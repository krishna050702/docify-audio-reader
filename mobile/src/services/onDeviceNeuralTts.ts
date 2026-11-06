import * as Speech from 'expo-speech';
import { TTSVoiceOption } from '../types';

/**
 * Curated list of On-Device Neural (Kokoro-82M ONNX / OS Enhanced Neural) and Cloud Neural voices.
 */
export const DEFAULT_VOICE_CATALOG: TTSVoiceOption[] = [
  {
    id: 'kokoro-af_heart',
    name: 'Heart (Kokoro-82M Neural • Warm Female)',
    language: 'en-US',
    engine: 'on-device-neural',
    badge: 'ON-DEVICE NEURAL',
  },
  {
    id: 'kokoro-am_adam',
    name: 'Adam (Kokoro-82M Neural • Deep Narrator)',
    language: 'en-US',
    engine: 'on-device-neural',
    badge: 'ON-DEVICE NEURAL',
  },
  {
    id: 'kokoro-bf_emma',
    name: 'Emma (Kokoro-82M Neural • British Studio)',
    language: 'en-GB',
    engine: 'on-device-neural',
    badge: 'ON-DEVICE NEURAL',
  },
  {
    id: 'backend-en-US-AvaMultilingualNeural',
    name: 'Ava Multilingual (Edge Studio Neural)',
    language: 'en-US',
    engine: 'backend-neural',
    badge: 'FREE CLOUD NEURAL',
  },
  {
    id: 'backend-en-US-AndrewMultilingualNeural',
    name: 'Andrew Podcast Host (Edge Studio Neural)',
    language: 'en-US',
    engine: 'backend-neural',
    badge: 'FREE CLOUD NEURAL',
  },
  {
    id: 'openai-alloy',
    name: 'OpenAI Alloy (HD Narrator)',
    language: 'en-US',
    engine: 'cloud-openai',
    badge: 'OPENAI HD',
  },
  {
    id: 'openai-nova',
    name: 'OpenAI Nova (Dynamic & Crisp)',
    language: 'en-US',
    engine: 'cloud-openai',
    badge: 'OPENAI HD',
  },
  {
    id: 'elevenlabs-rachel',
    name: 'ElevenLabs Rachel (Ultra-Realistic)',
    language: 'en-US',
    engine: 'cloud-elevenlabs',
    badge: 'ELEVENLABS v2.5',
  },
];

/**
 * Queries the device OS (iOS AVSpeechSynthesizer / Android Google TTS) and prioritizes Enhanced/Neural voices.
 */
export async function discoverDeviceNeuralVoices(): Promise<TTSVoiceOption[]> {
  try {
    const rawVoices = await Speech.getAvailableVoicesAsync();
    const englishVoices = rawVoices.filter((v) => v.language?.toLowerCase().startsWith('en'));

    // Sort Enhanced / Siri / Premium / Network Neural voices to the top
    englishVoices.sort((a, b) => {
      const score = (v: Speech.Voice) => {
        const id = (v.identifier || '').toLowerCase();
        const name = (v.name || '').toLowerCase();
        if (v.quality === Speech.VoiceQuality.Enhanced) return 3;
        if (id.includes('premium') || id.includes('enhanced') || id.includes('siri') || id.includes('network')) return 2;
        if (name.includes('natural') || name.includes('neural')) return 2;
        return 1;
      };
      return score(b) - score(a);
    });

    return englishVoices.slice(0, 8).map((v) => ({
      id: v.identifier,
      name: `${v.name} (${v.language})`,
      language: v.language,
      engine: 'os-native',
      badge: v.quality === Speech.VoiceQuality.Enhanced ? 'OS ENHANCED' : 'OFFLINE OS',
    }));
  } catch {
    return [];
  }
}

/**
 * Generates the self-contained HTML for the hidden WebView ONNX Worker that runs Kokoro-82M (82M parameter
 * open-weight Neural TTS via Transformers.js / ONNX Runtime Web) directly on-device for offline neural audio.
 */
export function getOnDeviceKokoroWorkerHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body>
<script type="module">
  import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.1.1/dist/kokoro.web.js";

  let ttsModel = null;
  let isInitializing = false;

  async function initModel() {
    if (ttsModel || isInitializing) return;
    isInitializing = true;
    try {
      window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'STATUS', status: 'loading_model' }));
      ttsModel = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "q8" // 8-bit quantized (~80MB) cached in IndexedDB for 100% offline reuse
      });
      window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'STATUS', status: 'ready' }));
    } catch (err) {
      window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'ERROR', message: String(err) }));
    } finally {
      isInitializing = false;
    }
  }

  window.synthesizeKokoro = async function(reqId, text, voice) {
    try {
      await initModel();
      if (!ttsModel) throw new Error("Kokoro ONNX model not loaded");
      const cleanVoice = (voice || "af_heart").replace("kokoro-", "");
      const audio = await ttsModel.generate(text, { voice: cleanVoice });
      const wavBlob = audio.toBlob();
      const reader = new FileReader();
      reader.onloadend = () => {
        window.ReactNativeWebView?.postMessage(JSON.stringify({
          type: 'AUDIO_READY',
          reqId,
          base64DataUrl: reader.result
        }));
      };
      reader.readAsDataURL(wavBlob);
    } catch (err) {
      window.ReactNativeWebView?.postMessage(JSON.stringify({
        type: 'SYNTH_FALLBACK',
        reqId,
        message: String(err)
      }));
    }
  };
</script>
</body>
</html>`;
}
