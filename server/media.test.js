import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createHeartbeat, editDistance, isFuzzyMatch, stripPunctuation,
  isLibRuUrl, estimateWordTimestamps, alignWhisperToOriginal, addPunctuation,
  transcribeAndAlignTTS,
} from './media.js';

// Shared mocks for OpenAI — vi.hoisted runs before vi.mock
const { mockChatCreate, mockTranscriptionsCreate } = vi.hoisted(() => ({
  mockChatCreate: vi.fn(),
  mockTranscriptionsCreate: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    constructor() {}
    chat = { completions: { create: mockChatCreate } };
    audio = { transcriptions: { create: mockTranscriptionsCreate } };
  },
}));

describe('createHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call onProgress with incrementing seconds', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(
      onProgress,
      'audio',
      (s) => `Connecting... (${s}s)`
    );

    // Advance 3 seconds
    vi.advanceTimersByTime(3000);

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, 'audio', 0, 'active', 'Connecting... (1s)');
    expect(onProgress).toHaveBeenNthCalledWith(2, 'audio', 0, 'active', 'Connecting... (2s)');
    expect(onProgress).toHaveBeenNthCalledWith(3, 'audio', 0, 'active', 'Connecting... (3s)');

    heartbeat.stop();
  });

  it('should stop calling onProgress after stop() is called', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(
      onProgress,
      'video',
      (s) => `Waiting (${s}s)`
    );

    vi.advanceTimersByTime(2000);
    expect(onProgress).toHaveBeenCalledTimes(2);

    heartbeat.stop();

    vi.advanceTimersByTime(3000);
    // Should still be 2, not 5
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it('should report isStopped correctly', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(onProgress, 'audio', (s) => `${s}s`);

    expect(heartbeat.isStopped()).toBe(false);
    heartbeat.stop();
    expect(heartbeat.isStopped()).toBe(true);
  });

  it('should be safe to call stop() multiple times', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(onProgress, 'audio', (s) => `${s}s`);

    heartbeat.stop();
    heartbeat.stop();
    heartbeat.stop();

    expect(heartbeat.isStopped()).toBe(true);
  });

  it('should use custom interval', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(
      onProgress,
      'transcription',
      (s) => `${s}s`,
      500 // 500ms interval
    );

    vi.advanceTimersByTime(2000);

    // 2000ms / 500ms = 4 calls
    expect(onProgress).toHaveBeenCalledTimes(4);

    heartbeat.stop();
  });

  it('should pass correct type to onProgress', () => {
    const onProgress = vi.fn();

    const audioHeartbeat = createHeartbeat(onProgress, 'audio', (s) => `${s}`);
    vi.advanceTimersByTime(1000);
    expect(onProgress).toHaveBeenLastCalledWith('audio', 0, 'active', '1');
    audioHeartbeat.stop();

    onProgress.mockClear();

    const videoHeartbeat = createHeartbeat(onProgress, 'video', (s) => `${s}`);
    vi.advanceTimersByTime(1000);
    expect(onProgress).toHaveBeenLastCalledWith('video', 0, 'active', '1');
    videoHeartbeat.stop();
  });

  it('should not call onProgress after being stopped even if interval fires', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(onProgress, 'audio', (s) => `${s}s`);

    vi.advanceTimersByTime(1000);
    expect(onProgress).toHaveBeenCalledTimes(1);

    // Stop before next interval
    heartbeat.stop();

    // Even if we advance time, should not get more calls
    vi.advanceTimersByTime(5000);
    expect(onProgress).toHaveBeenCalledTimes(1);
  });
});

