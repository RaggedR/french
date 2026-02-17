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

vi.mock('../src/firebase', () => ({
  db: {},
  auth: { currentUser: null },
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
    const firestoreCards = [
      { id: 'привет', word: 'Привет', translation: 'Hello', sourceLanguage: 'ru',
        easeFactor: 2.5, interval: 0, repetition: 0,
        nextReviewDate: new Date(Date.now() - 1000).toISOString(),
        addedAt: new Date().toISOString(), lastReviewedAt: null },
    ];
    mockGetDoc.mockResolvedValue(firestoreSnap({ cards: firestoreCards }));

    const { result } = renderHook(() => useDeck('user-123'));

    // Wait for the async Firestore load
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.cards).toHaveLength(1);
    expect(result.current.cards[0].word).toBe('Привет');
    expect(result.current.loaded).toBe(true);
  });

  it('migrates localStorage deck to Firestore when Firestore is empty', async () => {
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
      await vi.runAllTimersAsync();
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
});
