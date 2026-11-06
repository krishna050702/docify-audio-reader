# Complete Setup & Troubleshooting Guide (`SETUP.md`)

Follow this step-by-step guide to set up **Docify** on Windows, macOS, or Linux, run it on your physical Android/iOS phone, and build your release packages.

---

## Step 1: Prerequisites Check

1. **Python 3.10+ (Already installed on your PC: `Python 3.12.5`)**
   - Verify in PowerShell:
     ```powershell
     python --version
     ```
2. **Node.js LTS (v20 or v22) — Required for React Native / Expo CLI**
   - If `node -v` is not recognized in your terminal, install Node.js LTS via Windows Winget or from [nodejs.org](https://nodejs.org/):
     ```powershell
     winget install OpenJS.NodeJS.LTS
     ```
   - After installing, **close and reopen PowerShell** so `node` and `npm` are added to your `PATH`.
3. **Expo Go App (For instant testing on your physical phone)**
   - **Android:** Install **Expo Go** from the Google Play Store.
   - **iOS:** Install **Expo Go** from the Apple App Store.

---

## Step 2: Run the Automated Setup Script

We have included automated setup scripts that configure your Python virtual environment, install the FastAPI PDF/DOCX/TTS dependencies, install the React Native `node_modules`, and give you a launch menu.

### On Windows (PowerShell or Command Prompt):
```powershell
cd C:\Users\2362471\.gemini\antigravity\scratch\docify-audio-reader
.\setup.bat
```
*(Or run `powershell -ExecutionPolicy Bypass -File .\setup.ps1` directly).*

### On macOS / Linux:
```bash
cd docify-audio-reader
chmod +x setup.sh
./setup.sh
```

---

## Step 3: Running Each Component

### A. Launch the Instant Web Preview (No Node.js Required)
You can test the full Spotify document workflow (uploading `.pdf` and `.docx` files, auto-chaptering, Track 0 summary, and synced word highlighting) immediately:
- **Direct file:** Open [`web-preview/index.html`](file:///C:/Users/2362471/.gemini/antigravity/scratch/docify-audio-reader/web-preview/index.html) in Chrome or Edge.
- **Via FastAPI server:** Run the backend (below) and open `http://localhost:8000` in your browser.

### B. Launch the FastAPI Document & Neural TTS Backend
```powershell
cd C:\Users\2362471\.gemini\antigravity\scratch\docify-audio-reader\backend
.\.venv\Scripts\activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
- **API Health Check:** `http://localhost:8000/api/health`
- **Interactive Swagger API Docs:** `http://localhost:8000/docs`

### C. Launch the React Native (Expo) Mobile App
```powershell
cd C:\Users\2362471\.gemini\antigravity\scratch\docify-audio-reader\mobile
npm install
npx expo start
```
- Scan the QR code displayed in the terminal using **Expo Go** on your phone.

---

## Step 4: Connecting Your Physical Phone to Your Local PC Backend

When testing on a physical Android/iOS device over Wi-Fi, `localhost` on the phone refers to the phone itself, not your computer.
1. Find your PC's local Wi-Fi IPv4 address by running:
   ```powershell
   ipconfig
   ```
   *(Look for `IPv4 Address`, e.g., `192.168.1.42`).*
2. Open the **Docify** mobile app -> go to the **Neural TTS** tab (Settings) -> set **FastAPI Document & Neural TTS Server URL** to:
   ```
   http://192.168.1.42:8000
   ```
3. Note: Even without the backend connected, the mobile app works **100% standalone offline** using its built-in `.docx`/`.pdf` local parser and **On-Device Neural TTS**.

---

## Step 5: Troubleshooting Common Issues

* **`node` or `npm` is not recognized:**
  Run `winget install OpenJS.NodeJS.LTS`, then restart your terminal window.
* **Phone cannot connect to Expo Metro Bundler on public/office Wi-Fi:**
  Start Expo in tunnel mode so it works across any network or mobile hotspot:
  ```powershell
  npx expo start --tunnel
  ```
* **PDF has scanned images instead of selectable text:**
  Scanned image PDFs require OCR. Connect the FastAPI backend or paste text directly in the **Upload -> Paste Text** modal.
