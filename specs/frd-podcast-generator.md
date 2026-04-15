# FRD: Podcast Generator

## Overview

Add a mobile-first podcast generation experience for authenticated users. A user supplies a topic, the system creates an interview-style script with a host and guest, synthesizes the episode into spoken audio using Azure services, and lets the user read the transcript and listen in the browser.

## User Stories

- As an authenticated listener, I want to enter a topic and generate an episode so that I can listen to a fresh podcast on demand.
- As a mobile user, I want the podcast experience to work comfortably on a phone so that I can generate and listen while away from a desktop.
- As a listener, I want to see the generated script while audio is available so that I can follow along or skim the conversation.
- As a listener, I want clear failure feedback when the AI or speech service is unavailable so that I know whether to retry.

## Integration Points

- **Existing authentication flow** — podcast generation requires a valid auth cookie from the current `/api/auth/login` flow and redirects unauthenticated users to `/login`.
- **Existing navigation** — authenticated navigation adds a `Podcasts` entry without removing `Profile`, `Admin`, or `Logout`.
- **Existing profile page** — profile gains a clear path into the podcast generator experience.
- **Existing API application** — new podcast endpoints live alongside the current auth/admin routes and reuse the existing structured logging and error-response shape.
- **Existing Azure deployment** — the API container app gains Azure OpenAI and Azure AI Speech configuration without changing the current deployment topology.

## Acceptance Criteria

- [ ] An authenticated user can open `/podcasts`, enter a topic, and submit a generation request.
- [ ] The system generates an interview-style script with alternating host and guest turns.
- [ ] The generated episode includes a readable transcript in the UI.
- [ ] The system synthesizes the script into playable audio and exposes it to the browser without requiring a file download.
- [ ] The browser UI renders correctly on common phone-sized screens and keeps primary actions visible without horizontal scrolling.
- [ ] Unauthenticated users attempting to open podcast pages or APIs are redirected to login or receive a 401 JSON error, consistent with the current auth model.
- [ ] When Azure generation or speech synthesis fails, the user sees a human-readable error and can try again without refreshing the page.

## Edge Cases

- Empty or whitespace-only topic: reject the request with validation feedback.
- Overly long topic: reject the request with a clear length validation error.
- AI returns incomplete or malformed script structure: fail the request instead of synthesizing broken content.
- Script generation succeeds but speech synthesis fails: preserve the transcript and surface an audio-generation error.
- Repeated submissions while a generation is already in progress: keep the UI disabled until the current request finishes.

## Error Handling

- Validation errors return `400` with `{ "error": string }`.
- Missing authentication returns `401` with `{ "error": "Not authenticated" }`.
- Missing Azure configuration returns `503` with `{ "error": string }`.
- Upstream Azure AI or Speech failures return `502` with `{ "error": string }`.
- The frontend keeps the last successful episode visible when a subsequent generation attempt fails.

## Non-Functional Requirements

- **Performance:** The API should begin responding immediately and complete a typical generation request within 60 seconds.
- **Security:** Azure credentials stay server-side only; no service keys are exposed to browser code.
- **Accessibility:** The topic form must have labeled controls, keyboard submission, visible focus states, and transcript text that remains readable on mobile screens.
- **Responsiveness:** The primary podcast workflow must be usable at 360px width and above.
- **Observability:** Generation and synthesis failures must be logged with enough context to diagnose Azure-side issues.

## Out of Scope for This Increment

- User interruptions or follow-up questions during playback.
- Android Auto integration.
- Long-term episode history or persistence beyond the running application instance.
