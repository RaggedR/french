import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TranscriptPanel } from '../src/components/TranscriptPanel';
import type { Transcript, WordTimestamp, TranslatorConfig } from '../src/types';

// Mock the API module
vi.mock('../src/services/api', () => ({
  apiRequest: vi.fn().mockResolvedValue({
    word: 'тест',
    translation: 'test',
    sourceLanguage: 'ru',
  }),
}));

// Mock scrollIntoView (jsdom doesn't support it)
Element.prototype.scrollIntoView = vi.fn();

const MOCK_WORDS: WordTimestamp[] = [
  { word: 'Привет,', start: 0.0, end: 0.4, lemma: 'привет' },
  { word: 'как', start: 0.5, end: 0.7, lemma: 'как' },
  { word: 'дела?', start: 0.8, end: 1.2, lemma: 'дело' },
  { word: 'Я', start: 1.5, end: 1.6, lemma: 'я' },
  { word: 'хочу', start: 1.7, end: 2.0, lemma: 'хотеть' },
  { word: 'рассказать', start: 2.1, end: 2.8, lemma: 'рассказать' },
  { word: 'вам', start: 2.9, end: 3.1, lemma: 'вы' },
  { word: 'историю.', start: 3.2, end: 3.8, lemma: 'история' },
];

const MOCK_TRANSCRIPT: Transcript = {
  words: MOCK_WORDS,
  segments: [
    { text: 'Привет, как дела?', start: 0, end: 1.2 },
    { text: 'Я хочу рассказать вам историю.', start: 1.5, end: 3.8 },
  ],
  language: 'ru',
  duration: 4.0,
};

const DEFAULT_CONFIG: TranslatorConfig = {};

function renderTranscript(overrides: {
  currentTime?: number;
  config?: TranslatorConfig;
  wordFrequencies?: Map<string, number>;
  onAddToDeck?: any;
  isWordInDeck?: any;
  isLoading?: boolean;
  transcript?: Transcript;
} = {}) {
  return render(
    <TranscriptPanel
      transcript={overrides.transcript ?? MOCK_TRANSCRIPT}
      currentTime={overrides.currentTime ?? 0}
      config={overrides.config ?? DEFAULT_CONFIG}
      wordFrequencies={overrides.wordFrequencies}
      onAddToDeck={overrides.onAddToDeck}
      isWordInDeck={overrides.isWordInDeck}
      isLoading={overrides.isLoading}
    />
  );
}

