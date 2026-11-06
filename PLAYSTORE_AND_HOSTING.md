# Publishing to Google Play Store, Sharing APK & Cloud Hosting Guide

This project is pre-configured with **Expo Application Services (`eas.json`)**, Android Play Store bundle identifiers (`com.docify.audioreader`), background audio permissions, and Docker/Render cloud deployment configs.

---

## Option A: Build a Shareable Android `.apk` (Send via WhatsApp / Drive / Link)

If you want an `.apk` file you can immediately install on any Android phone or share with friends/testers without waiting for Google Play review:

```bash
cd mobile
npm install
npm install -g eas-cli
eas login
eas build -p android --profile preview
```
- When the build finishes, EAS gives you a **direct download URL & QR code** that anyone can scan to install the `.apk` on their phone.

---

## Option B: Publish to Google Play Store (`.aab` Production Bundle)

1. **Generate the Signed Android App Bundle (`.aab`):**
   ```bash
   cd mobile
   eas build -p android --profile production
   ```
   *(EAS automatically generates and securely manages your Android Upload Keystore for you).*

2. **Upload to Google Play Console:**
   - Go to [Google Play Console](https://play.google.com/console) -> **Create App** -> Name it **Docify: PDF & Word Audio Player**.
   - Go to **Production** (or **Internal Testing**) -> **Create new release** -> Upload the `.aab` file downloaded from EAS.
   - Or automate submission with:
     ```bash
     eas submit -p android --profile production
     ```

---

## Option C: Host the FastAPI Document & Neural TTS Backend

The mobile app works **100% standalone offline** (using on-device `.docx`/`.pdf` parsing + On-Device Neural TTS), but hosting the Python backend unlocks:
- Layout-aware `PyMuPDF` header/footer margin stripping for complex multi-column PDFs.
- Free studio-grade neural voices (`en-US-AvaMultilingualNeural`, `en-US-AndrewMultilingualNeural`) with exact millisecond word timestamps.

### 1-Click Deploy on Render / Railway:
1. Push this folder to a GitHub repository.
2. Connect the repository to **Render.com** (it automatically detects [render.yaml](file:///C:/Users/2362471/.gemini/antigravity/scratch/docify-audio-reader/render.yaml)) or **Railway.app** (it automatically detects [Dockerfile](file:///C:/Users/2362471/.gemini/antigravity/scratch/docify-audio-reader/backend/Dockerfile)).
3. Copy your live `https://your-app.onrender.com` URL and paste it into the mobile app under **Neural TTS Settings -> Backend Server URL**.
