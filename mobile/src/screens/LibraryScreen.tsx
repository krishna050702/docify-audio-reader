import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { UploadModal } from '../components/UploadModal';
import { usePlayerStore } from '../store/usePlayerStore';

export const LibraryScreen: React.FC = () => {
  const albums = usePlayerStore((s) => s.albums);
  const activeAlbumId = usePlayerStore((s) => s.activeAlbumId);
  const activeChapterIndex = usePlayerStore((s) => s.activeChapterIndex);
  const activeSegmentIndex = usePlayerStore((s) => s.activeSegmentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playAlbum = usePlayerStore((s) => s.playAlbum);
  const togglePlayPause = usePlayerStore((s) => s.togglePlayPause);
  const deleteAlbum = usePlayerStore((s) => s.deleteAlbum);
  const setFullPlayerOpen = usePlayerStore((s) => s.setFullPlayerOpen);
  const ttsConfig = usePlayerStore((s) => s.ttsConfig);

  const [searchQuery, setSearchQuery] = useState('');
  const [uploadVisible, setUploadVisible] = useState(false);

  const filteredAlbums = albums.filter(
    (a) =>
      a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.authorOrSource.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const continueAlbum = albums.find((a) => a.id === activeAlbumId) || albums[0];
  const continueChapIdx =
    continueAlbum?.id === activeAlbumId
      ? activeChapterIndex
      : continueAlbum?.lastPlayedChapterIndex || 0;
  const continueSegIdx =
    continueAlbum?.id === activeAlbumId
      ? activeSegmentIndex
      : continueAlbum?.lastPlayedSegmentIndex || 0;

  return (
    <View style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topHeader}>
        <View>
          <Text style={styles.greeting}>Good Evening</Text>
          <Text style={styles.subGreeting}>
            {ttsConfig.engineMode === 'on-device-neural'
              ? '⚡ On-Device Neural TTS Active'
              : `☁️ ${ttsConfig.engineMode.toUpperCase()} Active`}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.uploadCtaButton}
          onPress={() => setUploadVisible(true)}
        >
          <Ionicons name="add-circle" size={20} color="#000000" />
          <Text style={styles.uploadCtaText}>Upload PDF / Word</Text>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#8E8E93" />
        <TextInput
          placeholder="Search your PDFs, Word docs, or chapters..."
          placeholderTextColor="#8E8E93"
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={styles.searchInput}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={18} color="#8E8E93" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Continue Listening Hero Card */}
        {continueAlbum && (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>Continue Listening</Text>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => {
                if (activeAlbumId !== continueAlbum.id || !isPlaying) {
                  playAlbum(continueAlbum.id);
                }
                setFullPlayerOpen(true);
              }}
            >
              <LinearGradient
                colors={[continueAlbum.coverColors[0], '#1A1A1A']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroCard}
              >
                <View style={styles.heroBadgeRow}>
                  <View style={styles.fileTypePill}>
                    <Text style={styles.fileTypePillText}>
                      {continueAlbum.fileType.toUpperCase()} ALBUM
                    </Text>
                  </View>
                  <Text style={styles.heroTimeLeft}>
                    Track {continueChapIdx + 1}/{continueAlbum.chapters.length} • Sentence{' '}
                    {continueSegIdx + 1}
                  </Text>
                </View>

                <Text style={styles.heroDocTitle} numberOfLines={2}>
                  {continueAlbum.title}
                </Text>
                <Text style={styles.heroChapterSub} numberOfLines={1}>
                  Up next:{' '}
                  {continueAlbum.chapters[continueChapIdx]?.title ||
                    continueAlbum.chapters[0]?.title}
                </Text>

                <View style={styles.heroPlayRow}>
                  <View style={styles.lyricsReadyTag}>
                    <Ionicons name="musical-notes" size={13} color="#1DB954" />
                    <Text style={styles.lyricsReadyText}>Synced Lyrics & Auto-Resume</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.heroPlayCircle}
                    onPress={(e) => {
                      e.stopPropagation();
                      if (activeAlbumId === continueAlbum.id) {
                        togglePlayPause();
                      } else {
                        playAlbum(continueAlbum.id);
                      }
                    }}
                  >
                    <Ionicons
                      name={isPlaying && activeAlbumId === continueAlbum.id ? 'pause' : 'play'}
                      size={22}
                      color="#000"
                    />
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* Document Albums List */}
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Your Document Albums ({filteredAlbums.length})</Text>
          </View>

          {filteredAlbums.map((album) => {
            const isCurrent = album.id === activeAlbumId;
            const savedChap = isCurrent ? activeChapterIndex : album.lastPlayedChapterIndex || 0;
            const savedSeg = isCurrent ? activeSegmentIndex : album.lastPlayedSegmentIndex || 0;
            return (
              <TouchableOpacity
                key={album.id}
                style={[styles.albumCard, isCurrent && styles.albumCardActive]}
                onPress={() => {
                  if (!isCurrent || !isPlaying) {
                    playAlbum(album.id);
                  }
                  setFullPlayerOpen(true);
                }}
              >
                <LinearGradient
                  colors={album.coverColors}
                  style={styles.albumCover}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Ionicons
                    name={album.fileType === 'pdf' ? 'document-text' : 'reader'}
                    size={26}
                    color="#FFFFFF"
                  />
                  <Text style={styles.coverExtTag}>{album.fileType.toUpperCase()}</Text>
                </LinearGradient>

                <View style={styles.albumMeta}>
                  <Text
                    style={[styles.albumTitle, isCurrent && { color: '#1DB954' }]}
                    numberOfLines={1}
                  >
                    {album.title}
                  </Text>
                  <Text style={styles.albumSub} numberOfLines={1}>
                    Track {savedChap + 1}/{album.chapters.length} • Sentence {savedSeg + 1}
                  </Text>
                  <View style={styles.albumTagRow}>
                    <View style={styles.metaChip}>
                      <Ionicons name="time-outline" size={12} color="#B3B3B3" />
                      <Text style={styles.metaChipText}>
                        {Math.max(1, Math.round(album.totalDurationSec / 60))}m
                      </Text>
                    </View>
                    <View style={styles.metaChip}>
                      <Ionicons name="flash-outline" size={12} color="#1DB954" />
                      <Text style={[styles.metaChipText, { color: '#1DB954' }]}>
                        Auto-Resume
                      </Text>
                    </View>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation();
                    if (isCurrent) {
                      togglePlayPause();
                    } else {
                      playAlbum(album.id);
                    }
                  }}
                  style={styles.cardPlayToggleBtn}
                  accessibilityLabel={isCurrent && isPlaying ? 'Pause' : 'Play'}
                >
                  <Ionicons
                    name={isCurrent && isPlaying ? 'pause-circle' : 'play-circle'}
                    size={32}
                    color="#1DB954"
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => deleteAlbum(album.id)}
                  style={styles.deleteBtn}
                  accessibilityLabel="Remove Document"
                >
                  <Ionicons name="trash-outline" size={18} color="#666" />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <UploadModal visible={uploadVisible} onClose={() => setUploadVisible(false)} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  greeting: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  subGreeting: {
    color: '#1DB954',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  uploadCtaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1DB954',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 22,
    gap: 6,
  },
  uploadCtaText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 13,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F1F1F',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 16,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  sectionBlock: {
    marginBottom: 22,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 10,
  },
  heroCard: {
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  heroBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  fileTypePill: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  fileTypePillText: {
    color: '#1DB954',
    fontSize: 10.5,
    fontWeight: '800',
  },
  heroTimeLeft: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '600',
  },
  heroDocTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 6,
  },
  heroChapterSub: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    marginBottom: 14,
  },
  heroPlayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lyricsReadyTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 6,
  },
  lyricsReadyText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '600',
  },
  heroPlayCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#1DB954',
    alignItems: 'center',
    justifyContent: 'center',
  },
  albumCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    padding: 12,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  albumCardActive: {
    borderColor: 'rgba(29, 185, 84, 0.5)',
    backgroundColor: '#1E2621',
  },
  albumCover: {
    width: 60,
    height: 60,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverExtTag: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    marginTop: 2,
  },
  albumMeta: {
    flex: 1,
    marginLeft: 12,
  },
  albumTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  albumSub: {
    color: '#9CA3AF',
    fontSize: 12.5,
    marginTop: 2,
  },
  albumTagRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaChipText: {
    color: '#B3B3B3',
    fontSize: 11,
    fontWeight: '600',
  },
  cardPlayToggleBtn: {
    padding: 6,
    marginRight: 2,
  },
  deleteBtn: {
    padding: 8,
  },
});
