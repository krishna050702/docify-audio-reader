import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getInitialSampleAlbums } from '../services/documentParser';
import { ttsEngine } from '../services/ttsEngine';
import {
  BookmarkClip,
  DocumentAlbum,
  Playlist,
  TTSConfig,
  TTSEngineMode,
} from '../types';

interface PlayerState {
  // Library & Playlists
  albums: DocumentAlbum[];
  playlists: Playlist[];
  bookmarks: BookmarkClip[];

  // Active Playback State
  activeAlbumId: string | null;
  activeChapterIndex: number;
  activeSegmentIndex: number;
  activeWordIndex: number;
  isPlaying: boolean;
  isFullPlayerOpen: boolean;
  segmentElapsedSec: number;
  segmentDurationSec: number;
  sleepTimerMinutesLeft: number | null;

  // TTS & Cleaning Configuration
  ttsConfig: TTSConfig;

  // Actions
  initializeDefaultsIfEmpty: () => void;
  addAlbum: (album: DocumentAlbum) => void;
  deleteAlbum: (albumId: string) => void;
  playAlbum: (albumId: string, chapterIndex?: number, segmentIndex?: number) => void;
  togglePlayPause: () => void;
  skipNextSegment: () => void;
  skipPrevSegment: () => void;
  skipToChapter: (chapterIndex: number) => void;
  seekToSegment: (segmentIndex: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  setEngineMode: (mode: TTSEngineMode, voiceId?: string) => void;
  updateTTSConfig: (partial: Partial<TTSConfig>) => void;
  setFullPlayerOpen: (open: boolean) => void;
  addBookmarkFromCurrent: () => BookmarkClip | null;
  removeBookmark: (id: string) => void;
  createPlaylist: (name: string, description: string) => void;
  toggleAlbumInPlaylist: (playlistId: string, albumId: string) => void;
  setSleepTimer: (minutes: number | null) => void;
}

const DEFAULT_TTS_CONFIG: TTSConfig = {
  engineMode: 'on-device-neural',
  selectedVoiceId: 'kokoro-af_heart',
  playbackSpeed: 1.0,
  pitch: 1.0,
  backendUrl: 'http://localhost:8000',
  openAiApiKey: '',
  elevenLabsApiKey: '',
  elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
  smartCleanCitations: true,
  smartCleanHeadersFooters: true,
  autoGenerateSummaryTrack: true,
};

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => {
      const startCurrentSegmentPlayback = () => {
        const state = get();
        const album = state.albums.find((a) => a.id === state.activeAlbumId);
        if (!album) return;

        const chapter = album.chapters[state.activeChapterIndex];
        if (!chapter) return;

        const segment = chapter.segments[state.activeSegmentIndex];
        if (!segment) return;

        // Prefetch upcoming 2 segments in the background for zero-latency transitions
        const nextSeg1 = chapter.segments[state.activeSegmentIndex + 1];
        const nextSeg2 = chapter.segments[state.activeSegmentIndex + 2];
        if (nextSeg1) ttsEngine.prefetchSegmentAudio(nextSeg1, state.ttsConfig);
        if (nextSeg2) ttsEngine.prefetchSegmentAudio(nextSeg2, state.ttsConfig);

        ttsEngine.speakSegment(segment, state.ttsConfig, {
          onWordIndexChange: (wordIdx) => {
            set({ activeWordIndex: wordIdx });
          },
          onSegmentProgress: (elapsedSec, durationSec) => {
            set({ segmentElapsedSec: elapsedSec, segmentDurationSec: durationSec });
          },
          onSegmentComplete: () => {
            const latest = get();
            if (!latest.isPlaying) return;
            latest.skipNextSegment();
          },
          onError: () => {
            set({ isPlaying: false });
          },
        });
      };

      return {
        albums: [],
        playlists: [
          {
            id: 'playlist-commute',
            name: 'Morning Commute',
            description: 'Key papers & reports queued for hands-free listening',
            documentIds: [],
            coverColors: ['#1DB954', '#064E3B'],
          },
          {
            id: 'playlist-deep-work',
            name: 'Exam & Research Prep',
            description: 'High-priority technical documents',
            documentIds: [],
            coverColors: ['#6366F1', '#1E1B4B'],
          },
        ],
        bookmarks: [],
        activeAlbumId: null,
        activeChapterIndex: 0,
        activeSegmentIndex: 0,
        activeWordIndex: 0,
        isPlaying: false,
        isFullPlayerOpen: false,
        segmentElapsedSec: 0,
        segmentDurationSec: 1,
        sleepTimerMinutesLeft: null,
        ttsConfig: DEFAULT_TTS_CONFIG,

        initializeDefaultsIfEmpty: () => {
          const { albums, ttsConfig } = get();
          if (albums.length === 0) {
            const samples = getInitialSampleAlbums(ttsConfig);
            set({
              albums: samples,
              activeAlbumId: samples[0]?.id || null,
            });
          }
        },

        addAlbum: (album) => {
          set((state) => ({
            albums: [album, ...state.albums],
            activeAlbumId: album.id,
            activeChapterIndex: 0,
            activeSegmentIndex: 0,
            activeWordIndex: 0,
          }));
        },

        deleteAlbum: (albumId) => {
          const state = get();
          if (state.activeAlbumId === albumId) {
            ttsEngine.stop();
          }
          set((s) => ({
            albums: s.albums.filter((a) => a.id !== albumId),
            activeAlbumId: s.activeAlbumId === albumId ? null : s.activeAlbumId,
            isPlaying: s.activeAlbumId === albumId ? false : s.isPlaying,
          }));
        },

        playAlbum: (albumId, chapterIndex, segmentIndex) => {
          const state = get();
          const album = state.albums.find((a) => a.id === albumId);
          if (!album) return;

          const chIdx = chapterIndex ?? album.lastPlayedChapterIndex ?? 0;
          const segIdx = segmentIndex ?? (chapterIndex !== undefined ? 0 : album.lastPlayedSegmentIndex ?? 0);

          set({
            activeAlbumId: albumId,
            activeChapterIndex: chIdx,
            activeSegmentIndex: segIdx,
            activeWordIndex: 0,
            isPlaying: true,
          });

          startCurrentSegmentPlayback();
        },

        togglePlayPause: () => {
          const state = get();
          if (!state.activeAlbumId && state.albums.length > 0) {
            get().playAlbum(state.albums[0].id, 0, 0);
            return;
          }

          if (state.isPlaying) {
            ttsEngine.stop();
            set({ isPlaying: false });
          } else {
            set({ isPlaying: true });
            startCurrentSegmentPlayback();
          }
        },

        skipNextSegment: () => {
          const state = get();
          const album = state.albums.find((a) => a.id === state.activeAlbumId);
          if (!album) return;

          const currentChapter = album.chapters[state.activeChapterIndex];
          if (!currentChapter) return;

          let nextChapIdx = state.activeChapterIndex;
          let nextSegIdx = state.activeSegmentIndex + 1;

          if (nextSegIdx >= currentChapter.segments.length) {
            nextChapIdx = state.activeChapterIndex + 1;
            nextSegIdx = 0;
          }

          if (nextChapIdx >= album.chapters.length) {
            // Reached the end of the document album
            ttsEngine.stop();
            set({ isPlaying: false, activeWordIndex: 0 });
            return;
          }

          // Persist progress inside the album item
          const updatedAlbums = state.albums.map((a) =>
            a.id === album.id
              ? { ...a, lastPlayedChapterIndex: nextChapIdx, lastPlayedSegmentIndex: nextSegIdx }
              : a
          );

          set({
            albums: updatedAlbums,
            activeChapterIndex: nextChapIdx,
            activeSegmentIndex: nextSegIdx,
            activeWordIndex: 0,
            segmentElapsedSec: 0,
          });

          if (state.isPlaying) {
            startCurrentSegmentPlayback();
          }
        },

        skipPrevSegment: () => {
          const state = get();
          const album = state.albums.find((a) => a.id === state.activeAlbumId);
          if (!album) return;

          let prevChapIdx = state.activeChapterIndex;
          let prevSegIdx = state.activeSegmentIndex - 1;

          if (prevSegIdx < 0) {
            if (prevChapIdx > 0) {
              prevChapIdx -= 1;
              const prevChap = album.chapters[prevChapIdx];
              prevSegIdx = Math.max(0, prevChap.segments.length - 1);
            } else {
              prevSegIdx = 0;
            }
          }

          set({
            activeChapterIndex: prevChapIdx,
            activeSegmentIndex: prevSegIdx,
            activeWordIndex: 0,
            segmentElapsedSec: 0,
          });

          if (state.isPlaying) {
            startCurrentSegmentPlayback();
          }
        },

        skipToChapter: (chapterIndex) => {
          const state = get();
          const album = state.albums.find((a) => a.id === state.activeAlbumId);
          if (!album || !album.chapters[chapterIndex]) return;

          set({
            activeChapterIndex: chapterIndex,
            activeSegmentIndex: 0,
            activeWordIndex: 0,
            isPlaying: true,
          });
          startCurrentSegmentPlayback();
        },

        seekToSegment: (segmentIndex) => {
          set({
            activeSegmentIndex: segmentIndex,
            activeWordIndex: 0,
            isPlaying: true,
          });
          startCurrentSegmentPlayback();
        },

        setPlaybackSpeed: (speed) => {
          const rounded = Math.round(speed * 100) / 100;
          set((state) => ({
            ttsConfig: { ...state.ttsConfig, playbackSpeed: rounded },
          }));
          if (get().isPlaying) {
            startCurrentSegmentPlayback();
          }
        },

        setEngineMode: (mode, voiceId) => {
          set((state) => ({
            ttsConfig: {
              ...state.ttsConfig,
              engineMode: mode,
              selectedVoiceId: voiceId || state.ttsConfig.selectedVoiceId,
            },
          }));
          if (get().isPlaying) {
            startCurrentSegmentPlayback();
          }
        },

        updateTTSConfig: (partial) => {
          set((state) => ({
            ttsConfig: { ...state.ttsConfig, ...partial },
          }));
        },

        setFullPlayerOpen: (open) => set({ isFullPlayerOpen: open }),

        addBookmarkFromCurrent: () => {
          const state = get();
          const album = state.albums.find((a) => a.id === state.activeAlbumId);
          if (!album) return null;

          const chapter = album.chapters[state.activeChapterIndex];
          const segment = chapter?.segments[state.activeSegmentIndex];
          if (!chapter || !segment) return null;

          const clip: BookmarkClip = {
            id: `bm-${Date.now()}`,
            documentId: album.id,
            documentTitle: album.title,
            chapterTitle: chapter.title,
            chapterIndex: state.activeChapterIndex,
            segmentIndex: state.activeSegmentIndex,
            snippetText: segment.text,
            createdAt: new Date().toISOString(),
          };

          set((s) => ({ bookmarks: [clip, ...s.bookmarks] }));
          return clip;
        },

        removeBookmark: (id) => {
          set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) }));
        },

        createPlaylist: (name, description) => {
          const newPl: Playlist = {
            id: `pl-${Date.now()}`,
            name,
            description,
            documentIds: [],
            coverColors: ['#1DB954', '#064E3B'],
          };
          set((s) => ({ playlists: [...s.playlists, newPl] }));
        },

        toggleAlbumInPlaylist: (playlistId, albumId) => {
          set((s) => ({
            playlists: s.playlists.map((pl) => {
              if (pl.id !== playlistId) return pl;
              const exists = pl.documentIds.includes(albumId);
              return {
                ...pl,
                documentIds: exists
                  ? pl.documentIds.filter((id) => id !== albumId)
                  : [...pl.documentIds, albumId],
              };
            }),
          }));
        },

        setSleepTimer: (minutes) => set({ sleepTimerMinutesLeft: minutes }),
      };
    },
    {
      name: 'docify-spotify-reader-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        albums: state.albums,
        playlists: state.playlists,
        bookmarks: state.bookmarks,
        activeAlbumId: state.activeAlbumId,
        activeChapterIndex: state.activeChapterIndex,
        activeSegmentIndex: state.activeSegmentIndex,
        ttsConfig: state.ttsConfig,
      }),
    }
  )
);
