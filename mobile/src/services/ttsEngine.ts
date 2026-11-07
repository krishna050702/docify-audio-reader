import {
  AudioPlayer,
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Speech from 'expo-speech';
import { LyricSegment, TTSConfig } from '../types';
import { resolveBestNativeVoice } from './onDeviceNeuralTts';
import { sanitizeTextForSpeech } from './textCleaner';

export type PlaybackMetadata = {
  albumTitle: string;
  chapterTitle: string;
  segmentIndex: number;
  totalSegments: number;
};

type PlaybackCallbacks = {
  onWordIndexChange: (wordIdx: number) => void;
  onSegmentProgress: (elapsedSec: number, durationSec: number) => void;
  onSegmentComplete: () => void;
  onError: (errMsg: string) => void;
  onExternalPause?: () => void;
  onExternalResume?: () => void;
  onExternalNext?: () => void;
  onExternalPrev?: () => void;
};

/**
 * Generates a small 16-second silent WAV file (4kHz, 8-bit unsigned mono PCM) on disk once.
 * Used as an in-process MediaSession carrier (`buildBasicMediaSession` in `expo-audio`)
 * so On-Device TTS (`expo-speech`) maintains background audio focus and responds to
 * Bluetooth/headset/system Play/Pause/Skip media events without requiring `AudioControlsService`.
 */
async function ensureSilentMediaSessionWav(): Promise<string | null> {
  if (!FileSystem.cacheDirectory) return null;
  const wavUri = `${FileSystem.cacheDirectory}docify-lockscreen-session-v1.wav`;
  try {
    const info = await FileSystem.getInfoAsync(wavUri);
    if (info.exists && info.size > 1000) {
      return wavUri;
    }

    const sampleRate = 4000;
    const durationSec = 16;
    const numSamples = sampleRate * durationSec;
    const dataSize = numSamples;
    const totalSize = 44 + dataSize;
    const buffer = new Uint8Array(totalSize);
    const view = new DataView(buffer.buffer);

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        buffer[offset + i] = str.charCodeAt(i);
      }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true); // Byte rate
    view.setUint16(32, 1, true); // Block align
    view.setUint16(34, 8, true); // 8-bit unsigned PCM
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    // 0x80 (128) is silence in 8-bit unsigned WAV
    buffer.fill(128, 44);

    let binary = '';
    const CHUNK = 8192;
    for (let i = 0; i < buffer.length; i += CHUNK) {
      const sub = buffer.subarray(i, Math.min(i + CHUNK, buffer.length));
      binary += String.fromCharCode.apply(null, sub as unknown as number[]);
    }
    const b64 = globalThis.btoa
      ? globalThis.btoa(binary)
      : Buffer.from(binary, 'binary').toString('base64');

    await FileSystem.writeAsStringAsync(wavUri, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return wavUri;
  } catch {
    return null;
  }
}

class HybridTTSEngine {
  private soundInstance: AudioPlayer | null = null;
  private mediaSessionCarrier: AudioPlayer | null = null;
  private wordTimer: ReturnType<typeof setInterval> | null = null;
  private currentSessionId = 0;
  private audioModeInitialized = false;
  private isOnDeviceSpeaking = false;
  private suppressCarrierPauseEvent = false;
  private lastCarrierTimeSec = 0;
  private activeCallbacks: PlaybackCallbacks | null = null;

