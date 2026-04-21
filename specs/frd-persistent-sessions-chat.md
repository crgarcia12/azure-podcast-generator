# FRD: Persistent Sessions with Chat-Based Episode Editing

**Status:** Draft
**Traces to:** PRD — Interactive Podcast Sessions

## 1. Overview

When a user logs in, they land on a list of their podcast sessions. Sessions are stored in a SQLite database so they survive container restarts and redeployments. When a user opens a session, they see the episode player alongside a **chat panel** that shows the full conversation history (user edits + system responses). The user can pause playback and use the chat to direct changes to the episode flow — designed for hands-free use while driving.

## 2. User Stories

### US-1: Persistent Sessions
> As a user, I want my podcast sessions to persist across container restarts so I don't lose my work.

**Acceptance Criteria:**
- Sessions, segments, interrupts, and audio data are stored in a SQLite database file
- The database file is stored at a configurable path (`DB_PATH` env var, default `./data/podcast.db`)
- All existing session CRUD operations work identically but read/write from SQLite
- Data survives API process restarts

### US-2: Login → Sessions List
> As a user, after I log in I want to see my sessions list immediately.

**Acceptance Criteria:**
- After successful login, redirect to `/podcasts/sessions`
- The sessions list shows all my sessions with topic, title, segment count, and status

### US-3: Chat-Based Episode Editing
> As a user, I want to see my edits as a conversation in a chat panel so I can track what I asked and how the episode changed.

**Acceptance Criteria:**
- The session player page includes a **chat panel** below the player
- Each interrupt the user sends appears as a "user" chat message
- Each system response (acknowledgment of the edit) appears as an "assistant" chat message
- Chat messages are stored in the database and persist across page reloads
- The chat panel auto-scrolls to the latest message

### US-4: Car-Friendly Flow
> As a user listening in my car, I want to pause playback, speak or type my edit, and resume.

**Acceptance Criteria:**
- The existing InterruptInput with voice support and auto-send "driving mode" is preserved
- The chat panel shows alongside the player so the user can see their edit history
- The interrupt input is part of the chat panel (send a message = send an interrupt)
- The flow is: pause → type/speak edit → system processes → new segments appear → resume playback

## 3. Technical Design

### 3.1 Database Layer

**Technology:** SQLite via `better-sqlite3` (synchronous, zero-config, single file)

**Schema:**
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'generating',
  context_summary TEXT,
  pending_interrupt_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE segments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  host_line TEXT NOT NULL,
  guest_line TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  revision INTEGER NOT NULL DEFAULT 1,
  generated_after_interrupt TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE interrupts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  after_segment_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  input_method TEXT NOT NULL DEFAULT 'text',
  created_at TEXT NOT NULL
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  interrupt_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE audio_cache (
  segment_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  audio_data BLOB NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_segments_session ON segments(session_id);
CREATE INDEX idx_interrupts_session ON interrupts(session_id);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX idx_audio_cache_session ON audio_cache(session_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);
```

### 3.2 API Changes

- New file: `src/api/src/models/database.ts` — SQLite connection singleton, schema migration
- Refactor: `src/api/src/models/session-store.ts` — replace in-memory Maps with SQLite queries
- New model: `src/api/src/models/chat-store.ts` — chat message CRUD
- Update: `src/api/src/routes/sessions.ts` — include chat messages in session response, add chat endpoints
- Update: `src/api/src/services/interactive-session-service.ts` — create chat messages on interrupt

### 3.3 New API Endpoints

```
GET  /api/podcasts/sessions/:sessionId/chat    → list chat messages
POST /api/podcasts/sessions/:sessionId/chat    → send chat message (triggers interrupt)
```

### 3.4 Web Changes

- Update: `src/web/src/app/login/page.tsx` — redirect to `/podcasts/sessions` after login
- Update: `src/web/src/app/podcasts/sessions/[sessionId]/page.tsx` — add chat panel
- New hook: extend `useInteractiveSession` with chat message loading and sending
- Integrate existing `ChatMessage`, `MessageList` components into session player

## 4. Current Implementation

- Sessions stored in in-memory `Map<string, PodcastSession>`
- Audio cached in in-memory `Map<string, Buffer>`
- Chat routes exist as placeholders (`routes/chat.ts`)
- Chat UI components exist but are unused (`ChatMessage`, `ChatInput`, `MessageList`, `TypingIndicator`)
- InterruptInput already has voice + driving mode support
- Session player page exists with full playback + interrupt flow
