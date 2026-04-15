# Azure Podcast Generator

Create short, interview-style podcast episodes from a topic. Authenticated users can generate a script, read the transcript, and listen to audio directly in the browser.

## What the app does

- Supports registration, login, profile, and admin flows
- Lets signed-in users open `/podcasts` and submit a topic
- Generates a host-and-guest transcript for the episode
- Plays synthesized audio in the browser
- Falls back to a mock provider for local development when Azure AI settings are not configured

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js, React, TypeScript |
| Backend | Express.js, TypeScript |
| AI/audio | Azure OpenAI, Azure AI Speech, or mock provider |
| Testing | Playwright, Cucumber.js, Vitest, Supertest |
| Deployment | Azure Container Apps via Azure Developer CLI (`azd`) |
| Local orchestration | Aspire |

## Getting started

Install dependencies:

```bash
npm install
cd src/web && npm install && cd ../..
cd src/api && npm install && cd ../..
```

Run the full app locally:

```bash
npm run dev:aspire
```

Or run the web app and API without Aspire:

```bash
npm run dev:all
```

After the app is running:

1. Register a user or sign in.
2. Open `/podcasts`.
3. Enter a topic such as `History of Boeing`.
4. Generate an episode and play it in the browser.

## Azure AI configuration

If no Azure podcast configuration is present, the API uses a mock provider so the end-to-end flow still works locally.

To use Azure-backed generation, configure:

```text
PODCAST_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_DEPLOYMENT_NAME=
AZURE_SPEECH_REGION=
```

Then choose one of these auth modes:

**API keys**

```text
AZURE_OPENAI_API_KEY=
AZURE_SPEECH_KEY=
```

**Managed identity**

```text
AZURE_SPEECH_RESOURCE_ID=
```

Optional settings:

```text
AZURE_OPENAI_API_VERSION=2024-10-21
PODCAST_HOST_VOICE=en-US-JennyNeural
PODCAST_GUEST_VOICE=en-US-GuyNeural
```

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev:aspire` | Start the web app and API with Aspire |
| `npm run dev:all` | Run web, API, and docs concurrently |
| `npm run build:all` | Build the API and web app |
| `npm run test:api` | Run API unit tests |
| `npm run test:cucumber` | Run Cucumber tests |
| `npm run test:e2e` | Run Playwright tests |
| `npm run test:all` | Run the full test suite |
| `azd up` | Provision and deploy to Azure |

## Project layout

```text
src/web/      Next.js frontend
src/api/      Express API
src/shared/   Shared types
e2e/          Playwright tests
tests/        Cucumber tests
infra/        Azure infrastructure and deployment scripts
docs/         Project documentation
```

## Deployment

This repo includes Azure deployment assets for Container Apps.

```bash
azd auth login
azd up
```

If you want Azure-backed podcast generation after deployment, make sure the API container app receives the Azure OpenAI and Azure Speech settings expected by the backend.

## License

[ISC](LICENSE)
