#!/bin/bash
set -euo pipefail

workspace_root="${DEVBOX_WORKSPACE_ROOT:-/workspace}"
repository_url="${DEVBOX_REPOSITORY_URL:-https://github.com/crgarcia12/azure-podcast-generator.git}"
repository_branch="${DEVBOX_REPOSITORY_BRANCH:-main}"
repository_path="${DEVBOX_REPOSITORY_PATH:-${workspace_root}/azure-podcast-generator}"
home_dir="${HOME:-${workspace_root}/home}"

mkdir -p "${workspace_root}" "${home_dir}"
export HOME="${home_dir}"

if [[ ! -d "${repository_path}/.git" ]]; then
  mkdir -p "$(dirname "${repository_path}")"
  if ! git clone --depth 1 --branch "${repository_branch}" "${repository_url}" "${repository_path}"; then
    echo "Warning: failed to clone ${repository_url} into ${repository_path}. Starting with the persistent workspace only." >&2
    mkdir -p "${repository_path}"
  fi
fi

cd "${repository_path}"

echo "Devbox ready in ${repository_path}"
echo "Attach with: kubectl exec -it deploy/devbox -n ${AKS_NAMESPACE:-azure-podcast-generator} -- bash"

exec sleep infinity
