# PodCraft Android App

Native Android client for the PodCraft podcast generator, built with Jetpack Compose and Material 3.

## Features

| Screen | Description |
|--------|-------------|
| **Home** | Landing page with feature overview and auth-aware CTA |
| **Login / Register** | JWT authentication via HTTP-only cookies |
| **Podcast Studio** | Generate podcast episodes from any topic, view transcripts |
| **Sessions** | Create, browse, and delete interactive podcast sessions |
| **Session Detail** | Chat-style transcript view with host/guest/interrupt cards |
| **Player** | Media3-powered audio playback with segment navigation |
| **Profile** | User info, role badge, admin panel link |
| **Admin** | User management (admin-only) |
| **Settings** | Server connection info, app version, sign out |

## Architecture

- **UI**: Jetpack Compose with Navigation Compose
- **Networking**: Retrofit + OkHttp with kotlinx-serialization
- **Auth**: JWT stored in encrypted cookies via `PersistentCookieJar` + `EncryptedSharedPreferences`
- **Playback**: Media3 `MediaLibraryService` with Android Auto support
- **Theme**: Material 3 with dark mode support (purple/indigo palette)

## Building

### Prerequisites

- JDK 17
- Android SDK (API 35)
- Gradle 8.11+

### Build debug APK

```bash
cd src/android
gradle assembleDebug
```

The APK is output to `app/build/outputs/apk/debug/`.

### Run tests

```bash
cd src/android
gradle testDebugUnitTest
```

## Configuration

The API base URL is configured at build time in `app/build.gradle.kts`:

```kotlin
buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:5001\"")
```

`10.0.2.2` is the Android emulator's alias for the host machine's localhost. For physical devices, change this to your machine's IP address.

## CI

The GitHub Actions workflow (`.github/workflows/android.yml`) runs on every push to `feature/android-auto` and PRs to `main` that touch `src/android/**`:

1. Build debug APK
2. Run unit tests
3. Upload APK artifact (30-day retention)
4. Upload test results (14-day retention)

## Project Structure

```
src/android/
├── app/
│   ├── build.gradle.kts          # Dependencies, SDK config
│   ├── proguard-rules.pro        # R8/ProGuard rules
│   └── src/
│       ├── main/
│       │   ├── AndroidManifest.xml
│       │   ├── java/com/podcraft/android/
│       │   │   ├── PodCraftApp.kt              # Application class
│       │   │   ├── api/                        # Retrofit API client + models
│       │   │   ├── playback/                   # Media3 playback service
│       │   │   ├── ui/                         # Compose screens
│       │   │   │   ├── MainActivity.kt         # NavHost + bottom nav
│       │   │   │   ├── admin/                  # Admin user management
│       │   │   │   ├── home/                   # Landing page
│       │   │   │   ├── login/                  # Login screen
│       │   │   │   ├── player/                 # Audio player
│       │   │   │   ├── podcasts/               # Podcast studio
│       │   │   │   ├── profile/                # User profile
│       │   │   │   ├── register/               # Registration
│       │   │   │   ├── sessions/               # Session list + detail
│       │   │   │   ├── settings/               # App settings
│       │   │   │   └── theme/                  # Material 3 theme
│       │   │   └── util/                       # Network utilities
│       │   └── res/                            # Resources (icons, strings)
│       └── test/                               # Unit tests
├── build.gradle.kts              # Root build config
├── settings.gradle.kts           # Gradle settings
└── gradle.properties             # Gradle properties
```
