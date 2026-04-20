#!/bin/bash
set -euo pipefail

get_env_value() {
  local key="$1"
  local value=""
  if [[ -n "${!key:-}" ]]; then
    printf '%s' "${!key}"
    return 0
  fi
  if value="$(azd env get-value "${key}" 2>/dev/null)"; then
    printf '%s' "${value}"
  fi
}

resource_group="$(get_env_value AZURE_RESOURCE_GROUP)"
cluster_name="$(get_env_value AKS_CLUSTER_NAME)"

if [[ -z "${resource_group}" || -z "${cluster_name}" ]]; then
  echo "AZURE_RESOURCE_GROUP and AKS_CLUSTER_NAME must be available in the azd environment." >&2
  exit 1
fi

wait_for_cluster() {
  local started_cluster=0

  for _ in {1..60}; do
    local provisioning_state
    local power_state

    provisioning_state="$(az aks show \
      --resource-group "${resource_group}" \
      --name "${cluster_name}" \
      --query "provisioningState" \
      --output tsv 2>/dev/null || true)"
    power_state="$(az aks show \
      --resource-group "${resource_group}" \
      --name "${cluster_name}" \
      --query "powerState.code" \
      --output tsv 2>/dev/null || true)"

    if [[ "${power_state}" == "Stopped" && "${started_cluster}" -eq 0 ]]; then
      az aks start \
        --resource-group "${resource_group}" \
        --name "${cluster_name}" \
        --only-show-errors >/dev/null
      started_cluster=1
      power_state="Starting"
    fi

    if [[ "${provisioning_state}" == "Succeeded" && "${power_state}" == "Running" ]]; then
      return 0
    fi

    sleep 10
  done

  return 1
}

if ! wait_for_cluster; then
  echo "AKS cluster '${cluster_name}' is not available for deployment." >&2
  exit 1
fi

az aks get-credentials \
  --resource-group "${resource_group}" \
  --name "${cluster_name}" \
  --overwrite-existing \
  --only-show-errors >/dev/null

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
rm -f "${root_dir}/src/web/.env.production"

namespace_name="$(get_env_value AKS_NAMESPACE)"
namespace_name="${namespace_name:-azure-podcast-generator}"
app_insights_connection_string="$(get_env_value APPLICATIONINSIGHTS_CONNECTION_STRING)"
jwt_secret="$(kubectl get secret api-config -n "${namespace_name}" -o jsonpath='{.data.jwt-secret}' 2>/dev/null | base64 --decode || true)"
if [[ -z "${jwt_secret}" ]]; then
  jwt_secret="$(get_env_value JWT_SECRET)"
fi
if [[ -z "${jwt_secret}" ]]; then
  jwt_secret="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
fi

kubectl create namespace "${namespace_name}" --dry-run=client -o yaml | kubectl apply --validate=false -f - >/dev/null
kubectl create secret generic api-config \
  --namespace "${namespace_name}" \
  --from-literal=jwt-secret="${jwt_secret}" \
  --from-literal=applicationinsights-connection-string="${app_insights_connection_string}" \
  --dry-run=client -o yaml | kubectl apply --validate=false -f - >/dev/null

export SERVICE_API_IMAGE_NAME="$(get_env_value SERVICE_API_IMAGE_NAME)"
export SERVICE_DEVBOX_IMAGE_NAME="$(get_env_value SERVICE_DEVBOX_IMAGE_NAME)"
export SERVICE_WEB_IMAGE_NAME="$(get_env_value SERVICE_WEB_IMAGE_NAME)"
export API_MANAGED_IDENTITY_CLIENT_ID="$(get_env_value API_MANAGED_IDENTITY_CLIENT_ID)"

node "${root_dir}/scripts/render-aks-manifests.mjs"

echo "Connected kubectl context to AKS cluster '${cluster_name}'."
