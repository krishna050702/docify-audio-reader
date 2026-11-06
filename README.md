# Docify — "Spotify for Your Documents" (Android, iOS & Web)

**Docify** transforms static **PDF (`.pdf`)**, **Microsoft Word (`.docx`)**, and **Text (`.txt`, `.md`)** documents into an effortless, Spotify-style audio experience. Instead of robotic screen readers that read page numbers, headers, and raw citations out loud, Docify treats **Documents as Albums** and **Sections as Playable Tracks**, complete with **live word-by-word synced lyrics** and a **Dual Hybrid TTS Engine** (Offline On-Device Neural TTS + Studio Cloud Neural Voices).

---

## Table of Contents
1. [Core Features](#1-core-features)
2. [System Architecture](#2-system-architecture)
3. [Project Structure](#3-project-structure)
4. [One-Click Setup & Quick Start](#4-one-click-setup--quick-start)
5. [TTS Engine Modes (On-Device Neural vs. Cloud)](#5-tts-engine-modes-on-device-neural-vs-cloud)
6. [Building for Android (.apk), Google Play Store (.aab) & iOS](#6-building-for-android-apk-google-play-store-aab--ios)
7. [Cloud Hosting (FastAPI Backend)](#7-cloud-hosting-fastapi-backend)

---

## 1. Core Features

| Feature | Description |
| :--- | :--- |
| **Smart Auto-Chaptering (Albums & Tracks)** | Automatically detects headings (`Chapter 1`, `1. Introduction`, `H1`/`H2`, font-size hierarchy) and splits any PDF or Word doc into skip-friendly tracks. |
| **Track 0: Executive Summary (TL;DR)** | Auto-generates a concise 60-second audio overview track at the start of every uploaded document so you can preview key takeaways first. |
| **Spotify "Lyrics" Synced Read-Along** | Highlights both the active sentence and the **exact word being spoken** in real time. Tap any sentence in the lyrics view to jump audio directly to that spot. |
| **Ear-Friendly Text Cleaner** | Strips out running page headers/footers (top/bottom 7% PDF margins), standalone page numbers (`Page 4 of 22`), academic citations (`[12, 14]`, `(Smith et al., 2024)`), raw URLs, and broken line hyphenations before synthesis. |
| **Dual Hybrid TTS Engine** | **Offline Mode:** On-Device Neural TTS (`Kokoro-82M` ONNX worker + iOS/Android Enhanced Neural voices) at `\$0` cost. **Cloud Mode:** Self-hosted FastAPI Neural TTS (`Edge-TTS` with exact word timestamps), OpenAI HD (`tts-1`), or ElevenLabs (`eleven_turbo_v2_5`). |
| **JIT Paragraph Lookahead Prefetching** | Zero waiting for large 100-page PDFs—synthesizes Paragraph 1 in `< 1 second` while pre-fetching and caching Paragraphs `N+1` and `N+2` in the background. |
| **Liked Clips (Audio Bookmarks) & Queues** | Tap the Heart/Bookmark icon while listening to save the exact quote and timestamp. Tap any saved clip later to jump right back to that sentence. |

---

## 2. System Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   React Native (Expo) Mobile App (iOS / Android)           │
│                                                                            │
│  ┌──────────────────┐   ┌───────────────────────┐   ┌───────────────────┐  │
│  │  Library Screen  │   │ Full-Screen Player    │   │ Neural TTS Studio │  │
│  │  • Upload PDF/DOC│   │ • Synced Word Lyrics  │   │ • Speed 0.8x-2.5x │  │
│  │  • Continue Card │   │ • Chapter Tracklist   │   │ • Offline / Cloud │  │
│  └────────┬─────────┘   └───────────┬───────────┘   └─────────┬─────────┘  │
│           │                         │                         │            │
│           ▼                         ▼                         ▼            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │              Zustand Persistent Store (AsyncStorage)                 │  │
│  └────────┬───────────────────────────────────────────────────┬─────────┘  │
│           │                                                   │            │
│           ▼                                                   ▼            │
│  ┌─────────────────────────────────┐       ┌────────────────────────────┐  │
│  │ Document Ingestion & Cleaner    │       │ HybridTTSEngine            │  │
│  │ • On-Device DOCX (JSZip/XML)    │       │ • JIT N+1, N+2 Prefetcher  │  │
│  │ • On-Device PDF Stream Fallback │       │ • FileSystem MP3 Cache     │  │
│  │ • Citation & Header Stripper    │       │ • On-Device Kokoro / OS    │  │
│  └────────┬────────────────────────┘       └─────────┬────────┬─────────┘  │
└───────────┼──────────────────────────────────────────┼────────┼────────────┘
            │ (Optional REST Upload)                   │        │
            ▼                                          │        ▼
┌──────────────────────────────────────────────────────┴────────┐   ┌────────┐
│              Python FastAPI Backend (/backend)                │   │ OpenAI │
│  • POST /api/parse-document (PyMuPDF margin & font analyzer)  │   │   or   │
│  • POST /api/tts/synthesize (Neural Audio + Word Timestamps)  │   │ 11Labs │
└───────────────────────────────────────────────────────────────┘   └────────┘
```

---

## 3. Project Structure

```
docify-audio-reader/
├── README.md                       # Complete project documentation
├── SETUP.md                        # Step-by-step installation & troubleshooting guide
├── PLAYSTORE_AND_HOSTING.md        # Play Store (.aab), APK sharing & cloud hosting guide
├── setup.bat                       # Windows 1-click setup & launcher (Command Prompt)
├── setup.ps1                       # Windows PowerShell automated setup & interactive menu
├── setup.sh                        # macOS / Linux automated setup script
├── .env.example                    # Environment variables template
├── render.yaml                     # Render.com 1-click cloud deployment blueprint
│
├── mobile/                         # React Native (Expo SDK 52 + TypeScript)
│   ├── App.tsx                     # Root tab navigation, MiniPlayer dock & modals
│   ├── app.json                    # Android/iOS bundle IDs, permissions & intent filters
│   ├── eas.json                    # Expo Application Services build profiles (APK & AAB)
│   ├── package.json                # Dependencies & build scripts
│   ├── tsconfig.json               # TypeScript configuration
│   └── src/
│       ├── types/index.ts          # Core TypeScript interfaces
│       ├── store/usePlayerStore.ts # Zustand state management + offline persistence
│       ├── services/
│       │   ├── textCleaner.ts      # Citation/header cleaner, chapter detector & Track 0 builder
│       │   ├── documentParser.ts   # Local DOCX/PDF parser + FastAPI client + sample albums
│       │   ├── onDeviceNeuralTts.ts# Kokoro-82M ONNX worker bridge & OS Neural voice discovery
│       │   └── ttsEngine.ts        # Unified audio/speech engine with lookahead prefetching
│       ├── components/
│       │   ├── MiniPlayer.tsx      # Persistent Spotify bottom bar
│       │   ├── NowPlayingModal.tsx # Full-screen Lyrics, Chapters & Voice selector modal
│       │   └── UploadModal.tsx     # File picker (.pdf, .docx, .txt) + direct text paste
│       └── screens/
│           ├── LibraryScreen.tsx   # Home screen, Continue Listening hero & Document Albums
│           ├── PlaylistsScreen.tsx # Saved Audio Highlights ("Liked Clips") & Playlists
│           └── SettingsScreen.tsx  # TTS Engine switcher, cleaner toggles & API keys
│
├── backend/                        # Python FastAPI Server
│   ├── main.py                     # API endpoints + serves interactive web preview
│   ├── parser.py                   # PyMuPDF layout-aware PDF parser & python-docx parser
│   ├── tts_service.py              # Neural TTS synthesis with WordBoundary timestamps
│   ├── requirements.txt            # Python package dependencies
│   └── Dockerfile                  # Container image for cloud deployment
│
└── web-preview/                    # Instant Browser Simulator (Zero dependencies required)
    └── index.html                  # Real client-side PDF.js + Mammoth DOCX + Spotify Lyrics UI
```

---

## 4. One-Click Setup & Quick Start

### Option 1: Automated Setup Script (Recommended)
* **Windows (Double-click or terminal):**
  ```powershell
  .\setup.bat
  # or in PowerShell:
  powershell -ExecutionPolicy Bypass -File .\setup.ps1
  ```
* **macOS / Linux:**
  ```bash
  chmod +x setup.sh && ./setup.sh
  ```

### Option 2: Try the Instant Web Preview Right Now
Open [`web-preview/index.html`](file:///C:/Users/2362471/.gemini/antigravity/scratch/docify-audio-reader/web-preview/index.html) in any browser (or start the backend and visit `http://localhost:8000`). Click **+ Upload PDF / DOCX** to upload a real PDF or Word file and listen with live word-by-word highlighting.

### Option 3: Manual Backend + Mobile Setup
1. **Start the Python FastAPI Backend:**
   ```powershell
   cd backend
   python -m venv .venv
   .\.venv\Scripts\activate
   pip install -r requirements.txt
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```
2. **Start the React Native (Expo) Mobile App:**
   ```powershell
   cd mobile
   npm install
   npx expo start
   ```
   Scan the QR code using the **Expo Go** app on your Android or iOS phone.

---

## 5. TTS Engine Modes (On-Device Neural vs. Cloud)

Inside the app's **Neural TTS** tab ([`SettingsScreen.tsx`](file:///C:/Users/2362471/.gemini/antigravity/scratch/docify-audio-reader/mobile/src/screens/SettingsScreen.tsx)), you can switch between 4 architectures at any time:

1. **On-Device Neural TTS (`on-device-neural` — Default):**
   - Runs 100% offline on the user's phone at `\$0` cost using embedded Kokoro-82M ONNX / native OS neural speech synthesis with live word boundary tracking.
2. **Self-Hosted FastAPI Neural Server (`backend-neural`):**
   - Connects to your [`backend/`](file:///C:/Users/2362471/.gemini/antigravity/scratch/docify-audio-reader/backend/main.py) server to stream high-definition neural voices (`en-US-AvaMultilingualNeural`, `en-US-AndrewMultilingualNeural`) with exact millisecond word timestamps for free.
3. **OpenAI HD Audio (`cloud-openai`):**
   - Uses OpenAI's `tts-1` model (`alloy`, `nova`, `onyx`) when you enter an OpenAI API key.
4. **ElevenLabs Turbo v2.5 (`cloud-elevenlabs`):**
   - Uses ElevenLabs studio voices when you enter an ElevenLabs API key.

---

## 6. Building for Android (`.apk`), Google Play Store (`.aab`) & iOS

See [`PLAYSTORE_AND_HOSTING.md`](file:///C:/Users/2362471/.gemini/antigravity/scratch/docify-audio-reader/PLAYSTORE_AND_HOSTING.md) for complete details.

```powershell
cd mobile
npm install -g eas-cli
eas login

# 1. Build a shareable Android APK (install directly on any phone or share via link):
npm run build:apk

# 2. Build a signed Google Play Store App Bundle (.aab):
npm run build:playstore

# 3. Build for iOS App Store:
npm run build:ios
```

---

## 7. Cloud Hosting (FastAPI Backend)

- **Render.com:** Push this repository to GitHub and connect it to Render—[`render.yaml`](file:///C:/Users/2362471/.gemini/antigravity/scratch/docify-audio-reader/render.yaml) automatically configures the Python build and start commands.
- **Docker / Railway / Fly.io / Cloud Run:** Use [`backend/Dockerfile`](file:///C:/Users/2362471/.gemini/antigravity/scratch/docify-audio-reader/backend/Dockerfile) to deploy a container on any cloud platform.
