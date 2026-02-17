import { describe, it, expect } from 'vitest';
import { createCard, sm2, normalizeCardId } from '../src/utils/sm2';
import type { SRSCard, SRSRating } from '../src/types';

// These tests validate the pure logic used inside useDeck.ts.
// Each operation mirrors the hook's callback without React dependencies.

// ─── Pure deck operations (same logic as useDeck callbacks) ────

function addCard(
  deck: SRSCard[],
  word: string,
  translation: string,
  sourceLanguage: string,
  context?: string,
  contextTranslation?: string,
): SRSCard[] {
  const id = normalizeCardId(word);
  if (deck.some(c => c.id === id)) return deck; // duplicate
  return [...deck, createCard(word, translation, sourceLanguage, context, contextTranslation)];
}

function removeCard(deck: SRSCard[], id: string): SRSCard[] {
  return deck.filter(c => c.id !== id);
}

function reviewCard(deck: SRSCard[], id: string, rating: SRSRating): SRSCard[] {
  return deck.map(c => c.id === id ? sm2(c, rating) : c);
}

function isWordInDeck(deck: SRSCard[], word: string): boolean {
  const id = normalizeCardId(word);
  return deck.some(c => c.id === id);
}

// ─── addCard ───────────────────────────────────────────────────

describe('addCard', () => {
  it('adds new card to empty deck', () => {
    const deck = addCard([], 'мир', 'world', 'ru');
    expect(deck).toHaveLength(1);
    expect(deck[0].word).toBe('мир');
    expect(deck[0].translation).toBe('world');
  });

  it('prevents duplicate (same normalized id)', () => {
    const deck1 = addCard([], 'Мир', 'world', 'ru');
    const deck2 = addCard(deck1, 'мир', 'peace', 'ru');
    expect(deck2).toHaveLength(1);
    expect(deck2).toBe(deck1); // same reference — unchanged
  });

  it('ё and е treated as same word', () => {
    const deck1 = addCard([], 'ёж', 'hedgehog', 'ru');
    const deck2 = addCard(deck1, 'еж', 'hedgehog', 'ru');
    expect(deck2).toHaveLength(1);
    expect(deck2).toBe(deck1);
  });

  it('punctuation variations are same word', () => {
    const deck1 = addCard([], 'привет!', 'hello', 'ru');
    const deck2 = addCard(deck1, 'привет', 'hi', 'ru');
    expect(deck2).toHaveLength(1);
    expect(deck2).toBe(deck1);
  });

  it('adds card with context', () => {
    const deck = addCard([], 'слово', 'word', 'ru', 'Это слово.', 'This is a word.');
    expect(deck[0].context).toBe('Это слово.');
    expect(deck[0].contextTranslation).toBe('This is a word.');
  });
});

// ─── removeCard ────────────────────────────────────────────────

describe('removeCard', () => {
  it('removes card by id', () => {
    const deck = addCard([], 'мир', 'world', 'ru');
    const result = removeCard(deck, 'мир');
    expect(result).toHaveLength(0);
  });

  it('unchanged if id not found', () => {
    const deck = addCard([], 'мир', 'world', 'ru');
    const result = removeCard(deck, 'солнце');
    expect(result).toHaveLength(1);
  });

  it('only removes exact id match', () => {
    let deck = addCard([], 'мир', 'world', 'ru');
    deck = addCard(deck, 'дом', 'house', 'ru');
    const result = removeCard(deck, 'мир');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('дом');
  });
});

// ─── reviewCard ────────────────────────────────────────────────

describe('reviewCard', () => {
  it('updates only the targeted card', () => {
    let deck = addCard([], 'мир', 'world', 'ru');
    deck = addCard(deck, 'дом', 'house', 'ru');
    const result = reviewCard(deck, 'мир', 4);
    // 'мир' should be updated (graduated)
    expect(result[0].repetition).toBe(1);
    // 'дом' should be unchanged
    expect(result[1].repetition).toBe(0);
  });

  it('leaves other cards unchanged', () => {
    let deck = addCard([], 'мир', 'world', 'ru');
    deck = addCard(deck, 'дом', 'house', 'ru');
    const original = deck[1];
    const result = reviewCard(deck, 'мир', 4);
    expect(result[1]).toBe(original); // same reference
  });
});

// ─── isWordInDeck ──────────────────────────────────────────────

describe('isWordInDeck', () => {
  it('true for normalized match (ё→е, punctuation stripped)', () => {
    const deck = addCard([], 'ёж', 'hedgehog', 'ru');
    expect(isWordInDeck(deck, 'еж')).toBe(true);
    expect(isWordInDeck(deck, 'ёж!')).toBe(true);
  });

  it('false for word not in deck', () => {
    const deck = addCard([], 'мир', 'world', 'ru');
    expect(isWordInDeck(deck, 'дом')).toBe(false);
  });

  it('case insensitive', () => {
    const deck = addCard([], 'Москва', 'Moscow', 'ru');
    expect(isWordInDeck(deck, 'москва')).toBe(true);
    expect(isWordInDeck(deck, 'МОСКВА')).toBe(true);
  });
});