  private async ensureAudioMode() {
    if (this.audioModeInitialized) return;
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        shouldPlayInBackground: true,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
        shouldRouteThroughEarpiece: false,
      });
      await setIsAudioActiveAsync(true).catch(() => {});
      this.audioModeInitialized = true;
    } catch {
      // Ignore on unsupported environments
    }
  }

  /**
   * Keeps an in-process ExoPlayer `MediaSession` active during On-Device TTS (`expo-speech`)
   * so background audio stays alive and headset/system media buttons pause/resume/skip cleanly.
   */
  private async activateMediaSessionCarrier(metadata?: PlaybackMetadata): Promise<void> {
    try {
      const wavUri = await ensureSilentMediaSessionWav();
      if (!wavUri) return;

      if (!this.mediaSessionCarrier) {
        const carrier = createAudioPlayer(
          {
            uri: wavUri,
            name: metadata?.chapterTitle || 'Docify Audio Reader',
          },
          { updateInterval: 300, keepAudioSessionActive: true }
        );
        carrier.loop = true;
        carrier.volume = 0.01;
        this.mediaSessionCarrier = carrier;

        carrier.addListener('playbackStatusUpdate', (status) => {
          if (!status.isLoaded || this.suppressCarrierPauseEvent) return;

          const timeDelta = status.currentTime - this.lastCarrierTimeSec;
          this.lastCarrierTimeSec = status.currentTime;
          if (Math.abs(timeDelta) >= 6 && Math.abs(timeDelta) <= 13) {
            if (timeDelta > 0) {
              this.activeCallbacks?.onExternalNext?.();
              return;
            } else if (timeDelta < 0) {
              this.activeCallbacks?.onExternalPrev?.();
              return;
            }
          }

          if (this.isOnDeviceSpeaking && !status.playing && !status.didJustFinish) {
            this.isOnDeviceSpeaking = false;
            this.currentSessionId++;
            if (this.wordTimer) {
              clearInterval(this.wordTimer);
              this.wordTimer = null;
            }
            Speech.stop().catch(() => {});
            this.activeCallbacks?.onExternalPause?.();
          } else if (!this.isOnDeviceSpeaking && status.playing && this.activeCallbacks) {
            this.activeCallbacks.onExternalResume?.();
          }
        });
      }

      this.suppressCarrierPauseEvent = true;
      if (!this.mediaSessionCarrier.playing) {
        this.mediaSessionCarrier.play();
      }
      setTimeout(() => {
        this.suppressCarrierPauseEvent = false;
      }, 250);
    } catch {
      // Ignore carrier setup errors
    }
  }

  /**
   * Stops any active speech or streaming audio immediately.
   */
  public async stop(_clearNotification = false): Promise<void> {
    this.currentSessionId++;
    this.isOnDeviceSpeaking = false;
    deactivateKeepAwake('docify-tts').catch(() => {});

    if (this.wordTimer) {
      clearInterval(this.wordTimer);
      this.wordTimer = null;
    }

    try {
      await Speech.stop();
    } catch {}

    if (this.soundInstance) {
      try {
        this.soundInstance.pause();
        this.soundInstance.remove();
      } catch {}
      this.soundInstance = null;
    }

    if (this.mediaSessionCarrier) {
      try {
        this.suppressCarrierPauseEvent = true;
        this.mediaSessionCarrier.pause();
        setTimeout(() => {
          this.suppressCarrierPauseEvent = false;
        }, 250);
      } catch {}
    }
  }

  /**
   * Pre-fetches and caches the next segment's neural audio in the background so transitions are instant.
   */
  public async prefetchSegmentAudio(segment: LyricSegment, config: TTSConfig): Promise<void> {
    if (segment.cachedAudioUri) return;
    if (config.engineMode === 'os-native' || config.engineMode === 'on-device-neural') return;

    try {
      const uri = await this.synthesizeToCachedFile(segment, config);
      if (uri) {
        segment.cachedAudioUri = uri;
      }
    } catch {
      // Silent prefetch fallback
    }
  }

  /**
   * Plays a single LyricSegment using the active TTS Engine Mode and fires live word-level sync callbacks.
   */
  public async speakSegment(
    segment: LyricSegment,
    config: TTSConfig,
    callbacks: PlaybackCallbacks,
    metadata?: PlaybackMetadata
  ): Promise<void> {
    await this.stop(false);
    const sessionId = ++this.currentSessionId;
    this.activeCallbacks = callbacks;
    activateKeepAwakeAsync('docify-tts').catch(() => {});
    await this.ensureAudioMode();

    if (sessionId !== this.currentSessionId) return;

    if (
      config.engineMode === 'backend-neural' ||
      config.engineMode === 'cloud-openai' ||
      config.engineMode === 'cloud-elevenlabs'
    ) {
      try {
        const audioUri =
          segment.cachedAudioUri || (await this.synthesizeToCachedFile(segment, config));
        if (audioUri && sessionId === this.currentSessionId) {
          segment.cachedAudioUri = audioUri;
          await this.playAudioFileWithWordSync(
            audioUri,
            segment,
            config.playbackSpeed,
            callbacks,
            sessionId,
            metadata
          );
          return;
        }
      } catch {
        // Gracefully fall back to Enhanced On-Device Neural TTS if offline or API key not set
      }
    }

    if (sessionId === this.currentSessionId) {
      await this.speakWithOnDeviceVoice(segment, config, callbacks, sessionId, metadata);
    }
  }

  private async synthesizeToCachedFile(
    segment: LyricSegment,
    config: TTSConfig
  ): Promise<string | null> {
    const cleanText = sanitizeTextForSpeech(segment.text);
    if (!cleanText) return null;

    const cacheKey = `${config.engineMode}-${config.selectedVoiceId}-${segment.id}.mp3`.replace(
      /[^a-zA-Z0-9._-]/g,
      '_'
    );
    const targetPath = `${FileSystem.cacheDirectory}${cacheKey}`;

    const fileInfo = await FileSystem.getInfoAsync(targetPath);
    if (fileInfo.exists && fileInfo.size > 256) {
      return targetPath;
    }

    if (config.engineMode === 'backend-neural') {
      if (config.backendUrl && !config.backendUrl.includes('localhost')) {
        try {
          const voice = config.selectedVoiceId.replace(/^backend-/, '').replace(/^kokoro-/, '');
          const url = `${config.backendUrl.replace(/\/$/, '')}/api/tts/synthesize`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: cleanText,
              voice: voice || 'en-US-AvaMultilingualNeural',
              speed: config.playbackSpeed,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            if (data.audioBase64) {
              await FileSystem.writeAsStringAsync(targetPath, data.audioBase64, {
                encoding: FileSystem.EncodingType.Base64,
              });
              if (Array.isArray(data.wordTimings) && data.wordTimings.length > 0) {
                segment.words = data.wordTimings;
              }
              return targetPath;
            }
          }
        } catch {
          // Fall through to zero-config cloud neural stream
        }
      }

      const isMale =
        config.selectedVoiceId.includes('Andrew') || config.selectedVoiceId.includes('adam');
      const pollyVoice = isMale ? 'Matthew' : 'Joanna';
      const streamUrl = `https://api.streamelements.com/kappa/v2/speech?voice=${encodeURIComponent(
        pollyVoice
      )}&text=${encodeURIComponent(cleanText)}`;

      const res = await fetch(streamUrl);
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        if (arrayBuf.byteLength > 256) {
          const base64 = this.arrayBufferToBase64(arrayBuf);
          await FileSystem.writeAsStringAsync(targetPath, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          return targetPath;
        }
      }
    }

    if (config.engineMode === 'cloud-openai' && config.openAiApiKey) {
      const voice = config.selectedVoiceId.replace(/^openai-/, '') || 'alloy';
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.openAiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          voice,
          input: cleanText,
          speed: Math.min(4.0, Math.max(0.25, config.playbackSpeed)),
        }),
      });

      if (!response.ok) throw new Error('OpenAI TTS request failed');
      const arrayBuf = await response.arrayBuffer();
      const base64 = this.arrayBufferToBase64(arrayBuf);
      await FileSystem.writeAsStringAsync(targetPath, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return targetPath;
    }

    if (config.engineMode === 'cloud-elevenlabs' && config.elevenLabsApiKey) {
      const voiceId = config.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM';
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': config.elevenLabsApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: cleanText,
            model_id: 'eleven_turbo_v2_5',
          }),
        }
      );

      if (!response.ok) throw new Error('ElevenLabs TTS request failed');
      const arrayBuf = await response.arrayBuffer();
      const base64 = this.arrayBufferToBase64(arrayBuf);
      await FileSystem.writeAsStringAsync(targetPath, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return targetPath;
    }

    return null;
  }

  private async playAudioFileWithWordSync(
    uri: string,
    segment: LyricSegment,
    playbackSpeed: number,
    callbacks: PlaybackCallbacks,
    sessionId: number,
    metadata?: PlaybackMetadata
  ): Promise<void> {
    if (sessionId !== this.currentSessionId) return;

    const player = createAudioPlayer(
      { uri, name: metadata?.chapterTitle || 'Docify Audio Reader' },
      { updateInterval: 100, keepAudioSessionActive: true }
    );
    this.soundInstance = player;
    player.shouldCorrectPitch = true;
    player.setPlaybackRate(Math.min(2.0, Math.max(0.5, playbackSpeed)), 'high');

    let hasStartedPlaying = false;

    player.addListener('playbackStatusUpdate', (status) => {
      if (sessionId !== this.currentSessionId || !status.isLoaded) return;

      if (status.playing) {
        hasStartedPlaying = true;
      } else if (hasStartedPlaying && !status.didJustFinish && !status.isBuffering) {
        callbacks.onExternalPause?.();
        return;
      }

      const posSec = status.currentTime || 0;
      const durSec = status.duration > 0 ? status.duration : segment.estimatedDurationSec;

      callbacks.onSegmentProgress(posSec, durSec);

      const ratio = durSec > 0 ? posSec / durSec : 0;
      const wordIdx = Math.min(
        segment.words.length - 1,
        Math.max(0, Math.floor(ratio * segment.words.length))
      );
      callbacks.onWordIndexChange(wordIdx);

      if (status.didJustFinish) {
        callbacks.onSegmentComplete();
      }
    });

    player.play();
  }

  private async speakWithOnDeviceVoice(
    segment: LyricSegment,
    config: TTSConfig,
    callbacks: PlaybackCallbacks,
    sessionId: number,
    metadata?: PlaybackMetadata
  ): Promise<void> {
    const cleanSpokenText = sanitizeTextForSpeech(segment.text);
    if (!cleanSpokenText) {
      if (sessionId === this.currentSessionId) {
        callbacks.onSegmentComplete();
      }
      return;
    }

    const resolvedVoice = await resolveBestNativeVoice(config.selectedVoiceId, config.pitch);
    if (sessionId !== this.currentSessionId) return;

    this.isOnDeviceSpeaking = true;
    await this.activateMediaSessionCarrier(metadata);
    if (sessionId !== this.currentSessionId) return;

    const totalWords = segment.words.length;
    const adjustedDurationSec = Math.max(1, segment.estimatedDurationSec / config.playbackSpeed);
    const startWallTime = Date.now();
    let boundarySupported = false;

    this.wordTimer = setInterval(() => {
      if (sessionId !== this.currentSessionId) return;
      const elapsedSec = (Date.now() - startWallTime) / 1000;
      callbacks.onSegmentProgress(
        Math.min(elapsedSec, adjustedDurationSec),
        adjustedDurationSec
      );

      if (!boundarySupported && totalWords > 0) {
        const progressRatio = Math.min(0.99, elapsedSec / adjustedDurationSec);
        const estimatedWordIdx = Math.floor(progressRatio * totalWords);
        callbacks.onWordIndexChange(estimatedWordIdx);
      }
    }, 110);

    const startSpeech = (useSpecificVoice: boolean) => {
      if (sessionId !== this.currentSessionId) return;

      Speech.speak(cleanSpokenText, {
        voice: useSpecificVoice ? resolvedVoice.voice : undefined,
        language: resolvedVoice.language || 'en-US',
        rate: config.playbackSpeed,
        pitch: resolvedVoice.pitch,
        onBoundary: (event: any) => {
          if (sessionId !== this.currentSessionId || typeof event?.charIndex !== 'number') return;
          boundarySupported = true;
          const charIdx = event.charIndex;
          const foundIdx = segment.words.findIndex(
            (w) => charIdx >= w.startCharIndex && charIdx <= w.endCharIndex + 1
          );
          if (foundIdx !== -1) {
            callbacks.onWordIndexChange(foundIdx);
          }
        },
        onDone: () => {
          if (sessionId !== this.currentSessionId) return;
          this.isOnDeviceSpeaking = false;
          if (this.wordTimer) {
            clearInterval(this.wordTimer);
            this.wordTimer = null;
          }
          callbacks.onSegmentComplete();
        },
        onError: (err) => {
          if (sessionId !== this.currentSessionId) return;
          if (useSpecificVoice && resolvedVoice.voice) {
            startSpeech(false);
            return;
          }
          this.isOnDeviceSpeaking = false;
          if (this.wordTimer) {
            clearInterval(this.wordTimer);
            this.wordTimer = null;
          }
          callbacks.onError(String(err));
        },
      });
    };

    startSpeech(Boolean(resolvedVoice.voice));
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const CHUNK = 8192;
    for (let i = 0; i < bytes.byteLength; i += CHUNK) {
      const sub = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
      binary += String.fromCharCode.apply(null, sub as unknown as number[]);
    }
    return globalThis.btoa
      ? globalThis.btoa(binary)
      : Buffer.from(binary, 'binary').toString('base64');
  }
}

export const ttsEngine = new HybridTTSEngine();
