# Copilot Instructions

## Project Overview

Azure Podcast Generator — create interview-style podcast episodes from a topic. Users register, log in, submit a topic, and get a host-and-guest transcript with synthesized audio playback in the browser. Falls back to a mock provider when Azure AI is not configured.

This project uses the **spec2cloud** framework for spec-driven development. See `AGENTS.md` for orchestrator details, `.spec2cloud/state.json` for current state, and `.github/skills/*/SKILL.md` for agent skills.

## Build, Test, and Lint Commands

### Running locally

```bash
npm run dev:aspire          # Recommended: all services via Aspire (API :5001, Web :3001)
npm run dev:all             # Alternative: API + Web + Docs concurrently without Aspire
npm run dev:api             # API only
npm run dev                 # Web only
```

### Building

```bash
npm run build:all           # Build API (tsc) + Web (next build)
cd src/api && npm run build # API only
cd src/web && npm run build # Web only
```

### Testing

```bash
# Full suite
npm run test:all

# By layer
npm run test:api                                          # Vitest unit tests (API)
cd src/api && npm run test:unit                           # Unit tests only
cd src/api && npm run test:integration                    # Integration tests only
cd src/api && npm run test:watch                          # Watch mode
npm run test:cucumber                                     # Cucumber BDD tests
npm run test:e2e                                          # Playwright e2e tests

# Single test file
cd src/api && npx vitest run src/routes/__tests__/auth.test.ts
npx playwright test --config=e2e/playwright.config.ts e2e/auth.spec.ts
npx cucumber-js --tags @auth

# Cucumber tag filters: @auth, @registration, @login, @logout, @smoke, @api, @ui, @admin, @roles, @authorization
```

### Linting

```bash
cd src/api && npm run lint
cd src/web && npm run lint
```

### Deployment

```bash
azd auth login
azd up                      # Provision + deploy to Azure Container Apps
azd provision               # Provision only
azd deploy                  # Deploy only
azd down                    # Tear down all resources
```

## Architecture

### Service topology

Two services orchestrated by Aspire (`apphost.cs`), deployed as Azure Container Apps:

- **API** (`src/api/`) — Express.js on port 5001 (8080 in container). Auth, podcast generation, admin.
- **Web** (`src/web/`) — Next.js on port 3001 (3000 in container). Proxies `/api/*` to the API via `next.config.ts` rewrites.

Web depends on API (Aspire `WaitFor(api)`). No shared code package exists between them — types are defined independently in each service.

### API structure (`src/api/src/`)

- **Entry**: `index.ts` calls `createApp()` from `app.ts` and listens on `PORT` (default 5001)
- **App factory**: `app.ts` — `createApp()` wires middleware (helmet, cors, express.json, cookieParser, pinoHttp) and mounts routes
- **Routes**: each file in `routes/` exports a `mapXEndpoints(app)` function — not Express Router
  - `health.ts` → `GET /health`, `GET /api/info`
  - `auth.ts` → `POST /api/auth/register|login|logout`, `GET /api/auth/me`
  - `admin.ts` → `GET /api/admin/users`
  - `podcasts.ts` → `POST /api/podcasts`, `GET /api/podcasts/:episodeId/audio`
  - `chat.ts` → placeholder routes at `/api/chat/sessions`
- **Auth**: JWT tokens in HTTP-only cookies. Middleware in `middleware/auth.ts` (`requireAuth`, `requireRole('admin')`)
- **Storage**: in-memory `Map` stores (`models/user-store.ts`, `models/podcast-store.ts`) — no database
- **Podcast service**: `services/podcast-service.ts` — mock provider by default, Azure provider (`PODCAST_PROVIDER=azure`) uses Azure OpenAI + Azure Speech with `DefaultAzureCredential`
- **Logging**: pino via `logger.ts`, structured JSON. Never use `console.log`.
- **Error responses**: route-local `try/catch` returning `res.status(N).json({ error: "..." })`

### Web structure (`src/web/src/app/`)

- App Router with `output: 'standalone'` for containerization
- All pages are client components (`'use client'`) using direct `fetch` calls via `lib/api.ts`
- `lib/api.ts` exports `apiFetch()` which always sets `credentials: 'include'` for cookie auth
- Pages: landing (`/`), login, register, profile, admin, podcasts
- Components in `components/`: `NavBar`, chat UI components (ChatMessage, MessageList, ChatInput, TypingIndicator)
- Styling: Tailwind CSS utility classes

### Infrastructure (`infra/`)

Bicep templates provision: Container Apps Environment, ACR, Log Analytics, Application Insights, managed identities for API and Web container apps.

## Key Conventions

### Route pattern

New API routes follow this pattern — export a `mapXEndpoints(app: Express)` function, then call it from `app.ts`:

```typescript
// src/api/src/routes/my-feature.ts
export function mapMyFeatureEndpoints(app: Express) {
  app.get('/api/my-feature', requireAuth, async (req, res) => { ... });
}
```

### Authentication

JWT stored in HTTP-only cookie named `token`. Use `requireAuth` middleware for protected routes, `requireRole('admin')` for admin-only. `req.user` is set by the middleware.

### Environment variables

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | JWT signing key |
| `ALLOWED_ORIGINS` | CORS origins |
| `COOKIE_SECURE` | Secure cookie flag |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | Initial admin user |
| `PODCAST_PROVIDER` | `azure` or omit for mock |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT_NAME` | Azure OpenAI config |
| `AZURE_SPEECH_REGION`, `AZURE_SPEECH_KEY` or `AZURE_SPEECH_RESOURCE_ID` | Azure Speech config |

### Testing patterns

- **Cucumber**: Feature files live in `specs/features/*.feature`, step definitions in `tests/features/step-definitions/*.ts`. Custom `World` class in `tests/features/support/world.ts` provides `apiRequest()`, browser management, and cookie sync helpers. Hooks in `support/hooks.ts` auto-start Aspire.
- **Playwright**: Specs in `e2e/*.spec.ts` (no page object layer). Shared helpers in `e2e/test-helpers.ts` (`resetAppState`, `registerUser`, `loginUser`, `uniqueUser`). Custom fixture in `e2e/fixtures.ts` resets API state before each test. Runs single-worker, sequential.
- **Vitest + Supertest**: API route tests in `src/api/src/routes/__tests__/`. Use `createApp()` factory with Supertest — no running server needed.
- Both Cucumber and Playwright auto-start Aspire if not already running.

### Naming

- camelCase for variables/functions, PascalCase for types/interfaces, kebab-case for file names
- TypeScript strict mode — no `any` types

### Spec-driven rules

- Features must trace to specs in `specs/frd-*.md`
- Never modify existing tests without approval
- Never use `test.skip()`, `xit()`, or comment out tests
- Run the full test suite after changes (`npm run test:all`)
