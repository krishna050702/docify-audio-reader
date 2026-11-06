import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';
import { LyricSegment, TTSConfig } from '../types';

type PlaybackCallbacks = {
  onWordIndexChange: (wordIdx: number) => void;
  onSegmentProgress: (elapsedSec: number, durationSec: number) => void;
  onSegmentComplete: () => void;
  onError: (errMsg: string) => void;
};

class HybridTTSEngine {
  private soundInstance: Audio.Sound | null = null;
  private wordTimer: ReturnType<typeof setInterval> | null = null;
  private isCancelled = false;
  private audioModeInitialized = false;

  private async ensureAudioMode() {
    if (this.audioModeInitialized) return;
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      this.audioModeInitialized = true;
    } catch {
      // Ignore on web or unsupported environments
    }
  }

  /**
   * Stops any active speech or streaming audio immediately.
   */
  public async stop(): Promise<void> {
    this.isCancelled = true;
    if (this.wordTimer) {
      clearInterval(this.wordTimer);
      this.wordTimer = null;
    }
    try {
      await Speech.stop();
    } catch {}

    if (this.soundInstance) {
      try {
        await this.soundInstance.stopAsync();
        await this.soundInstance.unloadAsync();
      } catch {}
      this.soundInstance = null;
    }
  }

  /**
   * Pre-fetches and caches the next segment's neural audio in the background so transitions are instant.
   */
  public async prefetchSegmentAudio(segment: LyricSegment, config: TTSConfig): Promise<void> {
    if (segment.cachedAudioUri) return;
    if (config.engineMode === 'os-native') return;

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
    callbacks: PlaybackCallbacks
  ): Promise<void> {
    await this.stop();
    this.isCancelled = false;
    await this.ensureAudioMode();

    // 1. If using Cloud or Backend Neural TTS (or cached neural audio file), try playing high-res audio stream
    if (
      config.engineMode === 'backend-neural' ||
      config.engineMode === 'cloud-openai' ||
      config.engineMode === 'cloud-elevenlabs'
    ) {
      try {
        const audioUri = segment.cachedAudioUri || (await this.synthesizeToCachedFile(segment, config));
        if (audioUri && !this.isCancelled) {
          segment.cachedAudioUri = audioUri;
          await this.playAudioFileWithWordSync(audioUri, segment, config.playbackSpeed, callbacks);
          return;
        }
      } catch (err: any) {
        // Gracefully fall back to On-Device Neural / Native TTS if offline or API key not set
      }
    }

    // 2. On-Device Neural TTS (Kokoro local neural / Enhanced OS Neural voice with live boundary tracking)
    if (!this.isCancelled) {
      this.speakWithOnDeviceVoice(segment, config, callbacks);
    }
  }

  /**
   * Synthesizes a segment via Backend Neural TTS, OpenAI TTS, or ElevenLabs and caches the MP3/WAV on device.
   */
  private async synthesizeToCachedFile(
    segment: LyricSegment,
    config: TTSConfig
  ): Promise<string | null> {
    const cacheKey = `${config.engineMode}-${config.selectedVoiceId}-${segment.id}.mp3`.replace(
      /[^a-zA-Z0-9._-]/g,
      '_'
    );
    const targetPath = `${FileSystem.cacheDirectory}${cacheKey}`;

    const fileInfo = await FileSystem.getInfoAsync(targetPath);
    if (fileInfo.exists && fileInfo.size > 256) {
      return targetPath;
    }

    if (config.engineMode === 'backend-neural' && config.backendUrl) {
      const voice = config.selectedVoiceId.replace(/^backend-/, '').replace(/^kokoro-/, '');
      const url = `${config.backendUrl.replace(/\/$/, '')}/api/tts/synthesize`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: segment.text,
          voice: voice || 'en-US-AvaMultilingualNeural',
          speed: config.playbackSpeed,
        }),
      });

      if (!response.ok) throw new Error('Backend TTS unavailable');
      const data = await response.json();
      if (data.audioBase64) {
        await FileSystem.writeAsStringAsync(targetPath, data.audioBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        // Update exact word timings if returned by the neural backend
        if (Array.isArray(data.wordTimings) && data.wordTimings.length > 0) {
          segment.words = data.wordTimings;
        }
        return targetPath;
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
          input: segment.text,
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
      const voiceId = config.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM'; // Rachel
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': config.elevenLabsApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: segment.text,
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

  /**
   * Plays a cached neural audio file via expo-av and synchronizes word highlights using playback status.
   */
  private async playAudioFileWithWordSync(
    uri: string,
    segment: LyricSegment,
    playbackSpeed: number,
    callbacks: PlaybackCallbacks
  ): Promise<void> {
    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: true, rate: playbackSpeed, shouldCorrectPitch: true }
    );
    this.soundInstance = sound;

    sound.setOnPlaybackStatusUpdate((status) => {
      if (this.isCancelled || !status.isLoaded) return;

      const posMs = status.positionMillis || 0;
      const durMs = status.durationMillis || segment.estimatedDurationSec * 1000;

      callbacks.onSegmentProgress(posMs / 1000, durMs / 1000);

      // Find matching word index based on proportional or exact timestamp
      const ratio = durMs > 0 ? posMs / durMs : 0;
      const wordIdx = Math.min(
        segment.words.length - 1,
        Math.max(0, Math.floor(ratio * segment.words.length))
      );
      callbacks.onWordIndexChange(wordIdx);

      if (status.didJustFinish) {
        callbacks.onSegmentComplete();
      }
    });
  }

  /**
   * Uses On-Device speech synthesis with real-time word boundary events + timer interpolation fallback.
   */
  private speakWithOnDeviceVoice(
    segment: LyricSegment,
    config: TTSConfig,
    callbacks: PlaybackCallbacks
  ): void {
    const totalWords = segment.words.length;
    const adjustedDurationSec = Math.max(1, segment.estimatedDurationSec / config.playbackSpeed);
    const startWallTime = Date.now();
    let boundarySupported = false;

    // Smooth timer for progress bar & fallback word highlighting on Android/iOS devices
    this.wordTimer = setInterval(() => {
      if (this.isCancelled) return;
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
    }, 90);

    const nativeVoiceId =
      config.selectedVoiceId.startsWith('kokoro-') ||
      config.selectedVoiceId.startsWith('backend-') ||
      config.selectedVoiceId.startsWith('openai-') ||
      config.selectedVoiceId.startsWith('elevenlabs-')
        ? undefined
        : config.selectedVoiceId;

    Speech.speak(segment.text, {
      voice: nativeVoiceId,
      rate: config.playbackSpeed,
      pitch: config.pitch,
      onBoundary: (event: any) => {
        if (this.isCancelled || typeof event?.charIndex !== 'number') return;
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
        if (this.wordTimer) {
          clearInterval(this.wordTimer);
          this.wordTimer = null;
        }
        if (!this.isCancelled) {
          callbacks.onSegmentComplete();
        }
      },
      onError: (err) => {
        if (this.wordTimer) {
          clearInterval(this.wordTimer);
          this.wordTimer = null;
        }
        if (!this.isCancelled) {
          callbacks.onError(String(err));
        }
      },
    });
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return globalThis.btoa ? globalThis.btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  }
}

export const ttsEngine = new HybridTTSEngine();
