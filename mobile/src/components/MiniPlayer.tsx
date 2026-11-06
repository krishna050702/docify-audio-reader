import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { usePlayerStore } from '../store/usePlayerStore';

export const MiniPlayer: React.FC = () => {
  const {
    albums,
    activeAlbumId,
    activeChapterIndex,
    activeSegmentIndex,
    isPlaying,
    togglePlayPause,
    skipNextSegment,
    setFullPlayerOpen,
    addBookmarkFromCurrent,
  } = usePlayerStore();

  const activeAlbum = albums.find((a) => a.id === activeAlbumId) || albums[0];
  if (!activeAlbum) return null;

  const chapter = activeAlbum.chapters[activeChapterIndex] || activeAlbum.chapters[0];
  const totalSegments = chapter?.segments.length || 1;
  const progressPercent = Math.min(100, Math.round(((activeSegmentIndex + 1) / totalSegments) * 100));

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={() => setFullPlayerOpen(true)}
      style={styles.container}
    >
      <View style={styles.innerRow}>
        <LinearGradient
          colors={activeAlbum.coverColors}
          style={styles.coverThumb}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <Ionicons
            name={activeAlbum.fileType === 'pdf' ? 'document-text' : 'reader'}
            size={20}
            color="#FFFFFF"
          />
        </LinearGradient>

        <View style={styles.metaCol}>
          <Text style={styles.trackTitle} numberOfLines={1}>
            {chapter?.title || activeAlbum.title}
          </Text>
          <Text style={styles.albumSub} numberOfLines={1}>
            {activeAlbum.title} • Track {activeChapterIndex + 1}/{activeAlbum.chapters.length}
          </Text>
        </View>

        <TouchableOpacity
          onPress={(e) => {
            e.stopPropagation();
            addBookmarkFromCurrent();
          }}
          style={styles.iconBtn}
          accessibilityLabel="Save Audio Bookmark"
        >
          <Ionicons name="heart-outline" size={22} color="#B3B3B3" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={(e) => {
            e.stopPropagation();
            togglePlayPause();
          }}
          style={styles.playBtn}
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
        >
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color="#000000" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={(e) => {
            e.stopPropagation();
            skipNextSegment();
          }}
          style={styles.iconBtn}
          accessibilityLabel="Next Sentence"
        >
          <Ionicons name="play-skip-forward" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Spotify-style thin bottom progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#242424',
    marginHorizontal: 8,
    marginBottom: 6,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    elevation: 10,
  },
  innerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  coverThumb: {
    width: 42,
    height: 42,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaCol: {
    flex: 1,
    marginLeft: 10,
    marginRight: 6,
  },
  trackTitle: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  albumSub: {
    color: '#B3B3B3',
    fontSize: 11.5,
    marginTop: 2,
  },
  iconBtn: {
    padding: 8,
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1DB954',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  progressTrack: {
    height: 2.5,
    backgroundColor: 'rgba(255,255,255,0.12)',
    width: '100%',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#1DB954',
  },
});
