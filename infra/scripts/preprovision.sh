#!/bin/bash
set -euo pipefail

if ! existing_key="$(azd env config get infra.parameters.aksSshPublicKey 2>/dev/null)"; then
  existing_key=""
fi
if [[ -z "${existing_key}" ]]; then
  if ! existing_key="$(azd env get-value AKS_SSH_PUBLIC_KEY 2>/dev/null)"; then
    existing_key=""
  fi
fi
if [[ -n "${existing_key}" ]]; then
  azd env set AKS_SSH_PUBLIC_KEY "${existing_key}" >/dev/null
  azd env config set infra.parameters.aksSshPublicKey "${existing_key}" >/dev/null
  echo "AKS_SSH_PUBLIC_KEY already configured."
  exit 0
fi

ssh_key=""
for candidate in "$HOME/.ssh/id_rsa.pub" "$HOME/.ssh/id_ed25519.pub"; do
  if [[ -f "${candidate}" ]]; then
    ssh_key="$(tr -d '\r\n' < "${candidate}")"
    echo "Using existing SSH public key: ${candidate}"
    break
  fi
done

if [[ -z "${ssh_key}" ]]; then
  key_path="$HOME/.ssh/azd_aks"
  mkdir -p "$HOME/.ssh"
  ssh-keygen -t rsa -b 4096 -N "" -f "${key_path}" >/dev/null
  ssh_key="$(tr -d '\r\n' < "${key_path}.pub")"
  echo "Generated a new SSH public key at ${key_path}.pub"
fi

azd env set AKS_SSH_PUBLIC_KEY "${ssh_key}" >/dev/null
azd env config set infra.parameters.aksSshPublicKey "${ssh_key}" >/dev/null
echo "Configured AKS_SSH_PUBLIC_KEY for provisioning."
