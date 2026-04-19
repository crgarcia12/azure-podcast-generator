#!/bin/bash
set -euo pipefail

resource_group="$(azd env get-value AZURE_RESOURCE_GROUP 2>/dev/null || true)"
cluster_name="$(azd env get-value AKS_CLUSTER_NAME 2>/dev/null || true)"

if [[ -z "${resource_group}" || -z "${cluster_name}" ]]; then
  echo "AZURE_RESOURCE_GROUP and AKS_CLUSTER_NAME must be available in the azd environment." >&2
  exit 1
fi

az aks get-credentials \
  --resource-group "${resource_group}" \
  --name "${cluster_name}" \
  --overwrite-existing \
  --only-show-errors >/dev/null

rm -f "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/src/web/.env.production"

echo "Connected kubectl context to AKS cluster '${cluster_name}'."