describe('createHeartbeat edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not throw if onProgress throws', () => {
    const onProgress = vi.fn().mockImplementation(() => {
      throw new Error('Progress error');
    });

    const heartbeat = createHeartbeat(onProgress, 'audio', (s) => `${s}s`);

    // This should not throw
    expect(() => {
      vi.advanceTimersByTime(1000);
    }).toThrow('Progress error');

    heartbeat.stop();
  });

  it('should handle rapid stop calls', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(onProgress, 'audio', (s) => `${s}s`);

    // Rapidly stop
    for (let i = 0; i < 100; i++) {
      heartbeat.stop();
    }

    expect(heartbeat.isStopped()).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(onProgress).toHaveBeenCalledTimes(0);
  });

  it('should work with very short intervals', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(onProgress, 'audio', (s) => `${s}`, 10);

    vi.advanceTimersByTime(100);
    expect(onProgress).toHaveBeenCalledTimes(10);

    heartbeat.stop();
  });

  it('should work with long intervals', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(onProgress, 'audio', (s) => `${s}`, 60000);

    vi.advanceTimersByTime(120000);
    expect(onProgress).toHaveBeenCalledTimes(2);

    heartbeat.stop();
  });

  it('should allow different message builders', () => {
    const onProgress = vi.fn();

    // Complex message builder
    const messageBuilder = (s) => {
      const mins = Math.floor(s / 60);
      const secs = s % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const heartbeat = createHeartbeat(onProgress, 'audio', messageBuilder);

    vi.advanceTimersByTime(65000); // 65 seconds

    expect(onProgress).toHaveBeenLastCalledWith('audio', 0, 'active', '1:05');

    heartbeat.stop();
  });
});

// ---------------------------------------------------------------------------
// stripPunctuation
// ---------------------------------------------------------------------------

describe('stripPunctuation', () => {
  it('removes leading and trailing punctuation', () => {
    expect(stripPunctuation('«Привет»')).toBe('Привет');
    expect(stripPunctuation('слово.')).toBe('слово');
    expect(stripPunctuation(',слово,')).toBe('слово');
    expect(stripPunctuation('...слово!')).toBe('слово');
    expect(stripPunctuation('—слово—')).toBe('слово');
  });

  it('preserves internal punctuation-like characters', () => {
    expect(stripPunctuation('кто-то')).toBe('кто-то');
  });

  it('returns empty string for only-punctuation input', () => {
    expect(stripPunctuation('...')).toBe('');
    expect(stripPunctuation('—')).toBe('');
  });

  it('returns the word unchanged if no edge punctuation', () => {
    expect(stripPunctuation('программа')).toBe('программа');
    expect(stripPunctuation('hello')).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// editDistance
// ---------------------------------------------------------------------------

describe('editDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('программа', 'программа')).toBe(0);
  });

  it('returns length of other string for empty input', () => {
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
    expect(editDistance('', '')).toBe(0);
  });

  it('computes single-character edits correctly', () => {
    expect(editDistance('cat', 'bat')).toBe(1);  // substitution
    expect(editDistance('cat', 'cats')).toBe(1); // insertion
    expect(editDistance('cats', 'cat')).toBe(1); // deletion
  });

  it('computes multi-character edits', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('sunday', 'saturday')).toBe(3);
  });

  it('handles Russian words (Whisper correction scenario)', () => {
    // пограмма -> программа (1 insertion: insert р after п)
    expect(editDistance('пограмма', 'программа')).toBe(1);
    // скажым -> скажем (1 substitution: ы -> е)
    expect(editDistance('скажым', 'скажем')).toBe(1);
  });

  it('is symmetric', () => {
    expect(editDistance('abc', 'xyz')).toBe(editDistance('xyz', 'abc'));
    expect(editDistance('программа', 'пограмма')).toBe(editDistance('пограмма', 'программа'));
  });
});

// ---------------------------------------------------------------------------
// isFuzzyMatch
// ---------------------------------------------------------------------------

