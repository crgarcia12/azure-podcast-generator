# Increment Plan — Android Auto Media App

## aa-001: Project scaffold and API client

- **Type:** extension
- **FRD:** frd-android-auto.md
- **Scope:** Create the Android project under `src/android/` with Gradle (Kotlin DSL), set up dependencies (Media3, Retrofit, OkHttp, Compose, Material 3). Implement the `PodCraftApiClient` with Retrofit interfaces for auth, sessions, and segment audio. Implement cookie-based auth persistence with `EncryptedSharedPreferences`.
- **User Stories:** US-AA-4 (backend)
- **Acceptance Criteria:**
  - [ ] `src/android/` is a valid Android project buildable with `./gradlew assembleDebug`
  - [ ] Retrofit service interfaces defined for all API endpoints
  - [ ] OkHttp CookieJar persists auth cookies
  - [ ] Login API call works and stores credentials
- **Dependencies:** none

## aa-002: Playback service with Media3

- **Type:** extension
- **FRD:** frd-android-auto.md
- **Scope:** Implement `PlaybackService` extending `MediaLibraryService`. Create `MediaSession` with ExoPlayer. Handle play/pause/skip forward/skip back actions. Implement segment-by-segment playback with auto-advance. Foreground notification with controls. Audio focus management.
- **User Stories:** US-AA-2, US-AA-3
- **Acceptance Criteria:**
  - [ ] Foreground service plays audio segments sequentially
  - [ ] Auto-advances to next segment on completion
  - [ ] Play/pause/skip controls work via MediaSession
  - [ ] Notification shows current segment metadata
  - [ ] Audio focus properly managed
  - [ ] Pre-fetches 2 upcoming segments
- **Dependencies:** aa-001

## aa-003: Android Auto media browse tree

- **Type:** extension
- **FRD:** frd-android-auto.md
- **Scope:** Implement the `MediaLibraryService` browse tree callback. Root → "Your Sessions" → session items. Each session is a playable media item with title, subtitle (topic), and segment count. Tapping starts playback.
- **User Stories:** US-AA-1
- **Acceptance Criteria:**
  - [ ] App appears as media source in Android Auto
  - [ ] Browse tree shows sessions ordered by recency
  - [ ] Tapping a session starts segment playback
  - [ ] Empty state shows "No sessions" message
  - [ ] Browse tree refreshes on resume
- **Dependencies:** aa-002

## aa-004: Phone UI — login and session list

- **Type:** extension
- **FRD:** frd-android-auto.md
- **Scope:** Jetpack Compose screens for login and session list. Login form with error handling. Session list with pull-to-refresh. Navigation between screens. Persistent login check on startup.
- **User Stories:** US-AA-4, US-AA-5
- **Acceptance Criteria:**
  - [ ] Login screen with username/password
  - [ ] Error display on failed login
  - [ ] Session list shows all sessions with metadata
  - [ ] Pull-to-refresh reloads sessions
  - [ ] Tapping a session navigates to player
  - [ ] Auto-login on app restart if credentials stored
- **Dependencies:** aa-001

## aa-005: Phone UI — player screen

- **Type:** extension
- **FRD:** frd-android-auto.md
- **Scope:** Compose player screen bound to the `MediaSession`. Shows segment text, play/pause, prev/next, segment indicator, and seek bar. Shares the same playback state as Android Auto.
- **User Stories:** US-AA-6
- **Acceptance Criteria:**
  - [ ] Shows host/guest text for current segment
  - [ ] Play/pause, prev/next buttons
  - [ ] Segment indicator "Segment N of M"
  - [ ] Seek bar for current segment
  - [ ] Synchronized with Android Auto controls
- **Dependencies:** aa-002, aa-004

## aa-006: GitHub Actions CI workflow

- **Type:** infra
- **FRD:** frd-android-auto.md
- **Scope:** Create `.github/workflows/android.yml` that builds the Android app on push/PR to `feature/android-auto` branch. Setup Java 17, Gradle cache, run `assembleDebug`, upload APK as artifact.
- **Acceptance Criteria:**
  - [ ] Workflow triggers on push/PR to `feature/android-auto`
  - [ ] Builds debug APK successfully
  - [ ] Uploads APK as GitHub Actions artifact
  - [ ] Runs lint checks
- **Dependencies:** aa-001

## Dependency Graph

```
aa-001 (Scaffold + API Client)
  ├── aa-002 (Playback Service) → aa-003 (Auto Browse) → aa-005 (Phone Player)
  ├── aa-004 (Phone Login + List) ───────────────────── → aa-005
  └── aa-006 (GHA CI)
```
