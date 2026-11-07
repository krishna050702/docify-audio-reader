import { File as ExpoFile } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';
import { DocumentAlbum, TTSConfig } from '../types';
import {
  sanitizeTextForSpeech,
  structureTextIntoChapters,
  structureTextIntoChaptersAsync,
  yieldToMainThread,
} from './textCleaner';

// pako is bundled with jszip and allows decompressing PDF FlateDecode streams on-device
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pako = require('pako');

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
 * Safely reads a picked document URI (`content://` or `file://`) as a Base64 string.
 */
async function readFileUriAsBase64(fileUri: string): Promise<string> {
  const tempDest = `${LegacyFileSystem.cacheDirectory}docify-picked-${Date.now()}.tmp`;
  try {
    await LegacyFileSystem.copyAsync({ from: fileUri, to: tempDest });
    const b64 = await LegacyFileSystem.readAsStringAsync(tempDest, {
      encoding: LegacyFileSystem.EncodingType.Base64,
    });
    await LegacyFileSystem.deleteAsync(tempDest, { idempotent: true });
    if (b64 && b64.length > 0) {
      return b64;
    }
  } catch {
    await LegacyFileSystem.deleteAsync(tempDest, { idempotent: true }).catch(() => {});
  }

  try {
    const NativeFileClass = Object.getPrototypeOf(ExpoFile);
    const nativeFile = NativeFileClass ? new NativeFileClass(fileUri) : new ExpoFile(fileUri);
    const b64 = await nativeFile.base64();
    if (b64 && b64.length > 0) {
      return b64;
    }
  } catch {
    // Fall through to direct read fallback
  }

  return await LegacyFileSystem.readAsStringAsync(fileUri, {
    encoding: LegacyFileSystem.EncodingType.Base64,
  });
}

/**
 * Safely reads a picked document URI (`content://` or `file://`) as a UTF-8 string.
 */
async function readFileUriAsUtf8(fileUri: string): Promise<string> {
  const tempDest = `${LegacyFileSystem.cacheDirectory}docify-picked-${Date.now()}.txt`;
  try {
    await LegacyFileSystem.copyAsync({ from: fileUri, to: tempDest });
    const text = await LegacyFileSystem.readAsStringAsync(tempDest, {
      encoding: LegacyFileSystem.EncodingType.UTF8,
    });
    await LegacyFileSystem.deleteAsync(tempDest, { idempotent: true });
    if (text && text.length > 0) {
      return text;
    }
  } catch {
    await LegacyFileSystem.deleteAsync(tempDest, { idempotent: true }).catch(() => {});
  }

  try {
    const NativeFileClass = Object.getPrototypeOf(ExpoFile);
    const nativeFile = NativeFileClass ? new NativeFileClass(fileUri) : new ExpoFile(fileUri);
    const text = await nativeFile.text();
    if (text && text.length > 0) {
      return text;
    }
  } catch {
    // Fall through to direct read fallback
  }

  return await LegacyFileSystem.readAsStringAsync(fileUri, {
    encoding: LegacyFileSystem.EncodingType.UTF8,
  });
}

/**
 * Extracts text & headings directly on-device from a Word (.docx) file using JSZip + XML parsing.
 */
export async function extractTextFromDocxUri(fileUri: string): Promise<string> {
  const base64 = await readFileUriAsBase64(fileUri);
  await yieldToMainThread();

  const zip = await JSZip.loadAsync(base64, { base64: true });
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) {
    throw new Error('Invalid .docx file: word/document.xml not found.');
  }

  let xmlContent = await docXmlFile.async('text');
  await yieldToMainThread();

  const bodyMatch = xmlContent.match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/i);
  if (bodyMatch) {
    xmlContent = bodyMatch[1];
  }
  xmlContent = xmlContent
    .replace(/<w:instrText[\s\S]*?<\/w:instrText>/gi, '')
    .replace(/<w:delText[\s\S]*?<\/w:delText>/gi, '')
    .replace(/<w:tab\s*\/>/gi, '<w:t>, </w:t>')
    .replace(/<w:br\s*[^>]*\/>/gi, '<w:t>\n</w:t>');

  const paragraphs = xmlContent.split(/<\/w:p>/);
  const extractedLines: string[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    if (i > 0 && i % 150 === 0) {
      await yieldToMainThread();
    }
    const p = paragraphs[i];
    const isHeading = /<w:pStyle\s+w:val="(?:Heading[1-6]|Title|Subtitle)"/i.test(p);
    if (/<w:pStyle\s+w:val="TOC\d*"/i.test(p)) {
      continue;
    }

    const textMatches = p.match(/<w:t(?:\s+[^>]*)?>([^<]*)<\/w:t>/g);
    if (!textMatches) continue;

    const rawLine = textMatches
      .map((t) => t.replace(/<[^>]+>/g, ''))
      .join('')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .trim();

    const cleanedLine = sanitizeTextForSpeech(rawLine);
    if (cleanedLine && /[a-zA-Z]{2,}/.test(cleanedLine)) {
      extractedLines.push(isHeading ? `## ${cleanedLine}` : cleanedLine);
    }
  }

  return extractedLines.join('\n\n');
}