describe('TranscriptPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Word rendering ──────────────────────────────────────

  it('renders all words from transcript', () => {
    renderTranscript();
    for (const word of MOCK_WORDS) {
      expect(screen.getByText(word.word)).toBeInTheDocument();
    }
  });

  it('shows empty state when no words', () => {
    const emptyTranscript: Transcript = { words: [], segments: [], language: 'ru', duration: 0 };
    renderTranscript({ transcript: emptyTranscript });
    expect(screen.getByText('No transcript available')).toBeInTheDocument();
  });

  it('shows loading spinner when isLoading and no words', () => {
    const emptyTranscript: Transcript = { words: [], segments: [], language: 'ru', duration: 0 };
    renderTranscript({ transcript: emptyTranscript, isLoading: true });
    expect(screen.getByText('Transcribing audio...')).toBeInTheDocument();
  });

  // ─── Current word highlighting ─────────────────────────────

  it('highlights current word in yellow based on playback time', () => {
    // At time 0.5, "как" (start=0.5) should be current
    const { container } = renderTranscript({ currentTime: 0.5 });
    const wordSpans = container.querySelectorAll('span > span');
    // "как" is at index 1
    expect(wordSpans[1].className).toContain('bg-yellow-300');
  });

  it('marks past words in gray', () => {
    // At time 2.0, words before index of current word should be gray
    const { container } = renderTranscript({ currentTime: 2.0 });
    const wordSpans = container.querySelectorAll('span > span');
    // "Привет," (index 0) should be past
    expect(wordSpans[0].className).toContain('text-gray-500');
  });

  it('keeps future words in dark text', () => {
    // At time 0.5, "дела?" (index 2, start=0.8) is future
    const { container } = renderTranscript({ currentTime: 0.5 });
    const wordSpans = container.querySelectorAll('span > span');
    expect(wordSpans[2].className).toContain('text-gray-900');
  });

  it('highlights last started word during pauses', () => {
    // At time 1.3 (between "дела?" end=1.2 and "Я" start=1.5), "дела?" remains highlighted
    const { container } = renderTranscript({ currentTime: 1.3 });
    const wordSpans = container.querySelectorAll('span > span');
    // "дела?" is index 2
    expect(wordSpans[2].className).toContain('bg-yellow-300');
  });

  // ─── Progress bar ─────────────────────────────────────────

  it('shows progress bar at bottom tracking playback position', () => {
    const { container } = renderTranscript({ currentTime: 2.0 });
    const progressFill = container.querySelector('.bg-blue-500.h-full');
    // 2.0 / 4.0 = 50%
    expect(progressFill).toHaveStyle({ width: '50%' });
  });

  it('shows 0% progress at start', () => {
    const { container } = renderTranscript({ currentTime: 0 });
    const progressFill = container.querySelector('.bg-blue-500.h-full');
    expect(progressFill).toHaveStyle({ width: '0%' });
  });

  // ─── Word click behavior ──────────────────────────────────

  it('opens translation popup when Russian word is clicked', async () => {
    renderTranscript();
    fireEvent.click(screen.getByText('хочу'));
    // Word should be selected (bg-blue-200 class)
    expect(screen.getByText('хочу').className).toContain('bg-blue-200');
    // Should show translation popup with "Translating..." then result
    await waitFor(() => {
      expect(screen.getByText('test')).toBeInTheDocument();
    });
  });

  it('does NOT open popup for non-Cyrillic text', () => {
    // Add a non-Cyrillic word to transcript
    const transcriptWithPunct: Transcript = {
      ...MOCK_TRANSCRIPT,
      words: [...MOCK_WORDS, { word: '...', start: 4.0, end: 4.1 }],
    };
    renderTranscript({ transcript: transcriptWithPunct });
    fireEvent.click(screen.getByText('...'));
    // No popup should appear — the "..." span should not be selected
    expect(screen.getByText('...').className).not.toContain('bg-blue-200');
  });

  it('calls POST /api/translate with the clicked word', async () => {
    const { apiRequest } = await import('../src/services/api');
    renderTranscript();
    fireEvent.click(screen.getByText('рассказать'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/api/translate', {
        method: 'POST',
        body: JSON.stringify({ word: 'рассказать' }),
      });
    });
  });

  it('replaces popup when clicking a different word', async () => {
    renderTranscript();
    fireEvent.click(screen.getByText('хочу'));
    await waitFor(() => expect(screen.getByText('test')).toBeInTheDocument());

    fireEvent.click(screen.getByText('вам'));
    // "хочу" should no longer be selected
    expect(screen.getByText('хочу').className).not.toContain('bg-blue-200');
    // "вам" should be selected
    expect(screen.getByText('вам').className).toContain('bg-blue-200');
  });

  // ─── Frequency range highlighting ─────────────────────────

  it('underlines words in frequency range', () => {
    const freqs = new Map([
      ['привет', 100],   // outside range
      ['хотеть', 600],   // in range 500-1000
      ['рассказать', 800], // in range
    ]);
    const config: TranslatorConfig = { freqRangeMin: 500, freqRangeMax: 1000 };
    const { container } = renderTranscript({ config, wordFrequencies: freqs });

    const wordSpans = container.querySelectorAll('span > span');
    // "Привет," (lemma='привет', rank 100) — NOT underlined
    expect(wordSpans[0].className).not.toContain('underline');
    // "хочу" (lemma='хотеть', rank 600) — underlined
    expect(wordSpans[4].className).toContain('underline');
    expect(wordSpans[4].className).toContain('decoration-blue-400');
    // "рассказать" (lemma='рассказать', rank 800) — underlined
    expect(wordSpans[5].className).toContain('underline');
  });

  it('does not underline when frequency range not set', () => {
    const freqs = new Map([['хотеть', 600]]);
    // No freqRangeMin/Max in config
    const { container } = renderTranscript({ wordFrequencies: freqs });
    const wordSpans = container.querySelectorAll('span > span');
    expect(wordSpans[4].className).not.toContain('underline');
  });

  it('normalizes ё→е for frequency lookup', () => {
    // Word "ёж" with lemma "ёж" should match frequency key "еж"
    const transcriptWithYo: Transcript = {
      words: [{ word: 'ёж', start: 0, end: 0.5, lemma: 'ёж' }],
      segments: [{ text: 'ёж', start: 0, end: 0.5 }],
      language: 'ru',
      duration: 1.0,
    };
    const freqs = new Map([['еж', 300]]);
    const config: TranslatorConfig = { freqRangeMin: 200, freqRangeMax: 400 };
    const { container } = renderTranscript({
      transcript: transcriptWithYo,
      config,
      wordFrequencies: freqs,
    });
    const wordSpan = container.querySelector('span > span');
    expect(wordSpan!.className).toContain('underline');
  });

  // ─── isWordInDeck integration ─────────────────────────────

  it('shows "In deck" when clicked word is already in deck', async () => {
    const isWordInDeck = vi.fn().mockReturnValue(true);
    const onAddToDeck = vi.fn();
    renderTranscript({ isWordInDeck, onAddToDeck });
    fireEvent.click(screen.getByText('хочу'));
    await waitFor(() => {
      expect(screen.getByText('In deck')).toBeInTheDocument();
    });
  });

  it('shows "Add to deck" button when word is not in deck', async () => {
    const isWordInDeck = vi.fn().mockReturnValue(false);
    const onAddToDeck = vi.fn();
    renderTranscript({ isWordInDeck, onAddToDeck });
    fireEvent.click(screen.getByText('хочу'));
    await waitFor(() => {
      expect(screen.getByText('Add to deck')).toBeInTheDocument();
    });
  });

  // ─── Clickability ─────────────────────────────────────────

  it('makes Russian words clickable with cursor-pointer', () => {
    const { container } = renderTranscript();
    const wordSpans = container.querySelectorAll('span > span');
    // "Привет," contains Cyrillic → clickable
    expect(wordSpans[0].className).toContain('cursor-pointer');
  });
});