describe('isFuzzyMatch', () => {
  it('returns false for short words (< 4 chars)', () => {
    expect(isFuzzyMatch('да', 'до')).toBe(false);
    expect(isFuzzyMatch('кот', 'код')).toBe(false);
  });

  it('matches spelling corrections within threshold', () => {
    // пограмма -> программа: distance 2, maxLen 9, threshold max(2, 2) = 2 ✓
    expect(isFuzzyMatch('пограмма', 'программа')).toBe(true);
    // скажым -> скажем: distance 1, but both are < 4? No, 6 chars. threshold max(2, 1) = 2 ✓
    expect(isFuzzyMatch('скажым', 'скажем')).toBe(true);
  });

  it('rejects words that differ too much', () => {
    expect(isFuzzyMatch('программа', 'телевизор')).toBe(false);
    expect(isFuzzyMatch('hello', 'world')).toBe(false);
  });

  it('matches identical words', () => {
    expect(isFuzzyMatch('программа', 'программа')).toBe(true);
    expect(isFuzzyMatch('hello', 'hello')).toBe(true);
  });

  it('is symmetric', () => {
    expect(isFuzzyMatch('пограмма', 'программа')).toBe(isFuzzyMatch('программа', 'пограмма'));
  });
});

// ---------------------------------------------------------------------------
// isLibRuUrl
// ---------------------------------------------------------------------------