interface PdfCMapTables {
  map2: Map<number, string>;
  map4: Map<number, string>;
}

function hexToUnicodeString(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  if (!clean) return '';
  let out = '';
  const step = clean.length >= 4 && clean.length % 4 === 0 ? 4 : 2;
  for (let i = 0; i < clean.length; i += step) {
    const code = parseInt(clean.slice(i, i + step), 16);
    if (!Number.isNaN(code) && code > 0) {
      out += String.fromCodePoint(code);
    }
  }
  return out;
}

/**
 * Parses PDF `/ToUnicode` CMap tables (`beginbfchar` & `beginbfrange`) so PDFs with custom
 * subset fonts or Identity-H hex glyph IDs decode into readable English text on-device.
 */
function parseToUnicodeCMapStream(content: string, cmap: PdfCMapTables): void {
  if (!content.includes('beginbfchar') && !content.includes('beginbfrange')) return;

  const bfCharRegex = /beginbfchar([\s\S]*?)endbfchar/g;
  let charBlock: RegExpExecArray | null;
  while ((charBlock = bfCharRegex.exec(content)) !== null) {
    const pairRegex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let pair: RegExpExecArray | null;
    while ((pair = pairRegex.exec(charBlock[1])) !== null) {
      const srcHex = pair[1];
      const dstStr = hexToUnicodeString(pair[2]);
      const code = parseInt(srcHex, 16);
      if (!Number.isNaN(code) && dstStr) {
        if (srcHex.length <= 2) {
          cmap.map2.set(code, dstStr);
        } else {
          cmap.map4.set(code, dstStr);
        }
      }
    }
  }

  const bfRangeRegex = /beginbfrange([\s\S]*?)endbfrange/g;
  let rangeBlock: RegExpExecArray | null;
  while ((rangeBlock = bfRangeRegex.exec(content)) !== null) {
    const entryRegex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]+)\])/g;
    let entry: RegExpExecArray | null;
    while ((entry = entryRegex.exec(rangeBlock[1])) !== null) {
      const startHex = entry[1];
      const startCode = parseInt(startHex, 16);
      const endCode = parseInt(entry[2], 16);
      if (Number.isNaN(startCode) || Number.isNaN(endCode) || endCode < startCode) continue;
      const count = Math.min(512, endCode - startCode + 1);
      const targetMap = startHex.length <= 2 ? cmap.map2 : cmap.map4;

      if (entry[3] !== undefined) {
        const baseUnicode = parseInt(entry[3], 16);
        if (!Number.isNaN(baseUnicode)) {
          for (let offset = 0; offset < count; offset++) {
            targetMap.set(startCode + offset, String.fromCodePoint(baseUnicode + offset));
          }
        }
      } else if (entry[4] !== undefined) {
        const arrHexes = entry[4].match(/<([0-9A-Fa-f]+)>/g) || [];
        for (let offset = 0; offset < Math.min(count, arrHexes.length); offset++) {
          const hexItem = arrHexes[offset].replace(/[<>]/g, '');
          const str = hexToUnicodeString(hexItem);
          if (str) {
            targetMap.set(startCode + offset, str);
          }
        }
      }
    }
  }
}

function decodePdfLiteralString(raw: string, cmap: PdfCMapTables): string {
  // Handle octal escapes first
  let decoded = raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\([0-7]{1,3})/g, (_m, oct) => String.fromCharCode(parseInt(oct, 8)));

  if (cmap.map2.size > 0 && !/[a-zA-Z]{3,}/.test(decoded)) {
    let mapped = '';
    for (let i = 0; i < decoded.length; i++) {
      const code = decoded.charCodeAt(i) & 0xff;
      mapped += cmap.map2.get(code) ?? decoded[i];
    }
    decoded = mapped;
  }

  return decoded.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ');
}

