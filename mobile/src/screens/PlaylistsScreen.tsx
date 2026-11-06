import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { usePlayerStore } from '../store/usePlayerStore';

export const PlaylistsScreen: React.FC = () => {
  const {
    bookmarks,
    playlists,
    albums,
    playAlbum,
    setFullPlayerOpen,
    removeBookmark,
  } = usePlayerStore();

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 120 }}>
      <Text style={styles.pageTitle}>Liked Clips & Playlists</Text>
      <Text style={styles.pageSub}>
        Tap any saved quote to jump straight back to that exact moment in the document.
      </Text>

      {/* Liked Audio/Lyric Bookmarks */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="heart" size={18} color="#1DB954" />
          <Text style={styles.sectionTitle}>Saved Audio Highlights ({bookmarks.length})</Text>
        </View>

        {bookmarks.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="bookmark-outline" size={28} color="#666" />
            <Text style={styles.emptyText}>
              Tap the Heart or Bookmark icon while listening to save key quotes and audio timestamps
              here.
            </Text>
          </View>
        ) : (
          bookmarks.map((bm) => (
            <TouchableOpacity
              key={bm.id}
              style={styles.bookmarkCard}
              onPress={() => {
                playAlbum(bm.documentId, bm.chapterIndex, bm.segmentIndex);
                setFullPlayerOpen(true);
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.quoteText}>"{bm.snippetText}"</Text>
                <Text style={styles.quoteMeta}>
                  {bm.documentTitle} • {bm.chapterTitle}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => removeBookmark(bm.id)}
                style={{ padding: 6 }}
              >
                <Ionicons name="close-circle-outline" size={20} color="#777" />
              </TouchableOpacity>
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* Playlists */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="musical-notes" size={18} color="#1DB954" />
          <Text style={styles.sectionTitle}>Study & Commute Queues</Text>
        </View>

        {playlists.map((pl) => (
          <View key={pl.id} style={styles.playlistCard}>
            <View style={styles.playlistIconBox}>
              <Ionicons name="albums" size={24} color="#1DB954" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.playlistTitle}>{pl.name}</Text>
              <Text style={styles.playlistDesc}>{pl.description}</Text>
              <Text style={styles.playlistCount}>{albums.length} Documents Available</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  pageTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  pageSub: {
    color: '#9CA3AF',
    fontSize: 13,
    marginTop: 4,
    marginBottom: 18,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    padding: 22,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    color: '#888888',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  bookmarkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#1DB954',
  },
  quoteText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  quoteMeta: {
    color: '#1DB954',
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 6,
  },
  playlistCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
  },
  playlistIconBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: 'rgba(29, 185, 84, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  playlistDesc: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 2,
  },
  playlistCount: {
    color: '#1DB954',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
});
