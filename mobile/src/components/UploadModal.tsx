import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { createAlbumFromRawText, parseDocumentToAlbum } from '../services/documentParser';
import { usePlayerStore } from '../store/usePlayerStore';

interface UploadModalProps {
  visible: boolean;
  onClose: () => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({ visible, onClose }) => {
  const { ttsConfig, addAlbum, playAlbum, setFullPlayerOpen } = usePlayerStore();
  const [isParsing, setIsParsing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customText, setCustomText] = useState('');

  const handlePickDocument = async () => {
    setErrorMsg(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
          'text/markdown',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      setIsParsing(true);
      const album = await parseDocumentToAlbum(
        asset.uri,
        asset.name || 'Uploaded Document.pdf',
        asset.mimeType || 'application/pdf',
        ttsConfig
      );

      addAlbum(album);
      setIsParsing(false);
      onClose();
      playAlbum(album.id, 0, 0);
      setFullPlayerOpen(true);
    } catch (err: any) {
      setIsParsing(false);
      setErrorMsg(err?.message || 'Failed to parse document.');
    }
  };

  const handleCreateFromPaste = () => {
    if (!customText.trim()) {
      setErrorMsg('Please paste some text or article paragraphs first.');
      return;
    }
    const title = customTitle.trim() || 'Custom Audio Note';
    const album = createAlbumFromRawText(title, 'Direct Text Import', 'txt', customText, ttsConfig);
    addAlbum(album);
    setCustomTitle('');
    setCustomText('');
    setPasteMode(false);
    onClose();
    playAlbum(album.id, 0, 0);
    setFullPlayerOpen(true);
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Add Document to Spotify Player</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color="#B3B3B3" />
            </TouchableOpacity>
          </View>

          {errorMsg && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          )}

          {!pasteMode ? (
            <>
              <TouchableOpacity
                style={styles.uploadDropzone}
                onPress={handlePickDocument}
                disabled={isParsing}
              >
                {isParsing ? (
                  <>
                    <ActivityIndicator size="large" color="#1DB954" />
                    <Text style={styles.dropzoneTitle}>
                      Extracting Chapters & Cleaning Citations...
                    </Text>
                  </>
                ) : (
                  <>
                    <View style={styles.iconCircle}>
                      <Ionicons name="cloud-upload-outline" size={32} color="#1DB954" />
                    </View>
                    <Text style={styles.dropzoneTitle}>Select PDF or Word (.docx)</Text>
                    <Text style={styles.dropzoneSub}>
                      Auto-detects headings into tracks, strips headers/footers & creates Track 0
                      TL;DR summary
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => {
                  setErrorMsg(null);
                  setPasteMode(true);
                }}
              >
                <Ionicons name="clipboard-outline" size={18} color="#FFFFFF" />
                <Text style={styles.secondaryBtnText}>Or Paste Text / Article Directly</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.pasteForm}>
              <TextInput
                placeholder="Document Title (e.g. Q4 Board Strategy)"
                placeholderTextColor="#777"
                value={customTitle}
                onChangeText={setCustomTitle}
                style={styles.inputField}
              />
              <TextInput
                placeholder="Paste chapters, study notes, or article text here..."
                placeholderTextColor="#777"
                value={customText}
                onChangeText={setCustomText}
                multiline
                style={[styles.inputField, styles.textArea]}
              />
              <View style={styles.pasteActions}>
                <TouchableOpacity
                  style={styles.backBtn}
                  onPress={() => setPasteMode(false)}
                >
                  <Text style={styles.backBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.convertBtn}
                  onPress={handleCreateFromPaste}
                >
                  <Ionicons name="play" size={16} color="#000" />
                  <Text style={styles.convertBtnText}>Convert & Play Now</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: '#1E1E1E',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  errorBox: {
    backgroundColor: 'rgba(225, 29, 72, 0.2)',
    borderColor: '#E11D48',
    borderWidth: 1,
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  errorText: {
    color: '#FDA4AF',
    fontSize: 12.5,
  },
  uploadDropzone: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#1DB954',
    backgroundColor: 'rgba(29, 185, 84, 0.07)',
    borderRadius: 16,
    paddingVertical: 32,
    paddingHorizontal: 18,
    alignItems: 'center',
    marginBottom: 14,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(29, 185, 84, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  dropzoneTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  dropzoneSub: {
    color: '#A1A1AA',
    fontSize: 12.5,
    textAlign: 'center',
    lineHeight: 18,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2A2A2A',
    paddingVertical: 13,
    borderRadius: 12,
    gap: 8,
  },
  secondaryBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  pasteForm: {
    gap: 10,
  },
  inputField: {
    backgroundColor: '#121212',
    color: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  textArea: {
    minHeight: 130,
    textAlignVertical: 'top',
  },
  pasteActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 6,
  },
  backBtn: {
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  backBtnText: {
    color: '#B3B3B3',
    fontWeight: '600',
  },
  convertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1DB954',
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 20,
    gap: 6,
  },
  convertBtnText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 13.5,
  },
});