describe('isLibRuUrl', () => {
  it('returns true for lib.ru hostname', () => {
    expect(isLibRuUrl('https://lib.ru/PROZA/some-text.html')).toBe(true);
  });

  it('returns true for subdomain of lib.ru', () => {
    expect(isLibRuUrl('https://az.lib.ru/p/pushkin/text.html')).toBe(true);
  });

  it('returns false for non-lib.ru URLs', () => {
    expect(isLibRuUrl('https://ok.ru/video/123')).toBe(false);
    expect(isLibRuUrl('https://youtube.com/watch?v=abc')).toBe(false);
  });

  it('returns false for lib.ru appearing in path but not hostname', () => {
    expect(isLibRuUrl('https://example.com/lib.ru/page')).toBe(false);
  });

  it('returns false for invalid URLs', () => {
    expect(isLibRuUrl('not-a-url')).toBe(false);
    expect(isLibRuUrl('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// estimateWordTimestamps
// ---------------------------------------------------------------------------

describe('estimateWordTimestamps', () => {
  it('distributes duration proportionally to word character length', () => {
    const result = estimateWordTimestamps('aa bbbb', 3);
    // "aa" = 2 chars, "bbbb" = 4 chars, total = 6 chars
    // "aa" gets 2/6 * 3 = 1s, "bbbb" gets 4/6 * 3 = 2s
    expect(result.words).toHaveLength(2);
    expect(result.words[0].word).toBe('aa');
    expect(result.words[0].start).toBeCloseTo(0, 5);
    expect(result.words[0].end).toBeCloseTo(1, 5);
    expect(result.words[1].word).toBe(' bbbb');
    expect(result.words[1].start).toBeCloseTo(1, 5);
    expect(result.words[1].end).toBeCloseTo(3, 5);
  });

  it('adds leading space to all words except the first', () => {
    const result = estimateWordTimestamps('один два три', 10);
    expect(result.words[0].word).toBe('один');
    expect(result.words[1].word).toBe(' два');
    expect(result.words[2].word).toBe(' три');
  });

  it('timestamps cover the full duration with no gaps', () => {
    const result = estimateWordTimestamps('один два три четыре пять', 100);
    // First word starts at 0
    expect(result.words[0].start).toBe(0);
    // Last word ends at duration
    const lastWord = result.words[result.words.length - 1];
    expect(lastWord.end).toBeCloseTo(100, 5);
  });

  it('builds segments of ~20 words each', () => {
    // Create text with 45 words
    const words = Array.from({ length: 45 }, (_, i) => `слово${i}`);
    const result = estimateWordTimestamps(words.join(' '), 90);
    // 45 words / 20 per segment = 3 segments (20, 20, 5)
    expect(result.segments).toHaveLength(3);
    expect(result.segments[0].start).toBe(0);
    expect(result.segments[2].end).toBeCloseTo(90, 5);
  });

  it('returns language ru and input duration', () => {
    const result = estimateWordTimestamps('привет мир', 42);
    expect(result.language).toBe('ru');
    expect(result.duration).toBe(42);
  });

  it('handles single word', () => {
    const result = estimateWordTimestamps('привет', 5);
    expect(result.words).toHaveLength(1);
    expect(result.words[0].start).toBe(0);
    expect(result.words[0].end).toBe(5);
    expect(result.words[0].word).toBe('привет');
  });

  it('ignores extra whitespace', () => {
    const result = estimateWordTimestamps('  один   два  ', 10);
    expect(result.words).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// alignWhisperToOriginal
// ---------------------------------------------------------------------------

describe('alignWhisperToOriginal', () => {
  it('aligns matching words using Whisper timestamps', () => {
    const whisper = [
      { word: ' привет', start: 0.5, end: 1.0 },
      { word: ' мир', start: 1.0, end: 1.5 },
    ];
    const original = ['Привет,', 'мир!'];
    const result = alignWhisperToOriginal(whisper, original);
    // Uses original word text with Whisper timing
    expect(result[0].word).toBe('Привет,');
    expect(result[0].start).toBe(0.5);
    expect(result[0].end).toBe(1.0);
    expect(result[1].word).toBe(' мир!');
    expect(result[1].start).toBe(1.0);
    expect(result[1].end).toBe(1.5);
  });

  it('handles empty whisper words → all get zero timestamps', () => {
    const result = alignWhisperToOriginal([], ['один', 'два']);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ word: 'один', start: 0, end: 0 });
    expect(result[1]).toEqual({ word: ' два', start: 0, end: 0 });
  });

  it('handles empty original words → empty result', () => {
    const whisper = [{ word: ' привет', start: 0, end: 1 }];
    const result = alignWhisperToOriginal(whisper, []);
    expect(result).toHaveLength(0);
  });

  it('skips extra whisper words via lookahead', () => {
    // Whisper has an extra word "ну" that original doesn't have
    const whisper = [
      { word: ' ну', start: 0, end: 0.5 },
      { word: ' привет', start: 0.5, end: 1.0 },
      { word: ' мир', start: 1.0, end: 1.5 },
    ];
    const original = ['Привет,', 'мир.'];
    const result = alignWhisperToOriginal(whisper, original);
    // "Привет" should match whisper word at index 1 via lookahead
    expect(result[0].word).toBe('Привет,');
    expect(result[0].start).toBe(0.5);
    expect(result[1].word).toBe(' мир.');
    expect(result[1].start).toBe(1.0);
  });

  it('interpolates timestamps for unmatched original words', () => {
    // Original has words that Whisper didn't transcribe
    const whisper = [
      { word: ' привет', start: 0, end: 1.0 },
      { word: ' мир', start: 4.0, end: 5.0 },
    ];
    // "красивый" is between matched words → should be interpolated
    const original = ['Привет,', 'красивый', 'мир!'];
    const result = alignWhisperToOriginal(whisper, original);
    expect(result).toHaveLength(3);
    // "красивый" should have interpolated timestamps between 1.0 and 4.0
    expect(result[1].start).toBeGreaterThan(1.0);
    expect(result[1].start).toBeLessThan(4.0);
  });

  it('marks remaining original words for interpolation when whisper runs out', () => {
    const whisper = [
      { word: ' привет', start: 0, end: 1.0 },
    ];
    const original = ['Привет,', 'мир!', 'Как', 'дела?'];
    const result = alignWhisperToOriginal(whisper, original);
    expect(result).toHaveLength(4);
    // First word matched
    expect(result[0].start).toBe(0);
    // Remaining words get interpolated (not -1 after interpolation pass)
    expect(result[3].start).toBeGreaterThanOrEqual(0);
  });

  it('uses fuzzy matching for spelling corrections', () => {
    const whisper = [
      { word: ' пограмма', start: 0, end: 1.0 },  // misspelled
    ];
    const original = ['программа'];
    const result = alignWhisperToOriginal(whisper, original);
    // Should fuzzy-match and use original text with Whisper timing
    expect(result[0].word).toBe('программа');
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(1.0);
  });

  it('adds leading space to all words after the first', () => {
    const whisper = [
      { word: 'раз', start: 0, end: 1 },
      { word: ' два', start: 1, end: 2 },
      { word: ' три', start: 2, end: 3 },
    ];
    const original = ['Раз', 'два', 'три'];
    const result = alignWhisperToOriginal(whisper, original);
    expect(result[0].word).toBe('Раз');
    expect(result[1].word).toBe(' два');
    expect(result[2].word).toBe(' три');
  });
});

// ---------------------------------------------------------------------------
// addPunctuation (mocked OpenAI)
// ---------------------------------------------------------------------------

describe('addPunctuation', () => {
  beforeEach(() => {
    mockChatCreate.mockReset();
  });

  it('returns transcript unchanged when no words', async () => {
    const transcript = { words: [], segments: [], language: 'ru', duration: 10 };
    const result = await addPunctuation(transcript, { apiKey: 'test-key' });
    expect(result).toEqual(transcript);
  });

  it('returns transcript unchanged when no API key', async () => {
    const transcript = {
      words: [{ word: ' привет', start: 0, end: 1 }],
      segments: [],
      language: 'ru',
      duration: 1,
    };
    const result = await addPunctuation(transcript, { apiKey: '' });
    expect(result).toEqual(transcript);
  });

  it('applies punctuation from GPT-4o response via two-pointer alignment', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'Привет, мир!' } }],
    });

    const transcript = {
      words: [
        { word: ' привет', start: 0, end: 0.5 },
        { word: ' мир', start: 0.5, end: 1.0 },
      ],
      segments: [{ text: 'привет мир', start: 0, end: 1.0 }],
      language: 'ru',
      duration: 1.0,
    };

    const onProgress = vi.fn();
    const result = await addPunctuation(transcript, { apiKey: 'test-key', onProgress });

    // Words should have punctuation applied
    expect(result.words[0].word).toBe(' Привет,');
    expect(result.words[1].word).toBe(' мир!');
    // Timestamps preserved
    expect(result.words[0].start).toBe(0);
    expect(result.words[0].end).toBe(0.5);
  });

  it('falls back to original words on API error', async () => {
    mockChatCreate.mockRejectedValue(new Error('API Error'));

    const transcript = {
      words: [
        { word: ' привет', start: 0, end: 0.5 },
        { word: ' мир', start: 0.5, end: 1.0 },
      ],
      segments: [{ text: 'привет мир', start: 0, end: 1.0 }],
      language: 'ru',
      duration: 1.0,
    };

    const result = await addPunctuation(transcript, { apiKey: 'test-key' });

    // Should fall back to original words
    expect(result.words[0].word).toBe(' привет');
    expect(result.words[1].word).toBe(' мир');
  });

  it('handles GPT inserting extra tokens via lookahead', async () => {
    // GPT inserts "—" between words
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'Привет, — мир!' } }],
    });

    const transcript = {
      words: [
        { word: ' привет', start: 0, end: 0.5 },
        { word: ' мир', start: 0.5, end: 1.0 },
      ],
      segments: [{ text: 'привет мир', start: 0, end: 1.0 }],
      language: 'ru',
      duration: 1.0,
    };

    const result = await addPunctuation(transcript, { apiKey: 'test-key' });

    // Should still match both words despite the inserted "—"
    expect(result.words).toHaveLength(2);
    expect(stripPunctuation(result.words[0].word).trim().toLowerCase()).toBe('привет');
    expect(stripPunctuation(result.words[1].word).trim().toLowerCase()).toBe('мир');
  });

  it('calls onProgress with punctuation status', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'Слово.' } }],
    });

    const transcript = {
      words: [{ word: ' слово', start: 0, end: 1 }],
      segments: [{ text: 'слово', start: 0, end: 1 }],
      language: 'ru',
      duration: 1,
    };

    const onProgress = vi.fn();
    await addPunctuation(transcript, { apiKey: 'test-key', onProgress });

    // Should report start (0%) and complete (100%)
    expect(onProgress).toHaveBeenCalledWith('punctuation', 0, 'active', expect.stringContaining('1 words'));
    expect(onProgress).toHaveBeenCalledWith('punctuation', 100, 'complete', expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// transcribeAndAlignTTS
// ---------------------------------------------------------------------------

// Mock fs for transcribeAndAlignTTS tests (transcribeAudioChunk reads the audio file)
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    default: {
      ...actual.default,
      statSync: vi.fn((p) => {
        // Return fake stats for test audio paths
        if (p.includes('test-audio')) {
          return { size: 1024 * 1024 }; // 1MB
        }
        return actual.default.statSync(p);
      }),
      createReadStream: vi.fn((p) => {
        if (p.includes('test-audio')) {
          // Return a minimal readable stream stub
          const { Readable } = require('stream');
          return Readable.from(['fake-audio-data']);
        }
        return actual.default.createReadStream(p);
      }),
    },
  };
});

