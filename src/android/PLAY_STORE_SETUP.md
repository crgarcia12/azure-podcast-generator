# Play Store Deployment Guide

## One-Time Setup

### 1. Create a Google Play Developer Account
- Go to https://play.google.com/console
- Pay the $25 registration fee
- Complete identity verification

### 2. Generate a Release Keystore

```bash
keytool -genkeypair \
  -alias podcraft \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -keystore release.keystore \
  -storepass YOUR_STORE_PASSWORD \
  -keypass YOUR_KEY_PASSWORD \
  -dname "CN=PodCraft, OU=Mobile, O=YourOrg, L=City, ST=State, C=US"
```

> ⚠️ **BACK UP YOUR KEYSTORE** — if you lose it, you cannot update your app on the Play Store.

### 3. Configure GitHub Secrets

Go to **Settings → Secrets and variables → Actions** in your GitHub repo and add:

| Secret | Description | How to get it |
|--------|-------------|---------------|
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded keystore file | `base64 -w0 release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password | The password you used with keytool |
| `ANDROID_KEY_ALIAS` | Key alias | `podcraft` (or whatever you chose) |
| `ANDROID_KEY_PASSWORD` | Key password | The key password from keytool |
| `PLAY_STORE_KEY_BASE64` | Base64-encoded service account JSON | See step 4 |

### 4. Create a Play Store Service Account

1. Go to **Google Cloud Console** → **IAM & Admin** → **Service Accounts**
2. Create a new service account (e.g., `podcraft-deploy`)
3. Download the JSON key file
4. In **Google Play Console** → **Settings** → **API access**:
   - Link your Google Cloud project
   - Grant the service account **Release Manager** permissions
5. Base64-encode the JSON key: `base64 -w0 play-store-key.json`
6. Add it as `PLAY_STORE_KEY_BASE64` in GitHub Secrets

### 5. Create a GitHub Environment

1. Go to **Settings → Environments** → **New environment**
2. Name it `play-store`
3. Add protection rules (e.g., required reviewers for production deployments)

### 6. Create Your App on Play Console

1. Go to **Google Play Console** → **All apps** → **Create app**
2. Fill in:
   - App name: `PodCraft — AI Podcast Generator`
   - Default language: English (United States)
   - App or game: App
   - Free or paid: Free
3. Complete the **Store listing** (the metadata in `fastlane/metadata/` can be copy-pasted)
4. Complete the **Content rating** questionnaire
5. Set up a **Privacy policy** URL
6. Complete the **Target audience** section

## Deployment

### Automatic (via CI)

#### Deploy to internal testing:
```bash
# Tag a release
git tag android-v1.0.0
git push origin android-v1.0.0
```
This triggers the release workflow, builds a signed AAB, and uploads to the internal testing track.

#### Manual deployment via GitHub Actions:
1. Go to **Actions** → **Android Release**
2. Click **Run workflow**
3. Choose the track: `internal`, `beta`, or `production`
4. Click **Run workflow**

### Promotion flow:
```
internal → beta → production (10% staged rollout)
```

### Manual (via Fastlane)

```bash
cd src/android

# Set environment variables
export KEYSTORE_FILE=release.keystore
export KEYSTORE_PASSWORD=your_password
export KEY_ALIAS=podcraft
export KEY_PASSWORD=your_password
export PLAY_STORE_KEY_PATH=play-store-key.json

# Build and deploy to internal
fastlane deploy_internal

# Promote to beta
fastlane promote_to_beta

# Promote to production (10% rollout)
fastlane promote_to_production
```

## Version Management

Versions are tracked in `version.properties`:
- `VERSION_CODE` — Auto-incremented by CI on each release build
- `VERSION_NAME` — Set from git tag (e.g., `android-v1.2.3` → `1.2.3`)

To manually bump:
```bash
# Edit src/android/version.properties
VERSION_CODE=2
VERSION_NAME=1.1.0
```

## Build Variants

| Variant | Application ID | API URL | Use Case |
|---------|---------------|---------|----------|
| `devDebug` | `com.podcraft.android.dev.debug` | `http://10.0.2.2:5001` | Local development |
| `devRelease` | `com.podcraft.android.dev` | `http://10.0.2.2:5001` | Dev release testing |
| `prodDebug` | `com.podcraft.android.debug` | Build type default | Prod debugging |
| `prodRelease` | `com.podcraft.android` | `https://podcraft.azurecontainerapps.io` | Play Store |

## Troubleshooting

### "Upload failed: APK/AAB must be signed"
Ensure GitHub secrets are set correctly. Check the base64 encoding: `base64 -w0 release.keystore | wc -c` should be > 0.

### "Version code already exists"
The version code must be higher than any previously uploaded version. Check `version.properties` and ensure CI incremented it.

### "Service account doesn't have access"
In Play Console → Settings → API access, ensure the service account has **Release Manager** role for this app.
