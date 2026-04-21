# FRD: Android Auto Media App

## Overview

A native Android app that exposes PodCraft interactive podcast sessions as a media browse tree for Android Auto, with segment-by-segment playback, standard media controls, and a companion phone UI. Integrates with the existing PodCraft Express API for authentication and content.

## User Stories

### US-AA-1: Android Auto Media Browse

**As a** driver using Android Auto,
**I want** to see my podcast sessions in the car head unit media browser,
**So that** I can pick a session to listen to while driving.

**Acceptance Criteria:**
- The app registers as a media source in Android Auto.
- The root browse tree shows a "Your Sessions" category.
- Each session shows: title, topic (as subtitle), and segment count.
- Sessions are ordered by most recent first.
- Tapping a session starts playback from segment 1.
- If no sessions exist, show a "No sessions yet — create one on the web" message.
- The browse tree refreshes when the app resumes.

### US-AA-2: Segment-by-Segment Playback

**As a** listener,
**I want** podcast segments to play sequentially with auto-advance,
**So that** I can listen hands-free while driving.

**Acceptance Criteria:**
- Audio for each segment is fetched from `GET /api/podcasts/sessions/:sessionId/segments/:segmentId/audio`.
- Segments play in order (index 0, 1, 2, …).
- When a segment finishes, the next segment starts automatically.
- Up to 2 segments are pre-fetched ahead of current playback.
- Playback continues in the background (foreground service with notification).
- Audio focus is requested on play and released on pause/stop.
- When audio focus is lost temporarily (e.g., navigation prompt), playback pauses and resumes automatically.
- When audio focus is lost permanently, playback stops.
- MediaSession metadata updates per segment: title = "Segment N of M", subtitle = session topic.

### US-AA-3: Playback Controls

**As a** driver,
**I want** play/pause/skip controls on the car head unit and lock screen,
**So that** I can control playback without looking at my phone.

**Acceptance Criteria:**
- Play/pause toggles playback of the current segment.
- Skip forward advances to the next segment.
- Skip back returns to the previous segment (or restarts current if < 3 seconds played).
- Controls appear on: Android Auto head unit, lock screen notification, and notification shade.
- Seeking within a segment is supported via the car's seek bar.

### US-AA-4: Phone UI — Login

**As a** user,
**I want** to log in with my PodCraft credentials on my phone,
**So that** the app can fetch my podcast sessions.

**Acceptance Criteria:**
- Login screen with username and password fields.
- Calls `POST /api/auth/login` with credentials.
- Stores the auth cookie/token securely (EncryptedSharedPreferences).
- On success, navigates to the session list.
- On failure, shows error message.
- Persists login across app restarts.
- Logout button in settings clears stored credentials.

### US-AA-5: Phone UI — Session List

**As a** user on my phone,
**I want** to see my podcast sessions,
**So that** I can pick one to play.

**Acceptance Criteria:**
- Fetches sessions from `GET /api/podcasts/sessions`.
- Displays: title, topic, segment count, interrupt count, date.
- Pull-to-refresh to reload.
- Tapping a session navigates to the player screen.
- Empty state: "No sessions yet — create one on podcraft.app"

### US-AA-6: Phone UI — Player

**As a** user on my phone,
**I want** a player screen showing the current segment and controls,
**So that** I can follow along and control playback.

**Acceptance Criteria:**
- Shows session title and current segment text (host + guest lines).
- Play/pause button, previous/next segment buttons.
- Segment indicator: "Segment N of M".
- Progress bar for current segment audio position.
- Shares the same MediaSession as Android Auto (controls are synchronized).

## API Integration

All endpoints are on the existing PodCraft Express API. The Android app is a consumer only.

| Endpoint | Method | Purpose |
|---|---|---|
| `POST /api/auth/login` | POST | Authenticate user, receive auth cookie |
| `GET /api/auth/me` | GET | Verify auth session |
| `GET /api/podcasts/sessions` | GET | List user's interactive sessions |
| `GET /api/podcasts/sessions/:id` | GET | Get session detail with segments |
| `GET /api/podcasts/sessions/:id/segments/:segId/audio` | GET | Stream segment audio (WAV) |