function decodePdfHexString(hexRaw: string, cmap: PdfCMapTables): string {
  const clean = hexRaw.replace(/\s+/g, '');
  if (!clean) return '';

  // UTF-16BE BOM
  if (clean.toUpperCase().startsWith('FEFF')) {
    return hexToUnicodeString(clean.slice(4));
  }

  // Try 2-byte (4 hex char) CMap lookup first if map4 is populated
  if (cmap.map4.size > 0 && clean.length % 4 === 0) {
    let out4 = '';
    let hits = 0;
    for (let i = 0; i < clean.length; i += 4) {
      const code = parseInt(clean.slice(i, i + 4), 16);
      const mapped = cmap.map4.get(code);
      if (mapped !== undefined) {
        out4 += mapped;
        hits++;
      } else if (code >= 32 && code <= 126) {
        out4 += String.fromCharCode(code);
      }
    }
    if (hits > 0) return out4;
  }

  // Try 1-byte (2 hex char) CMap lookup if map2 is populated
  if (cmap.map2.size > 0 && clean.length % 2 === 0) {
    let out2 = '';
    let hits = 0;
    for (let i = 0; i < clean.length; i += 2) {
      const code = parseInt(clean.slice(i, i + 2), 16);
      const mapped = cmap.map2.get(code);
      if (mapped !== undefined) {
        out2 += mapped;
        hits++;
      } else if (code >= 32 && code <= 126) {
        out2 += String.fromCharCode(code);
      }
    }
    if (hits > 0) return out2;
  }

  // Fallback: UTF-16BE (if high bytes are 00) or standard ASCII/Latin-1 hex
  const isUtf16Be = clean.length >= 4 && clean.length % 4 === 0 && /^(?:00[2-7][0-9A-Fa-f])+/.test(clean);
  const step = isUtf16Be ? 4 : 2;
  let fallback = '';
  for (let i = 0; i < clean.length; i += step) {
    const code = parseInt(clean.slice(i, i + step), 16);
    if (code >= 32 && code <= 126) {
      fallback += String.fromCharCode(code);
    } else if (code >= 160 && code <= 255) {
      fallback += String.fromCharCode(code);
    } else {
      fallback += ' ';
    }
  }
  return fallback;
}

/**
 * Fast conversion of a Uint8Array to a latin1 string using 8KB chunks.
 */
function uint8ArrayToStringFast(bytes: Uint8Array): string {
  const CHUNK_SIZE = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const sub = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    parts.push(String.fromCharCode.apply(null, sub as unknown as number[]));
  }
  return parts.join('');
}

/**
 * Decompresses a PDF stream block using `pako.inflate` or `pako.inflateRaw`, handling
 * leading/trailing CRLF padding around `stream ... endstream`.
 */
function tryInflatePdfStream(rawStream: string): string | null {
  if (!pako?.inflate) return null;

  const trimmed = rawStream.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  const bytes = new Uint8Array(trimmed.length);
  for (let i = 0; i < trimmed.length; i++) {
    bytes[i] = trimmed.charCodeAt(i) & 0xff;
  }

  try {
    const decompressed: Uint8Array = pako.inflate(bytes);
    if (decompressed && decompressed.length > 0 && decompressed.length < 2000000) {
      return uint8ArrayToStringFast(decompressed);
    }
  } catch {
    try {
      if (pako.inflateRaw && bytes.length > 2) {
        const decompressedRaw: Uint8Array = pako.inflateRaw(bytes.subarray(2));
        if (decompressedRaw && decompressedRaw.length > 0 && decompressedRaw.length < 2000000) {
          return uint8ArrayToStringFast(decompressedRaw);
        }
      }
    } catch {}
  }
  return null;
}

/**
 * Extracts text from inside PDF `BT ... ET` blocks, supporting both literal strings `(...)`
 * and hexadecimal/CID strings `<...>` mapped via `/ToUnicode` CMaps.
 */
