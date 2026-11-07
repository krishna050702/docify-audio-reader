import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  GestureResponderEvent,
  LayoutChangeEvent,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { DEFAULT_VOICE_CATALOG, discoverDeviceNeuralVoices } from '../services/onDeviceNeuralTts';
import { getSegmentWords } from '../services/textCleaner';
import { usePlayerStore } from '../store/usePlayerStore';
import { ChapterTrack, LyricSegment, TTSVoiceOption } from '../types';

const SPEED_OPTIONS = [0.8, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5];

function formatSeconds(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
}

const ActiveLyricWords: React.FC<{ segment: LyricSegment }> = ({ segment }) => {
  const activeWordIndex = usePlayerStore((s) => s.activeWordIndex);
  const words = getSegmentWords(segment);

  return (
    <Text style={[styles.lyricSentence, styles.lyricSentenceActive]}>
      {words.map((w, wIdx) => (
        <Text
          key={`${segment.id}-w-${wIdx}`}
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
      ))}
    </Text>
  );
};

interface LyricRowProps {
  segment: LyricSegment;
  index: number;
  isCurrentSeg: boolean;
  isPastSeg: boolean;
  onPressSegment: (idx: number) => void;
}

const LyricSegmentRow = memo<LyricRowProps>(
  ({ segment, index, isCurrentSeg, isPastSeg, onPressSegment }) => {
    return (
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={() => onPressSegment(index)}
        style={[styles.lyricSegmentBox, isCurrentSeg && styles.lyricSegmentBoxActive]}
      >
        {isCurrentSeg ? (
          <ActiveLyricWords segment={segment} />
        ) : (
          <Text style={[styles.lyricSentence, isPastSeg && styles.lyricSentencePast]}>
            {segment.text}
          </Text>
        )}
      </TouchableOpacity>
    );
  },
  (prev, next) =>
    prev.segment.id === next.segment.id &&
    prev.isCurrentSeg === next.isCurrentSeg &&
    prev.isPastSeg === next.isPastSeg
);

