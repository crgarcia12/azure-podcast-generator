# syntax=docker/dockerfile:1.7
#
# Liliput single-container build for the Azure Podcast Generator.
#
# Builds both the Express API and the Next.js Web app and runs them inside
# one container, fronted by a small Node proxy. See LILIPUT_DEPLOY_CONTRACT.md
# and scripts/liliput-launcher.mjs for the why.

ARG BASE_PATH=/dev/crgarcia12/azure-podcast-generator/liliput-task-069d6fd4

# ---------- API build ----------
FROM mcr.microsoft.com/devcontainers/javascript-node:20-bookworm AS api-build
WORKDIR /api
COPY src/api/package.json src/api/package-lock.json* ./
RUN npm ci
COPY src/api/tsconfig.json ./
COPY src/api/src ./src
RUN npm run build && npm prune --omit=dev

# ---------- Web build (basePath baked in) ----------
FROM mcr.microsoft.com/devcontainers/javascript-node:20-bookworm AS web-build
ARG BASE_PATH
ENV BASE_PATH=${BASE_PATH}
ENV NEXT_PUBLIC_BASE_PATH=${BASE_PATH}
ENV NEXT_PUBLIC_API_URL=${BASE_PATH}
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /web
COPY src/web/package.json src/web/package-lock.json* ./
RUN npm ci
COPY src/web/ ./
RUN npm run build

# ---------- Runner ----------
FROM mcr.microsoft.com/devcontainers/javascript-node:20-bookworm AS runner
ARG BASE_PATH
ENV NODE_ENV=production
ENV PORT=8080
ENV BASE_PATH=${BASE_PATH}

# --- Dev-preview defaults (Liliput / single-container only) ---
# Liliput's deployment does NOT apply our k8s manifests, so any auth-related
# env vars defined there never reach the running pod. Bake the dev-preview
# defaults into the image so the app is usable out-of-the-box:
#   * SEED_ADMIN_*         seed an admin user at boot (admin / admin1234)
#   * REGISTRATION_ENABLED keep open registration on (set explicitly so the
#                          runtime default doesn't flip it off because
#                          SEED_ADMIN_PASSWORD is set).
# These are PREVIEW credentials only — production deployments override them.
ENV SEED_ADMIN_USERNAME=admin
ENV SEED_ADMIN_PASSWORD=admin1234
ENV REGISTRATION_ENABLED=true

# --- Azure OpenAI (cast service LLM provider) ---
# These NON-SECRET pointers tell the cast-service to call a real LLM instead
# of the mock template. Authentication happens at runtime via federated
# managed identity:
#   * The pod's default ServiceAccount mints a JWT (audience
#     api://AzureADTokenExchange) using the K8s TokenRequest API.
#   * That JWT is exchanged for an Azure access token against AAD using
#     the user-assigned identity below as the client.
#   * The user-assigned identity has Cognitive Services / OpenAI User
#     roles on the AI Foundry resource. No API keys are shipped.
# See src/api/src/services/k8s-aad-credential.ts for the implementation
# and LILIPUT_DEPLOY_CONTRACT.md for why this is baked into the image
# rather than configured on the Deployment.
ENV LLM_PROVIDER=azure
ENV AZURE_OPENAI_ENDPOINT=https://compy-foundry-ercqwl.cognitiveservices.azure.com
ENV AZURE_OPENAI_DEPLOYMENT_NAME=podcast-gpt-4o-mini
ENV AZURE_OPENAI_API_VERSION=2024-10-21
ENV AZURE_OPENAI_MODEL_DISPLAY_NAME="gpt-4o-mini (Azure OpenAI · compy-foundry)"
ENV AZURE_TENANT_ID=f75dc6d8-f0ea-4a54-9d3c-622e4aef8eb3
ENV AZURE_OPENAI_CLIENT_ID=f14665ae-86f5-41c2-95ba-96e817132222

WORKDIR /app

# API artifacts
COPY --from=api-build /api/dist ./api/dist
COPY --from=api-build /api/node_modules ./api/node_modules
COPY --from=api-build /api/package.json ./api/package.json

# Next.js standalone bundle.
# The web-build stage only copies src/web/ into /web (no parent package.json
# or lockfile), so Next.js treats /web as the workspace root and emits the
# standalone bundle flat at /web/.next/standalone/server.js. Copy that
# directly so the launcher sees /app/web/server.js.
COPY --from=web-build /web/.next/standalone/ ./web/
COPY --from=web-build /web/.next/static ./web/.next/static
COPY --from=web-build /web/public ./web/public

# Launcher
COPY scripts/liliput-launcher.mjs ./launcher.mjs

EXPOSE 8080
CMD ["node", "launcher.mjs"]
