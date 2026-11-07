import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';
import { persist, PersistStorage, StorageValue } from 'zustand/middleware';
import { getInitialSampleAlbums } from '../services/documentParser';
import { getSegmentWords } from '../services/textCleaner';
import { ttsEngine } from '../services/ttsEngine';
import {
  BookmarkClip,
  DocumentAlbum,
  Playlist,
  TTSConfig,
  TTSEngineMode,
} from '../types';

const STORE_FILE_URI = LegacyFileSystem.documentDirectory
  ? `${LegacyFileSystem.documentDirectory}docify-player-store-v2.json`
  : null;

/**
 * Tiny ~150-byte file that flushes reading position (chapter + sentence index) immediately
 * on every sentence transition or pause so closing & reopening the app NEVER loses position.
 */
const PROGRESS_FILE_URI = LegacyFileSystem.documentDirectory
  ? `${LegacyFileSystem.documentDirectory}docify-playback-progress-v2.json`
  : null;

interface ProgressSnapshot {
  activeAlbumId: string | null;
  activeChapterIndex: number;
  activeSegmentIndex: number;
  perAlbum: Record<string, { chapterIndex: number; segmentIndex: number }>;
}

let cachedPerAlbumProgress: Record<string, { chapterIndex: number; segmentIndex: number }> = {};

function saveInstantProgressSnapshot(
  activeAlbumId: string | null,
  activeChapterIndex: number,
  activeSegmentIndex: number,
  albums?: DocumentAlbum[]
): void {
  if (albums) {
    for (const a of albums) {
      cachedPerAlbumProgress[a.id] = {
        chapterIndex: a.lastPlayedChapterIndex || 0,
        segmentIndex: a.lastPlayedSegmentIndex || 0,
      };
    }
  }
  if (activeAlbumId) {
    cachedPerAlbumProgress[activeAlbumId] = {
      chapterIndex: activeChapterIndex,
      segmentIndex: activeSegmentIndex,
    };
  }

  if (!PROGRESS_FILE_URI) return;
  const payload: ProgressSnapshot = {
    activeAlbumId,
    activeChapterIndex,
    activeSegmentIndex,
    perAlbum: cachedPerAlbumProgress,
  };

  LegacyFileSystem.writeAsStringAsync(PROGRESS_FILE_URI, JSON.stringify(payload), {
    encoding: LegacyFileSystem.EncodingType.UTF8,
  }).catch(() => {});
}

let sqliteCleanedUp = false;
async function cleanupBloatedSqliteOnce(): Promise<void> {
  if (sqliteCleanedUp) return;
  sqliteCleanedUp = true;
  try {
    await AsyncStorage.removeItem('docify-spotify-reader-storage');
    await AsyncStorage.clear();
  } catch {}
}

interface PersistedPlayerSlice {
  albums: DocumentAlbum[];
  playlists: Playlist[];
  bookmarks: BookmarkClip[];
  activeAlbumId: string | null;
  activeChapterIndex: number;
  activeSegmentIndex: number;
  ttsConfig: TTSConfig;
}

