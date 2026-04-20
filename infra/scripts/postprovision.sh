#!/bin/bash
set -euo pipefail

echo -e "\033[0;32mPost-provision configuration...\033[0m"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SETTINGS_FILE="$ROOT_DIR/apphost.settings.json"
TEMPLATE_FILE="$ROOT_DIR/apphost.settings.template.json"

# Check if settings file exists, if not, copy from template
if [ ! -f "$SETTINGS_FILE" ]; then
    echo -e "\033[0;33mapphost.settings.json not found. Copying from template...\033[0m"
    if [ -f "$TEMPLATE_FILE" ]; then
        cp "$TEMPLATE_FILE" "$SETTINGS_FILE"
        echo -e "\033[0;32mTemplate copied successfully.\033[0m"
    else
        echo -e "\033[0;33mWarning: Template file not found at $TEMPLATE_FILE — skipping.\033[0m"
    fi
fi

resource_group="$(azd env get-value AZURE_RESOURCE_GROUP 2>/dev/null || true)"
cluster_name="$(azd env get-value AKS_CLUSTER_NAME 2>/dev/null || true)"
namespace_name="$(azd env get-value AKS_NAMESPACE 2>/dev/null || true)"
container_registry_name="$(azd env get-value AZURE_CONTAINER_REGISTRY_NAME 2>/dev/null || true)"
container_registry_endpoint="$(azd env get-value AZURE_CONTAINER_REGISTRY_ENDPOINT 2>/dev/null || true)"

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

azd env set AZURE_AKS_CLUSTER_NAME "${cluster_name}" >/dev/null

if ! wait_for_cluster; then
  echo "AKS cluster not available yet, skipping Kubernetes context setup. It will be configured when the cluster is provisioned and a deployment is performed."
  exit 0
fi

if [[ -n "${container_registry_name}" ]]; then
  az aks update \
    --resource-group "${resource_group}" \
    --name "${cluster_name}" \
    --attach-acr "${container_registry_name}" \
    --only-show-errors >/dev/null
fi

az config set extension.use_dynamic_install=yes_without_prompt >/dev/null

app_routing_enabled="$(az aks show \
  --resource-group "${resource_group}" \
  --name "${cluster_name}" \
  --query "addonProfiles.webApplicationRouting.enabled" \
  --output tsv 2>/dev/null || true)"

if [[ "${app_routing_enabled}" != "true" ]]; then
  app_routing_output=""
  if ! app_routing_output="$(az aks approuting enable \
    --resource-group "${resource_group}" \
    --name "${cluster_name}" \
    --only-show-errors 2>&1)"; then
    if [[ "${app_routing_output}" != *"already enabled"* ]]; then
      printf '%s\n' "${app_routing_output}" >&2
      exit 1
    fi
  fi
fi

az aks get-credentials \
  --resource-group "${resource_group}" \
  --name "${cluster_name}" \
  --overwrite-existing \
  --only-show-errors >/dev/null

echo -e "\033[0;32mProvisioning complete!\033[0m"
echo -e "\033[0;36m  - Resource Group: ${resource_group}\033[0m"
echo -e "\033[0;36m  - AKS Cluster: ${cluster_name}\033[0m"
echo -e "\033[0;36m  - Namespace: ${namespace_name:-not set}\033[0m"
echo -e "\033[0;36m  - Container Registry: ${container_registry_endpoint:-not set}\033[0m"
