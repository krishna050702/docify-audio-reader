import * as FileSystem from 'expo-file-system';
import JSZip from 'jszip';
import { DocumentAlbum, TTSConfig } from '../types';
import { structureTextIntoChapters } from './textCleaner';

const ALBUM_PALETTES: [string, string][] = [
  ['#1DB954', '#0A3D1C'],
  ['#4F46E5', '#1E1B4B'],
  ['#E11D48', '#4C0519'],
  ['#D97706', '#451A03'],
  ['#0891B2', '#083344'],
  ['#9333EA', '#3B0764'],
];

function pickCoverPalette(seed: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return ALBUM_PALETTES[Math.abs(hash) % ALBUM_PALETTES.length];
}

/**
 * Extracts text & headings directly on-device from a Word (.docx) file using JSZip + XML parsing.
 * Works 100% offline without requiring a backend!
 */
export async function extractTextFromDocxUri(fileUri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const zip = await JSZip.loadAsync(base64, { base64: true });
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) {
    throw new Error('Invalid .docx file: word/document.xml not found.');
  }

  const xmlContent = await docXmlFile.async('text');
  const paragraphs = xmlContent.split(/<\/w:p>/);
  const extractedLines: string[] = [];

  for (const p of paragraphs) {
    const isHeading = /<w:pStyle\s+w:val="(?:Heading[1-3]|Title|Subtitle)"/i.test(p);
    const textMatches = p.match(/<w:t(?:\s+[^>]*)?>([^<]*)<\/w:t>/g);
    if (!textMatches) continue;

    const lineText = textMatches
      .map((t) => t.replace(/<[^>]+>/g, ''))
      .join('')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .trim();

    if (lineText) {
      extractedLines.push(isHeading ? `## ${lineText}` : lineText);
    }
  }

  return extractedLines.join('\n\n');
}

/**
 * Extracts readable text streams from a PDF file locally as an offline fallback when the backend is unreachable.
 */
export async function extractTextFromPdfLocalFallback(fileUri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Decode base64 to binary string to scan PDF text objects (BT ... ET)
  const binary = globalThis.atob ? globalThis.atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const chunks: string[] = [];
  const tjRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
  let match: RegExpExecArray | null;

  while ((match = tjRegex.exec(binary)) !== null) {
    const cleaned = match[1]
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, ' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .trim();
    if (cleaned && /[a-zA-Z0-9]/.test(cleaned)) {
      chunks.push(cleaned);
    }
  }

  if (chunks.length > 5) {
    return chunks.join(' ');
  }

  throw new Error(
    'This PDF uses compressed FlateDecode streams or scanned images. Connect the FastAPI Backend in Settings to parse compressed/scanned PDFs with PyMuPDF.'
  );
}

/**
 * Parses an uploaded PDF, DOCX, or TXT file using the FastAPI backend (if reachable) or local on-device parser.
 */
export async function parseDocumentToAlbum(
  fileUri: string,
  fileName: string,
  mimeType: string,
  ttsConfig: TTSConfig
): Promise<DocumentAlbum> {
  const cleanTitle = fileName.replace(/\.(pdf|docx|doc|txt|md)$/i, '');
  const ext = fileName.toLowerCase().endsWith('.docx')
    ? 'docx'
    : fileName.toLowerCase().endsWith('.pdf') || mimeType.includes('pdf')
    ? 'pdf'
    : 'txt';

  let rawText = '';

  // 1. Try FastAPI Backend first for PDFs (layout-aware PyMuPDF extraction) or if user configured backend
  if (ttsConfig.backendUrl) {
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: fileUri,
        name: fileName,
        type: mimeType || 'application/octet-stream',
      } as any);

      const res = await fetch(`${ttsConfig.backendUrl.replace(/\/$/, '')}/api/parse-document`, {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.text && data.text.trim().length > 0) {
          rawText = data.text;
        }
      }
    } catch {
      // Backend offline -> gracefully fall back to on-device parser below
    }
  }

  // 2. Local On-Device Extraction fallback
  if (!rawText) {
    if (ext === 'docx') {
      rawText = await extractTextFromDocxUri(fileUri);
    } else if (ext === 'txt') {
      rawText = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
    } else if (ext === 'pdf') {
      rawText = await extractTextFromPdfLocalFallback(fileUri);
    }
  }

  return createAlbumFromRawText(cleanTitle, `Uploaded ${ext.toUpperCase()}`, ext, rawText, ttsConfig);
}

