import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { DEFAULT_VOICE_CATALOG, discoverDeviceNeuralVoices } from '../services/onDeviceNeuralTts';
import { usePlayerStore } from '../store/usePlayerStore';
import { TTSVoiceOption } from '../types';

const SPEED_OPTIONS = [0.8, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5];

export const NowPlayingModal: React.FC = () => {
  const {
    albums,
    activeAlbumId,
    activeChapterIndex,
    activeSegmentIndex,
    activeWordIndex,
    isPlaying,
    isFullPlayerOpen,
    ttsConfig,
    togglePlayPause,
    skipNextSegment,
    skipPrevSegment,
    skipToChapter,
    seekToSegment,
    setPlaybackSpeed,
    setEngineMode,
    setFullPlayerOpen,
    addBookmarkFromCurrent,
  } = usePlayerStore();

  const [viewMode, setViewMode] = useState<'lyrics' | 'chapters' | 'voices'>('lyrics');
  const [bookmarkToast, setBookmarkToast] = useState<string | null>(null);
  const [deviceVoices, setDeviceVoices] = useState<TTSVoiceOption[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    discoverDeviceNeuralVoices().then(setDeviceVoices);
  }, []);

  const activeAlbum = albums.find((a) => a.id === activeAlbumId) || albums[0];
  if (!activeAlbum) return null;

  const activeChapter = activeAlbum.chapters[activeChapterIndex] || activeAlbum.chapters[0];
  const segments = activeChapter?.segments || [];

  // Auto-scroll Spotify Lyrics view when activeSegmentIndex changes
  useEffect(() => {
    if (viewMode === 'lyrics' && scrollRef.current) {
      const approxY = Math.max(0, activeSegmentIndex * 92 - 90);
      scrollRef.current.scrollTo({ y: approxY, animated: true });
    }
  }, [activeSegmentIndex, viewMode]);

  const handleBookmark = () => {
    const saved = addBookmarkFromCurrent();
    if (saved) {
      setBookmarkToast('Saved to Liked Clips!');
      setTimeout(() => setBookmarkToast(null), 2200);
    }
  };

  const allVoiceOptions = [...DEFAULT_VOICE_CATALOG, ...deviceVoices];

  return (
    <Modal
      visible={isFullPlayerOpen}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => setFullPlayerOpen(false)}
    >
      <LinearGradient
        colors={[activeAlbum.coverColors[0], '#121212', '#0A0A0A']}
        locations={[0, 0.45, 1]}
        style={styles.fullContainer}
      >
        {/* Top Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => setFullPlayerOpen(false)} style={styles.headerBtn}>
            <Ionicons name="chevron-down" size={28} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerLabel}>PLAYING FROM DOCUMENT</Text>
            <Text style={styles.headerDocTitle} numberOfLines={1}>
              {activeAlbum.title}
            </Text>
          </View>

          <TouchableOpacity onPress={handleBookmark} style={styles.headerBtn}>
            <Ionicons name="bookmark-outline" size={23} color="#1DB954" />
          </TouchableOpacity>
        </View>

        {bookmarkToast && (
          <View style={styles.toastBanner}>
            <Ionicons name="checkmark-circle" size={16} color="#000" />
            <Text style={styles.toastText}>{bookmarkToast}</Text>
          </View>
        )}

        {/* Mode Switcher Pills (Spotify Lyrics | Chapters | Neural Voice) */}
        <View style={styles.modeTabsRow}>
          <TouchableOpacity
            style={[styles.modeTab, viewMode === 'lyrics' && styles.modeTabActive]}
            onPress={() => setViewMode('lyrics')}
          >
            <Ionicons
              name="musical-notes"
              size={15}
              color={viewMode === 'lyrics' ? '#000' : '#FFF'}
            />
            <Text style={[styles.modeTabText, viewMode === 'lyrics' && styles.modeTabTextActive]}>
              Live Lyrics
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modeTab, viewMode === 'chapters' && styles.modeTabActive]}
            onPress={() => setViewMode('chapters')}
          >
            <Ionicons
              name="list"
              size={15}
              color={viewMode === 'chapters' ? '#000' : '#FFF'}
            />
            <Text
              style={[styles.modeTabText, viewMode === 'chapters' && styles.modeTabTextActive]}
            >
              Chapters ({activeAlbum.chapters.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modeTab, viewMode === 'voices' && styles.modeTabActive]}
            onPress={() => setViewMode('voices')}
          >
            <Ionicons
              name="hardware-chip-outline"
              size={15}
              color={viewMode === 'voices' ? '#000' : '#FFF'}
            />
            <Text style={[styles.modeTabText, viewMode === 'voices' && styles.modeTabTextActive]}>
              Neural Voice
            </Text>
          </TouchableOpacity>
        </View>

        {/* Main Content Viewport */}
        <View style={styles.viewportCard}>
          {viewMode === 'lyrics' && (
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={styles.lyricsScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.lyricsHint}>
                Tap any sentence to jump audio • Synced Word-by-Word
              </Text>
              {segments.map((seg, idx) => {
                const isCurrentSeg = idx === activeSegmentIndex;
                const isPastSeg = idx < activeSegmentIndex;

                return (
                  <TouchableOpacity
                    key={seg.id}
                    activeOpacity={0.75}
                    onPress={() => seekToSegment(idx)}
                    style={[
                      styles.lyricSegmentBox,
                      isCurrentSeg && styles.lyricSegmentBoxActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.lyricSentence,
                        isPastSeg && styles.lyricSentencePast,
                        isCurrentSeg && styles.lyricSentenceActive,
                      ]}
                    >
                      {isCurrentSeg
                        ? seg.words.map((w, wIdx) => (
                            <Text
                              key={`${seg.id}-w-${wIdx}`}
                              style={
                                wIdx === activeWordIndex
                                  ? styles.activeWordHighlight
                                  : wIdx < activeWordIndex
                                  ? styles.spokenWordInCurrent
                                  : undefined
                              }
                            >
                              {w.word}{' '}
                            </Text>
                          ))
                        : seg.text}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {viewMode === 'chapters' && (
            <ScrollView contentContainerStyle={styles.chaptersScrollContent}>
              {activeAlbum.chapters.map((ch, cIdx) => {
                const isCurrent = cIdx === activeChapterIndex;
                return (
                  <TouchableOpacity
                    key={ch.id}
                    onPress={() => {
                      skipToChapter(cIdx);
                      setViewMode('lyrics');
                    }}
                    style={[styles.chapterRow, isCurrent && styles.chapterRowActive]}
                  >
                    <View style={styles.chapterNumCol}>
                      {isCurrent ? (
                        <Ionicons name="volume-high" size={18} color="#1DB954" />
                      ) : (
                        <Text style={styles.chapterNumText}>{cIdx + 1}</Text>
                      )}
                    </View>
                    <View style={styles.chapterInfoCol}>
                      <Text
                        style={[styles.chapterTitle, isCurrent && { color: '#1DB954' }]}
                        numberOfLines={1}
                      >
                        {ch.title}
                      </Text>
                      <Text style={styles.chapterSub}>
                        {ch.wordCount} words • ~{Math.max(1, Math.round(ch.estimatedDurationSec / 60))} min
                      </Text>
                    </View>
                    {ch.isSummaryTrack && (
                      <View style={styles.summaryBadge}>
                        <Text style={styles.summaryBadgeText}>AI TL;DR</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {viewMode === 'voices' && (
            <ScrollView contentContainerStyle={styles.chaptersScrollContent}>
              <Text style={styles.voiceSectionHeader}>
                SELECT ON-DEVICE NEURAL OR CLOUD AI VOICE
              </Text>
              {allVoiceOptions.map((v) => {
                const selected = ttsConfig.selectedVoiceId === v.id;
                return (
                  <TouchableOpacity
                    key={v.id}
                    onPress={() => setEngineMode(v.engine, v.id)}
                    style={[styles.chapterRow, selected && styles.chapterRowActive]}
                  >
                    <Ionicons
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={selected ? '#1DB954' : '#888'}
                      style={{ marginRight: 10 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.chapterTitle, selected && { color: '#1DB954' }]}>
                        {v.name}
                      </Text>
                      <Text style={styles.chapterSub}>Engine: {v.engine}</Text>
                    </View>
                    <View style={styles.voiceBadge}>
                      <Text style={styles.voiceBadgeText}>{v.badge}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* Track Title & Engine Status Bar */}
        <View style={styles.trackMetaSection}>
          <View style={{ flex: 1 }}>
            <Text style={styles.nowPlayingTrackTitle} numberOfLines={1}>
              {activeChapter?.title}
            </Text>
            <Text style={styles.nowPlayingEngineSub}>
              {ttsConfig.engineMode === 'on-device-neural'
                ? '⚡ On-Device Neural TTS (Offline Ready)'
                : ttsConfig.engineMode === 'backend-neural'
                ? '☁️ Neural Studio Stream (Word Synced)'
                : `🎙️ ${ttsConfig.engineMode.toUpperCase()}`}
            </Text>
          </View>
          <View style={styles.segmentCounterPill}>
            <Text style={styles.segmentCounterText}>
              {activeSegmentIndex + 1} / { Math.max(1, segments.length) }
            </Text>
          </View>
        </View>

        {/* Scrubber Progress Bar */}
        <View style={styles.scrubberWrap}>
          <View style={styles.scrubberTrack}>
            <View
              style={[
                styles.scrubberFill,
                {
                  width: `${Math.min(
                    100,
                    Math.round(((activeSegmentIndex + 1) / Math.max(1, segments.length)) * 100)
                  )}%`,
                },
              ]}
            />
          </View>
        </View>

        {/* Primary Transport Controls */}
        <View style={styles.controlsRow}>
          <TouchableOpacity
            onPress={() => {
              const currentIdx = SPEED_OPTIONS.indexOf(ttsConfig.playbackSpeed);
              const nextSpeed = SPEED_OPTIONS[(currentIdx + 1) % SPEED_OPTIONS.length];
              setPlaybackSpeed(nextSpeed);
            }}
            style={styles.speedPill}
          >
            <Text style={styles.speedPillText}>{ttsConfig.playbackSpeed}x</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={skipPrevSegment} style={styles.transportBtn}>
            <Ionicons name="play-skip-back" size={30} color="#FFFFFF" />
          </TouchableOpacity>

          <TouchableOpacity onPress={togglePlayPause} style={styles.bigPlayCircle}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={34} color="#000000" />
          </TouchableOpacity>

          <TouchableOpacity onPress={skipNextSegment} style={styles.transportBtn}>
            <Ionicons name="play-skip-forward" size={30} color="#FFFFFF" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              if (activeChapterIndex + 1 < activeAlbum.chapters.length) {
                skipToChapter(activeChapterIndex + 1);
              }
            }}
            style={styles.speedPill}
          >
            <Ionicons name="albums-outline" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fullContainer: {
    flex: 1,
    paddingTop: 44,
    paddingHorizontal: 18,
    paddingBottom: 28,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerBtn: {
    padding: 6,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  headerLabel: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  headerDocTitle: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
    marginTop: 2,
  },
  toastBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#1DB954',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 8,
    gap: 6,
  },
  toastText: {
    color: '#000000',
    fontWeight: '700',
    fontSize: 12,
  },
  modeTabsRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 24,
    padding: 4,
    marginBottom: 14,
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 20,
    gap: 5,
  },
  modeTabActive: {
    backgroundColor: '#1DB954',
  },
  modeTabText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  modeTabTextActive: {
    color: '#000000',
    fontWeight: '700',
  },
  viewportCard: {
    flex: 1,
    backgroundColor: 'rgba(18, 18, 18, 0.78)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    marginBottom: 16,
  },
  lyricsScrollContent: {
    padding: 18,
    paddingBottom: 80,
  },
  lyricsHint: {
    color: '#8E8E93',
    fontSize: 11.5,
    textAlign: 'center',
    marginBottom: 14,
    fontWeight: '600',
  },
  lyricSegmentBox: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  lyricSegmentBoxActive: {
    backgroundColor: 'rgba(29, 185, 84, 0.12)',
    borderLeftWidth: 3,
    borderLeftColor: '#1DB954',
  },
  lyricSentence: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 18,
    lineHeight: 27,
    fontWeight: '600',
  },
  lyricSentencePast: {
    color: 'rgba(255,255,255,0.28)',
  },
  lyricSentenceActive: {
    color: '#FFFFFF',
    fontSize: 20,
    lineHeight: 30,
    fontWeight: '700',
  },
  activeWordHighlight: {
    backgroundColor: '#1DB954',
    color: '#000000',
    fontWeight: '800',
    borderRadius: 4,
  },
  spokenWordInCurrent: {
    color: '#1DB954',
  },
  chaptersScrollContent: {
    padding: 14,
  },
  chapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  chapterRowActive: {
    backgroundColor: 'rgba(29, 185, 84, 0.14)',
    borderColor: 'rgba(29, 185, 84, 0.4)',
    borderWidth: 1,
  },
  chapterNumCol: {
    width: 28,
    alignItems: 'center',
  },
  chapterNumText: {
    color: '#888',
    fontWeight: '700',
  },
  chapterInfoCol: {
    flex: 1,
    marginLeft: 6,
  },
  chapterTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  chapterSub: {
    color: '#999999',
    fontSize: 11.5,
    marginTop: 2,
  },
  summaryBadge: {
    backgroundColor: '#1DB954',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  summaryBadgeText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '800',
  },
  voiceSectionHeader: {
    color: '#B3B3B3',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    marginLeft: 4,
  },
  voiceBadge: {
    backgroundColor: 'rgba(29, 185, 84, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  voiceBadgeText: {
    color: '#1DB954',
    fontSize: 9.5,
    fontWeight: '800',
  },
  trackMetaSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  nowPlayingTrackTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  nowPlayingEngineSub: {
    color: '#1DB954',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
  },
  segmentCounterPill: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  segmentCounterText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '700',
  },
  scrubberWrap: {
    marginBottom: 18,
  },
  scrubberTrack: {
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  scrubberFill: {
    height: '100%',
    backgroundColor: '#1DB954',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  speedPill: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    minWidth: 54,
    alignItems: 'center',
  },
  speedPillText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  transportBtn: {
    padding: 10,
  },
  bigPlayCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#1DB954',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
  },
});
