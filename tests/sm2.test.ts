import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeCardId, createCard, sm2, getDueCards, previewInterval } from '../src/utils/sm2';
import type { SRSCard } from '../src/types';

// Helper: create a card with overrides for testing
function makeCard(overrides: Partial<SRSCard> = {}): SRSCard {
  return {
    id: 'тест',
    word: 'тест',
    translation: 'test',
    sourceLanguage: 'ru',
    easeFactor: 2.5,
    interval: 0,
    repetition: 0,
    nextReviewDate: new Date(Date.now() - 60_000).toISOString(), // 1 min ago (due)
    addedAt: new Date().toISOString(),
    lastReviewedAt: null,
    ...overrides,
  };
}

// ─── normalizeCardId ───────────────────────────────────────────

describe('normalizeCardId', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeCardId('Привет!')).toBe('привет');
  });

  it('normalizes ё → е', () => {
    expect(normalizeCardId('ёж')).toBe('еж');
  });

  it('strips non-Cyrillic characters', () => {
    expect(normalizeCardId('hello-привет')).toBe('привет');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeCardId('')).toBe('');
  });

  it('returns empty string for only punctuation', () => {
    expect(normalizeCardId('...!!!')).toBe('');
  });

  it('handles mixed case Cyrillic', () => {
    expect(normalizeCardId('МОСКВА')).toBe('москва');
  });
});

// ─── createCard ────────────────────────────────────────────────

describe('createCard', () => {
  it('sets default SRS parameters', () => {
    const card = createCard('Привет', 'Hello', 'ru');
    expect(card.easeFactor).toBe(2.5);
    expect(card.interval).toBe(0);
    expect(card.repetition).toBe(0);
  });

  it('sets id to normalizeCardId(word)', () => {
    const card = createCard('Привет!', 'Hello', 'ru');
    expect(card.id).toBe('привет');
  });

  it('sets nextReviewDate to approximately now (immediately due)', () => {
    const before = Date.now();
    const card = createCard('тест', 'test', 'ru');
    const after = Date.now();
    const reviewTime = new Date(card.nextReviewDate).getTime();
    expect(reviewTime).toBeGreaterThanOrEqual(before);
    expect(reviewTime).toBeLessThanOrEqual(after);
  });

  it('stores context and contextTranslation when provided', () => {
    const card = createCard('слово', 'word', 'ru', 'Это слово.', 'This is a word.');
    expect(card.context).toBe('Это слово.');
    expect(card.contextTranslation).toBe('This is a word.');
  });

  it('omits context when not provided', () => {
    const card = createCard('слово', 'word', 'ru');
    expect(card.context).toBeUndefined();
    expect(card.contextTranslation).toBeUndefined();
  });

  it('sets addedAt to approximately now', () => {
    const before = Date.now();
    const card = createCard('тест', 'test', 'ru');
    const after = Date.now();
    const addedTime = new Date(card.addedAt).getTime();
    expect(addedTime).toBeGreaterThanOrEqual(before);
    expect(addedTime).toBeLessThanOrEqual(after);
  });

  it('sets lastReviewedAt to null', () => {
    const card = createCard('тест', 'test', 'ru');
    expect(card.lastReviewedAt).toBeNull();
  });
});

// ─── sm2 — Learning phase ──────────────────────────────────────

