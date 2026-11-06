export type TTSEngineMode =
  | 'on-device-neural'   // Embedded Kokoro-82M / Sherpa-ONNX local neural TTS + OS neural fallback
  | 'os-native'          // iOS AVSpeechSynthesizer / Android Google TTS with live word boundary events
  | 'backend-neural'     // Self-hosted FastAPI Backend (Kokoro-ONNX / Edge Neural TTS with exact word timestamps)
  | 'cloud-openai'       // OpenAI TTS-1 / TTS-1-HD
  | 'cloud-elevenlabs';  // ElevenLabs Turbo v2.5

export interface WordTiming {
  word: string;
  startCharIndex: number;
  endCharIndex: number;
  startTimeMs?: number;
  endTimeMs?: number;
}

export interface LyricSegment {
  id: string;
  index: number;
  text: string;
  estimatedDurationSec: number;
  startTimeOffsetSec: number;
  words: WordTiming[];
  cachedAudioUri?: string;
}

export interface ChapterTrack {
  id: string;
  trackNumber: number;
  title: string;
  isSummaryTrack?: boolean;
  estimatedDurationSec: number;
  wordCount: number;
  segments: LyricSegment[];
}

export interface DocumentAlbum {
  id: string;
  title: string;
  authorOrSource: string;
  fileType: 'pdf' | 'docx' | 'txt';
  createdAt: string;
  coverColors: [string, string];
  totalDurationSec: number;
  totalWords: number;
  chapters: ChapterTrack[];
  lastPlayedChapterIndex: number;
  lastPlayedSegmentIndex: number;
  isOfflineReady?: boolean;
}

export interface BookmarkClip {
  id: string;
  documentId: string;
  documentTitle: string;
  chapterTitle: string;
  chapterIndex: number;
  segmentIndex: number;
  snippetText: string;
  createdAt: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  documentIds: string[];
  coverColors: [string, string];
}

export interface TTSVoiceOption {
  id: string;
  name: string;
  language: string;
  engine: TTSEngineMode;
  badge: string;
}

export interface TTSConfig {
  engineMode: TTSEngineMode;
  selectedVoiceId: string;
  playbackSpeed: number; // 0.75 to 2.5
  pitch: number;         // 0.8 to 1.2
  backendUrl: string;
  openAiApiKey: string;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  smartCleanCitations: boolean;
  smartCleanHeadersFooters: boolean;
  autoGenerateSummaryTrack: boolean;
}
