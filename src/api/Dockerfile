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

# --- Azure OpenAI / AI Foundry (cast service LLM provider) ---
# These NON-SECRET pointers tell the cast-service to call a real LLM instead
# of the mock template. AUTHENTICATION is provided by a per-repo Azure
# service principal whose credentials are projected into the pod via the
# `liliput-azure-sp` Kubernetes Secret (see
# .github/skills/azure-app-registration). The API reads that Secret at
# startup (services/azure-secret-bootstrap.ts) and populates
# AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET into process.env
# so ClientSecretCredential / DefaultAzureCredential just work.
#
# AZURE_OPENAI_ENDPOINT is also projected from the Secret at runtime, but
# we bake a sensible default here so the image is usable in any env where
# the operator has wired up `crgar-liliput-ai`.
#
# Deployments available on `crgar-liliput-ai`:
#   * gpt-5             — chat (default)
#   * gpt-5-mini        — chat
#   * text-embedding-3-small — embeddings
#   * whisper           — transcription
#   * gpt-4o-mini-tts   — text-to-speech
ENV LLM_PROVIDER=azure
ENV AZURE_OPENAI_ENDPOINT=https://crgar-liliput-ai.openai.azure.com/
ENV AZURE_AI_FOUNDRY_ENDPOINT=https://crgar-liliput-ai.services.ai.azure.com/
ENV AZURE_OPENAI_DEPLOYMENT_NAME=gpt-5
ENV AZURE_OPENAI_API_VERSION=2024-10-21
ENV AZURE_OPENAI_MODEL_DISPLAY_NAME="gpt-5 (Azure AI Foundry · crgar-liliput-ai)"

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
