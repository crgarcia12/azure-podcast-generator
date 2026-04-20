#!/usr/bin/env bash
set -euo pipefail

namespace="$(azd env get-value AKS_NAMESPACE 2>/dev/null || true)"
namespace="${namespace:-azure-podcast-generator}"

declare -a env_vars=()
declare -a unset_env_vars=()
declare -a secret_literals=()

add_env_var() {
  env_vars+=("$1=$2")
}

unset_when_missing() {
  local name="$1"
  local value="$2"
  if [[ -n "${value}" ]]; then
    add_env_var "${name}" "${value}"
  else
    unset_env_vars+=("${name}-")
  fi
}

service_web_endpoint_url="${SERVICE_WEB_ENDPOINT_URL:-}"
if [[ -z "${service_web_endpoint_url}" ]]; then
  service_web_endpoint_url="$(azd env get-value SERVICE_WEB_ENDPOINT_URL 2>/dev/null || true)"
fi
service_web_endpoint_url="${service_web_endpoint_url%/}"

cookie_secure="${COOKIE_SECURE:-}"
if [[ -z "${cookie_secure}" ]]; then
  if [[ "${service_web_endpoint_url}" == https://* ]]; then
    cookie_secure="true"
  else
    cookie_secure="false"
  fi
fi

allowed_origins="${ALLOWED_ORIGINS:-}"
if [[ -z "${allowed_origins}" && -n "${service_web_endpoint_url}" ]]; then
  allowed_origins="${service_web_endpoint_url}"
fi

add_env_var "COOKIE_SECURE" "${cookie_secure}"
unset_when_missing "ALLOWED_ORIGINS" "${allowed_origins}"
unset_when_missing "REGISTRATION_ENABLED" "${REGISTRATION_ENABLED:-}"
unset_when_missing "SEED_ADMIN_USERNAME" "${SEED_ADMIN_USERNAME:-}"

host_voice="${PODCAST_HOST_VOICE:-en-US-JennyNeural}"
guest_voice="${PODCAST_GUEST_VOICE:-en-US-GuyNeural}"

has_api_key_config=false
if [[ -n "${AZURE_OPENAI_ENDPOINT:-}" && -n "${AZURE_OPENAI_DEPLOYMENT_NAME:-}" && -n "${AZURE_OPENAI_API_KEY:-}" && -n "${AZURE_SPEECH_KEY:-}" && -n "${AZURE_SPEECH_REGION:-}" ]]; then
  has_api_key_config=true
fi

has_managed_identity_config=false
if [[ -n "${AZURE_OPENAI_ENDPOINT:-}" && -n "${AZURE_OPENAI_DEPLOYMENT_NAME:-}" && -n "${AZURE_SPEECH_REGION:-}" && -n "${AZURE_SPEECH_RESOURCE_ID:-}" ]]; then
  has_managed_identity_config=true
fi

if [[ "${has_api_key_config}" == true ]]; then
  add_env_var "PODCAST_PROVIDER" "azure"
  add_env_var "AZURE_OPENAI_ENDPOINT" "${AZURE_OPENAI_ENDPOINT}"
  add_env_var "AZURE_OPENAI_DEPLOYMENT_NAME" "${AZURE_OPENAI_DEPLOYMENT_NAME}"
  add_env_var "AZURE_OPENAI_API_VERSION" "${AZURE_OPENAI_API_VERSION:-2024-10-21}"
  add_env_var "AZURE_SPEECH_REGION" "${AZURE_SPEECH_REGION}"
  add_env_var "PODCAST_HOST_VOICE" "${host_voice}"
  add_env_var "PODCAST_GUEST_VOICE" "${guest_voice}"
  secret_literals+=("--from-literal=AZURE_OPENAI_API_KEY=${AZURE_OPENAI_API_KEY}")
  secret_literals+=("--from-literal=AZURE_SPEECH_KEY=${AZURE_SPEECH_KEY}")
  unset_env_vars+=("AZURE_SPEECH_RESOURCE_ID-")
elif [[ "${has_managed_identity_config}" == true ]]; then
  add_env_var "PODCAST_PROVIDER" "azure"
  add_env_var "AZURE_OPENAI_ENDPOINT" "${AZURE_OPENAI_ENDPOINT}"
  add_env_var "AZURE_OPENAI_DEPLOYMENT_NAME" "${AZURE_OPENAI_DEPLOYMENT_NAME}"
  add_env_var "AZURE_OPENAI_API_VERSION" "${AZURE_OPENAI_API_VERSION:-2024-10-21}"
  add_env_var "AZURE_SPEECH_REGION" "${AZURE_SPEECH_REGION}"
  add_env_var "AZURE_SPEECH_RESOURCE_ID" "${AZURE_SPEECH_RESOURCE_ID}"
  add_env_var "PODCAST_HOST_VOICE" "${host_voice}"
  add_env_var "PODCAST_GUEST_VOICE" "${guest_voice}"
  unset_env_vars+=("AZURE_OPENAI_API_KEY-" "AZURE_SPEECH_KEY-")
else
  add_env_var "PODCAST_PROVIDER" "mock"
  unset_env_vars+=(
    "AZURE_OPENAI_ENDPOINT-"
    "AZURE_OPENAI_DEPLOYMENT_NAME-"
    "AZURE_OPENAI_API_VERSION-"
    "AZURE_OPENAI_API_KEY-"
    "AZURE_SPEECH_REGION-"
    "AZURE_SPEECH_KEY-"
    "AZURE_SPEECH_RESOURCE_ID-"
    "PODCAST_HOST_VOICE-"
    "PODCAST_GUEST_VOICE-"
  )
fi

if [[ -n "${SEED_ADMIN_PASSWORD:-}" ]]; then
  secret_literals+=("--from-literal=SEED_ADMIN_PASSWORD=${SEED_ADMIN_PASSWORD}")
else
  unset_env_vars+=("SEED_ADMIN_PASSWORD-")
fi

if (( ${#secret_literals[@]} > 0 )); then
  kubectl create secret generic api-runtime-secrets \
    -n "${namespace}" \
    "${secret_literals[@]}" \
    --dry-run=client \
    -o yaml | kubectl apply -f -

  kubectl set env deployment/api \
    -n "${namespace}" \
    --from=secret/api-runtime-secrets >/dev/null
fi

if (( ${#env_vars[@]} > 0 )); then
  kubectl set env deployment/api \
    -n "${namespace}" \
    "${env_vars[@]}" >/dev/null
fi

if (( ${#unset_env_vars[@]} > 0 )); then
  kubectl set env deployment/api \
    -n "${namespace}" \
    "${unset_env_vars[@]}" >/dev/null
fi

kubectl rollout status deployment/api -n "${namespace}" --timeout=300s
echo "Configured AKS API deployment in namespace '${namespace}'."
