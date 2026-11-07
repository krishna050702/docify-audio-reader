import { ChapterTrack, LyricSegment, WordTiming } from '../types';

const WORDS_PER_SECOND = 2.6; // ~156 words per minute natural audiobook speaking rate at 1.0x
const MAX_CHAPTER_WORDS = 550; // Keep chapters bite-sized so UI & TTS stay instant on huge PDFs

export interface CleaningOptions {
  stripCitations: boolean;
  stripHeadersFooters: boolean;
  generateSummaryTrack: boolean;
}

/**
 * Yields back to the React Native JS event loop so animations and touch events stay 60fps
 * while parsing or cleaning large PDFs.
 */
export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Sanitizes any sentence or paragraph right before it is spoken by the TTS engine
 * so that underscores, bullets, markdown tokens, slashes, and formatting noise are NEVER read aloud.
 */
export function sanitizeTextForSpeech(input: string): string {
  if (!input) return '';
  let s = input;

  // 1. Remove emojis and decorative symbols that TTS reads as "high voltage sign", "black circle", etc.
  s = s.replace(/[⚡•●▪▸◦‣⁃◆◇■□★☆✓✔✗✘→⇒➔➤►◄▲▼♦♥♠♣]/g, ' ');

  // 2. Remove repeated underscores, dashes, equals, asterisks, tildes, dots (form lines, dividers, TOC leaders)
  s = s.replace(/_{2,}/g, ' ');
  s = s.replace(/[-–—=~*#]{2,}/g, ' ');
  s = s.replace(/(?:\.\s*){4,}/g, '. ');

  // 3. Replace single underscores between words/numbers with a natural space (e.g. "audio_reader_v2" -> "audio reader v2")
  s = s.replace(/_/g, ' ');

  // 4. Replace table pipes and box-drawing characters with a brief pause
  s = s.replace(/[|¦│┃─━┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬]/g, ', ');

  // 5. Expand common abbreviations into natural spoken words
  s = s.replace(/\be\.g\.,?\b/gi, 'for example,');
  s = s.replace(/\bi\.e\.,?\b/gi, 'that is,');
  s = s.replace(/\bvs\.?\b/gi, 'versus');
  s = s.replace(/\betc\.(?=\s|$)/gi, 'et cetera');
  s = s.replace(/\bw\/o\b/gi, 'without');
  s = s.replace(/\bw\/\b/gi, 'with');
  s = s.replace(/\bFig(?:s)?\.\s*(\d+)/gi, 'Figure $1');
  s = s.replace(/\bSec\.\s*(\d+)/gi, 'Section $1');
  s = s.replace(/\bEq\.\s*(\d+)/gi, 'Equation $1');
  s = s.replace(/\bTL;DR\b/gi, 'Summary');

  // 6. Convert slashes between words so TTS doesn't say "slash" (e.g., "and/or" -> "and or", "PDF/DOCX" -> "PDF or DOCX")
  s = s.replace(/\band\/or\b/gi, 'and or');
  s = s.replace(/([a-zA-Z]{2,})\/([a-zA-Z]{2,})/g, '$1 or $2');
  s = s.replace(/[\\/]+/g, ' ');

  // 7. Replace '&' with 'and'
  s = s.replace(/\s*&\s*/g, ' and ');

  // 8. Strip stray brackets, braces, angle brackets, backticks, carets, hashes, asterisks
  s = s.replace(/[`^~#*<>{}\[\]]/g, ' ');

  // 9. Collapse multiple commas/spaces/periods into clean punctuation
  s = s.replace(/,\s*,+/g, ', ');
  s = s.replace(/\s+([,.;:!?])/g, '$1');
  s = s.replace(/\s{2,}/g, ' ');

  return s.trim();
}

/**
 * Fast, linear-time single-line cleaner that avoids catastrophic regex backtracking on huge PDFs.
 */
function cleanSingleLine(line: string, options: CleaningOptions): string {
  let s = line.trim();
  if (!s) return '';

  // Skip Word TOC/field lines or TOC dot leaders ("1.2 Intro ....... 14") in O(N) without regex backtracking
  if (/\b(?:PAGEREF|HYPERLINK|MERGEFORMAT|_Toc\d+)\b/i.test(s)) return '';
  if ((s.includes('....') || s.includes('. . .') || s.includes('___')) && /\d+\s*$/.test(s)) {
    return '';
  }

  // Skip horizontal divider lines
  if (/^[_=~*#\-–—|+.\s]{3,}$/.test(s)) return '';

  if (options.stripHeadersFooters) {
    if (/^(?:page|p\.|pg\.?)?\s*\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(s)) return '';
    if (/^[-–—|]\s*\d+\s*[-–—|]$/.test(s)) return '';
    if (
      /^(?:confidential|all rights reserved|draft copy|copyright\s*©?|©\s*\d{4}|issn\b|isbn\b|doi\s*:|downloaded from|authorized licensed use)/i.test(
        s
      )
    ) {
      return '';
    }
  }

  if (options.stripCitations) {
    // Bounded non-backtracking bracketed numeric citations: [1], [12, 15], [3-6]
    s = s.replace(/\[\s*\d{1,4}(?:\s*[,;–—-]\s*\d{1,4}){0,10}\s*\]/g, ' ');
    // Bounded non-backtracking parenthetical year citations: (Smith et al., 2023)
    s = s.replace(/\([A-Z][^\n()]{1,65}\b(?:19|20)\d{2}[a-z]?\)/g, ' ');
    s = s.replace(/\(\s*pp?\.\s*\d{1,4}(?:[-–]\d{1,4})?\s*\)/gi, ' ');
  }

  // Strip URLs, emails, and Windows paths
  if (s.includes('http') || s.includes('www.') || s.includes('@') || s.includes(':\\')) {
    s = s.replace(/https?:\/\/\S+/gi, ' ');
    s = s.replace(/\bwww\.\S+/gi, ' ');
    s = s.replace(/\b\S+@\S+\.\S+\b/g, ' ');
    s = s.replace(/\b[A-Za-z]:\\\S+/g, ' ');
  }

  // Strip leading bullet symbols and markdown tokens
  s = s.replace(/^[•●▪▸◦‣⁃◆◇■□★☆✓✔*-]\s+/, '');
  s = s.replace(/^>\s+/, '');

  return s.trim();
}

/**
 * Cleans raw PDF/DOCX text so it sounds natural when spoken aloud like an audiobook/podcast,
 * stripping underscores, headers, footers, TOC dot leaders, citations, URLs, and symbol noise.
 */
export function cleanDocumentTextForAudio(
  rawText: string,
  options: CleaningOptions = {
    stripCitations: true,
    stripHeadersFooters: true,
    generateSummaryTrack: true,
  }
): string {
  // Fix hyphenated words broken across line breaks
  const normalized = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/([a-zA-Z])-\n[ \t]*([a-z])/g, '$1$2');

  const lines = normalized.split('\n');
  const mergedLines: string[] = [];
  let buffer = '';

  for (let i = 0; i < lines.length; i++) {
    const cleanedLine = cleanSingleLine(lines[i], options);
    if (!cleanedLine) {
      if (buffer) {
        mergedLines.push(sanitizeTextForSpeech(buffer));
        buffer = '';
      }
      continue;
    }

    if (!/[a-zA-Z]{2,}/.test(cleanedLine)) {
      continue;
    }

    if (isLikelyHeading(cleanedLine)) {
      if (buffer) {
        mergedLines.push(sanitizeTextForSpeech(buffer));
        buffer = '';
      }
      const cleanHeading = sanitizeTextForSpeech(cleanedLine.replace(/^#{1,6}\s+/, ''));
      if (cleanHeading) {
        mergedLines.push(`## ${cleanHeading}`);
      }
      continue;
    }

    const plainLine = cleanedLine.replace(/^#{1,6}\s+/, '');
    if (!buffer) {
      buffer = plainLine;
    } else if (buffer.length + plainLine.length > 420) {
      // Flush paragraph buffer periodically so huge unpunctuated PDF blocks don't create giant strings
      mergedLines.push(sanitizeTextForSpeech(buffer));
      buffer = plainLine;
    } else {
      buffer += ' ' + plainLine;
    }
  }

  if (buffer) {
    mergedLines.push(sanitizeTextForSpeech(buffer));
  }

  return mergedLines.join('\n\n').trim();
}

/**
 * Detects whether a line is a Chapter / Section heading so we can split the document into Spotify Tracks.
 */
export function isLikelyHeading(line: string): boolean {
  const clean = line.trim();
  if (clean.length < 3 || clean.length > 120) return false;

  if (/^#{1,6}\s+.+/.test(clean)) return true;

  if (clean.length > 85) return false;
  if (/[.,;]$/.test(clean)) return false;

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
 * Lazily retrieves (and caches) word timing tokens for a single segment.
 * Avoids allocating 100,000+ WordTiming objects upfront when loading a large PDF.
 */
export function getSegmentWords(segment: LyricSegment): WordTiming[] {
  if (!segment.words || segment.words.length === 0) {
    segment.words = buildWordTimings(segment.text, segment.estimatedDurationSec || 3);
  }
  return segment.words;
}

/**
 * Splits a chapter's body into bite-sized LyricSegments (~1-2 sentences each) for synced lyric display and fast JIT audio streaming.
 * Note: `words` is initialized to `[]` and populated lazily via `getSegmentWords` when a segment is played/active.
 */
export function splitIntoLyricSegments(chapterId: string, bodyText: string): LyricSegment[] {
  const rawParagraphs = bodyText
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 1 && /[a-zA-Z]{2,}/.test(p));

  const segments: LyricSegment[] = [];
  let currentOffsetSec = 0;
  let segIndex = 0;

  for (const para of rawParagraphs) {
    const sentences = para.match(/[^.!?]+[.!?]+[\])'"`’”]*|.+$/g) || [para];
    let currentChunk = '';

    for (const sentence of sentences) {
      const s = sentence.trim();
      if (!s || !/[a-zA-Z]{2,}/.test(s)) continue;
      if ((currentChunk + ' ' + s).trim().length > 220 && currentChunk.length > 0) {
        const wordCount = currentChunk.split(/\s+/).length;
        const durationSec = Math.max(2, Math.round(wordCount / WORDS_PER_SECOND));
        segments.push({
          id: `${chapterId}-seg-${segIndex}`,
          index: segIndex,
          text: currentChunk,
          estimatedDurationSec: durationSec,
          startTimeOffsetSec: currentOffsetSec,
          words: [],
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
        words: [],
      });
      currentOffsetSec += durationSec;
      segIndex++;
    }
  }

  return segments;
}

/**
 * Generates "Track 0: Executive Summary" by extracting key sentences across the document.
 */
export function buildExecutiveSummaryTrack(docTitle: string, chapters: ChapterTrack[]): ChapterTrack {
  const cleanTitle = sanitizeTextForSpeech(docTitle);
  const keySentences: string[] = [
    `Audio summary for ${cleanTitle}. This document has ${chapters.length} ${
      chapters.length === 1 ? 'section' : 'chapters'
    }.`,
  ];

  const maxHighlights = Math.min(5, chapters.length);
  for (let i = 0; i < maxHighlights; i++) {
    const ch = chapters[i];
    if (ch.segments.length > 0) {
      const cleanChapTitle = sanitizeTextForSpeech(ch.title);
      keySentences.push(`${cleanChapTitle}. ${ch.segments[0].text}`);
    }
  }

  const summaryBody = keySentences.join('\n\n');
  const segments = splitIntoLyricSegments('track-0-summary', summaryBody);
  const totalDuration = segments.reduce((sum, s) => sum + s.estimatedDurationSec, 0);
  const wordCount = summaryBody.split(/\s+/).length;

  return {
    id: 'track-0-summary',
    trackNumber: 0,
    title: 'Executive Summary (Quick Overview)',
    isSummaryTrack: true,
    estimatedDurationSec: totalDuration,
    wordCount,
    segments,
  };
}

/**
 * Splits any oversized raw chapters (> MAX_CHAPTER_WORDS) into digestible sub-chapters
 * so individual chapters never contain hundreds of segments that bog down scrolling.
 */
function splitOversizedChapters(
  rawChapters: { title: string; bodyLines: string[] }[]
): { title: string; bodyLines: string[] }[] {
  const result: { title: string; bodyLines: string[] }[] = [];

  for (const ch of rawChapters) {
    let bucket: string[] = [];
    let bucketWords = 0;
    let partIdx = 1;
    const totalWords = ch.bodyLines.reduce((acc, l) => acc + l.split(/\s+/).length, 0);
    const needsSplit = totalWords > MAX_CHAPTER_WORDS * 1.3;

    if (!needsSplit) {
      result.push(ch);
      continue;
    }

    for (const line of ch.bodyLines) {
      const w = line.split(/\s+/).length;
      if (bucketWords + w > MAX_CHAPTER_WORDS && bucket.length > 0) {
        result.push({
          title: `${ch.title} (Part ${partIdx})`,
          bodyLines: bucket,
        });
        partIdx++;
        bucket = [line];
        bucketWords = w;
      } else {
        bucket.push(line);
        bucketWords += w;
      }
    }

    if (bucket.length > 0) {
      result.push({
        title: partIdx > 1 ? `${ch.title} (Part ${partIdx})` : ch.title,
        bodyLines: bucket,
      });
    }
  }

  return result;
}

/**
 * Synchronous chapter builder for small sample documents on startup.
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
      const cleanHeading = sanitizeTextForSpeech(trimmed.replace(/^#{1,6}\s+/, ''));
      if (currentChapter.bodyLines.length > 0) {
        rawChapters.push(currentChapter);
      }
      currentChapter = {
        title: cleanHeading || 'Section',
        bodyLines: [],
      };
    } else {
      currentChapter.bodyLines.push(trimmed);
    }
  }

  if (currentChapter.bodyLines.length > 0) {
    rawChapters.push(currentChapter);
  }

  const balancedChapters = splitOversizedChapters(rawChapters);

  const structuredChapters: ChapterTrack[] = balancedChapters
    .map((rc, idx) => {
      const chapterId = `chapter-${idx + 1}`;
      const bodyText = rc.bodyLines.join('\n\n');
      const segments = splitIntoLyricSegments(chapterId, bodyText);
      const duration = segments.reduce((sum, s) => sum + s.estimatedDurationSec, 0);
      const words = segments.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);

      return {
        id: chapterId,
        trackNumber: idx + 1,
        title: rc.title,
        estimatedDurationSec: duration,
        wordCount: words,
        segments,
      };
    })
    .filter((ch) => ch.segments.length > 0);

  if (options.generateSummaryTrack && structuredChapters.length > 0) {
    const summaryTrack = buildExecutiveSummaryTrack(docTitle, structuredChapters);
    return [summaryTrack, ...structuredChapters];
  }

  return structuredChapters;
}

/**
 * Non-blocking async pipeline for large uploaded PDFs/DOCX files.
 * Yields to the UI thread every 250 lines and every 4 chapters so the app never freezes.
 */
export async function structureTextIntoChaptersAsync(
  docTitle: string,
  rawText: string,
  options: CleaningOptions
): Promise<ChapterTrack[]> {
  const normalized = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/([a-zA-Z])-\n[ \t]*([a-z])/g, '$1$2');

  const lines = normalized.split('\n');
  const mergedLines: string[] = [];
  let buffer = '';

  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && i % 250 === 0) {
      await yieldToMainThread();
    }

    const cleanedLine = cleanSingleLine(lines[i], options);
    if (!cleanedLine) {
      if (buffer) {
        mergedLines.push(sanitizeTextForSpeech(buffer));
        buffer = '';
      }
      continue;
    }

    if (!/[a-zA-Z]{2,}/.test(cleanedLine)) continue;

    if (isLikelyHeading(cleanedLine)) {
      if (buffer) {
        mergedLines.push(sanitizeTextForSpeech(buffer));
        buffer = '';
      }
      const cleanHeading = sanitizeTextForSpeech(cleanedLine.replace(/^#{1,6}\s+/, ''));
      if (cleanHeading) {
        mergedLines.push(`## ${cleanHeading}`);
      }
      continue;
    }

    const plainLine = cleanedLine.replace(/^#{1,6}\s+/, '');
    if (!buffer) {
      buffer = plainLine;
    } else if (buffer.length + plainLine.length > 420) {
      mergedLines.push(sanitizeTextForSpeech(buffer));
      buffer = plainLine;
    } else {
      buffer += ' ' + plainLine;
    }
  }

  if (buffer) {
    mergedLines.push(sanitizeTextForSpeech(buffer));
  }

  await yieldToMainThread();

  const rawChapters: { title: string; bodyLines: string[] }[] = [];
  let currentChapter: { title: string; bodyLines: string[] } = {
    title: 'Introduction',
    bodyLines: [],
  };

  for (const line of mergedLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (isLikelyHeading(trimmed)) {
      const cleanHeading = sanitizeTextForSpeech(trimmed.replace(/^#{1,6}\s+/, ''));
      if (currentChapter.bodyLines.length > 0) {
        rawChapters.push(currentChapter);
      }
      currentChapter = {
        title: cleanHeading || 'Section',
        bodyLines: [],
      };
    } else {
      currentChapter.bodyLines.push(trimmed);
    }
  }

  if (currentChapter.bodyLines.length > 0) {
    rawChapters.push(currentChapter);
  }

  const balancedChapters = splitOversizedChapters(rawChapters);
  const structuredChapters: ChapterTrack[] = [];

  for (let idx = 0; idx < balancedChapters.length; idx++) {
    if (idx > 0 && idx % 4 === 0) {
      await yieldToMainThread();
    }
    const rc = balancedChapters[idx];
    const chapterId = `chapter-${idx + 1}`;
    const bodyText = rc.bodyLines.join('\n\n');
    const segments = splitIntoLyricSegments(chapterId, bodyText);
    if (segments.length === 0) continue;

    const duration = segments.reduce((sum, s) => sum + s.estimatedDurationSec, 0);
    const words = segments.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);

    structuredChapters.push({
      id: chapterId,
      trackNumber: structuredChapters.length + 1,
      title: rc.title,
      estimatedDurationSec: duration,
      wordCount: words,
      segments,
    });
  }

  if (options.generateSummaryTrack && structuredChapters.length > 0) {
    const summaryTrack = buildExecutiveSummaryTrack(docTitle, structuredChapters);
    return [summaryTrack, ...structuredChapters];
  }

  return structuredChapters;
}