let lastAlbumsRef: DocumentAlbum[] | null = null;
let lastPlaylistsRef: Playlist[] | null = null;
let lastBookmarksRef: BookmarkClip[] | null = null;
let lastTtsConfigRef: TTSConfig | null = null;
let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const fastDebouncedFileStorage: PersistStorage<PersistedPlayerSlice> = {
  getItem: async (name: string): Promise<StorageValue<PersistedPlayerSlice> | null> => {
    await cleanupBloatedSqliteOnce();
    try {
      let parsed: StorageValue<PersistedPlayerSlice> | null = null;
      if (STORE_FILE_URI) {
        const info = await LegacyFileSystem.getInfoAsync(STORE_FILE_URI);
        if (info.exists) {
          const content = await LegacyFileSystem.readAsStringAsync(STORE_FILE_URI, {
            encoding: LegacyFileSystem.EncodingType.UTF8,
          });
          parsed = JSON.parse(content) as StorageValue<PersistedPlayerSlice>;
        }
      }
      if (!parsed) {
        const fallback = await AsyncStorage.getItem(name);
        if (fallback) {
          parsed = JSON.parse(fallback) as StorageValue<PersistedPlayerSlice>;
        }
      }

      // Overlay the instant progress snapshot so exact chapter & sentence position is always restored
      if (parsed?.state && PROGRESS_FILE_URI) {
        try {
          const progInfo = await LegacyFileSystem.getInfoAsync(PROGRESS_FILE_URI);
          if (progInfo.exists) {
            const rawProg = await LegacyFileSystem.readAsStringAsync(PROGRESS_FILE_URI, {
              encoding: LegacyFileSystem.EncodingType.UTF8,
            });
            const prog = JSON.parse(rawProg) as ProgressSnapshot;
            if (prog.perAlbum) {
              cachedPerAlbumProgress = prog.perAlbum;
              parsed.state.albums = (parsed.state.albums || []).map((a) => {
                const saved = prog.perAlbum[a.id];
                if (!saved) return a;
                return {
                  ...a,
                  lastPlayedChapterIndex: saved.chapterIndex,
                  lastPlayedSegmentIndex: saved.segmentIndex,
                };
              });
            }
            if (prog.activeAlbumId) {
              parsed.state.activeAlbumId = prog.activeAlbumId;
              parsed.state.activeChapterIndex = prog.activeChapterIndex ?? 0;
              parsed.state.activeSegmentIndex = prog.activeSegmentIndex ?? 0;
            }
          }
        } catch {}
      }

      return parsed;
    } catch {
      return null;
    }
  },
  setItem: (_name: string, value: StorageValue<PersistedPlayerSlice>): void => {
    const s = value.state;
    if (
      s.albums === lastAlbumsRef &&
      s.playlists === lastPlaylistsRef &&
      s.bookmarks === lastBookmarksRef &&
      s.ttsConfig === lastTtsConfigRef
    ) {
      return;
    }

    lastAlbumsRef = s.albums;
    lastPlaylistsRef = s.playlists;
    lastBookmarksRef = s.bookmarks;
    lastTtsConfigRef = s.ttsConfig;

    if (persistDebounceTimer) {
      clearTimeout(persistDebounceTimer);
    }

    persistDebounceTimer = setTimeout(async () => {
      try {
        const compactState: StorageValue<PersistedPlayerSlice> = {
          version: value.version,
          state: {
            ...s,
            albums: (s.albums || []).map((a) => ({
              ...a,
              chapters: (a.chapters || []).map((ch) => ({
                ...ch,
                segments: (ch.segments || []).map((seg) => ({
                  id: seg.id,
                  index: seg.index,
                  text: seg.text,
                  estimatedDurationSec: seg.estimatedDurationSec,
                  startTimeOffsetSec: seg.startTimeOffsetSec,
                  words: [],
                })),
              })),
            })),
          },
        };
        const serialized = JSON.stringify(compactState);
        if (STORE_FILE_URI) {
          await LegacyFileSystem.writeAsStringAsync(STORE_FILE_URI, serialized, {
            encoding: LegacyFileSystem.EncodingType.UTF8,
          });
        }
      } catch {}
    }, 600);
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      if (STORE_FILE_URI) {
        await LegacyFileSystem.deleteAsync(STORE_FILE_URI, { idempotent: true });
      }
      if (PROGRESS_FILE_URI) {
        await LegacyFileSystem.deleteAsync(PROGRESS_FILE_URI, { idempotent: true });
      }
      await AsyncStorage.removeItem(name);
    } catch {}
  },
};

