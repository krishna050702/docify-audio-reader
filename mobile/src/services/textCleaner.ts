import { ChapterTrack, LyricSegment, WordTiming } from '../types';

const WORDS_PER_SECOND = 2.65; // ~160 words per minute natural speaking rate at 1.0x

export interface CleaningOptions {
  stripCitations: boolean;
  stripHeadersFooters: boolean;
  generateSummaryTrack: boolean;
}

/**
 * Cleans raw PDF/DOCX text so it sounds natural when spoken aloud like an audiobook/podcast.
 */
export function cleanDocumentTextForAudio(
  rawText: string,
  options: CleaningOptions = {
    stripCitations: true,
    stripHeadersFooters: true,
    generateSummaryTrack: true,
  }
): string {
  let text = rawText.replace(/\r\n/g, '\n');

  // 1. Fix hyphenated words broken across line breaks (e.g., "architec-\nture" -> "architecture")
  text = text.replace(/([a-zA-Z])-\n\s*([a-z])/g, '$1$2');

  if (options.stripHeadersFooters) {
    // 2. Remove standalone page numbers ("Page 4 of 20", "- 12 -", standalone digits on a line)
    text = text.replace(/^\s*(?:page\s*)?\d+(?:\s*of\s*\d+)?\s*$/gim, '');
    text = text.replace(/^\s*[-–—]\s*\d+\s*[-–—]\s*$/gm, '');
    // Remove repeated copyright/confidentiality footers
    text = text.replace(/^\s*(?:confidential|all rights reserved|draft copy).*$/gim, '');
  }

  if (options.stripCitations) {
    // 3. Remove bracketed numeric citations like [1], [12, 15], [3-6]
    text = text.replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, '');
    // 4. Remove academic inline parenthetical citations like (Smith et al., 2023)
    text = text.replace(/\s*\([A-Z][a-zA-Z]+(?:\s+et\s+al\.)?,\s*\d{4}[a-z]?\)/g, '');
  }

  // 5. Replace raw long URLs with spoken placeholder "link" so TTS doesn't spell "h-t-t-p-s-colon-slash-slash..."
  text = text.replace(/https?:\/\/[^\s)]+/g, '(web link)');

  // 6. Normalize bullet symbols into natural pause punctuation
  text = text.replace(/^\s*[•●▪▸◦*-]\s+/gm, '• ');

  // 7. Merge single line wraps inside paragraphs while preserving double-newline paragraph breaks & headings
  const lines = text.split('\n');
  const mergedLines: string[] = [];
  let buffer = '';

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (buffer) {
        mergedLines.push(buffer);
        buffer = '';
      }
      mergedLines.push('');
      continue;
    }

    if (isLikelyHeading(trimmed)) {
      if (buffer) {
        mergedLines.push(buffer);
        buffer = '';
      }
      mergedLines.push(trimmed);
      mergedLines.push('');
      continue;
    }

    if (!buffer) {
      buffer = trimmed;
    } else if (/[.!?:;]$/.test(buffer) && /^[•]/.test(trimmed)) {
      mergedLines.push(buffer);
      buffer = trimmed;
    } else {
      buffer += ' ' + trimmed;
    }
  }
  if (buffer) mergedLines.push(buffer);

  return mergedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Detects whether a line is a Chapter / Section heading so we can split the document into Spotify Tracks.
 */