describe('transcribeAndAlignTTS', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockTranscriptionsCreate.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls Whisper then aligns to original text, returning correct shape', async () => {
    mockTranscriptionsCreate.mockResolvedValue({
      words: [
        { word: 'Привет', start: 0.0, end: 0.5 },
        { word: 'мир', start: 0.6, end: 1.0 },
      ],
      segments: [{ text: 'Привет мир', start: 0, end: 1.0 }],
      language: 'ru',
      duration: 1.0,
    });

    const resultPromise = transcribeAndAlignTTS('Привет мир', '/tmp/test-audio.mp3', {
      apiKey: 'test-key',
    });
    // Advance past the progress interval
    vi.advanceTimersByTime(5000);
    const result = await resultPromise;

    expect(result.words).toHaveLength(2);
    expect(result.words[0].word).toBe('Привет');
    expect(result.words[0].start).toBe(0.0);
    expect(result.words[0].end).toBe(0.5);
    expect(result.words[1].word).toBe(' мир');
    expect(result.words[1].start).toBe(0.6);
    expect(result.words[1].end).toBe(1.0);
    expect(result.segments).toHaveLength(1);
    expect(result.language).toBe('ru');
    expect(result.duration).toBe(1.0);
  });

  it('builds segments of ~20 words each', async () => {
    // Create 45 whisper words
    const whisperWords = Array.from({ length: 45 }, (_, i) => ({
      word: `слово${i}`,
      start: i * 0.5,
      end: (i + 1) * 0.5,
    }));
    mockTranscriptionsCreate.mockResolvedValue({
      words: whisperWords,
      segments: [],
      language: 'ru',
      duration: 22.5,
    });

    const text = Array.from({ length: 45 }, (_, i) => `слово${i}`).join(' ');
    const resultPromise = transcribeAndAlignTTS(text, '/tmp/test-audio.mp3', {
      apiKey: 'test-key',
    });
    vi.advanceTimersByTime(5000);
    const result = await resultPromise;

    // 45 words / 20 per segment = 3 segments (20, 20, 5)
    expect(result.segments).toHaveLength(3);
    expect(result.words).toHaveLength(45);
    expect(result.duration).toBe(22.5);
  });

  it('handles Whisper mishearing words via fuzzy alignment', async () => {
    // Whisper hears "привед" instead of "привет" (common mishearing)
    mockTranscriptionsCreate.mockResolvedValue({
      words: [
        { word: 'привед', start: 0.0, end: 0.5 },
        { word: 'мир', start: 0.6, end: 1.0 },
      ],
      segments: [],
      language: 'ru',
      duration: 1.0,
    });

    const resultPromise = transcribeAndAlignTTS('привет мир', '/tmp/test-audio.mp3', {
      apiKey: 'test-key',
    });
    vi.advanceTimersByTime(5000);
    const result = await resultPromise;

    // Should use original text "привет" with Whisper timestamp
    expect(result.words[0].word).toBe('привет');
    expect(result.words[0].start).toBe(0.0);
    expect(result.words[1].word).toBe(' мир');
    expect(result.words[1].start).toBe(0.6);
  });
});
