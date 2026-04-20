# FRD: Interactive Podcast Chat

## Overview

Transform the podcast listening experience from passive playback into an interactive conversation. While listening to a generated podcast, the user can interrupt at any moment — via voice or text — to ask a question, challenge a point, or steer the interview in a new direction. The host weaves the user's input into the conversation naturally, the guest responds, and the interview continues along the new thread. The podcast plays segment by segment with smart audio caching for smooth playback and fast pivots.

## User Stories

### US-IC-1: Segment-by-Segment Playback
**As a** listener,
**I want** the podcast to play one segment (one host-guest exchange) at a time with automatic progression,
**So that** I can follow the conversation naturally and interrupt between exchanges.

**Acceptance Criteria:**
- The generated transcript is split into discrete segments (one host question + guest answer = one segment).
- Audio is generated per segment, not for the entire episode at once.
- Segments auto-advance: when one finishes playing, the next begins automatically.
- Up to 3 segments are pre-generated (audio cached) ahead of the current playback position.
- A visible segment indicator shows current position (e.g., "Segment 3 of 8").

### US-IC-2: Segment Navigation
**As a** listener who may be distracted (e.g., driving),
**I want** to navigate between segments with previous/next controls,
**So that** I can replay a segment I missed or skip ahead.

**Acceptance Criteria:**
- "Previous segment" button replays the prior segment from the start.
- Pressing "previous" multiple times steps back further (segment 5 → 4 → 3).
- "Next segment" button skips to the next segment.
- Play/pause button controls the current segment.
- Navigation state is preserved — the user can go back, re-listen, then continue forward.
- Controls are large enough for safe touch interaction (minimum 44×44px tap targets).

### US-IC-3: Voice Interrupt
**As a** listener who is driving or hands-busy,
**I want** to press a button to pause the podcast and speak my question,
**So that** I can interact without typing.

**Acceptance Criteria:**
- A prominent "Interrupt" / microphone button is always visible during playback.
- Pressing the button: (1) pauses audio playback, (2) activates the microphone, (3) shows a recording indicator.
- The user speaks their question. Recording stops on silence detection (2s pause) or when the user presses the button again.
- Speech is transcribed to text using the browser Web Speech API (v1 — no Azure STT fallback).
- **Review mode (default):** Transcribed text is shown for confirmation. User can edit, cancel, or send.
- **Auto-send mode (opt-in, for driving):** After silence detection, the transcription is sent automatically with a brief toast notification. User can undo within 3 seconds.
- After sending, the AI regenerates the transcript from the interrupt point: host asks the user's question, guest answers, and the interview continues in the new direction.
- All pre-cached audio after the interrupt point is evicted. New segments get fresh audio on demand.
- If the browser doesn't support Web Speech API, the mic button is hidden and an info message suggests text input.

### US-IC-4: Text Input Fallback
**As a** listener who prefers typing or is in a quiet environment,
**I want** to type my question instead of speaking,
**So that** I have an alternative interaction method.

**Acceptance Criteria:**
- A text input field is available alongside the microphone button.
- Typing a question and submitting it triggers the same flow as voice interrupt (pause → generate new segment → resume).
- The text input is accessible during playback without stopping it — the user types, then hits send to interrupt.
- The input supports multi-line text for longer questions or comments.

### US-IC-5: AI Conversational Continuation
**As a** listener,
**I want** the podcast to naturally incorporate my question and then continue in a new direction,
**So that** the interview feels organic and responsive to my curiosity.

**Acceptance Criteria:**
- When the user submits a question, the AI generates a new segment: the host rephrases/asks the user's question, the guest answers thoughtfully.
- After answering, the AI generates follow-up segments that continue the interview in a direction inspired by the user's question — not returning to the pre-interrupt script.
- The conversation maintains context: the guest references earlier points when relevant.
- The host's tone and style remain consistent throughout interrupts.
- The AI receives the full conversation history (all prior segments + user interrupts) as context.

### US-IC-6: Podcast Session History
**As a** listener,
**I want** my podcast sessions saved with full history — transcript, audio, and my interruptions,
**So that** I can revisit past conversations.