function extractTextOperatorsFromPdfStream(
  content: string,
  cmap: PdfCMapTables,
  outChunks: string[]
): void {
  if (!content.includes('BT')) return;

  const btEtRegex = /\bBT\b([\s\S]*?)\bET\b/g;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = btEtRegex.exec(content)) !== null) {
    const btBlock = blockMatch[1];
    const tokenRegex =
      /\[([^\]]+)\]\s*TJ|\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*(?:Tj|'|")|<([0-9A-Fa-f\s]+)>\s*(?:Tj|'|")|\b(T\*|TD|Td)\b/g;
    let tok: RegExpExecArray | null;
    let lineBuffer = '';

    while ((tok = tokenRegex.exec(btBlock)) !== null) {
      if (tok[1] !== undefined) {
        const tjInner = tok[1];
        const partRegex =
          /\(([^()\\]*(?:\\.[^()\\]*)*)\)|<([0-9A-Fa-f\s]+)>|(-?\d+(?:\.\d+)?)/g;
        let part: RegExpExecArray | null;
        while ((part = partRegex.exec(tjInner)) !== null) {
          if (part[1] !== undefined) {
            lineBuffer += decodePdfLiteralString(part[1], cmap);
          } else if (part[2] !== undefined) {
            lineBuffer += decodePdfHexString(part[2], cmap);
          } else if (part[3] !== undefined) {
            const kern = parseFloat(part[3]);
            if (kern <= -80 && !lineBuffer.endsWith(' ')) {
              lineBuffer += ' ';
            }
          }
        }
      } else if (tok[2] !== undefined) {
        lineBuffer += decodePdfLiteralString(tok[2], cmap) + ' ';
      } else if (tok[3] !== undefined) {
        lineBuffer += decodePdfHexString(tok[3], cmap) + ' ';
      } else if (tok[4] !== undefined) {
        if (!lineBuffer.endsWith(' ')) {
          lineBuffer += ' ';
        }
      }
    }

    const cleaned = sanitizeTextForSpeech(lineBuffer);
    if (cleaned.length >= 2 && /[a-zA-Z]{2,}/.test(cleaned)) {
      outChunks.push(cleaned);
    }
  }
}

/**
 * Non-blocking on-device PDF text stream extractor with FlateDecode + ToUnicode CMap + Hex-String support.
 */
export async function extractTextFromPdfLocalFallback(fileUri: string): Promise<string> {
  const base64 = await readFileUriAsBase64(fileUri);
  await yieldToMainThread();

  const binary = globalThis.atob
    ? globalThis.atob(base64)
    : Buffer.from(base64, 'base64').toString('binary');
  await yieldToMainThread();

  const cmap: PdfCMapTables = {
    map2: new Map<number, string>(),
    map4: new Map<number, string>(),
  };
  const decodedContentStreams: string[] = [];

  const streamRegex = /stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let streamMatch: RegExpExecArray | null;
  let streamCount = 0;

  // Pass 1: Decompress non-image streams and collect ToUnicode CMap tables + text content streams
  while ((streamMatch = streamRegex.exec(binary)) !== null) {
    streamCount++;
    if (streamCount % 6 === 0) {
      await yieldToMainThread();
    }

    const rawStream = streamMatch[1];
    if (rawStream.length < 6 || rawStream.length > 1500000) {
      continue;
    }

    const dictHeaderStart = Math.max(0, streamMatch.index - 280);
    const dictHeader = binary.slice(dictHeaderStart, streamMatch.index);
    if (
      /\/Subtype\s*\/(?:Image|XML)|\/FontFile\d*|\/DCTDecode|\/JPXDecode|\/JBIG2Decode|\/CCITTFaxDecode|\/ICCBased|\/Metadata/i.test(
        dictHeader
      )
    ) {
      continue;
    }

    const inflated = tryInflatePdfStream(rawStream);
    const streamText = inflated || (rawStream.includes('BT') || rawStream.includes('beginbf') ? rawStream : null);
    if (!streamText) continue;

    if (streamText.includes('beginbfchar') || streamText.includes('beginbfrange')) {
      parseToUnicodeCMapStream(streamText, cmap);
    }
    if (streamText.includes('BT')) {
      decodedContentStreams.push(streamText);
    }

    if (decodedContentStreams.length >= 600) {
      break;
    }
  }

  // Pass 2: Extract text from all `BT ... ET` blocks using the collected ToUnicode CMap tables
  const chunks: string[] = [];
  for (let i = 0; i < decodedContentStreams.length; i++) {
    if (i > 0 && i % 8 === 0) {
      await yieldToMainThread();
    }
    extractTextOperatorsFromPdfStream(decodedContentStreams[i], cmap, chunks);
    if (chunks.length >= 2500) {
      break;
    }
  }

  if (chunks.length === 0) {
    await yieldToMainThread();
    extractTextOperatorsFromPdfStream(binary, cmap, chunks);
  }

  if (chunks.length > 0) {
    return chunks.join('\n\n');
  }

  throw new Error(
    'This PDF contains only scanned page images (no selectable text layer). Connect the FastAPI Backend in Settings for OCR, or upload a text-based PDF/DOCX.'
  );
}

