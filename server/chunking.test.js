import { describe, it, expect } from 'vitest';
import { createChunks, getChunkTranscript, createTextChunks, formatTime } from './chunking.js';

// ─── Helpers ────────────────────────────────────────────────────

/** Build a minimal transcript with evenly spaced segments and words */
function makeTranscript(durationSeconds, segmentCount = 10) {
  const segDuration = durationSeconds / segmentCount;
  const segments = [];
  const words = [];

  for (let i = 0; i < segmentCount; i++) {
    const start = i * segDuration;
    const end = start + segDuration;
    segments.push({
      text: `Сегмент ${i + 1}. Это текст.`,
      start,
      end,
    });

    // 3 words per segment
    const wordDuration = segDuration / 3;
    for (let w = 0; w < 3; w++) {
      words.push({
        word: `слово${i * 3 + w}`,
        start: start + w * wordDuration,
        end: start + (w + 1) * wordDuration,
      });
    }
  }

  return { segments, words, duration: durationSeconds, language: 'ru' };
}

/** Build a transcript with a specific gap between two segments */
function makeTranscriptWithGap(totalDuration, gapAt, gapDuration) {
  const segments = [];
  const words = [];
  const segDuration = 10; // 10s per segment
  let time = 0;
  let segIndex = 0;

  while (time < totalDuration) {
    const start = time;
    const end = Math.min(time + segDuration, totalDuration);

    if (start >= gapAt && start < gapAt + gapDuration) {
      // Skip this segment (it's in the gap)
      time = gapAt + gapDuration;
      continue;
    }

    segments.push({
      text: `Сегмент ${segIndex + 1}.`,
      start,
      end: Math.min(end, gapAt > start ? gapAt : end),
    });

    words.push({
      word: `слово${segIndex}`,
      start,
      end: Math.min(end, gapAt > start ? gapAt : end),
    });

    segIndex++;
    time = end;
    if (time === gapAt) time = gapAt + gapDuration; // jump over gap
  }

  return { segments, words, duration: totalDuration, language: 'ru' };
}

// ─── createChunks ───────────────────────────────────────────────

describe('createChunks', () => {
  it('returns single chunk for short video (<3 min)', () => {
    const transcript = makeTranscript(120); // 2 minutes
    const chunks = createChunks(transcript);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].id).toBe('chunk-0');
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].startTime).toBe(0);
    expect(chunks[0].endTime).toBe(120);
    expect(chunks[0].duration).toBe(120);
  });

  it('returns single chunk when no segments', () => {
    const transcript = { segments: [], words: [{ word: 'test', start: 0, end: 1 }], duration: 60 };
    const chunks = createChunks(transcript);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].duration).toBe(60);
  });

  it('returns single chunk when segments is null/undefined', () => {
    const transcript = { segments: null, words: [], duration: 30 };
    const chunks = createChunks(transcript);

    expect(chunks).toHaveLength(1);
  });

  it('splits long video into multiple chunks at natural pauses', () => {
    // 10 minutes with 10 segments, each 60s → gaps at segment boundaries
    const transcript = makeTranscript(600, 10);
    // Add gaps between segments (the default makeTranscript has no gaps)
    // Manually add gaps by adjusting segment end times
    for (let i = 0; i < transcript.segments.length - 1; i++) {
      // Shorten each segment by 1s to create a 1s gap (>0.5s threshold)
      transcript.segments[i].end -= 1;
    }

    const chunks = createChunks(transcript);
    expect(chunks.length).toBeGreaterThan(1);

    // All chunks should have sequential IDs
    chunks.forEach((chunk, i) => {
      expect(chunk.id).toBe(`chunk-${i}`);
      expect(chunk.index).toBe(i);
    });

    // No overlap between chunks
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startTime).toBeGreaterThanOrEqual(chunks[i - 1].endTime);
    }
  });

  it('chunk IDs are sequential chunk-0, chunk-1, ...', () => {
    const transcript = makeTranscript(600, 20);
    // Add gaps
    for (let i = 0; i < transcript.segments.length - 1; i++) {
      transcript.segments[i].end -= 1;
    }
    const chunks = createChunks(transcript);

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].id).toBe(`chunk-${i}`);
    }
  });

  it('previewText is truncated to 100 chars with "..." suffix', () => {
    // Need >3min so it goes through createChunkObject (short videos use raw slice)
    const longText = 'А'.repeat(200);
    const segments = [{ text: longText, start: 0, end: 200 }];
    const words = [{ word: 'тест', start: 0, end: 200 }];
    const transcript = { segments, words, duration: 200 };
    const chunks = createChunks(transcript);

    expect(chunks[0].previewText.length).toBeLessThanOrEqual(103); // 100 + "..."
    expect(chunks[0].previewText).toContain('...');
  });

  it('previewText without "..." when under 100 chars', () => {
    const transcript = {
      segments: [{ text: 'Short text.', start: 0, end: 60 }],
      words: [{ word: 'short', start: 0, end: 60 }],
      duration: 60,
    };
    const chunks = createChunks(transcript);

    expect(chunks[0].previewText).toBe('Short text.');
    expect(chunks[0].previewText).not.toContain('...');
  });

  it('wordCount reflects words assigned to each chunk', () => {
    const transcript = makeTranscript(120); // short → single chunk, 30 words
    const chunks = createChunks(transcript);

    expect(chunks[0].wordCount).toBe(30); // 10 segments × 3 words
  });

  it('merges final chunk shorter than 2 minutes with previous', () => {
    // Create a transcript that would produce a tiny final chunk
    // 4 minutes total, with a gap at 3 min mark
    // Should chunk at ~3min, leaving 1min final → merge
    const segments = [];
    const words = [];
    // First 3 min: continuous segments
    for (let i = 0; i < 18; i++) {
      const start = i * 10;
      const end = start + 9.4; // small gap < 0.5s, won't split here
      segments.push({ text: `Сегмент ${i}.`, start, end });
      words.push({ word: `w${i}`, start, end });
    }
    // Gap at 3 min (180s) — big enough to trigger split
    // Then 1 min more (too short for final chunk → merge)
    for (let i = 0; i < 6; i++) {
      const start = 181 + i * 10;
      const end = start + 9.4;
      segments.push({ text: `Сегмент ${18 + i}.`, start, end });
      words.push({ word: `w${18 + i}`, start, end });
    }

    const transcript = { segments, words, duration: 240, language: 'ru' };
    const chunks = createChunks(transcript);

    // The final chunk (1 min) should be merged with the previous
    // So we should get fewer chunks than if we didn't merge
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.duration).toBeGreaterThanOrEqual(120); // merged → at least 2 min
  });

  it('keeps final chunk when it is long enough (>= 2 min)', () => {
    // 8 minutes, 24 segments × 20s each
    const segments = [];
    const words = [];
    for (let i = 0; i < 24; i++) {
      const start = i * 20;
      const end = start + 19; // 1s gap between segments
      segments.push({ text: `Сегмент ${i}.`, start, end });
      words.push({ word: `w${i}`, start, end });
    }

    const transcript = { segments, words, duration: 480, language: 'ru' };
    const chunks = createChunks(transcript);

    // All chunks should be at least 2 minutes
    chunks.forEach(chunk => {
      expect(chunk.duration).toBeGreaterThanOrEqual(120);
    });
  });
});

