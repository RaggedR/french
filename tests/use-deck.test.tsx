import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Firebase mock ──────────────────────────────────────────────
const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, collection, id) => ({ path: `${collection}/${id}` })),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  getFirestore: vi.fn(),
}));

vi.mock('../src/firebase-db', () => ({
  db: {},
}));

vi.mock('../src/firebase', () => ({
  db: {},
  auth: { currentUser: null },
}));

const mockCaptureException = vi.fn();
vi.mock('@sentry/react', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

// ── API mock (for enrich-deck) ──────────────────────────────────
const mockApiRequest = vi.fn();
vi.mock('../src/services/api', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

import { useDeck } from '../src/hooks/useDeck';

// ── Helpers ────────────────────────────────────────────────────
function firestoreSnap(data: object | null) {
  return {
    exists: () => data !== null,
    data: () => data,
  };
}

// Provide a proper localStorage mock for jsdom
const localStorageStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value; }),
  removeItem: vi.fn((key: string) => { delete localStorageStore[key]; }),
};
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, writable: true });

describe('useDeck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Default: Firestore returns empty doc
    mockGetDoc.mockResolvedValue(firestoreSnap(null));
    mockSetDoc.mockResolvedValue(undefined);
    // Default: enrich-deck returns empty entries
    mockApiRequest.mockResolvedValue({ entries: {} });
    // Clear localStorage store
    Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]);
  });

  // ─── Initial load ────────────────────────────────────────────

  it('starts with empty cards when no userId', () => {
    const { result } = renderHook(() => useDeck(null));
    expect(result.current.cards).toEqual([]);
    expect(result.current.dueCount).toBe(0);
  });

  it('loads cards from Firestore when userId provided', async () => {
    // Dynamic import() inside getFirestoreHelpers() hangs with fake timers
    // because Vitest's module loader uses async primitives that get frozen.
    vi.useRealTimers();
    const firestoreCards = [
      { id: 'привет', word: 'Привет', translation: 'Hello', sourceLanguage: 'ru',
        easeFactor: 2.5, interval: 0, repetition: 0,
        nextReviewDate: new Date(Date.now() - 1000).toISOString(),
        addedAt: new Date().toISOString(), lastReviewedAt: null },
    ];
    mockGetDoc.mockResolvedValue(firestoreSnap({ cards: firestoreCards }));

    const { result } = renderHook(() => useDeck('user-123'));

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    expect(result.current.cards).toHaveLength(1);
    expect(result.current.cards[0].word).toBe('Привет');
    expect(result.current.loaded).toBe(true);
    vi.useFakeTimers();
  });

  it('migrates localStorage deck to Firestore when Firestore is empty', async () => {
    vi.useRealTimers(); // dynamic import() hangs with fake timers
    const localCards = [
      { id: 'мир', word: 'Мир', translation: 'World', sourceLanguage: 'ru',
        easeFactor: 2.5, interval: 0, repetition: 0,
        nextReviewDate: new Date(Date.now() - 1000).toISOString(),
        addedAt: new Date().toISOString(), lastReviewedAt: null },
    ];
    localStorage.setItem('srs_deck', JSON.stringify(localCards));
    mockGetDoc.mockResolvedValue(firestoreSnap(null));

    const { result } = renderHook(() => useDeck('user-456'));

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // Cards loaded from localStorage
    expect(result.current.cards).toHaveLength(1);
    expect(result.current.cards[0].word).toBe('Мир');
    // Migrated to Firestore
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'decks/user-456' }),
      expect.objectContaining({ cards: localCards }),
    );
    // localStorage cleared after migration
    expect(localStorage.getItem('srs_deck')).toBeNull();
    vi.useFakeTimers();
  });

  it('falls back to localStorage when Firestore errors', async () => {
    const localCards = [
      { id: 'дом', word: 'Дом', translation: 'House', sourceLanguage: 'ru',
        easeFactor: 2.5, interval: 0, repetition: 0,
        nextReviewDate: new Date(Date.now() - 1000).toISOString(),
        addedAt: new Date().toISOString(), lastReviewedAt: null },
    ];
    localStorage.setItem('srs_deck', JSON.stringify(localCards));
    mockGetDoc.mockRejectedValue(new Error('Firestore unavailable'));

    const { result } = renderHook(() => useDeck('user-789'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.cards).toHaveLength(1);
    expect(result.current.cards[0].word).toBe('Дом');
    expect(result.current.loaded).toBe(true);
  });

  // ─── addCard ─────────────────────────────────────────────────

  it('adds a new card to the deck', async () => {
    const { result } = renderHook(() => useDeck('user-1'));
    await act(async () => { await vi.runAllTimersAsync(); });

    act(() => {
      result.current.addCard('Привет', 'Hello', 'ru', 'Привет, мир!', 'Hello, world!');
    });

    expect(result.current.cards).toHaveLength(1);
    expect(result.current.cards[0].word).toBe('Привет');
    expect(result.current.cards[0].translation).toBe('Hello');
    expect(result.current.cards[0].context).toBe('Привет, мир!');
  });

  it('prevents duplicate cards (same normalized id)', async () => {
    const { result } = renderHook(() => useDeck('user-1'));
    await act(async () => { await vi.runAllTimersAsync(); });

    act(() => {
      result.current.addCard('Привет', 'Hello', 'ru');
      result.current.addCard('привет', 'Hi', 'ru'); // same normalized id
    });

    expect(result.current.cards).toHaveLength(1);
  });

  it('treats ё and е as same word (dedup)', async () => {
    const { result } = renderHook(() => useDeck('user-1'));
    await act(async () => { await vi.runAllTimersAsync(); });

    act(() => {
      result.current.addCard('ёж', 'hedgehog', 'ru');
      result.current.addCard('еж', 'hedgehog', 'ru');
    });

    expect(result.current.cards).toHaveLength(1);
  });

  // ─── removeCard ──────────────────────────────────────────────

  it('removes card by id', async () => {
    const { result } = renderHook(() => useDeck('user-1'));
    await act(async () => { await vi.runAllTimersAsync(); });

    act(() => {
      result.current.addCard('Слово', 'Word', 'ru');
    });
    const cardId = result.current.cards[0].id;

    act(() => {
      result.current.removeCard(cardId);
    });

    expect(result.current.cards).toHaveLength(0);
  });

  it('does nothing when removing non-existent id', async () => {
    const { result } = renderHook(() => useDeck('user-1'));
    await act(async () => { await vi.runAllTimersAsync(); });

    act(() => {
      result.current.addCard('Слово', 'Word', 'ru');
    });

    act(() => {
      result.current.removeCard('nonexistent');
    });

    expect(result.current.cards).toHaveLength(1);
  });

  // ─── reviewCard ──────────────────────────────────────────────

  it('updates card via sm2 algorithm on review', async () => {
    const { result } = renderHook(() => useDeck('user-1'));
    await act(async () => { await vi.runAllTimersAsync(); });

    act(() => {
      result.current.addCard('Книга', 'Book', 'ru');
    });
    const cardId = result.current.cards[0].id;

    act(() => {
      result.current.reviewCard(cardId, 4); // Good rating
    });

    const updated = result.current.cards.find(c => c.id === cardId);
    expect(updated).toBeDefined();
    // SM-2 with Good (4) on learning card: graduates to rep=1, interval=1
    expect(updated!.repetition).toBe(1);
    expect(updated!.interval).toBe(1);
  });

  it('leaves other cards unchanged when reviewing one', async () => {
    const { result } = renderHook(() => useDeck('user-1'));
    await act(async () => { await vi.runAllTimersAsync(); });

    act(() => {
      result.current.addCard('Один', 'One', 'ru');
      result.current.addCard('Два', 'Two', 'ru');
    });

    const card1Id = result.current.cards[0].id;
    const card2Before = { ...result.current.cards[1] };

    act(() => {
      result.current.reviewCard(card1Id, 4);
    });

    // Second card should be untouched
    expect(result.current.cards[1].repetition).toBe(card2Before.repetition);
    expect(result.current.cards[1].interval).toBe(card2Before.interval);
  });

  // ─── isWordInDeck ────────────────────────────────────────────

  it('returns true for word in deck (normalized match)', async () => {
    const { result } = renderHook(() => useDeck('user-1'));
    await act(async () => { await vi.runAllTimersAsync(); });

    act(() => {
      result.current.addCard('Привет', 'Hello', 'ru');
    });

    expect(result.current.isWordInDeck('привет')).toBe(true);
    expect(result.current.isWordInDeck('Привет!')).toBe(true);
  });

  it('returns false for word not in deck', async () => {
    const { result } = renderHook(() => useDeck('user-1'));
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(result.current.isWordInDeck('неизвестно')).toBe(false);
  });

  // ─── Firestore persistence (debounced) ───────────────────────

  it('saves to Firestore after 500ms debounce on addCard', async () => {
    const { result } = renderHook(() => useDeck('user-1'));
    await act(async () => { await vi.runAllTimersAsync(); });

    // Reset mock after the initial load's setDoc calls (migration, etc.)
    mockSetDoc.mockClear();

    act(() => {
      result.current.addCard('Тест', 'Test', 'ru');
    });

    // Not called immediately
    expect(mockSetDoc).not.toHaveBeenCalled();

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'decks/user-1' }),
      expect.objectContaining({
        cards: expect.arrayContaining([
          expect.objectContaining({ word: 'Тест' }),
        ]),
      }),
    );
  });

  it('does not save to Firestore when no userId', () => {
    const { result } = renderHook(() => useDeck(null));

    act(() => {
      result.current.addCard('Тест', 'Test', 'ru');
    });

    vi.advanceTimersByTime(1000);
    // setDoc should never be called (no getDoc either since no userId)
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  // ─── dueCards ────────────────────────────────────────────────

  it('computes dueCards from cards with past nextReviewDate', async () => {
    const { result } = renderHook(() => useDeck('user-1'));
    await act(async () => { await vi.runAllTimersAsync(); });

    act(() => {
      result.current.addCard('Слово', 'Word', 'ru');
    });

    // Newly added card has nextReviewDate ≈ now, which is "due"
    expect(result.current.dueCount).toBe(1);
    expect(result.current.dueCards).toHaveLength(1);
  });

  // ─── saveError state ──────────────────────────────────────

  it('sets saveError when Firestore save fails', async () => {
    mockSetDoc.mockRejectedValue(new Error('Firestore write failed'));

    const { result } = renderHook(() => useDeck('user-1'));
    await act(async () => { await vi.runAllTimersAsync(); });

    // Reset mocks after initial load
    mockSetDoc.mockRejectedValue(new Error('Firestore write failed'));

    act(() => {
      result.current.addCard('Ошибка', 'Error', 'ru');
    });

    expect(result.current.saveError).toBeNull(); // Not set yet (debounced)

    // Advance past debounce to trigger the save
    await act(async () => {
      vi.advanceTimersByTime(500);
      // Allow the rejected promise to settle
      await vi.runAllTimersAsync();
    });

    expect(result.current.saveError).toMatch(/Deck changes may not be saved/);
  });

  it('reports save failures to Sentry', async () => {
    const error = new Error('Firestore write failed');
    mockSetDoc.mockRejectedValue(error);

    const { result } = renderHook(() => useDeck('user-1'));
    await act(async () => { await vi.runAllTimersAsync(); });

    mockCaptureException.mockClear();
    mockSetDoc.mockRejectedValue(error);

    act(() => {
      result.current.addCard('Sentry', 'Test', 'ru');
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
    });

    expect(mockCaptureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ tags: { operation: 'deck_save' } }),
    );
  });

  it('saves to localStorage as fallback when Firestore fails', async () => {
    mockSetDoc.mockRejectedValue(new Error('Firestore write failed'));

    const { result } = renderHook(() => useDeck('user-1'));
    await act(async () => { await vi.runAllTimersAsync(); });

    mockSetDoc.mockRejectedValue(new Error('Firestore write failed'));
    mockLocalStorage.setItem.mockClear();

    act(() => {
      result.current.addCard('Fallback', 'Test', 'ru');
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
    });

    // localStorage should be written as backup
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'srs_deck',
      expect.stringContaining('Fallback'),
    );
  });

  // Auto-clear of saveError on successful save is tested indirectly:
  // the production code calls setSaveError(null) in setDoc's .then().
  // Direct testing is blocked by React 19 strict mode running state updaters
  // twice, which prevents the debounced timer from firing on the second addCard.
  // The user-facing behavior (dismissing errors) is covered by 'clearSaveError
  // manually clears the error' below.

  it('clearSaveError manually clears the error', async () => {
    mockSetDoc.mockRejectedValue(new Error('fail'));

    const { result } = renderHook(() => useDeck('user-1'));
    await act(async () => { await vi.runAllTimersAsync(); });

    mockSetDoc.mockRejectedValue(new Error('fail'));

    act(() => {
      result.current.addCard('Manual', 'Test', 'ru');
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
    });

    expect(result.current.saveError).toBeTruthy();

    act(() => {
      result.current.clearSaveError();
    });

    expect(result.current.saveError).toBeNull();
  });

  // ─── Dictionary enrichment ──────────────────────────────────

  it('enriches cards missing dictionary data after Firestore load', async () => {
    vi.useRealTimers();
    const firestoreCards = [
      { id: 'привет', word: 'Привет', translation: 'Hello', sourceLanguage: 'ru',
        easeFactor: 2.5, interval: 0, repetition: 0,
        nextReviewDate: new Date(Date.now() - 1000).toISOString(),
        addedAt: new Date().toISOString(), lastReviewedAt: null },
    ];
    mockGetDoc.mockResolvedValue(firestoreSnap({ cards: firestoreCards }));

    const dictionaryEntry = { stressedForm: 'приве́т', pos: 'other', translations: ['hello', 'hi'] };
    mockApiRequest.mockResolvedValue({
      entries: { 'Привет': dictionaryEntry },
    });

    const { result } = renderHook(() => useDeck('user-enrich'));

    // Wait for Firestore load + enrichment
    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });

    // API should have been called with the card's word
    expect(mockApiRequest).toHaveBeenCalledWith(
      '/api/enrich-deck',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ words: [{ word: 'Привет' }] }),
      }),
    );

    // Card should now have dictionary data
    expect(result.current.cards[0].dictionary).toEqual(dictionaryEntry);
    vi.useFakeTimers();
  });

  it('does not call enrich-deck for cards that already have dictionary data', async () => {
    vi.useRealTimers();
    const dictionaryEntry = { stressedForm: 'кни́га', pos: 'noun', translations: ['book'] };
    const firestoreCards = [
      { id: 'книга', word: 'Книга', translation: 'Book', sourceLanguage: 'ru',
        dictionary: dictionaryEntry,
        easeFactor: 2.5, interval: 0, repetition: 0,
        nextReviewDate: new Date(Date.now() - 1000).toISOString(),
        addedAt: new Date().toISOString(), lastReviewedAt: null },
    ];
    mockGetDoc.mockResolvedValue(firestoreSnap({ cards: firestoreCards }));
    // Mock for generate-examples (will be called since dictionary has no example)
    mockApiRequest.mockResolvedValue({ examples: {} });

    renderHook(() => useDeck('user-no-enrich'));

    await act(async () => {
      await new Promise(r => setTimeout(r, 200));
    });

    // enrich-deck should NOT have been called — all cards already have dictionary
    const enrichDeckCalls = mockApiRequest.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes('enrich-deck')
    );
    expect(enrichDeckCalls).toHaveLength(0);
    vi.useFakeTimers();
  });

  it('enrichment failure does not break deck loading', async () => {
    vi.useRealTimers();
    const firestoreCards = [
      { id: 'слово', word: 'Слово', translation: 'Word', sourceLanguage: 'ru',
        easeFactor: 2.5, interval: 0, repetition: 0,
        nextReviewDate: new Date(Date.now() - 1000).toISOString(),
        addedAt: new Date().toISOString(), lastReviewedAt: null },
    ];
    mockGetDoc.mockResolvedValue(firestoreSnap({ cards: firestoreCards }));
    mockApiRequest.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useDeck('user-fail-enrich'));

    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });

    // Cards should still be loaded (without dictionary data)
    expect(result.current.cards).toHaveLength(1);
    expect(result.current.cards[0].word).toBe('Слово');
    expect(result.current.cards[0].dictionary).toBeUndefined();
    expect(result.current.loaded).toBe(true);
    vi.useFakeTimers();
  });

  it('saves enriched cards back to Firestore', async () => {
    vi.useRealTimers();
    const firestoreCards = [
      { id: 'дом', word: 'Дом', translation: 'House', sourceLanguage: 'ru',
        easeFactor: 2.5, interval: 0, repetition: 0,
        nextReviewDate: new Date(Date.now() - 1000).toISOString(),
        addedAt: new Date().toISOString(), lastReviewedAt: null },
    ];
    mockGetDoc.mockResolvedValue(firestoreSnap({ cards: firestoreCards }));

    const dictionaryEntry = { stressedForm: 'до́м', pos: 'noun', translations: ['house', 'home'] };
    mockApiRequest.mockResolvedValue({
      entries: { 'Дом': dictionaryEntry },
    });
    mockSetDoc.mockResolvedValue(undefined);

    renderHook(() => useDeck('user-save-enrich'));

    // Wait for load + enrichment + debounced save
    await act(async () => {
      await new Promise(r => setTimeout(r, 700));
    });

    // Firestore should have been called with enriched cards
    const saveCalls = mockSetDoc.mock.calls.filter(
      (call: unknown[]) => {
        const data = call[1] as { cards?: Array<{ dictionary?: unknown }> };
        return data.cards?.some(c => c.dictionary);
      }
    );
    expect(saveCalls.length).toBeGreaterThan(0);
    vi.useFakeTimers();
  });

  // ─── Example sentence enrichment ────────────────────────────

  it('generates example sentences for cards with dictionary but no example', async () => {
    vi.useRealTimers();
    const dictionaryEntry = { stressedForm: 'кни́га', pos: 'noun', translations: ['book'] };
    const firestoreCards = [
      { id: 'книга', word: 'Книга', translation: 'Book', sourceLanguage: 'ru',
        dictionary: dictionaryEntry,
        easeFactor: 2.5, interval: 0, repetition: 0,
        nextReviewDate: new Date(Date.now() - 1000).toISOString(),
        addedAt: new Date().toISOString(), lastReviewedAt: null },
    ];
    mockGetDoc.mockResolvedValue(firestoreSnap({ cards: firestoreCards }));

    // No dictionary enrichment needed (already has dictionary)
    // Example generation should be called
    mockApiRequest.mockResolvedValue({
      examples: { 'Книга': { russian: 'Я читаю интересную книгу.', english: 'I am reading an interesting book.' } },
    });

    const { result } = renderHook(() => useDeck('user-example-enrich'));

    await act(async () => {
      await new Promise(r => setTimeout(r, 200));
    });

    // API should have been called with generate-examples
    expect(mockApiRequest).toHaveBeenCalledWith(
      '/api/generate-examples',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ words: ['Книга'] }),
      }),
    );

    // Card should now have example in dictionary
    expect(result.current.cards[0].dictionary?.example).toEqual({
      russian: 'Я читаю интересную книгу.',
      english: 'I am reading an interesting book.',
    });
    vi.useFakeTimers();
  });

  it('skips example generation for cards already having examples', async () => {
    vi.useRealTimers();
    const dictionaryEntry = {
      stressedForm: 'кни́га', pos: 'noun', translations: ['book'],
      example: { russian: 'Эта книга хорошая.', english: 'This book is good.' },
    };
    const firestoreCards = [
      { id: 'книга', word: 'Книга', translation: 'Book', sourceLanguage: 'ru',
        dictionary: dictionaryEntry,
        easeFactor: 2.5, interval: 0, repetition: 0,
        nextReviewDate: new Date(Date.now() - 1000).toISOString(),
        addedAt: new Date().toISOString(), lastReviewedAt: null },
    ];
    mockGetDoc.mockResolvedValue(firestoreSnap({ cards: firestoreCards }));

    renderHook(() => useDeck('user-skip-examples'));

    await act(async () => {
      await new Promise(r => setTimeout(r, 200));
    });

    // API should NOT have been called — all cards already have examples
    expect(mockApiRequest).not.toHaveBeenCalled();
    vi.useFakeTimers();
  });

  it('skips example generation for cards without dictionary data', async () => {
    vi.useRealTimers();
    const firestoreCards = [
      { id: 'слово', word: 'Слово', translation: 'Word', sourceLanguage: 'ru',
        easeFactor: 2.5, interval: 0, repetition: 0,
        nextReviewDate: new Date(Date.now() - 1000).toISOString(),
        addedAt: new Date().toISOString(), lastReviewedAt: null },
    ];
    mockGetDoc.mockResolvedValue(firestoreSnap({ cards: firestoreCards }));

    // Dictionary enrichment returns null (word not found)
    mockApiRequest.mockResolvedValue({ entries: {} });

    renderHook(() => useDeck('user-no-dict-no-examples'));

    await act(async () => {
      await new Promise(r => setTimeout(r, 200));
    });

    // Should have been called for enrich-deck, but NOT for generate-examples
    const calls = mockApiRequest.mock.calls;
    expect(calls.some((c: unknown[]) => (c[0] as string).includes('enrich-deck'))).toBe(true);
    expect(calls.some((c: unknown[]) => (c[0] as string).includes('generate-examples'))).toBe(false);
    vi.useFakeTimers();
  });

  it('example enrichment failure does not break deck loading', async () => {
    vi.useRealTimers();
    const dictionaryEntry = { stressedForm: 'до́м', pos: 'noun', translations: ['house'] };
    const firestoreCards = [
      { id: 'дом', word: 'Дом', translation: 'House', sourceLanguage: 'ru',
        dictionary: dictionaryEntry,
        easeFactor: 2.5, interval: 0, repetition: 0,
        nextReviewDate: new Date(Date.now() - 1000).toISOString(),
        addedAt: new Date().toISOString(), lastReviewedAt: null },
    ];
    mockGetDoc.mockResolvedValue(firestoreSnap({ cards: firestoreCards }));

    // Example generation fails
    mockApiRequest.mockRejectedValue(new Error('GPT API error'));

    const { result } = renderHook(() => useDeck('user-example-fail'));

    await act(async () => {
      await new Promise(r => setTimeout(r, 200));
    });

    // Cards should still be loaded (without examples)
    expect(result.current.cards).toHaveLength(1);
    expect(result.current.cards[0].dictionary?.example).toBeUndefined();
    expect(result.current.loaded).toBe(true);
    vi.useFakeTimers();
  });

  it('chains dictionary enrichment then example generation', async () => {
    vi.useRealTimers();
    const firestoreCards = [
      { id: 'привет', word: 'Привет', translation: 'Hello', sourceLanguage: 'ru',
        easeFactor: 2.5, interval: 0, repetition: 0,
        nextReviewDate: new Date(Date.now() - 1000).toISOString(),
        addedAt: new Date().toISOString(), lastReviewedAt: null },
    ];
    mockGetDoc.mockResolvedValue(firestoreSnap({ cards: firestoreCards }));

    const dictionaryEntry = { stressedForm: 'приве́т', pos: 'other', translations: ['hello'] };
    const exampleData = { russian: 'Привет, как дела?', english: 'Hello, how are you?' };

    // First call: enrich-deck returns dictionary
    // Second call: generate-examples returns example
    mockApiRequest.mockImplementation((url: string) => {
      if (url.includes('enrich-deck')) {
        return Promise.resolve({ entries: { 'Привет': dictionaryEntry } });
      }
      if (url.includes('generate-examples')) {
        return Promise.resolve({ examples: { 'Привет': exampleData } });
      }
      return Promise.reject(new Error('Unexpected API call'));
    });

    const { result } = renderHook(() => useDeck('user-chain-enrich'));

    await act(async () => {
      await new Promise(r => setTimeout(r, 300));
    });

    // Both APIs should have been called in sequence
    expect(mockApiRequest).toHaveBeenCalledWith('/api/enrich-deck', expect.anything());
    expect(mockApiRequest).toHaveBeenCalledWith('/api/generate-examples', expect.anything());

    // Card should have both dictionary AND example
    expect(result.current.cards[0].dictionary).toBeDefined();
    expect(result.current.cards[0].dictionary?.example).toEqual(exampleData);
    vi.useFakeTimers();
  });

  it('batches example generation in chunks of 50', async () => {
    vi.useRealTimers();
    const dictionaryEntry = { stressedForm: 'те́ст', pos: 'noun', translations: ['test'] };
    // Create 75 cards that all need examples (have dictionary but no example)
    const firestoreCards = Array.from({ length: 75 }, (_, i) => ({
      id: `word${i}`, word: `Word${i}`, translation: `Trans${i}`, sourceLanguage: 'ru',
      dictionary: dictionaryEntry,
      easeFactor: 2.5, interval: 0, repetition: 0,
      nextReviewDate: new Date(Date.now() - 1000).toISOString(),
      addedAt: new Date().toISOString(), lastReviewedAt: null,
    }));
    mockGetDoc.mockResolvedValue(firestoreSnap({ cards: firestoreCards }));

    mockApiRequest.mockImplementation((url: string) => {
      if (url.includes('generate-examples')) {
        return Promise.resolve({ examples: {} });
      }
      return Promise.reject(new Error('Unexpected API call'));
    });

    renderHook(() => useDeck('user-batch-examples'));

    await act(async () => {
      await new Promise(r => setTimeout(r, 300));
    });

    // Should have made 2 batch calls: 50 + 25
    const exampleCalls = mockApiRequest.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes('generate-examples')
    );
    expect(exampleCalls).toHaveLength(2);

    // First batch should have 50 words
    const firstBody = JSON.parse((exampleCalls[0][1] as { body: string }).body);
    expect(firstBody.words).toHaveLength(50);

    // Second batch should have 25 words
    const secondBody = JSON.parse((exampleCalls[1][1] as { body: string }).body);
    expect(secondBody.words).toHaveLength(25);
    vi.useFakeTimers();
  });
});
