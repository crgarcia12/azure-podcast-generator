# Increment Plan — Interactive Podcast Chat

## ext-002: Segment-based podcast generation (API)

- **Type:** extension
- **FRD:** frd-interactive-podcast.md
- **Scope:** Restructure podcast generation to produce discrete segments. Create session management APIs (`POST /api/podcasts/sessions`, `GET /api/podcasts/sessions/:id`, `GET /api/podcasts/sessions`). Each session holds ordered segments with individual audio generation. Update mock provider for segment-based flow. Existing one-shot API remains unchanged.
- **User Stories:** US-IC-1 (backend), US-IC-6 (backend)
- **Acceptance Criteria:**
  - [ ] `POST /api/podcasts/sessions` creates a session with initial segments (text only) from a topic.
  - [ ] `GET /api/podcasts/sessions/:id` returns full session state (segments, interrupts, metadata).
  - [ ] `GET /api/podcasts/sessions` lists sessions for the authenticated user.
  - [ ] `POST /api/podcasts/sessions/:id/segments/:index/audio` generates audio for one segment.
  - [ ] Mock provider generates segment-based episodes for local development.
  - [ ] Existing `POST /api/podcasts` and `GET /api/podcasts` endpoints still work unchanged.
- **Test Strategy:** Vitest unit tests for session store, segment generation, and audio-per-segment. Integration tests for new endpoints with auth. Regression on existing podcast endpoints.
- **Dependencies:** none

## ext-003: Session state machine and revision model

- **Type:** extension
- **FRD:** frd-interactive-podcast.md
- **Scope:** Add session/segment status enums, revision tracking, and interrupt state machine to the session API. Implement `POST /api/podcasts/sessions/:id/interrupt` with idempotency (`clientRequestId`), `409` rejection for concurrent interrupts, stale segment eviction, and revision bumping. Add `DELETE /api/podcasts/sessions/:id` for session deletion. Enforce limits (10 sessions/user, 50 segments/session, 20 interrupts/session).
- **User Stories:** US-IC-5 (state management)
- **Acceptance Criteria:**
  - [ ] Sessions have `status` field: `generating | ready | interrupted | error`.
  - [ ] Segments have `status` field: `pending | generating | ready | failed | stale`.
  - [ ] Session `revision` increments on each interrupt.
  - [ ] `POST /interrupt` with `clientRequestId` is idempotent (same ID returns same result).
  - [ ] `POST /interrupt` returns `409` when another interrupt is already processing.
  - [ ] Segments after interrupt point are marked `stale`; their audio is evicted.
  - [ ] `DELETE /sessions/:id` removes session and all audio data.
  - [ ] Limits enforced: max sessions, segments, interrupts.
- **Test Strategy:** Vitest unit tests for state transitions, idempotency, concurrent interrupt rejection, limit enforcement.
- **Dependencies:** ext-002

## ext-003b: AI interrupt conversation logic

- **Type:** extension
- **FRD:** frd-interactive-podcast.md
- **Scope:** Wire the interrupt endpoint to Azure OpenAI (and mock provider). When an interrupt is processed: assemble conversation history as AI context, generate new segments where the host asks the user's question and the guest answers, then continue the interview in the new direction. For sessions with 20+ segments, trim context to last 10 + stored summary.
- **User Stories:** US-IC-5 (AI continuation)
- **Acceptance Criteria:**
  - [ ] The host naturally incorporates the user's question; the guest provides a relevant answer.
  - [ ] Continuation segments follow the new direction, not the pre-interrupt thread.
  - [ ] Full conversation history (segments + interrupts) is sent as AI context.
  - [ ] For sessions with 20+ segments, context is trimmed to last 10 + summary.
  - [ ] Context summary is stored in session metadata for reuse.
  - [ ] Mock provider supports interrupt flow with deterministic responses.
- **Test Strategy:** Vitest unit tests for context assembly, summarization, prompt construction. Integration tests for interrupt → new segments flow.
- **Dependencies:** ext-003

