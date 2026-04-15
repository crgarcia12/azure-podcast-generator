#!/usr/bin/env bash
set -euo pipefail

resource_group="$(azd env get-value AZURE_RESOURCE_GROUP 2>/dev/null)"
api_app_name="$(azd env get-value SERVICE_API_NAME 2>/dev/null)"
web_url="$(azd env get-value SERVICE_WEB_ENDPOINT_URL 2>/dev/null || true)"
if [[ -z "${web_url}" ]]; then
  web_url="$(azd env get-value REACT_APP_WEB_BASE_URL 2>/dev/null || true)"
fi

if [[ -z "${resource_group}" || -z "${api_app_name}" ]]; then
  echo "AZURE_RESOURCE_GROUP and SERVICE_API_NAME must be available in the azd environment." >&2
  exit 1
fi

allowed_origins="${ALLOWED_ORIGINS:-${web_url}}"
env_vars=("COOKIE_SECURE=true")
if [[ -n "${allowed_origins}" ]]; then
  env_vars+=("ALLOWED_ORIGINS=${allowed_origins}")
fi

secret_args=()
if [[ -n "${SEED_ADMIN_USERNAME:-}" && -n "${SEED_ADMIN_PASSWORD:-}" ]]; then
  secret_args+=("seed-admin-password=${SEED_ADMIN_PASSWORD}")
  env_vars+=("SEED_ADMIN_USERNAME=${SEED_ADMIN_USERNAME}")
  env_vars+=("SEED_ADMIN_PASSWORD=secretref:seed-admin-password")
fi

if [[ -n "${AZURE_OPENAI_ENDPOINT:-}" && -n "${AZURE_OPENAI_DEPLOYMENT_NAME:-}" && -n "${AZURE_OPENAI_API_KEY:-}" && -n "${AZURE_SPEECH_KEY:-}" && -n "${AZURE_SPEECH_REGION:-}" ]]; then
  secret_args+=("azure-openai-api-key=${AZURE_OPENAI_API_KEY}")
  secret_args+=("azure-speech-key=${AZURE_SPEECH_KEY}")
  env_vars+=("PODCAST_PROVIDER=azure")
  env_vars+=("AZURE_OPENAI_ENDPOINT=${AZURE_OPENAI_ENDPOINT}")
  env_vars+=("AZURE_OPENAI_DEPLOYMENT_NAME=${AZURE_OPENAI_DEPLOYMENT_NAME}")
  env_vars+=("AZURE_OPENAI_API_VERSION=${AZURE_OPENAI_API_VERSION:-2024-10-21}")
  env_vars+=("AZURE_OPENAI_API_KEY=secretref:azure-openai-api-key")
  env_vars+=("AZURE_SPEECH_REGION=${AZURE_SPEECH_REGION}")
  env_vars+=("AZURE_SPEECH_KEY=secretref:azure-speech-key")
  env_vars+=("PODCAST_HOST_VOICE=${PODCAST_HOST_VOICE:-en-US-JennyNeural}")
  env_vars+=("PODCAST_GUEST_VOICE=${PODCAST_GUEST_VOICE:-en-US-GuyNeural}")
elif [[ -n "${AZURE_OPENAI_ENDPOINT:-}" && -n "${AZURE_OPENAI_DEPLOYMENT_NAME:-}" && -n "${AZURE_SPEECH_REGION:-}" && -n "${AZURE_SPEECH_RESOURCE_ID:-}" ]]; then
  env_vars+=("PODCAST_PROVIDER=azure")
  env_vars+=("AZURE_OPENAI_ENDPOINT=${AZURE_OPENAI_ENDPOINT}")
  env_vars+=("AZURE_OPENAI_DEPLOYMENT_NAME=${AZURE_OPENAI_DEPLOYMENT_NAME}")
  env_vars+=("AZURE_OPENAI_API_VERSION=${AZURE_OPENAI_API_VERSION:-2024-10-21}")
  env_vars+=("AZURE_SPEECH_REGION=${AZURE_SPEECH_REGION}")
  env_vars+=("AZURE_SPEECH_RESOURCE_ID=${AZURE_SPEECH_RESOURCE_ID}")
  env_vars+=("PODCAST_HOST_VOICE=${PODCAST_HOST_VOICE:-en-US-JennyNeural}")
  env_vars+=("PODCAST_GUEST_VOICE=${PODCAST_GUEST_VOICE:-en-US-GuyNeural}")
else
  env_vars+=("PODCAST_PROVIDER=mock")
fi

if (( ${#secret_args[@]} > 0 )); then
  az containerapp secret set \
    --resource-group "${resource_group}" \
    --name "${api_app_name}" \
    --secrets "${secret_args[@]}" \
    --only-show-errors >/dev/null
fi

az containerapp update \
  --resource-group "${resource_group}" \
  --name "${api_app_name}" \
  --set-env-vars "${env_vars[@]}" \
  --only-show-errors >/dev/null

echo "Configured API container app '${api_app_name}' in resource group '${resource_group}'."