/**
 * Parses an uploaded PDF, DOCX, or TXT file using the FastAPI backend (if reachable) or local non-blocking on-device parser.
 */
export async function parseDocumentToAlbum(
  fileUri: string,
  fileName: string,
  mimeType: string,
  ttsConfig: TTSConfig
): Promise<DocumentAlbum> {
  const cleanTitle =
    sanitizeTextForSpeech(fileName.replace(/\.(pdf|docx|doc|txt|md)$/i, '')) || 'Uploaded Document';
  const ext = fileName.toLowerCase().endsWith('.docx')
    ? 'docx'
    : fileName.toLowerCase().endsWith('.pdf') || mimeType.includes('pdf')
    ? 'pdf'
    : 'txt';

  let rawText = '';

  if (ttsConfig.backendUrl && !ttsConfig.backendUrl.includes('localhost')) {
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

  if (!rawText) {
    if (ext === 'docx') {
      rawText = await extractTextFromDocxUri(fileUri);
    } else if (ext === 'txt') {
      rawText = await readFileUriAsUtf8(fileUri);
    } else if (ext === 'pdf') {
      rawText = await extractTextFromPdfLocalFallback(fileUri);
    }
  }

  await yieldToMainThread();
  return await createAlbumFromRawTextAsync(
    cleanTitle,
    `Uploaded ${ext.toUpperCase()}`,
    ext,
    rawText,
    ttsConfig
  );
}

/**
 * Async non-blocking album builder for uploaded documents and large pasted articles.
 */
export async function createAlbumFromRawTextAsync(
  title: string,
  authorOrSource: string,
  fileType: 'pdf' | 'docx' | 'txt',
  rawText: string,
  ttsConfig: TTSConfig
): Promise<DocumentAlbum> {
  const cleanTitle = sanitizeTextForSpeech(title) || title;
  const chapters = await structureTextIntoChaptersAsync(cleanTitle, rawText, {
    stripCitations: ttsConfig.smartCleanCitations,
    stripHeadersFooters: ttsConfig.smartCleanHeadersFooters,
    generateSummaryTrack: ttsConfig.autoGenerateSummaryTrack,
  });

  const totalDurationSec = chapters.reduce((sum, c) => sum + c.estimatedDurationSec, 0);
  const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);

  return {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: cleanTitle,
    authorOrSource,
    fileType,
    createdAt: new Date().toISOString(),
    coverColors: pickCoverPalette(cleanTitle),
    totalDurationSec,
    totalWords,
    chapters,
    lastPlayedChapterIndex: 0,
    lastPlayedSegmentIndex: 0,
    isOfflineReady: true,
  };
}

/**
 * Synchronous album builder for lightweight initial sample documents.
 */
export function createAlbumFromRawText(
  title: string,
  authorOrSource: string,
  fileType: 'pdf' | 'docx' | 'txt',
  rawText: string,
  ttsConfig: TTSConfig
): DocumentAlbum {
  const cleanTitle = sanitizeTextForSpeech(title) || title;
  const chapters = structureTextIntoChapters(cleanTitle, rawText, {
    stripCitations: ttsConfig.smartCleanCitations,
    stripHeadersFooters: ttsConfig.smartCleanHeadersFooters,
    generateSummaryTrack: ttsConfig.autoGenerateSummaryTrack,
  });

  const totalDurationSec = chapters.reduce((sum, c) => sum + c.estimatedDurationSec, 0);
  const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);

  return {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: cleanTitle,
    authorOrSource,
    fileType,
    createdAt: new Date().toISOString(),
    coverColors: pickCoverPalette(cleanTitle),
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
      'Deep Focus: Future of Audio Reading',
      'Research Whitepaper • PDF',
      'pdf',
      sample1Text,
      ttsConfig
    ),
    createAlbumFromRawText(
      'Distributed Mobile Architecture',
      'Engineering Spec • DOCX',
      'docx',
      sample2Text,
      ttsConfig
    ),
  ];
}
