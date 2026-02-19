import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// In-memory Firestore mock
const mockDocs = new Map();
const mockSet = vi.fn(async (data) => {});
const mockGet = vi.fn(async () => ({
  docs: [...mockDocs.entries()].map(([id, data]) => ({
    id,
    data: () => data,
  })),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: (name) => ({
      doc: (id) => ({
        set: async (data) => {
          mockDocs.set(id, data);
          return mockSet(data);
        },
      }),
      where: () => ({ get: mockGet }),
      get: mockGet,
    }),
  }),
}));

import {
  trackCost,
  trackTranslateCost,
  getUserCost,
  getUserWeeklyCost,
  getUserMonthlyCost,
  initUsageStore,
} from './usage.js';

describe('usage.js — Firestore persistence', () => {
  let uid;
  let testCounter = 0;

  beforeEach(() => {
    testCounter++;
    uid = `persist-test-${testCounter}-${Date.now()}`;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T10:00:00Z'));
    mockDocs.clear();
    mockSet.mockClear();
    mockGet.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('trackCost triggers debounced Firestore write after 5s', async () => {
    trackCost(uid, 0.10);

    // Write should not happen immediately
    expect(mockSet).not.toHaveBeenCalled();

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(5000);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockDocs.has(uid)).toBe(true);

    const saved = mockDocs.get(uid);
    expect(saved.daily.cost).toBeCloseTo(0.10);
    expect(saved.daily.date).toBe('2026-03-15');
    expect(saved.updatedAt).toBeDefined();
  });

  it('multiple trackCost calls debounce into a single write', async () => {
    trackCost(uid, 0.025);
    trackCost(uid, 0.025);
    trackCost(uid, 0.006);

    await vi.advanceTimersByTimeAsync(5000);

    // Only one Firestore write despite three trackCost calls
    expect(mockSet).toHaveBeenCalledTimes(1);

    const saved = mockDocs.get(uid);
    expect(saved.daily.cost).toBeCloseTo(0.056);
  });

  it('trackTranslateCost (alias) also triggers persistence', async () => {
    trackTranslateCost(uid, 0.05);

    await vi.advanceTimersByTimeAsync(5000);

    expect(mockSet).toHaveBeenCalledTimes(1);
    const saved = mockDocs.get(uid);
    expect(saved.daily.cost).toBeCloseTo(0.05);
    expect(saved.daily.date).toBe('2026-03-15');
  });

  it('initUsageStore loads current-period data from Firestore (new schema)', async () => {
    // Pre-populate Firestore mock with flat schema data for "today"
    mockDocs.set(uid, {
      daily: { cost: 0.70, date: '2026-03-15' },
      weekly: { cost: 3.00, week: '2026-W11' },
      monthly: { cost: 10.00, month: '2026-03' },
    });

    await initUsageStore();

    expect(getUserCost(uid)).toBeCloseTo(0.70);
    expect(getUserWeeklyCost(uid)).toBeCloseTo(3.00);
    expect(getUserMonthlyCost(uid)).toBeCloseTo(10.00);
  });

  it('initUsageStore migrates legacy schema (openai+translate)', async () => {
    // Pre-populate with old nested schema
    mockDocs.set(uid, {
      openai: {
        daily: { cost: 0.50, date: '2026-03-15' },
        weekly: { cost: 2.00, week: '2026-W11' },
        monthly: { cost: 7.00, month: '2026-03' },
      },
      translate: {
        daily: { cost: 0.20, date: '2026-03-15' },
        weekly: { cost: 1.00, week: '2026-W11' },
        monthly: { cost: 3.00, month: '2026-03' },
      },
    });

    await initUsageStore();

    // Should merge into combined budget
    expect(getUserCost(uid)).toBeCloseTo(0.70);        // 0.50 + 0.20
    expect(getUserWeeklyCost(uid)).toBeCloseTo(3.00);  // 2.00 + 1.00
    expect(getUserMonthlyCost(uid)).toBeCloseTo(10.00); // 7.00 + 3.00
  });

  it('initUsageStore skips expired period data', async () => {
    // Data from yesterday / last week / last month — should NOT load
    mockDocs.set(uid, {
      daily: { cost: 0.70, date: '2026-03-14' },         // yesterday
      weekly: { cost: 3.00, week: '2026-W10' },          // last week
      monthly: { cost: 10.00, month: '2026-02' },        // last month
    });

    await initUsageStore();

    // All should be 0 since the stored data is expired
    expect(getUserCost(uid)).toBe(0);
    expect(getUserWeeklyCost(uid)).toBe(0);
    expect(getUserMonthlyCost(uid)).toBe(0);
  });

  it('Firestore failure does not break in-memory tracking', async () => {
    // Make set() throw
    mockSet.mockRejectedValueOnce(new Error('Firestore unavailable'));

    trackCost(uid, 0.10);

    // In-memory tracking should still work
    expect(getUserCost(uid)).toBeCloseTo(0.10);

    // Debounced write fires and fails silently
    await vi.advanceTimersByTimeAsync(5000);

    // Data still in memory despite persistence failure
    expect(getUserCost(uid)).toBeCloseTo(0.10);
  });
});
