# PRD: PodCraft Android Auto Companion

## Vision

Bring PodCraft interactive podcasts to the car. A native Android app that integrates with Android Auto so commuters can listen to their AI-generated podcast sessions hands-free, with voice-controlled playback and interrupt capabilities — the same interactive experience as the web, optimized for driving.

## Problem Statement

PodCraft users generate interactive podcast sessions via the web app, but the experience is desktop/mobile-browser-only. Commuters — a primary podcast audience — cannot access their sessions in the car through Android Auto. There is no native app to provide background audio playback, lock-screen controls, or car-optimized media browsing.

## User Personas

### Commuter Claire
- Drives 30–60 minutes daily
- Generates podcast sessions on topics she's curious about before leaving
- Wants to listen in the car via Android Auto with play/pause/skip controls
- Occasionally wants to ask a follow-up question via voice while driving

### Weekend Explorer Sam
- Uses PodCraft on weekends for long drives
- Browses past sessions and picks one to relisten
- Values the interrupt feature to steer conversations on topics that interest him

## Core Features

### F-AA-1: Android Auto Media Browse
Browse podcast sessions from the car head unit. Sessions are organized by recency with title, topic, and segment count visible. Tap to start playback.

### F-AA-2: Segment-by-Segment Playback
Play podcast segments sequentially with automatic advancement. Background playback continues when the screen is off or other apps are in focus. Audio focus management ensures proper pause/resume with navigation prompts.

### F-AA-3: Playback Controls
Standard media controls: play, pause, skip forward (next segment), skip back (previous segment). Controls available on the car head unit, lock screen, and notification.

### F-AA-4: Voice Interrupt (Future — v2)
Press a steering wheel button or use a voice command to pause and ask a question. The app sends the interrupt to the API and resumes with the AI-generated response. *Deferred to v2 due to Android Auto voice interaction constraints.*

### F-AA-5: Phone UI — Session List
Simple phone screen showing the user's podcast sessions. Login, browse sessions, tap to play. Minimal UI — the car experience is primary.

### F-AA-6: Phone UI — Player
Full-screen player with segment text, play/pause, prev/next, and a progress bar showing segment position.

### F-AA-7: Authentication
Login screen with username/password. Auth token stored securely. Sessions fetched from the existing PodCraft API.

## Success Metrics

- App builds successfully via GitHub Actions
- Android Auto media browse tree shows podcast sessions
- Playback works end-to-end: browse → select → play → auto-advance
- Standard media controls (play/pause/skip) work on car head unit and lock screen

## Technical Constraints

- **Kotlin** — standard for new Android projects
- **Media3** — AndroidX media library for MediaSession + MediaLibraryService
- **Jetpack Compose** — modern declarative UI for phone screens
- **Retrofit + OkHttp** — HTTP client for PodCraft API integration
- **Gradle** — build system, compatible with GitHub Actions
- **Min SDK 26** (Android 8.0) — covers 95%+ of Android Auto devices
- **Target SDK 35** — latest stable

## Out of Scope (v1)

- Voice interrupt from car (v2)
- Offline playback / download for offline
- Push notifications for new episodes
- Wear OS companion
- CarPlay (iOS)
- Google Play Store submission (manual for now)