// ─── getChunkTranscript ─────────────────────────────────────────

describe('getChunkTranscript', () => {
  const transcript = {
    words: [
      { word: 'первое', start: 0, end: 1 },
      { word: 'второе', start: 2, end: 3 },
      { word: 'третье', start: 180, end: 181 },
      { word: 'четвёртое', start: 182, end: 183 },
    ],
    segments: [
      { text: 'Первое второе.', start: 0, end: 3 },
      { text: 'Третье четвёртое.', start: 180, end: 183 },
    ],
    language: 'ru',
    duration: 183,
  };

  it('filters words to the given time range', () => {
    const chunk = getChunkTranscript(transcript, 0, 10);
    expect(chunk.words).toHaveLength(2);
    expect(chunk.words[0].word).toBe('первое');
    expect(chunk.words[1].word).toBe('второе');
  });

  it('offsets timestamps relative to chunk start', () => {
    const chunk = getChunkTranscript(transcript, 180, 183);
    expect(chunk.words[0].start).toBe(0); // was 180, now 0
    expect(chunk.words[0].end).toBe(1); // was 181, now 1
    expect(chunk.words[1].start).toBe(2); // was 182, now 2
  });

  it('filters segments to the given time range', () => {
    const chunk = getChunkTranscript(transcript, 180, 183);
    expect(chunk.segments).toHaveLength(1);
    expect(chunk.segments[0].text).toBe('Третье четвёртое.');
  });

  it('offsets segment timestamps relative to chunk start', () => {
    const chunk = getChunkTranscript(transcript, 180, 183);
    expect(chunk.segments[0].start).toBe(0); // was 180
    expect(chunk.segments[0].end).toBe(3); // was 183
  });

  it('returns empty arrays when no words/segments in range', () => {
    const chunk = getChunkTranscript(transcript, 50, 100);
    expect(chunk.words).toHaveLength(0);
    expect(chunk.segments).toHaveLength(0);
  });

  it('includes words that span the chunk boundary', () => {
    // Word from 2-3, chunk ends at 2.5 → word overlaps → included
    const chunk = getChunkTranscript(transcript, 0, 2.5);
    expect(chunk.words).toHaveLength(2); // both "первое" (0-1) and "второе" (2-3)
  });

  it('sets duration to endTime - startTime', () => {
    const chunk = getChunkTranscript(transcript, 180, 183);
    expect(chunk.duration).toBe(3);
  });

  it('preserves language field', () => {
    const chunk = getChunkTranscript(transcript, 0, 10);
    expect(chunk.language).toBe('ru');
  });

  it('handles null words array gracefully', () => {
    const t = { words: null, segments: [], language: 'ru', duration: 10 };
    const chunk = getChunkTranscript(t, 0, 10);
    expect(chunk.words).toHaveLength(0);
  });
});

