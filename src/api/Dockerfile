# syntax=docker/dockerfile:1.7
#
# Liliput single-container build for the Azure Podcast Generator.
#
# Builds both the Express API and the Next.js Web app and runs them inside
# one container, fronted by a small Node proxy. See LILIPUT_DEPLOY_CONTRACT.md
# and scripts/liliput-launcher.mjs for the why.

ARG BASE_PATH=/dev/crgarcia12/azure-podcast-generator/liliput-task-15f4165a

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

WORKDIR /app

# API artifacts
COPY --from=api-build /api/dist ./api/dist
COPY --from=api-build /api/node_modules ./api/node_modules
COPY --from=api-build /api/package.json ./api/package.json

# Next.js standalone bundle.
# Because the repo has a top-level package-lock.json, Next.js treats the
# repo root as the workspace root and emits the standalone bundle nested
# under the relative project path: .next/standalone/src/web/*. We flatten
# that here so the launcher just sees /app/web/server.js.
COPY --from=web-build /web/.next/standalone/src/web/ ./web/
COPY --from=web-build /web/.next/static ./web/.next/static
COPY --from=web-build /web/public ./web/public

# Launcher
COPY scripts/liliput-launcher.mjs ./launcher.mjs

EXPOSE 8080
CMD ["node", "launcher.mjs"]