## ext-004: Segment player UI with navigation

- **Type:** extension
- **FRD:** frd-interactive-podcast.md
- **Scope:** Build the interactive podcast player on the web frontend. Segment-by-segment playback with auto-advance. Play/pause, previous/next segment controls. Segment progress indicator. Audio caching — request audio for 3 upcoming segments. Transcript view with current-segment highlighting and scroll-follow. Mobile-first layout with large touch targets.
- **User Stories:** US-IC-1 (frontend), US-IC-2
- **Acceptance Criteria:**
  - [ ] Player displays current segment text and plays its audio.
  - [ ] Auto-advances to next segment when current finishes.
  - [ ] Previous/next buttons navigate between segments.
  - [ ] Segment indicator shows "Segment N of M".
  - [ ] Audio is pre-fetched for 3 upcoming segments.
  - [ ] Transcript below player highlights the current segment and scrolls to follow.
  - [ ] Controls are minimum 44×44px for touch safety.
  - [ ] Responsive layout works at 360px width.
- **Test Strategy:** Playwright e2e tests for segment playback, navigation, and transcript display. Component behavior tested via mocked API responses.
- **Dependencies:** ext-002

## ext-005: Voice and text interrupt UI

- **Type:** extension
- **FRD:** frd-interactive-podcast.md
- **Scope:** Add interrupt interaction to the player. Microphone button activates Web Speech API for voice input with transcription preview. Text input field as fallback. On submit, call the interrupt API, discard stale cached audio, load new segments, and resume playback. Handle browser speech API unavailability gracefully.
- **User Stories:** US-IC-3, US-IC-4
- **Acceptance Criteria:**
  - [ ] Microphone button pauses playback and starts recording (Web Speech API).
  - [ ] Recording indicator is visible during voice capture.
  - [ ] Transcribed text shown for user to confirm, edit, or cancel.
  - [ ] Text input field available as alternative to voice.
  - [ ] On send, interrupt API is called, new segments load, playback resumes.
  - [ ] Pre-cached segments after interrupt point are discarded.
  - [ ] If Web Speech API unavailable, mic button is hidden with info message.
  - [ ] Loading state shown while AI generates response segments.
- **Test Strategy:** Playwright e2e tests for text interrupt flow (voice mocked). Unit tests for speech API detection and fallback.
- **Dependencies:** ext-003b, ext-004

## ext-006: Session history and interrupt timeline

- **Type:** extension
- **FRD:** frd-interactive-podcast.md
- **Scope:** Session list page showing past interactive sessions. Session detail page with full transcript including inline user interruptions. Interrupts visually distinct with "You asked:" labels and input method badges. Session metadata (topic, date, segment count, interrupt count).
- **User Stories:** US-IC-6 (frontend), US-IC-7
- **Acceptance Criteria:**
  - [ ] Session list shows past sessions with topic, date, segment count, and interrupt count.
  - [ ] Clicking a session opens the interactive player pre-loaded with all segments.
  - [ ] User interruptions appear inline in the transcript at the correct positions.
  - [ ] Interrupts are visually distinct (highlighted, labeled, showing voice/text badge).
  - [ ] User can relisten to any past session including interrupt segments.
- **Test Strategy:** Playwright e2e for session list, session detail with interrupts. Vitest for session list API response formatting.
- **Dependencies:** ext-005

## Dependency Graph

```
ext-002 (Segment API)
  ├── ext-003 (State Machine) ── ext-003b (AI Logic) ── ext-005 (Interrupt UI) ── ext-006 (History)
  └── ext-004 (Player UI) ──────────────────────────── ext-005
```

## Rollback Plan

Each increment is independently rollback-able:
- ext-006: Remove history UI, revert to current podcast list
- ext-005: Remove interrupt UI, player still works for passive listening
- ext-004: Remove segment player, revert to current single-audio player
- ext-003: Remove interrupt endpoint, sessions are generate-only
- ext-002: Remove session APIs, revert to current one-shot podcast flow