**Acceptance Criteria:**
- Each podcast session is stored with: topic, all segments (text + audio), user interruptions (with timestamps), and creation date.
- The podcast list page shows past sessions with topic, date, segment count, and interrupt count.
- Clicking a past session reopens it in the interactive player — the user can relisten and see their past interruptions inline.
- User interruptions are visually distinct in the transcript (e.g., highlighted, with a "You asked:" label).
- Sessions persist for the lifetime of the application instance (in-memory, consistent with current storage).

### US-IC-7: Interrupt History in Transcript
**As a** listener reviewing a past session,
**I want** to see my interruptions inline in the transcript,
**So that** I can follow the conversation flow including my contributions.

**Acceptance Criteria:**
- The transcript view shows segments in order, with user interruptions displayed between the segments they occurred after.
- Each interrupt shows: the user's original question (text), whether it was voice or text input, and when it occurred.
- The transcript is scrollable and highlights the currently-playing segment.

## Integration Points

- **Existing podcast generation** — builds on the current `POST /api/podcasts` flow but restructures it for segment-based generation.
- **Existing authentication** — all interactive podcast endpoints require auth cookies.
- **Existing navigation** — the `/podcasts` page evolves to support both quick-generate (current) and interactive mode.
- **Azure OpenAI** — uses the same deployment for script generation, now with conversation history context.
- **Azure Speech** — uses the same service for per-segment audio synthesis.
- **Mock provider** — mock mode must support segment-based generation for local development.

## Text Generation Lifecycle

The full transcript (all segment text) is generated **upfront** when a session is created or an interrupt is processed. Only **audio synthesis** is lazy and per-segment. This simplifies the player:
- The frontend always knows the total segment count and full text.
- Audio is requested on demand (3 segments ahead) and cached.
- On interrupt: new text is generated for all segments from the interrupt point forward. Audio for stale segments is evicted.

## API Design

### New Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `POST /api/podcasts/sessions` | POST | Create an interactive podcast session from a topic. Returns session ID + all segments (text only) + session revision. |
| `GET /api/podcasts/sessions/:sessionId` | GET | Get full session state: segments, interrupts, metadata, current revision. |
| `GET /api/podcasts/sessions` | GET | List all sessions for the authenticated user (summary: id, topic, date, segment count, interrupt count). |
| `GET /api/podcasts/sessions/:sessionId/segments/:segmentId/audio` | GET | Get audio for a specific segment. Returns audio bytes with cache headers. Generates on first request, cached thereafter. Returns `404` if segment is stale. |
| `POST /api/podcasts/sessions/:sessionId/interrupt` | POST | Submit a user interrupt. Body: `{ questionText, inputMethod, afterSegmentId, clientRequestId }`. Returns updated segment list + new revision. Rejects with `409` if an interrupt is already processing. Idempotent on `clientRequestId`. |
| `DELETE /api/podcasts/sessions/:sessionId` | DELETE | Delete a session and all its data (privacy/retention). |

### Existing Endpoints (unchanged)

| Endpoint | Method | Description |
|---|---|---|
| `POST /api/podcasts` | POST | Original one-shot generation (backward compatible). |
| `GET /api/podcasts` | GET | List one-shot episodes (backward compatible). |
| `GET /api/podcasts/:episodeId/audio` | GET | Stream one-shot episode audio (backward compatible). |

## Data Model

### PodcastSession
```typescript
interface PodcastSession {
  id: string;               // UUID
  userId: string;
  topic: string;
  revision: number;          // incremented on each interrupt
  status: 'generating' | 'ready' | 'interrupted' | 'error';
  segments: PodcastSegment[];
  interrupts: UserInterrupt[];
  pendingInterruptId?: string; // non-null while an interrupt is being processed
  createdAt: Date;
  updatedAt: Date;
}
```