interface PlayerState {
  // Library & Playlists
  albums: DocumentAlbum[];
  playlists: Playlist[];
  bookmarks: BookmarkClip[];
  hasHydrated: boolean;

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
      const syncPositionAndPersist = (
        albumId: string,
        chapterIdx: number,
        segmentIdx: number
      ) => {
        const state = get();
        const album = state.albums.find((a) => a.id === albumId);
        if (album) {
          album.lastPlayedChapterIndex = chapterIdx;
          album.lastPlayedSegmentIndex = segmentIdx;
        }
        saveInstantProgressSnapshot(albumId, chapterIdx, segmentIdx, state.albums);
      };

      const startCurrentSegmentPlayback = () => {
        const state = get();
        const album = state.albums.find((a) => a.id === state.activeAlbumId);
        if (!album) return;

        const chapter = album.chapters[state.activeChapterIndex] || album.chapters[0];
        if (!chapter) return;

        const segment = chapter.segments[state.activeSegmentIndex] || chapter.segments[0];
        if (!segment) return;

        getSegmentWords(segment);

        const nextSeg1 = chapter.segments[state.activeSegmentIndex + 1];
        if (nextSeg1) ttsEngine.prefetchSegmentAudio(nextSeg1, state.ttsConfig);

        ttsEngine.speakSegment(
          segment,
          state.ttsConfig,
          {
            onWordIndexChange: (wordIdx) => {
              const current = get();
              if (current.isFullPlayerOpen && current.activeWordIndex !== wordIdx) {
                set({ activeWordIndex: wordIdx });
              }
            },
            onSegmentProgress: () => {},
            onSegmentComplete: () => {
              const latest = get();
              if (!latest.isPlaying) return;
              latest.skipNextSegment();
            },
            onError: () => {
              set({ isPlaying: false });
            },
            onExternalPause: () => {
              set({ isPlaying: false });
              const latest = get();
              if (latest.activeAlbumId) {
                syncPositionAndPersist(
                  latest.activeAlbumId,
                  latest.activeChapterIndex,
                  latest.activeSegmentIndex
                );
              }
            },
            onExternalResume: () => {
              const latest = get();
              if (!latest.isPlaying) {
                set({ isPlaying: true });
                startCurrentSegmentPlayback();
              }
            },
            onExternalNext: () => {
              get().skipNextSegment();
            },
            onExternalPrev: () => {
              get().skipPrevSegment();
            },
          },
          {
            albumTitle: album.title,
            chapterTitle: chapter.title,
            segmentIndex: state.activeSegmentIndex,
            totalSegments: chapter.segments.length,
          }
        );
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
        hasHydrated: false,
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
          const { albums, hasHydrated, ttsConfig } = get();
          if (!hasHydrated) return;
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
          saveInstantProgressSnapshot(album.id, 0, 0);
        },

        deleteAlbum: (albumId) => {
          const state = get();
          if (state.activeAlbumId === albumId) {
            ttsEngine.stop(true);
          }
          delete cachedPerAlbumProgress[albumId];
          set((s) => {
            const remaining = s.albums.filter((a) => a.id !== albumId);
            const nextActiveId =
              s.activeAlbumId === albumId ? remaining[0]?.id || null : s.activeAlbumId;
            return {
              albums: remaining,
              activeAlbumId: nextActiveId,
              isPlaying: s.activeAlbumId === albumId ? false : s.isPlaying,
            };
          });
        },