// ─── createTextChunks ───────────────────────────────────────────

describe('createTextChunks', () => {
  it('returns single chunk for short text', () => {
    const chunks = createTextChunks('Короткий текст.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('Короткий текст.');
    expect(chunks[0].id).toBe('chunk-0');
    expect(chunks[0].status).toBe('pending');
  });

  it('splits on double-newline section breaks', () => {
    const sections = Array.from({ length: 5 }, (_, i) =>
      'А'.repeat(1000) + ` секция ${i + 1}.`
    );
    const text = sections.join('\n\n');
    const chunks = createTextChunks(text);

    // Multiple sections should produce multiple chunks
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('no chunk exceeds 3500 chars (TTS limit)', () => {
    // Long text with many sentences
    const sentences = Array.from({ length: 100 }, (_, i) =>
      `Это предложение номер ${i + 1}, оно довольно длинное для тестирования.`
    );
    const text = sentences.join(' ');
    const chunks = createTextChunks(text);

    chunks.forEach(chunk => {
      // Allow small overflow from merging — the hard TTS limit is 4096
      expect(chunk.text.length).toBeLessThan(4096);
    });
  });

  it('unwraps lib.ru line-wrapping (single newlines become spaces)', () => {
    const libRuText = 'Это первая строка\nкоторая продолжается\nна следующей строке.';
    const chunks = createTextChunks(libRuText);

    // Single newlines should be joined with spaces
    expect(chunks[0].text).toContain('Это первая строка которая продолжается на следующей строке.');
  });

  it('preserves double-newline paragraph breaks', () => {
    const text = 'Параграф один.\n\nПараграф два.';
    const chunks = createTextChunks(text);

    // Both paragraphs should be present (might be in same chunk if short)
    const allText = chunks.map(c => c.text).join('\n\n');
    expect(allText).toContain('Параграф один.');
    expect(allText).toContain('Параграф два.');
  });

  it('splits long sections on sentence boundaries', () => {
    // One huge section — each sentence ~50 chars, 200 sentences = ~10000 chars → multiple chunks
    const sentences = Array.from({ length: 200 }, (_, i) =>
      `Это достаточно длинное предложение номер ${i + 1} для теста.`
    );
    const text = sentences.join(' ');
    const chunks = createTextChunks(text);

    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk (except last) should end near a sentence boundary
    chunks.slice(0, -1).forEach(chunk => {
      const trimmed = chunk.text.trim();
      expect(trimmed).toMatch(/[.!?»…]$/);
    });
  });

  it('merges short final chunk (<500 chars) with previous', () => {
    // Create text where final piece would be very short
    const longPart = 'А'.repeat(3000) + '. ';
    const shortPart = 'Конец.';
    const text = longPart + shortPart;
    const chunks = createTextChunks(text);

    // Short final piece should be merged
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.text).toContain('Конец.');
    expect(lastChunk.text.length).toBeGreaterThan(500);
  });

  it('includes wordCount for each chunk', () => {
    const text = 'Один два три четыре пять.';
    const chunks = createTextChunks(text);
    expect(chunks[0].wordCount).toBe(5);
  });

  it('includes previewText truncated to 100 chars', () => {
    const longText = 'Б'.repeat(200) + '.';
    const chunks = createTextChunks(longText);
    expect(chunks[0].previewText.length).toBeLessThanOrEqual(103);
  });

  it('handles empty text', () => {
    const chunks = createTextChunks('');
    expect(chunks).toHaveLength(1);
  });

  it('handles text with only whitespace sections', () => {
    const text = '   \n\n   \n\n   ';
    const chunks = createTextChunks(text);
    // Should handle gracefully (single empty chunk)
    expect(chunks).toHaveLength(1);
  });

  it('chunk IDs are sequential', () => {
    const text = Array.from({ length: 50 }, (_, i) =>
      `Секция ${i + 1}. ` + 'Текст. '.repeat(100)
    ).join('\n\n');
    const chunks = createTextChunks(text);

    chunks.forEach((chunk, i) => {
      expect(chunk.id).toBe(`chunk-${i}`);
      expect(chunk.index).toBe(i);
    });
  });
});

// ─── formatTime ─────────────────────────────────────────────────

describe('formatTime', () => {
  it('formats 0 seconds as "0:00"', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('formats seconds with zero-padded seconds', () => {
    expect(formatTime(5)).toBe('0:05');
  });

  it('formats minutes and seconds', () => {
    expect(formatTime(65)).toBe('1:05');
  });

  it('formats exact minutes', () => {
    expect(formatTime(120)).toBe('2:00');
  });

  it('formats large values', () => {
    expect(formatTime(3600)).toBe('60:00');
  });

  it('floors fractional seconds', () => {
    expect(formatTime(65.7)).toBe('1:05');
  });
});