export function isLikelyHeading(line: string): boolean {
  const clean = line.trim();
  if (clean.length < 3 || clean.length > 90) return false;
  if (/[.,;]$/.test(clean)) return false;

  // Markdown headings
  if (/^#{1,3}\s+.+/.test(clean)) return true;

  // Explicit Chapter / Section / Part / Module / Appendix numbering
  if (/^(?:chapter|section|part|module|unit|appendix)\s+(?:\d+|[ivxlcdm]+|[a-z])\b/i.test(clean)) {
    return true;
  }

  // Numbered headings like "1. Introduction", "2.1 System Architecture"
  if (/^\d+(?:\.\d+)?\s+[A-Z][a-zA-Z0-9\s,&:-]{2,65}$/.test(clean)) {
    return true;
  }

  // Short ALL CAPS headings (at least 2 words)
  if (clean === clean.toUpperCase() && /[A-Z]{3,}/.test(clean) && clean.split(/\s+/).length <= 9) {
    return true;
  }

  return false;
}

/**
 * Tokenizes a sentence/paragraph into words with character offsets for Spotify-style live word highlighting.
 */
export function buildWordTimings(text: string, durationSec: number): WordTiming[] {
  const words: WordTiming[] = [];
  const regex = /\S+/g;
  let match: RegExpExecArray | null;
  const rawTokens: { word: string; start: number; end: number }[] = [];

  while ((match = regex.exec(text)) !== null) {
    rawTokens.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  const totalChars = Math.max(1, rawTokens.reduce((acc, t) => acc + t.word.length, 0));
  let cumulativeMs = 0;
  const totalMs = durationSec * 1000;

  for (const token of rawTokens) {
    const wordShareMs = (token.word.length / totalChars) * totalMs;
    words.push({
      word: token.word,
      startCharIndex: token.start,
      endCharIndex: token.end,
      startTimeMs: Math.round(cumulativeMs),
      endTimeMs: Math.round(cumulativeMs + wordShareMs),
    });
    cumulativeMs += wordShareMs;
  }

  return words;
}

/**
 * Splits a chapter's body into bite-sized LyricSegments (~1-2 sentences each) for synced lyric display and fast JIT audio streaming.
 */
export function splitIntoLyricSegments(chapterId: string, bodyText: string): LyricSegment[] {
  const rawParagraphs = bodyText
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const segments: LyricSegment[] = [];
  let currentOffsetSec = 0;
  let segIndex = 0;

  for (const para of rawParagraphs) {
    // Split long paragraphs into 1-2 sentence chunks (~220 chars max) for crisp Spotify lyric view
    const sentences = para.match(/[^.!?]+[.!?]+[\])'"`’”]*|.+$/g) || [para];
    let currentChunk = '';

    for (const sentence of sentences) {
      const s = sentence.trim();
      if (!s) continue;
      if ((currentChunk + ' ' + s).trim().length > 240 && currentChunk.length > 0) {
        const wordCount = currentChunk.split(/\s+/).length;
        const durationSec = Math.max(2, Math.round(wordCount / WORDS_PER_SECOND));
        segments.push({
          id: `${chapterId}-seg-${segIndex}`,
          index: segIndex,
          text: currentChunk,
          estimatedDurationSec: durationSec,
          startTimeOffsetSec: currentOffsetSec,
          words: buildWordTimings(currentChunk, durationSec),
        });
        currentOffsetSec += durationSec;
        segIndex++;
        currentChunk = s;
      } else {
        currentChunk = currentChunk ? `${currentChunk} ${s}` : s;
      }
    }

    if (currentChunk) {
      const wordCount = currentChunk.split(/\s+/).length;
      const durationSec = Math.max(2, Math.round(wordCount / WORDS_PER_SECOND));
      segments.push({
        id: `${chapterId}-seg-${segIndex}`,
        index: segIndex,
        text: currentChunk,
        estimatedDurationSec: durationSec,
        startTimeOffsetSec: currentOffsetSec,
        words: buildWordTimings(currentChunk, durationSec),
      });
      currentOffsetSec += durationSec;
      segIndex++;
    }
  }

  return segments;
}

/**
 * Generates "Track 0: Executive Summary (TL;DR)" by extracting key sentences across the document.
 */
export function buildExecutiveSummaryTrack(docTitle: string, chapters: ChapterTrack[]): ChapterTrack {
  const keySentences: string[] = [
    `Audio summary for ${docTitle}.`,
    `This document contains ${chapters.length} ${chapters.length === 1 ? 'section' : 'chapters'}.`,
  ];

  const maxHighlights = Math.min(5, chapters.length);
  for (let i = 0; i < maxHighlights; i++) {
    const ch = chapters[i];
    if (ch.segments.length > 0) {
      keySentences.push(`In ${ch.title}: ${ch.segments[0].text}`);
    }
  }

  const summaryBody = keySentences.join('\n\n');
  const segments = splitIntoLyricSegments('track-0-summary', summaryBody);
  const totalDuration = segments.reduce((sum, s) => sum + s.estimatedDurationSec, 0);
  const wordCount = summaryBody.split(/\s+/).length;

  return {
    id: 'track-0-summary',
    trackNumber: 0,
    title: '⚡ Executive Summary (TL;DR Preview)',
    isSummaryTrack: true,
    estimatedDurationSec: totalDuration,
    wordCount,
    segments,
  };
}

/**
 * Full pipeline: takes raw text and returns structured Spotify-like Chapters & Lyric Segments.
 */
export function structureTextIntoChapters(
  docTitle: string,
  rawText: string,
  options: CleaningOptions
): ChapterTrack[] {
  const cleaned = cleanDocumentTextForAudio(rawText, options);
  const lines = cleaned.split('\n');

  const rawChapters: { title: string; bodyLines: string[] }[] = [];
  let currentChapter: { title: string; bodyLines: string[] } = {
    title: 'Introduction',
    bodyLines: [],
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (isLikelyHeading(trimmed)) {
      const cleanHeading = trimmed.replace(/^#{1,3}\s+/, '');
      if (currentChapter.bodyLines.length > 0) {
        rawChapters.push(currentChapter);
      }
      currentChapter = {
        title: cleanHeading,
        bodyLines: [],
      };
    } else {
      currentChapter.bodyLines.push(trimmed);
    }
  }

  if (currentChapter.bodyLines.length > 0) {
    rawChapters.push(currentChapter);
  }

  // If a long document had no explicit headings, auto-split every ~450 words into digestible Tracks
  if (rawChapters.length === 1 && rawChapters[0].bodyLines.join(' ').split(/\s+/).length > 600) {
    const allParas = rawChapters[0].bodyLines;
    rawChapters.length = 0;
    let bucket: string[] = [];
    let bucketWords = 0;
    let partNum = 1;

    for (const p of allParas) {
      const w = p.split(/\s+/).length;
      if (bucketWords + w > 450 && bucket.length > 0) {
        rawChapters.push({
          title: `Part ${partNum}: ${bucket[0].slice(0, 38).trim()}...`,
          bodyLines: bucket,
        });
        partNum++;
        bucket = [p];
        bucketWords = w;
      } else {
        bucket.push(p);
        bucketWords += w;
      }
    }
    if (bucket.length > 0) {
      rawChapters.push({
        title: `Part ${partNum}: ${bucket[0].slice(0, 38).trim()}...`,
        bodyLines: bucket,
      });
    }
  }

  const structuredChapters: ChapterTrack[] = rawChapters.map((rc, idx) => {
    const chapterId = `chapter-${idx + 1}`;
    const bodyText = rc.bodyLines.join('\n\n');
    const segments = splitIntoLyricSegments(chapterId, bodyText);
    const duration = segments.reduce((sum, s) => sum + s.estimatedDurationSec, 0);
    const words = bodyText.split(/\s+/).filter(Boolean).length;

    return {
      id: chapterId,
      trackNumber: idx + 1,
      title: rc.title,
      estimatedDurationSec: duration,
      wordCount: words,
      segments,
    };
  });

  if (options.generateSummaryTrack && structuredChapters.length > 0) {
    const summaryTrack = buildExecutiveSummaryTrack(docTitle, structuredChapters);
    return [summaryTrack, ...structuredChapters];
  }

  return structuredChapters;
}
