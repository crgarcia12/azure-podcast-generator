FROM mcr.microsoft.com/devcontainers/javascript-node:20-bookworm AS deps
WORKDIR /app
COPY src/api/package.json src/api/package-lock.json* ./
RUN npm ci --omit=dev

FROM mcr.microsoft.com/devcontainers/javascript-node:20-bookworm AS build
WORKDIR /app
COPY src/api/package.json src/api/package-lock.json* ./
RUN npm ci
COPY src/api/tsconfig.json ./
COPY src/api/src/ ./src/
RUN npm run build

FROM mcr.microsoft.com/devcontainers/javascript-node:20-bookworm AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY src/api/package.json ./
EXPOSE 8080
ENV PORT=8080
CMD ["node", "dist/index.js"]