### PodcastSegment
```typescript
interface PodcastSegment {
  id: string;               // immutable UUID — survives index changes
  index: number;             // current position in the segment list
  hostLine: string;
  guestLine: string;
  status: 'pending' | 'generating' | 'ready' | 'failed' | 'stale';
  revision: number;          // session revision when this segment was created
  generatedAfterInterrupt?: string; // interrupt ID that triggered this segment
  createdAt: Date;
}
```

Audio is stored **separately** in an `AudioCache` map (`segmentId → Buffer`) with:
- Max entries: 50 per session (LRU eviction)
- Stale segments are evicted immediately on interrupt
- Audio is regenerated on demand if evicted

### UserInterrupt
```typescript
interface UserInterrupt {
  id: string;               // UUID
  clientRequestId: string;   // client-provided for idempotency
  afterSegmentId: string;    // segment ID this interrupt follows
  questionText: string;
  inputMethod: 'voice' | 'text';
  createdAt: Date;
}
```

### Limits
- Max 10 active sessions per user
- Max 50 segments per session
- Max 20 interrupts per session
- Question text: 5–500 characters

## Edge Cases

- **Interrupt during audio generation:** The interrupt endpoint returns `409 Conflict` if another interrupt is already processing. Client retries with same `clientRequestId` for idempotency.
- **Rapid successive interrupts:** Second interrupt is rejected with `409`. UI disables interrupt button while processing.
- **Empty or nonsensical questions:** Validate 5–500 characters. If AI can't incorporate the question, the host acknowledges it and redirects.
- **Very long conversations (20+ segments):** Trim AI context window to recent segments (last 10) plus a summary of earlier ones. Summary stored in session metadata.
- **Browser doesn't support Web Speech API:** Fall back to text-only mode, hide the microphone button, show info message.
- **Audio generation fails for a segment:** Segment status set to `failed`. Show text transcript, offer retry button. Other segments unaffected.
- **Session navigation while new segments generate:** Show loading indicator on upcoming segments, allow replaying completed ones.
- **Network interruption during playback:** Buffer current segment fully before playing. Show offline indicator if audio fetch fails.
- **Stale audio request after interrupt:** Audio GET returns `404` for segments with `stale` status. Client refetches with new segment IDs.
- **Microphone permission denied:** Show clear error message directing user to browser settings. Fall back to text input.
- **No sessions yet (empty state):** Show welcome message with "Create your first interactive podcast" CTA.
- **Page refresh during generation:** Session status is `generating`. On reload, show progress indicator and poll until `ready`.
- **Max session/segment limits reached:** Return `429` with clear message. Suggest deleting old sessions.

## Error Handling

- Missing/invalid session ID returns `404` with `{ "error": "Session not found" }`.
- Interrupt on non-existent session returns `404`.
- Topic validation follows existing rules (empty, too long → `400`).
- Azure AI failures during segment generation return `502` with partial session state preserved.
- Audio generation failures for individual segments return `502` but don't invalidate the session.
- All errors are logged with session context for debugging.

## Non-Functional Requirements

- **Latency:** New segment text generation < 10 seconds. Audio per segment < 5 seconds. Total interrupt-to-playback < 15 seconds.
- **Caching:** Pre-generate audio for 3 upcoming segments to eliminate playback gaps.
- **Mobile-first:** All controls (play, pause, prev, next, interrupt, text input) must be thumb-reachable on phone screens.
- **Accessibility:** Play controls must be keyboard-navigable. Screen readers must announce segment transitions and recording state.
- **Security:** Voice data is processed client-side (Web Speech API) or sent to Azure Speech — never stored on our servers as raw audio.
- **Observability:** Log segment generation times, interrupt frequency, and session duration for performance monitoring.

## Out of Scope for This Increment

- Real-time streaming audio (segments are discrete, not streamed mid-generation).
- Multi-user collaborative podcast sessions.
- Android Auto / CarPlay integration.
- Persistent storage beyond application lifetime (database).
- Export podcast as downloadable file (MP3/WAV).
- Custom voice selection for host/guest.
- Sharing sessions between users.
- Azure Speech-to-Text for voice input (v1 uses browser Web Speech API only).
- Cross-device session sync.
