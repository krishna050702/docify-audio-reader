import * as Speech from 'expo-speech';
import { TTSVoiceOption } from '../types';

/**
 * Curated list of Neural Voice Personas (Android WaveNet Network Neural / iOS Enhanced / Kokoro / Cloud Studio).
 */
export const DEFAULT_VOICE_CATALOG: TTSVoiceOption[] = [
  {
    id: 'kokoro-af_heart',
    name: 'Heart • Warm Audiobook Female',
    language: 'en-US',
    engine: 'on-device-neural',
    badge: 'NEURAL WARM FEMALE',
  },
  {
    id: 'kokoro-am_adam',
    name: 'Adam • Deep Podcast Narrator (Male)',
    language: 'en-US',
    engine: 'on-device-neural',
    badge: 'NEURAL DEEP MALE',
  },
  {
    id: 'kokoro-bf_emma',
    name: 'Emma • British Studio Narrator',
    language: 'en-GB',
    engine: 'on-device-neural',
    badge: 'BRITISH NEURAL',
  },
  {
    id: 'kokoro-in_neerja',
    name: 'Neerja • Clear Indian English Narrator',
    language: 'en-IN',
    engine: 'on-device-neural',
    badge: 'INDIAN NEURAL',
  },
  {
    id: 'backend-en-US-AvaMultilingualNeural',
    name: 'Ava Multilingual (Edge Studio Neural)',
    language: 'en-US',
    engine: 'backend-neural',
    badge: 'STUDIO CLOUD NEURAL',
  },
  {
    id: 'backend-en-US-AndrewMultilingualNeural',
    name: 'Andrew Podcast Host (Edge Studio Neural)',
    language: 'en-US',
    engine: 'backend-neural',
    badge: 'STUDIO CLOUD NEURAL',
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

let cachedSystemVoices: Speech.Voice[] | null = null;

async function getSystemVoices(): Promise<Speech.Voice[]> {
  if (cachedSystemVoices && cachedSystemVoices.length > 0) {
    return cachedSystemVoices;
  }
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    if (voices && voices.length > 0) {
      cachedSystemVoices = voices;
    }
    return voices || [];
  } catch {
    return [];
  }
}

function scoreVoiceQuality(v: Speech.Voice): number {
  const id = (v.identifier || '').toLowerCase();
  const name = (v.name || '').toLowerCase();
  let score = 0;

  if (v.quality === Speech.VoiceQuality.Enhanced) score += 50;
  // Android Google TTS WaveNet/Neural2 voices end with "-network"
  if (id.includes('-network') || name.includes('network')) score += 45;
  if (id.includes('neural') || name.includes('neural') || name.includes('natural')) score += 40;
  if (id.includes('wavenet') || id.includes('premium') || id.includes('enhanced') || id.includes('siri')) {
    score += 35;
  }
  // Prefer high-tier Google TTS voice codes (tpf, sfg, iom, tpd, gba, gbd, end, enc)
  if (/-(tpf|sfg|iom|tpd|gba|gbd|gbg|rjs|end|enc)-/.test(id)) {
    score += 20;
  }
  if (id.includes('-local')) {
    score += 5;
  }
  return score;
}

/**
 * Resolves a persona or voice ID to the best installed Android WaveNet (`-network`) / iOS Enhanced
 * native voice identifier, language, and natural prosody adjustments.
 */
export async function resolveBestNativeVoice(
  selectedVoiceId: string,
  basePitch: number
): Promise<{ voice?: string; language: string; pitch: number }> {
  const voices = await getSystemVoices();
  const englishVoices = voices.filter((v) => v.language?.toLowerCase().startsWith('en'));

  if (englishVoices.length === 0) {
    return { voice: undefined, language: 'en-US', pitch: basePitch };
  }

  // If the user explicitly picked a discovered OS voice identifier, use it directly
  const exactMatch = englishVoices.find((v) => v.identifier === selectedVoiceId);
  if (exactMatch) {
    return {
      voice: exactMatch.identifier,
      language: exactMatch.language || 'en-US',
      pitch: basePitch,
    };
  }

  // Otherwise match the persona (Warm Female, Deep Male, British Studio, Indian English)
  const wantBritish = selectedVoiceId.includes('bf_') || selectedVoiceId.includes('en-GB');
  const wantIndian = selectedVoiceId.includes('in_') || selectedVoiceId.includes('en-IN');
  const wantMale =
    selectedVoiceId.includes('am_adam') ||
    selectedVoiceId.includes('Andrew') ||
    selectedVoiceId.includes('male');

  const targetLangPrefix = wantBritish ? 'en-gb' : wantIndian ? 'en-in' : 'en-us';

  const candidates = englishVoices.slice().sort((a, b) => {
    const aId = (a.identifier || '').toLowerCase();
    const bId = (b.identifier || '').toLowerCase();
    const aLang = (a.language || '').toLowerCase();
    const bLang = (b.language || '').toLowerCase();

    let aScore = scoreVoiceQuality(a);
    let bScore = scoreVoiceQuality(b);

    if (aLang.startsWith(targetLangPrefix)) aScore += 30;
    if (bLang.startsWith(targetLangPrefix)) bScore += 30;

    // Android Google TTS male vs female voice code hints
    const isMaleVoiceCode = (id: string) =>
      /-(iom|tpd|tpc|gbd|rjs|end|ene|male)\b/.test(id) || id.includes('daniel') || id.includes('ARTHUR');
    const isFemaleVoiceCode = (id: string) =>
      /-(tpf|sfg|tpe|gba|gbg|enc|ena|female)\b/.test(id) || id.includes('samantha') || id.includes('ava');

    if (wantMale) {
      if (isMaleVoiceCode(aId)) aScore += 25;
      if (isMaleVoiceCode(bId)) bScore += 25;
    } else {
      if (isFemaleVoiceCode(aId)) aScore += 25;
      if (isFemaleVoiceCode(bId)) bScore += 25;
    }

    return bScore - aScore;
  });

  const best = candidates[0];
  // Subtle natural pitch shaping for warm narrator vs deep podcast host
  const tunedPitch = wantMale
    ? Math.max(0.85, basePitch * 0.93)
    : Math.min(1.15, basePitch * 1.02);

  return {
    voice: best?.identifier,
    language: best?.language || (wantBritish ? 'en-GB' : wantIndian ? 'en-IN' : 'en-US'),
    pitch: tunedPitch,
  };
}

/**
 * Queries the device OS (iOS AVSpeechSynthesizer / Android Google TTS) and prioritizes Enhanced/Neural voices.
 */
export async function discoverDeviceNeuralVoices(): Promise<TTSVoiceOption[]> {
  try {
    const rawVoices = await getSystemVoices();
    const englishVoices = rawVoices.filter((v) => v.language?.toLowerCase().startsWith('en'));

    englishVoices.sort((a, b) => scoreVoiceQuality(b) - scoreVoiceQuality(a));

    return englishVoices.slice(0, 10).map((v) => {
      const idLower = (v.identifier || '').toLowerCase();
      const isNetworkNeural =
        v.quality === Speech.VoiceQuality.Enhanced ||
        idLower.includes('-network') ||
        idLower.includes('neural') ||
        idLower.includes('wavenet');

      return {
        id: v.identifier,
        name: `${v.name} (${v.language})`,
        language: v.language,
        engine: 'os-native',
        badge: isNetworkNeural ? 'ANDROID WAVENET / ENHANCED' : 'DEVICE VOICE',
      };
    });
  } catch {
    return [];
  }
}