describe('sm2 — learning phase (repetition === 0)', () => {
  let card: SRSCard;

  beforeEach(() => {
    card = makeCard({ repetition: 0, interval: 0, easeFactor: 2.5 });
  });

  it('Again (0): stays in learning, nextReview ≈ +1min', () => {
    const before = Date.now();
    const result = sm2(card, 0);
    expect(result.repetition).toBe(0);
    expect(result.interval).toBe(0);
    const reviewMs = new Date(result.nextReviewDate).getTime() - before;
    expect(reviewMs).toBeGreaterThanOrEqual(55_000);
    expect(reviewMs).toBeLessThanOrEqual(65_000);
  });

  it('Hard (2): stays in learning, nextReview ≈ +5min', () => {
    const before = Date.now();
    const result = sm2(card, 2);
    expect(result.repetition).toBe(0);
    expect(result.interval).toBe(0);
    const reviewMs = new Date(result.nextReviewDate).getTime() - before;
    expect(reviewMs).toBeGreaterThanOrEqual(295_000);
    expect(reviewMs).toBeLessThanOrEqual(305_000);
  });

  it('Good (4): graduates to review (rep=1, interval=1), nextReview ≈ +1day', () => {
    const before = Date.now();
    const result = sm2(card, 4);
    expect(result.repetition).toBe(1);
    expect(result.interval).toBe(1);
    const reviewMs = new Date(result.nextReviewDate).getTime() - before;
    const oneDayMs = 24 * 60 * 60 * 1000;
    expect(reviewMs).toBeGreaterThanOrEqual(oneDayMs - 1000);
    expect(reviewMs).toBeLessThanOrEqual(oneDayMs + 1000);
  });

  it('Easy (5): graduates (rep=1, interval=5), nextReview ≈ +5days', () => {
    const before = Date.now();
    const result = sm2(card, 5);
    expect(result.repetition).toBe(1);
    expect(result.interval).toBe(5);
    const reviewMs = new Date(result.nextReviewDate).getTime() - before;
    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
    expect(reviewMs).toBeGreaterThanOrEqual(fiveDaysMs - 1000);
    expect(reviewMs).toBeLessThanOrEqual(fiveDaysMs + 1000);
  });

  it('ease factor adjusts even in learning phase', () => {
    const again = sm2(card, 0);
    expect(again.easeFactor).not.toBe(2.5);
    expect(again.easeFactor).toBeLessThan(2.5);
  });

  it('ease factor never drops below 1.3', () => {
    const c = makeCard({ easeFactor: 1.3 });
    const result = sm2(c, 0);
    expect(result.easeFactor).toBe(1.3);
  });
});

// ─── sm2 — Review phase ────────────────────────────────────────

describe('sm2 — review phase (repetition > 0)', () => {
  let card: SRSCard;

  beforeEach(() => {
    card = makeCard({ repetition: 2, interval: 6, easeFactor: 2.5 });
  });

  it('Again (0): lapses back to learning (rep=0, interval=0), +1min', () => {
    const before = Date.now();
    const result = sm2(card, 0);
    expect(result.repetition).toBe(0);
    expect(result.interval).toBe(0);
    const reviewMs = new Date(result.nextReviewDate).getTime() - before;
    expect(reviewMs).toBeGreaterThanOrEqual(55_000);
    expect(reviewMs).toBeLessThanOrEqual(65_000);
  });

  it('Hard (2): interval *= 1.2 (min +1 day), rep increments', () => {
    const result = sm2(card, 2);
    expect(result.interval).toBe(7);
    expect(result.repetition).toBe(3);
  });

  it('Good (4): interval *= easeFactor, rep increments', () => {
    const result = sm2(card, 4);
    expect(result.interval).toBe(15);
    expect(result.repetition).toBe(3);
  });

  it('Easy (5): interval *= easeFactor * 1.3, rep increments', () => {
    const result = sm2(card, 5);
    expect(result.interval).toBe(20);
    expect(result.repetition).toBe(3);
  });

  it('interval always increases by at least 1 day', () => {
    const c = makeCard({ repetition: 1, interval: 1, easeFactor: 1.3 });
    const result = sm2(c, 2);
    expect(result.interval).toBeGreaterThanOrEqual(c.interval + 1);
  });

  it('sets lastReviewedAt to current time', () => {
    const before = Date.now();
    const result = sm2(card, 4);
    const after = Date.now();
    expect(result.lastReviewedAt).not.toBeNull();
    const reviewedAt = new Date(result.lastReviewedAt!).getTime();
    expect(reviewedAt).toBeGreaterThanOrEqual(before);
    expect(reviewedAt).toBeLessThanOrEqual(after);
  });

  it('preserves word, translation, context fields', () => {
    const c = makeCard({
      repetition: 1,
      interval: 3,
      word: 'мир',
      translation: 'world',
      context: 'Весь мир.',
      contextTranslation: 'The whole world.',
    });
    const result = sm2(c, 4);
    expect(result.word).toBe('мир');
    expect(result.translation).toBe('world');
    expect(result.context).toBe('Весь мир.');
    expect(result.contextTranslation).toBe('The whole world.');
  });
});

// ─── getDueCards ────────────────────────────────────────────────