### Authentication Strategy
The API uses HTTP-only cookies for web browsers. For the Android client:
- The app will send credentials via `POST /api/auth/login` and store the returned `Set-Cookie` token.
- OkHttp's `CookieJar` will manage cookie persistence across requests.
- Cookies are persisted to `EncryptedSharedPreferences` for security.

## Data Model (Client-Side)

```kotlin
data class SessionSummary(
    val id: String,
    val topic: String,
    val title: String,
    val segmentCount: Int,
    val interruptCount: Int,
    val status: String,
    val createdAt: String,
    val updatedAt: String,
)

data class Session(
    val id: String,
    val topic: String,
    val title: String,
    val summary: String,
    val revision: Int,
    val status: String,
    val segments: List<Segment>,
    val interrupts: List<Interrupt>,
    val createdAt: String,
    val updatedAt: String,
)

data class Segment(
    val id: String,
    val index: Int,
    val hostLine: String,
    val guestLine: String,
    val status: String,
    val revision: Int,
    val audioUrl: String,
    val generatedAfterInterrupt: String? = null,
)

data class Interrupt(
    val id: String,
    val afterSegmentId: String,
    val questionText: String,
    val inputMethod: String,
    val createdAt: String,
)
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 Android App                      │
│  ┌───────────────┐  ┌────────────────────────┐  │
│  │  Phone UI     │  │  Android Auto          │  │
│  │  (Compose)    │  │  (MediaBrowser)        │  │
│  │  - Login      │  │  - Browse tree         │  │
│  │  - Sessions   │  │  - Playback controls   │  │
│  │  - Player     │  │                        │  │
│  └───────┬───────┘  └──────────┬─────────────┘  │
│          │                     │                 │
│  ┌───────┴─────────────────────┴─────────────┐  │
│  │         PlaybackService                    │  │
│  │  (Media3 MediaLibraryService)             │  │
│  │  - MediaSession                           │  │
│  │  - Audio playback (ExoPlayer/Media3)      │  │
│  │  - Segment pre-fetching                   │  │
│  │  - Foreground notification                │  │
│  └───────────────────┬───────────────────────┘  │
│                      │                           │
│  ┌───────────────────┴───────────────────────┐  │
│  │         PodCraftApiClient                  │  │
│  │  (Retrofit + OkHttp + CookieJar)         │  │
│  └───────────────────┬───────────────────────┘  │
└──────────────────────┼───────────────────────────┘
                       │ HTTPS
              ┌────────┴────────┐
              │  PodCraft API   │
              │  (Express.js)   │
              └─────────────────┘
```

## Edge Cases

- **No network in tunnel:** Playback continues for pre-fetched segments. Show "Offline" indicator when fetch fails. Resume fetching when network returns.
- **API returns 401:** Redirect to login screen. Clear stored credentials.
- **Empty session list:** Show friendly empty state with instructions.
- **Audio fetch fails for a segment:** Skip to next segment. Show brief toast.
- **App killed by OS:** Foreground service keeps playback alive. On cold start, restore last session/position from saved state.
- **Bluetooth disconnect:** Pause playback, hold position.

## Non-Functional Requirements

- **Min SDK:** 26 (Android 8.0)
- **Target SDK:** 35
- **Language:** Kotlin
- **UI:** Jetpack Compose (Material 3)
- **Media:** AndroidX Media3 (MediaSession, ExoPlayer)
- **HTTP:** Retrofit 2 + OkHttp 4
- **Build:** Gradle 8.x with Kotlin DSL
- **CI:** GitHub Actions — build debug APK on push/PR

## Out of Scope (v1)

- Voice interrupt from Android Auto (requires custom voice interaction — v2)
- Offline download/caching beyond segment pre-fetch
- Wear OS
- Google Play Store automated deployment
- Custom artwork per session
- CarPlay (iOS)