export const NowPlayingModal: React.FC = () => {
  const isFullPlayerOpen = usePlayerStore((s) => s.isFullPlayerOpen);
  const albums = usePlayerStore((s) => s.albums);
  const activeAlbumId = usePlayerStore((s) => s.activeAlbumId);
  const activeChapterIndex = usePlayerStore((s) => s.activeChapterIndex);
  const activeSegmentIndex = usePlayerStore((s) => s.activeSegmentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const ttsConfig = usePlayerStore((s) => s.ttsConfig);

  const togglePlayPause = usePlayerStore((s) => s.togglePlayPause);
  const skipNextSegment = usePlayerStore((s) => s.skipNextSegment);
  const skipPrevSegment = usePlayerStore((s) => s.skipPrevSegment);
  const skipToChapter = usePlayerStore((s) => s.skipToChapter);
  const seekToSegment = usePlayerStore((s) => s.seekToSegment);
  const setPlaybackSpeed = usePlayerStore((s) => s.setPlaybackSpeed);
  const setEngineMode = usePlayerStore((s) => s.setEngineMode);
  const setFullPlayerOpen = usePlayerStore((s) => s.setFullPlayerOpen);
  const addBookmarkFromCurrent = usePlayerStore((s) => s.addBookmarkFromCurrent);

  const [viewMode, setViewMode] = useState<'lyrics' | 'chapters' | 'voices'>('lyrics');
  const [bookmarkToast, setBookmarkToast] = useState<string | null>(null);
  const [deviceVoices, setDeviceVoices] = useState<TTSVoiceOption[]>([]);
  const [scrubberWidth, setScrubberWidth] = useState<number>(300);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const lyricsListRef = useRef<FlatList<LyricSegment>>(null);

  useEffect(() => {
    if (isFullPlayerOpen && deviceVoices.length === 0) {
      discoverDeviceNeuralVoices().then(setDeviceVoices);
    }
  }, [isFullPlayerOpen, deviceVoices.length]);

  const activeAlbum = albums.find((a) => a.id === activeAlbumId) || albums[0];
  const activeChapter = activeAlbum?.chapters[activeChapterIndex] || activeAlbum?.chapters[0];
  const segments = activeChapter?.segments || [];

  useEffect(() => {
    if (
      isFullPlayerOpen &&
      viewMode === 'lyrics' &&
      lyricsListRef.current &&
      segments.length > 0 &&
      activeSegmentIndex >= 0 &&
      activeSegmentIndex < segments.length
    ) {
      try {
        lyricsListRef.current.scrollToIndex({
          index: activeSegmentIndex,
          animated: true,
          viewPosition: 0.25,
        });
      } catch {}
    }
  }, [activeSegmentIndex, viewMode, isFullPlayerOpen, segments.length]);

  const handlePressSegment = useCallback(
    (idx: number) => {
      seekToSegment(idx);
    },
    [seekToSegment]
  );

  if (!isFullPlayerOpen || !activeAlbum) return null;

  const handleBookmark = () => {
    const saved = addBookmarkFromCurrent();
    if (saved) {
      setBookmarkToast('Saved to Liked Clips!');
      setTimeout(() => setBookmarkToast(null), 2200);
    }
  };

  // Interactive slide / scrubber bar handlers
  const handleScrubberLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) setScrubberWidth(w);
  };

  const computeRatioFromTouch = (e: GestureResponderEvent): number => {
    const x = e.nativeEvent.locationX;
    return Math.max(0, Math.min(1, x / Math.max(1, scrubberWidth)));
  };

  const handleScrubberStart = (e: GestureResponderEvent) => {
    setDragRatio(computeRatioFromTouch(e));
  };

  const handleScrubberMove = (e: GestureResponderEvent) => {
    setDragRatio(computeRatioFromTouch(e));
  };

  const handleScrubberRelease = (e: GestureResponderEvent) => {
    const ratio = dragRatio !== null ? dragRatio : computeRatioFromTouch(e);
    setDragRatio(null);
    if (segments.length > 0) {
      const targetIdx = Math.min(
        segments.length - 1,
        Math.max(0, Math.floor(ratio * segments.length))
      );
      seekToSegment(targetIdx);
    }
  };

  const currentRatio =
    dragRatio !== null
      ? dragRatio
      : segments.length > 1
      ? activeSegmentIndex / (segments.length - 1)
      : segments.length === 1
      ? 1
      : 0;

  const progressPercent = Math.min(100, Math.max(0, Math.round(currentRatio * 100)));
  const currentSeg = segments[activeSegmentIndex];
  const elapsedChapterSec = currentSeg?.startTimeOffsetSec || 0;
  const totalChapterSec = activeChapter?.estimatedDurationSec || 1;

  const allVoiceOptions = [...DEFAULT_VOICE_CATALOG, ...deviceVoices];

  const renderLyricItem = ({ item, index }: { item: LyricSegment; index: number }) => (
    <LyricSegmentRow
      segment={item}
      index={index}
      isCurrentSeg={index === activeSegmentIndex}
      isPastSeg={index < activeSegmentIndex}
      onPressSegment={handlePressSegment}
    />
  );

  const renderChapterItem = ({ item: ch, index: cIdx }: { item: ChapterTrack; index: number }) => {
    const isCurrent = cIdx === activeChapterIndex;
    return (
      <TouchableOpacity
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
  };

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
            <FlatList
              ref={lyricsListRef}
              data={segments}
              keyExtractor={(item) => item.id}
              renderItem={renderLyricItem}
              contentContainerStyle={styles.lyricsScrollContent}
              showsVerticalScrollIndicator={false}
              initialNumToRender={12}
              maxToRenderPerBatch={10}
              windowSize={5}
              removeClippedSubviews
              onScrollToIndexFailed={(info) => {
                lyricsListRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: true,
                });
              }}
              ListHeaderComponent={
                <Text style={styles.lyricsHint}>
                  Tap any sentence or drag the slide bar below to seek audio
                </Text>
              }
            />
          )}

          {viewMode === 'chapters' && (
            <FlatList
              data={activeAlbum.chapters}
              keyExtractor={(item) => item.id}
              renderItem={renderChapterItem}
              contentContainerStyle={styles.chaptersScrollContent}
              initialNumToRender={15}
              maxToRenderPerBatch={12}
              windowSize={5}
              removeClippedSubviews
            />
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
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.nowPlayingTrackTitle} numberOfLines={1}>
              {activeChapter?.title}
            </Text>
            <Text style={styles.nowPlayingEngineSub}>
              {ttsConfig.engineMode === 'on-device-neural'
                ? '⚡ On-Device Neural TTS • Background Ready'
                : ttsConfig.engineMode === 'backend-neural'
                ? '☁️ Neural Studio Stream (Word Synced)'
                : `🎙️ ${ttsConfig.engineMode.toUpperCase()}`}
            </Text>
          </View>
          <View style={styles.segmentCounterPill}>
            <Text style={styles.segmentCounterText}>
              {activeSegmentIndex + 1} / {Math.max(1, segments.length)}
            </Text>
          </View>
        </View>

        {/* Interactive Scrubber / Slide Bar */}
        <View style={styles.scrubberContainer}>
          <View
            style={styles.scrubberHitArea}
            onLayout={handleScrubberLayout}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleScrubberStart}
            onResponderMove={handleScrubberMove}
            onResponderRelease={handleScrubberRelease}
          >
            <View style={styles.scrubberTrack}>
              <View style={[styles.scrubberFill, { width: `${progressPercent}%` }]} />
            </View>
            <View
              style={[
                styles.scrubberThumb,
                { left: `${progressPercent}%` },
              ]}
            />
          </View>
          <View style={styles.scrubberTimeRow}>
            <Text style={styles.scrubberTimeText}>{formatSeconds(elapsedChapterSec)}</Text>
            <Text style={styles.scrubberTimeText}>
              Track {activeChapterIndex + 1} of {activeAlbum.chapters.length}
            </Text>
            <Text style={styles.scrubberTimeText}>{formatSeconds(totalChapterSec)}</Text>
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

          <TouchableOpacity
            onPress={() => seekToSegment(Math.max(0, activeSegmentIndex - 3))}
            style={styles.transportBtn}
            accessibilityLabel="Rewind 3 sentences"
          >
            <Ionicons name="play-back" size={24} color="#B3B3B3" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={skipPrevSegment}
            style={styles.transportBtn}
            accessibilityLabel="Previous Sentence"
          >
            <Ionicons name="play-skip-back" size={30} color="#FFFFFF" />
          </TouchableOpacity>

          <TouchableOpacity onPress={togglePlayPause} style={styles.bigPlayCircle}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={34} color="#000000" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={skipNextSegment}
            style={styles.transportBtn}
            accessibilityLabel="Next Sentence"
          >
            <Ionicons name="play-skip-forward" size={30} color="#FFFFFF" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() =>
              seekToSegment(Math.min(Math.max(0, segments.length - 1), activeSegmentIndex + 3))
            }
            style={styles.transportBtn}
            accessibilityLabel="Forward 3 sentences"
          >
            <Ionicons name="play-forward" size={24} color="#B3B3B3" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              if (activeChapterIndex + 1 < activeAlbum.chapters.length) {
                skipToChapter(activeChapterIndex + 1);
              } else if (activeAlbum.chapters.length > 0) {
                skipToChapter(0);
              }
            }}
            style={styles.speedPill}
            accessibilityLabel="Next Chapter"
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
    paddingBottom: 24,
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
    marginBottom: 14,
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
    marginBottom: 6,
  },
  nowPlayingTrackTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  nowPlayingEngineSub: {
    color: '#1DB954',
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 2,
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
  scrubberContainer: {
    marginBottom: 14,
  },
  scrubberHitArea: {
    height: 28,
    justifyContent: 'center',
    position: 'relative',
  },
  scrubberTrack: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  scrubberFill: {
    height: '100%',
    backgroundColor: '#1DB954',
  },
  scrubberThumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#1DB954',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    marginLeft: -8,
    top: 6,
    elevation: 4,
  },
  scrubberTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  scrubberTimeText: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '600',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  speedPill: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 18,
    minWidth: 48,
    alignItems: 'center',
  },
  speedPillText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12.5,
  },
  transportBtn: {
    padding: 8,
  },
  bigPlayCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1DB954',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
  },
});
