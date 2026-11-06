import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MiniPlayer } from './src/components/MiniPlayer';
import { NowPlayingModal } from './src/components/NowPlayingModal';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { PlaylistsScreen } from './src/screens/PlaylistsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { usePlayerStore } from './src/store/usePlayerStore';

export default function App() {
  const [activeTab, setActiveTab] = useState<'library' | 'playlists' | 'settings'>('library');
  const initializeDefaultsIfEmpty = usePlayerStore((s) => s.initializeDefaultsIfEmpty);

  useEffect(() => {
    initializeDefaultsIfEmpty();
  }, [initializeDefaultsIfEmpty]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      {/* Main Screen Content */}
      <View style={styles.mainViewport}>
        {activeTab === 'library' && <LibraryScreen />}
        {activeTab === 'playlists' && <PlaylistsScreen />}
        {activeTab === 'settings' && <SettingsScreen />}
      </View>

      {/* Persistent Spotify Mini-Player Docked Above Bottom Tabs */}
      <View style={styles.bottomDock}>
        <MiniPlayer />

        <View style={styles.tabBar}>
          <TouchableOpacity
            style={styles.tabItem}
            onPress={() => setActiveTab('library')}
          >
            <Ionicons
              name={activeTab === 'library' ? 'library' : 'library-outline'}
              size={22}
              color={activeTab === 'library' ? '#1DB954' : '#8E8E93'}
            />
            <Text
              style={[
                styles.tabLabel,
                activeTab === 'library' && styles.tabLabelActive,
              ]}
            >
              Library
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.tabItem}
            onPress={() => setActiveTab('playlists')}
          >
            <Ionicons
              name={activeTab === 'playlists' ? 'heart' : 'heart-outline'}
              size={22}
              color={activeTab === 'playlists' ? '#1DB954' : '#8E8E93'}
            />
            <Text
              style={[
                styles.tabLabel,
                activeTab === 'playlists' && styles.tabLabelActive,
              ]}
            >
              Clips & Queues
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.tabItem}
            onPress={() => setActiveTab('settings')}
          >
            <Ionicons
              name={activeTab === 'settings' ? 'hardware-chip' : 'hardware-chip-outline'}
              size={22}
              color={activeTab === 'settings' ? '#1DB954' : '#8E8E93'}
            />
            <Text
              style={[
                styles.tabLabel,
                activeTab === 'settings' && styles.tabLabelActive,
              ]}
            >
              Neural TTS
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Full Screen Spotify Lyrics & Chapters Modal */}
      <NowPlayingModal />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#121212',
  },
  mainViewport: {
    flex: 1,
  },
  bottomDock: {
    backgroundColor: 'rgba(18, 18, 18, 0.96)',
  },
  tabBar: {
    flexDirection: 'row',
    height: 58,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    flex: 1,
  },
  tabLabel: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 3,
  },
  tabLabelActive: {
    color: '#1DB954',
    fontWeight: '700',
  },
});
