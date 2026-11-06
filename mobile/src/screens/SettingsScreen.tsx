import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { usePlayerStore } from '../store/usePlayerStore';
import { TTSEngineMode } from '../types';

const ENGINE_CARDS: {
  mode: TTSEngineMode;
  title: string;
  subtitle: string;
  badge: string;
}[] = [
  {
    mode: 'on-device-neural',
    title: 'On-Device Neural TTS (Kokoro-82M / Sherpa)',
    subtitle: 'Runs 100% offline on phone processor. Zero API cost, natural human prosody.',
    badge: 'RECOMMENDED • FREE',
  },
  {
    mode: 'backend-neural',
    title: 'Self-Hosted FastAPI Neural Server',
    subtitle: 'Streams Studio Neural voices + exact millisecond word timestamps from your backend.',
    badge: 'FREE CLOUD NEURAL',
  },
  {
    mode: 'cloud-openai',
    title: 'OpenAI HD Audio (tts-1 / tts-1-hd)',
    subtitle: 'Ultra-realistic Alloy, Nova, and Onyx voices using your OpenAI API key.',
    badge: 'CLOUD API',
  },
  {
    mode: 'cloud-elevenlabs',
    title: 'ElevenLabs Turbo v2.5',
    subtitle: 'Studio audiobook narration using your ElevenLabs API key.',
    badge: 'CLOUD API',
  },
];

export const SettingsScreen: React.FC = () => {
  const { ttsConfig, setEngineMode, updateTTSConfig } = usePlayerStore();

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 130 }}>
      <Text style={styles.pageTitle}>Voice Engine & Smart Cleaner</Text>
      <Text style={styles.pageSub}>
        Switch between Offline On-Device Neural TTS and Cloud AI Voices at any time.
      </Text>

      {/* Engine Mode Selector */}
      <Text style={styles.sectionHeader}>1. CHOOSE TTS ARCHITECTURE</Text>
      {ENGINE_CARDS.map((card) => {
        const active = ttsConfig.engineMode === card.mode;
        return (
          <TouchableOpacity
            key={card.mode}
            onPress={() => setEngineMode(card.mode)}
            style={[styles.engineCard, active && styles.engineCardActive]}
          >
            <View style={styles.engineTopRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <Ionicons
                  name={active ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={active ? '#1DB954' : '#777'}
                />
                <Text style={[styles.engineTitle, active && { color: '#1DB954' }]}>
                  {card.title}
                </Text>
              </View>
              <View style={styles.badgePill}>
                <Text style={styles.badgeText}>{card.badge}</Text>
              </View>
            </View>
            <Text style={styles.engineSub}>{card.subtitle}</Text>
          </TouchableOpacity>
        );
      })}

      {/* Ear-Friendly Document Cleaning Toggles */}
      <Text style={styles.sectionHeader}>2. EAR-FRIENDLY DOCUMENT CLEANING</Text>
      <View style={styles.cardGroup}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.toggleTitle}>Auto-Generate Track 0 Executive Summary</Text>
            <Text style={styles.toggleSub}>
              Adds a 60-second TL;DR audio overview track at the top of every uploaded PDF/DOCX
            </Text>
          </View>
          <Switch
            value={ttsConfig.autoGenerateSummaryTrack}
            onValueChange={(v) => updateTTSConfig({ autoGenerateSummaryTrack: v })}
            trackColor={{ false: '#333', true: '#1DB954' }}
          />
        </View>

        <View style={styles.toggleRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.toggleTitle}>Strip Academic Citations & Brackets</Text>
            <Text style={styles.toggleSub}>
              Skips reading [12, 14] and (Smith et al., 2024) out loud
            </Text>
          </View>
          <Switch
            value={ttsConfig.smartCleanCitations}
            onValueChange={(v) => updateTTSConfig({ smartCleanCitations: v })}
            trackColor={{ false: '#333', true: '#1DB954' }}
          />
        </View>

        <View style={styles.toggleRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.toggleTitle}>Strip Page Numbers & Running Headers</Text>
            <Text style={styles.toggleSub}>
              Removes "Page 4 of 25" and margin footers for uninterrupted flow
            </Text>
          </View>
          <Switch
            value={ttsConfig.smartCleanHeadersFooters}
            onValueChange={(v) => updateTTSConfig({ smartCleanHeadersFooters: v })}
            trackColor={{ false: '#333', true: '#1DB954' }}
          />
        </View>
      </View>

      {/* Cloud & Self-Hosted API Configuration */}
      <Text style={styles.sectionHeader}>3. BACKEND & CLOUD API KEYS (OPTIONAL)</Text>
      <View style={styles.cardGroup}>
        <Text style={styles.inputLabel}>FastAPI Document & Neural TTS Server URL</Text>
        <TextInput
          value={ttsConfig.backendUrl}
          onChangeText={(v) => updateTTSConfig({ backendUrl: v })}
          placeholder="http://localhost:8000"
          placeholderTextColor="#666"
          style={styles.textInput}
        />

        <Text style={styles.inputLabel}>OpenAI API Key (For Cloud OpenAI HD TTS)</Text>
        <TextInput
          value={ttsConfig.openAiApiKey}
          onChangeText={(v) => updateTTSConfig({ openAiApiKey: v })}
          placeholder="sk-..."
          placeholderTextColor="#666"
          secureTextEntry
          style={styles.textInput}
        />

        <Text style={styles.inputLabel}>ElevenLabs API Key (For ElevenLabs v2.5)</Text>
        <TextInput
          value={ttsConfig.elevenLabsApiKey}
          onChangeText={(v) => updateTTSConfig({ elevenLabsApiKey: v })}
          placeholder="xi-api-key..."
          placeholderTextColor="#666"
          secureTextEntry
          style={styles.textInput}
        />
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
  sectionHeader: {
    color: '#1DB954',
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 10,
  },
  engineCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  engineCardActive: {
    borderColor: '#1DB954',
    backgroundColor: 'rgba(29, 185, 84, 0.1)',
  },
  engineTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  engineTitle: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
    flex: 1,
  },
  badgePill: {
    backgroundColor: 'rgba(29, 185, 84, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    color: '#1DB954',
    fontSize: 9.5,
    fontWeight: '800',
  },
  engineSub: {
    color: '#9CA3AF',
    fontSize: 12.5,
    lineHeight: 18,
    marginLeft: 28,
  },
  cardGroup: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
    gap: 14,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  toggleSub: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 2,
  },
  inputLabel: {
    color: '#D1D5DB',
    fontSize: 12.5,
    fontWeight: '600',
    marginBottom: -6,
  },
  textInput: {
    backgroundColor: '#121212',
    color: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13.5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
});