describe('getDueCards', () => {
  it('returns cards with nextReviewDate in the past', () => {
    const due = makeCard({ id: 'a', nextReviewDate: new Date(Date.now() - 60_000).toISOString() });
    const result = getDueCards([due]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('excludes cards with nextReviewDate in the future', () => {
    const future = makeCard({ id: 'b', nextReviewDate: new Date(Date.now() + 86_400_000).toISOString() });
    const result = getDueCards([future]);
    expect(result).toHaveLength(0);
  });

  it('sorts oldest-first', () => {
    const older = makeCard({ id: 'old', nextReviewDate: new Date(Date.now() - 120_000).toISOString() });
    const newer = makeCard({ id: 'new', nextReviewDate: new Date(Date.now() - 30_000).toISOString() });
    const result = getDueCards([newer, older]);
    expect(result[0].id).toBe('old');
    expect(result[1].id).toBe('new');
  });

  it('returns empty for empty input', () => {
    expect(getDueCards([])).toEqual([]);
  });

  it('returns empty when no cards are due', () => {
    const future = makeCard({ nextReviewDate: new Date(Date.now() + 86_400_000).toISOString() });
    expect(getDueCards([future])).toEqual([]);
  });
});

// ─── previewInterval ────────────────────────────────────────────

describe('previewInterval', () => {
  it('learning: Again = 1min', () => {
    const card = makeCard({ repetition: 0 });
    expect(previewInterval(card, 0)).toEqual({ value: 1, unit: 'min' });
  });

  it('learning: Hard = 5min', () => {
    const card = makeCard({ repetition: 0 });
    expect(previewInterval(card, 2)).toEqual({ value: 5, unit: 'min' });
  });

  it('learning: Good = 1day', () => {
    const card = makeCard({ repetition: 0 });
    expect(previewInterval(card, 4)).toEqual({ value: 1, unit: 'day' });
  });

  it('learning: Easy = 5day', () => {
    const card = makeCard({ repetition: 0 });
    expect(previewInterval(card, 5)).toEqual({ value: 5, unit: 'day' });
  });

  it('review Again: 1min (lapse)', () => {
    const card = makeCard({ repetition: 2, interval: 6, easeFactor: 2.5 });
    expect(previewInterval(card, 0)).toEqual({ value: 1, unit: 'min' });
  });

  it('review Good: computed interval in days', () => {
    const card = makeCard({ repetition: 2, interval: 6, easeFactor: 2.5 });
    const preview = previewInterval(card, 4);
    expect(preview.unit).toBe('day');
    expect(preview.value).toBe(15);
  });

  it('review Easy: larger computed interval', () => {
    const card = makeCard({ repetition: 2, interval: 6, easeFactor: 2.5 });
    const preview = previewInterval(card, 5);
    expect(preview.unit).toBe('day');
    expect(preview.value).toBeGreaterThan(15);
  });

  it('review Hard: computed interval in days', () => {
    const card = makeCard({ repetition: 2, interval: 6, easeFactor: 2.5 });
    const preview = previewInterval(card, 2);
    expect(preview.unit).toBe('day');
    expect(preview.value).toBe(7); // 6 * 1.2 = 7.2 → 7
  });
});

// ─── Multi-review sequences ──────────────────────────────────────

describe('sm2 — multi-review sequences', () => {
  it('full learning → graduation → review cycle', () => {
    let card = makeCard({ repetition: 0, interval: 0, easeFactor: 2.5 });

    // Learning: Again → still learning
    card = sm2(card, 0);
    expect(card.repetition).toBe(0);

    // Learning: Good → graduate
    card = sm2(card, 4);
    expect(card.repetition).toBe(1);
    expect(card.interval).toBe(1);

    // Review: Good → interval grows
    card = sm2(card, 4);
    expect(card.repetition).toBe(2);
    expect(card.interval).toBeGreaterThanOrEqual(2);

    // Review: Good again → interval grows further
    const prevInterval = card.interval;
    card = sm2(card, 4);
    expect(card.repetition).toBe(3);
    expect(card.interval).toBeGreaterThan(prevInterval);
  });

  it('repeated "Again" keeps card in learning with low ease', () => {
    let card = makeCard({ repetition: 0, interval: 0, easeFactor: 2.5 });

    for (let i = 0; i < 5; i++) {
      card = sm2(card, 0);
    }

    expect(card.repetition).toBe(0);
    expect(card.interval).toBe(0);
    expect(card.easeFactor).toBe(1.3); // floored at minimum
  });

  it('lapse from review → re-graduate → continue growing', () => {
    // Start in review phase
    let card = makeCard({ repetition: 3, interval: 15, easeFactor: 2.5 });

    // Lapse
    card = sm2(card, 0);
    expect(card.repetition).toBe(0);
    expect(card.interval).toBe(0);

    // Re-graduate with Good
    card = sm2(card, 4);
    expect(card.repetition).toBe(1);
    expect(card.interval).toBe(1);

    // Continue reviewing
    card = sm2(card, 4);
    expect(card.repetition).toBe(2);
    expect(card.interval).toBeGreaterThanOrEqual(2);
  });

  it('ease factor recovers after Easy ratings following Again', () => {
    let card = makeCard({ repetition: 0, interval: 0, easeFactor: 2.5 });

    // Tank ease factor with Again
    card = sm2(card, 0);
    card = sm2(card, 0);
    card = sm2(card, 0);
    const lowEase = card.easeFactor;

    // Graduate and keep hitting Easy
    card = sm2(card, 4);
    card = sm2(card, 5);
    card = sm2(card, 5);
    card = sm2(card, 5);

    expect(card.easeFactor).toBeGreaterThan(lowEase);
  });

  it('interval grows exponentially with consistent Good ratings', () => {
    let card = makeCard({ repetition: 0, interval: 0, easeFactor: 2.5 });

    // Graduate
    card = sm2(card, 4);
    const intervals: number[] = [card.interval];

    // Review 5 times with Good
    for (let i = 0; i < 5; i++) {
      card = sm2(card, 4);
      intervals.push(card.interval);
    }

    // Each interval should be larger than the previous
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    }
    // After 5 Good reviews, interval should be well over a month
    expect(intervals[intervals.length - 1]).toBeGreaterThan(30);
  });

  it('Hard ratings grow interval slowly', () => {
    let card = makeCard({ repetition: 1, interval: 1, easeFactor: 2.5 });

    // 10 Hard reviews
    const intervals: number[] = [];
    for (let i = 0; i < 10; i++) {
      card = sm2(card, 2);
      intervals.push(card.interval);
    }

    // Each grows by at least 1
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeGreaterThanOrEqual(intervals[i - 1] + 1);
    }

    // After 10 Hard reviews, should still be modest (much less than Good)
    const goodCard = makeCard({ repetition: 1, interval: 1, easeFactor: 2.5 });
    let goodResult = goodCard;
    for (let i = 0; i < 10; i++) {
      goodResult = sm2(goodResult, 4);
    }
    expect(card.interval).toBeLessThan(goodResult.interval);
  });
});

// ─── Edge cases ──────────────────────────────────────────────────

describe('sm2 — edge cases', () => {
  it('handles interval=1 with Hard (min +1 day guarantee)', () => {
    const card = makeCard({ repetition: 1, interval: 1, easeFactor: 1.3 });
    const result = sm2(card, 2);
    // 1 * 1.2 = 1.2 → rounds to 1, but min is interval + 1 = 2
    expect(result.interval).toBe(2);
  });

  it('handles very high ease factor', () => {
    const card = makeCard({ repetition: 2, interval: 10, easeFactor: 3.0 });
    const result = sm2(card, 4);
    expect(result.interval).toBe(30); // 10 * 3.0
    expect(result.easeFactor).toBeGreaterThan(2.5);
  });

  it('handles minimum ease factor (1.3) with Good rating', () => {
    const card = makeCard({ repetition: 1, interval: 5, easeFactor: 1.3 });
    const result = sm2(card, 4);
    // 5 * 1.3 = 6.5 → 7 (rounded), or at minimum 6
    expect(result.interval).toBeGreaterThanOrEqual(6);
  });

  it('Easy rating from learning skips ahead significantly', () => {
    const card = makeCard({ repetition: 0, interval: 0, easeFactor: 2.5 });
    const good = sm2(card, 4);
    const easy = sm2(card, 5);
    expect(easy.interval).toBeGreaterThan(good.interval);
    expect(easy.interval).toBe(5);
  });

  it('preserves sourceLanguage through reviews', () => {
    const card = makeCard({ sourceLanguage: 'ru' });
    const result = sm2(card, 4);
    expect(result.sourceLanguage).toBe('ru');
  });

  it('preserves addedAt through reviews', () => {
    const card = makeCard({ addedAt: '2024-01-01T00:00:00.000Z' });
    const result = sm2(card, 4);
    expect(result.addedAt).toBe('2024-01-01T00:00:00.000Z');
  });
});
