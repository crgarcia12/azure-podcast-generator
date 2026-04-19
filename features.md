# PodCraft — Feature Summary

## Core Features

### 🎙 AI Podcast Generation
Enter any topic and get a full interview-style podcast episode with host and guest dialogue. Powered by Azure OpenAI (GPT-4o) for script writing and Azure Speech for voice synthesis with two distinct voices.

### 🔒 Registration Lock
Public registration is disabled by default (`REGISTRATION_ENABLED=false`). A seeded admin account is created on startup. Flip the env var to `true` when you're ready to go live.

### 📚 Episode History
All generated episodes are saved and listed on the Studio page. Revisit past transcripts and replay audio anytime.

### ⬇️ Audio Download
Download any episode's audio as a WAV file directly from the browser.

### 🎨 Polished UI (PodCraft Branding)
- Gradient hero landing page with feature highlights
- Sticky navbar with mobile hamburger menu
- Animated generation progress with rotating status messages
- Collapsible transcripts with speaker avatars (Host/Guest)
- Consistent violet/indigo design system across all pages
- Mobile-first responsive design

## Technical Details

| Feature | Implementation |
|---|---|
| AI Script Generation | Azure OpenAI GPT-4o via managed identity — 10-12 turn natural dialogue |
| Voice Synthesis | Azure Speech TTS with Jenny (host) and Guy (guest) neural voices |
| Auth | JWT in HTTP-only cookies, seeded admin user, lockable registration |
| Episode Storage | In-memory (resets on container restart) — sufficient for testing phase |
| Deployment | Azure Kubernetes Service (AKS) via GitHub Actions with OIDC auth |

## Login Credentials (Testing)
- **Username:** `admin`
- **Password:** `PodCraft2026!`