        playAlbum: (albumId, chapterIndex, segmentIndex) => {
          const state = get();
          const album = state.albums.find((a) => a.id === albumId);
          if (!album) return;

          const isSameAlbum = state.activeAlbumId === albumId;

          // If caller didn't specify explicit chapter/segment, resume from saved position
          const savedAlbumPos = cachedPerAlbumProgress[albumId];
          const targetChap =
            chapterIndex !== undefined
              ? chapterIndex
              : isSameAlbum
              ? state.activeChapterIndex
              : savedAlbumPos?.chapterIndex ?? album.lastPlayedChapterIndex ?? 0;

          const targetSeg =
            segmentIndex !== undefined
              ? segmentIndex
              : chapterIndex !== undefined
              ? 0
              : isSameAlbum
              ? state.activeSegmentIndex
              : savedAlbumPos?.segmentIndex ?? album.lastPlayedSegmentIndex ?? 0;

          // Clamp to valid chapter and segment bounds
          const safeChap = Math.max(0, Math.min(targetChap, Math.max(0, album.chapters.length - 1)));
          const chapObj = album.chapters[safeChap];
          const safeSeg = Math.max(
            0,
            Math.min(targetSeg, Math.max(0, (chapObj?.segments.length || 1) - 1))
          );

          // If already playing this exact segment on the same album, don't restart from scratch
          if (
            isSameAlbum &&
            state.isPlaying &&
            chapterIndex === undefined &&
            segmentIndex === undefined
          ) {
            return;
          }

          syncPositionAndPersist(albumId, safeChap, safeSeg);

          set({
            activeAlbumId: albumId,
            activeChapterIndex: safeChap,
            activeSegmentIndex: safeSeg,
            activeWordIndex: 0,
            isPlaying: true,
          });

          startCurrentSegmentPlayback();
        },

        togglePlayPause: () => {
          const state = get();
          if (!state.activeAlbumId && state.albums.length > 0) {
            get().playAlbum(state.albums[0].id);
            return;
          }

          if (state.isPlaying) {
            ttsEngine.stop(false);
            set({ isPlaying: false });
            if (state.activeAlbumId) {
              syncPositionAndPersist(
                state.activeAlbumId,
                state.activeChapterIndex,
                state.activeSegmentIndex
              );
            }
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
            ttsEngine.stop(true);
            set({ isPlaying: false, activeWordIndex: 0 });
            return;
          }

          syncPositionAndPersist(album.id, nextChapIdx, nextSegIdx);

          set({
            activeChapterIndex: nextChapIdx,
            activeSegmentIndex: nextSegIdx,
            activeWordIndex: 0,
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

          syncPositionAndPersist(album.id, prevChapIdx, prevSegIdx);

          set({
            activeChapterIndex: prevChapIdx,
            activeSegmentIndex: prevSegIdx,
            activeWordIndex: 0,
          });

          if (state.isPlaying) {
            startCurrentSegmentPlayback();
          }
        },

        skipToChapter: (chapterIndex) => {
          const state = get();
          const album = state.albums.find((a) => a.id === state.activeAlbumId);
          if (!album || !album.chapters[chapterIndex]) return;

          syncPositionAndPersist(album.id, chapterIndex, 0);

          set({
            activeChapterIndex: chapterIndex,
            activeSegmentIndex: 0,
            activeWordIndex: 0,
            isPlaying: true,
          });
          startCurrentSegmentPlayback();
        },

        seekToSegment: (segmentIndex) => {
          const state = get();
          const album = state.albums.find((a) => a.id === state.activeAlbumId);
          if (!album) return;
          const chapter = album.chapters[state.activeChapterIndex];
          if (!chapter) return;

          const clamped = Math.max(0, Math.min(segmentIndex, Math.max(0, chapter.segments.length - 1)));
          syncPositionAndPersist(album.id, state.activeChapterIndex, clamped);

          set({
            activeSegmentIndex: clamped,
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
      name: 'docify-spotify-reader-storage-v2',
      storage: fastDebouncedFileStorage,
      partialize: (state): PersistedPlayerSlice => ({
        albums: state.albums,
        playlists: state.playlists,
        bookmarks: state.bookmarks,
        activeAlbumId: state.activeAlbumId,
        activeChapterIndex: state.activeChapterIndex,
        activeSegmentIndex: state.activeSegmentIndex,
        ttsConfig: state.ttsConfig,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          usePlayerStore.setState({ hasHydrated: true });
          usePlayerStore.getState().initializeDefaultsIfEmpty();
          return;
        }
        usePlayerStore.setState({ hasHydrated: true, isPlaying: false });
        if (!state.albums || state.albums.length === 0) {
          usePlayerStore.getState().initializeDefaultsIfEmpty();
        }
      },
    }
  )
);