/**
 * Creates a playable DocumentAlbum directly from raw or pasted text.
 */
export function createAlbumFromRawText(
  title: string,
  authorOrSource: string,
  fileType: 'pdf' | 'docx' | 'txt',
  rawText: string,
  ttsConfig: TTSConfig
): DocumentAlbum {
  const chapters = structureTextIntoChapters(title, rawText, {
    stripCitations: ttsConfig.smartCleanCitations,
    stripHeadersFooters: ttsConfig.smartCleanHeadersFooters,
    generateSummaryTrack: ttsConfig.autoGenerateSummaryTrack,
  });

  const totalDurationSec = chapters.reduce((sum, c) => sum + c.estimatedDurationSec, 0);
  const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);

  return {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    authorOrSource,
    fileType,
    createdAt: new Date().toISOString(),
    coverColors: pickCoverPalette(title),
    totalDurationSec,
    totalWords,
    chapters,
    lastPlayedChapterIndex: 0,
    lastPlayedSegmentIndex: 0,
    isOfflineReady: true,
  };
}

/**
 * Preloaded sample documents so users can immediately test Spotify-style playback, chapter skipping & live lyrics.
 */
export function getInitialSampleAlbums(ttsConfig: TTSConfig): DocumentAlbum[] {
  const sample1Text = `
1. The Attention Economy & Deep Focus
In a world saturated with constant notifications, long-form reading has become increasingly difficult for busy professionals and students [1, 2]. Research papers, legal contracts, and strategy memos pile up in our downloads folder while we spend hours commuting, exercising, or cooking (Newport, 2024).
By transforming static PDFs and Word documents into chapter-indexed audio streams with live synced lyrics, your ears can absorb complex material effortlessly while your hands and eyes are free.

2. Why Traditional PDF Screen Readers Fail
Legacy text-to-speech readers treat documents like raw strings of characters. They read running page headers, "Page 14 of 52", footnote numbers, and broken hyphenations out loud, breaking your concentration every thirty seconds.
Docify solves this with an intelligent layout and text cleaning pipeline. Before a single word is sent to the neural voice synthesizer, citations, headers, and formatting noise are stripped away, leaving pure narrative flow.

3. Hybrid On-Device & Cloud Neural Voices
Not every moment has high-speed Wi-Fi. When you are on a flight or subway, On-Device Neural TTS synthesizes natural human prosody directly on your phone's processor at zero cost.
When connected, you can switch seamlessly to studio-grade Cloud Neural voices with millisecond-accurate word timestamps that light up each word like Spotify lyrics.
  `.trim();

  const sample2Text = `
Chapter 1: System Architecture Overview
Modern cross-platform mobile applications require a responsive UI thread decoupled from heavy file parsing and audio synthesis. In our architecture, document ingestion splits large files into hierarchical Chapters and bite-sized Lyric Segments.
Instead of waiting three minutes for a 100-page report to convert into a single large audio file, Just-In-Time paragraph streaming synthesizes the first sentence in under one second while pre-fetching upcoming paragraphs in the background cache.

Chapter 2: Memory & Battery Optimization
Audio chunks are cached locally on the device filesystem indexed by content hash. If you rewind 15 seconds or replay a bookmarked clip for exam revision, the cached audio plays instantaneously without re-running the neural model or using mobile data.
  `.trim();

  return [
    createAlbumFromRawText(
      'Deep Focus: Future of Audio Reading.pdf',
      'Research Whitepaper • PDF',
      'pdf',
      sample1Text,
      ttsConfig
    ),
    createAlbumFromRawText(
      'Distributed Mobile Architecture.docx',
      'Engineering Spec • DOCX',
      'docx',
      sample2Text,
      ttsConfig
    ),
  ];
}
