import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Re-import fresh module for each test group by using dynamic import
// But since usage.js uses module-level Maps, we need to reset between tests
// by importing and testing the exported functions directly.

import {
  trackCost,
  getUserCost,
  getUserWeeklyCost,
  getUserMonthlyCost,
  getRemainingBudget,
  requireBudget,
  trackTranslateCost,
  flushAllUsage,
  clearAllCostsForTesting,
  DAILY_LIMIT,
  WEEKLY_LIMIT,
  MONTHLY_LIMIT,
  costs,
} from './usage.js';

// Helper to create mock Express req/res/next
function mockReqResNext(uid = 'user-1') {
  const req = { uid };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, wasNextCalled: () => nextCalled };
}

describe('usage.js', () => {
  // Use unique UIDs per test to avoid cross-test pollution
  // (module-level Maps persist across tests within the same file)
  let uid;
  let testCounter = 0;

  beforeEach(() => {
    testCounter++;
    uid = `test-user-${testCounter}-${Date.now()}`;
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearAllCostsForTesting();
  });

  // --- Cost estimation helpers -----------------------------------------------

  describe('costs', () => {
    it('whisper: $0.006/min', () => {
      expect(costs.whisper(60)).toBeCloseTo(0.006);
      expect(costs.whisper(300)).toBeCloseTo(0.03); // 5 min
    });

    it('gpt4o: ~$0.025 per call', () => {
      expect(costs.gpt4o()).toBe(0.025);
    });

    it('gpt4oMini: ~$0.002 per call', () => {
      expect(costs.gpt4oMini()).toBe(0.002);
    });

    it('tts: $15/1M characters', () => {
      expect(costs.tts(1_000_000)).toBe(15);
      expect(costs.tts(3500)).toBeCloseTo(0.0525);
    });

    it('translate: $20/1M characters', () => {
      expect(costs.translate(1_000_000)).toBe(20);
      expect(costs.translate(10)).toBeCloseTo(0.0002);
    });
  });

  // --- Combined API cost tracking (OpenAI + Translate) -----------------------

  describe('trackCost / getUserCost', () => {
    it('tracks daily cost for a user', () => {
      expect(getUserCost(uid)).toBe(0);
      trackCost(uid, 0.10);
      expect(getUserCost(uid)).toBeCloseTo(0.10);
    });

    it('accumulates multiple costs', () => {
      trackCost(uid, 0.025);
      trackCost(uid, 0.025);
      trackCost(uid, 0.006);
      expect(getUserCost(uid)).toBeCloseTo(0.056);
    });

    it('tracks weekly cost', () => {
      trackCost(uid, 0.50);
      expect(getUserWeeklyCost(uid)).toBeCloseTo(0.50);
    });

    it('tracks monthly cost', () => {
      trackCost(uid, 0.75);
      expect(getUserMonthlyCost(uid)).toBeCloseTo(0.75);
    });

    it('resets daily cost on new day', () => {
      // Track cost "today"
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-15T10:00:00Z'));
      trackCost(uid, 0.50);
      expect(getUserCost(uid)).toBeCloseTo(0.50);

      // Advance to next day
      vi.setSystemTime(new Date('2026-03-16T10:00:00Z'));
      expect(getUserCost(uid)).toBe(0);
    });

    it('resets weekly cost on new ISO week', () => {
      vi.useFakeTimers();
      // Monday of week 11, 2026
      vi.setSystemTime(new Date('2026-03-09T10:00:00Z'));
      trackCost(uid, 3.00);
      expect(getUserWeeklyCost(uid)).toBeCloseTo(3.00);

      // Monday of week 12, 2026
      vi.setSystemTime(new Date('2026-03-16T10:00:00Z'));
      expect(getUserWeeklyCost(uid)).toBe(0);
    });

    it('resets monthly cost on new month', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-15T10:00:00Z'));
      trackCost(uid, 5.00);
      expect(getUserMonthlyCost(uid)).toBeCloseTo(5.00);

      // Next month
      vi.setSystemTime(new Date('2026-04-01T10:00:00Z'));
      expect(getUserMonthlyCost(uid)).toBe(0);
    });
  });

  // --- getRemainingBudget ----------------------------------------------------

  describe('getRemainingBudget', () => {
    it('returns full daily budget for new user', () => {
      expect(getRemainingBudget(uid)).toBe(1.00);
    });

    it('returns remaining after costs', () => {
      trackCost(uid, 0.30);
      expect(getRemainingBudget(uid)).toBeCloseTo(0.70);
    });

    it('returns 0 when daily limit exceeded', () => {
      trackCost(uid, 1.00);
      expect(getRemainingBudget(uid)).toBe(0);
    });

    it('is constrained by weekly limit', () => {
      // Spend $4.90 over multiple "days" within the same week
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-09T10:00:00Z')); // Monday
      trackCost(uid, 0.90);
      vi.setSystemTime(new Date('2026-03-10T10:00:00Z')); // Tuesday
      trackCost(uid, 0.90);
      vi.setSystemTime(new Date('2026-03-11T10:00:00Z')); // Wednesday
      trackCost(uid, 0.90);
      vi.setSystemTime(new Date('2026-03-12T10:00:00Z')); // Thursday
      trackCost(uid, 0.90);
      vi.setSystemTime(new Date('2026-03-13T10:00:00Z')); // Friday
      trackCost(uid, 0.90);
      // Weekly total: $4.50, daily today: $0.90
      // Daily remaining: 1.00 - 0.90 = 0.10
      // Weekly remaining: 5.00 - 4.50 = 0.50
      // Monthly remaining: 10.00 - 4.50 = 5.50
      // Min = 0.10
      expect(getRemainingBudget(uid)).toBeCloseTo(0.10);
    });
  });

  // --- requireBudget middleware -----------------------------------------------

  describe('requireBudget', () => {
    it('calls next() when under all limits', () => {
      const { req, res, next, wasNextCalled } = mockReqResNext(uid);
      requireBudget(req, res, next);
      expect(wasNextCalled()).toBe(true);
      expect(res.statusCode).toBeNull();
    });

    it('blocks at daily limit ($1)', () => {
      trackCost(uid, 1.00);
      const { req, res, next, wasNextCalled } = mockReqResNext(uid);
      requireBudget(req, res, next);
      expect(wasNextCalled()).toBe(false);
      expect(res.statusCode).toBe(429);
      expect(res.body.error).toContain('Daily');
    });

    it('blocks at weekly limit ($5)', () => {
      vi.useFakeTimers();
      // Spread across days to stay under daily, but exceed weekly
      vi.setSystemTime(new Date('2026-03-09T10:00:00Z'));
      trackCost(uid, 0.99);
      vi.setSystemTime(new Date('2026-03-10T10:00:00Z'));
      trackCost(uid, 0.99);
      vi.setSystemTime(new Date('2026-03-11T10:00:00Z'));
      trackCost(uid, 0.99);
      vi.setSystemTime(new Date('2026-03-12T10:00:00Z'));
      trackCost(uid, 0.99);
      vi.setSystemTime(new Date('2026-03-13T10:00:00Z'));
      trackCost(uid, 0.99);
      vi.setSystemTime(new Date('2026-03-14T10:00:00Z'));
      trackCost(uid, 0.10);
      // Weekly: $5.05, daily today: $0.10

      const { req, res, next, wasNextCalled } = mockReqResNext(uid);
      requireBudget(req, res, next);
      expect(wasNextCalled()).toBe(false);
      expect(res.statusCode).toBe(429);
      expect(res.body.error).toContain('Weekly');
    });

    it('blocks at monthly limit ($10)', () => {
      vi.useFakeTimers();
      // Spread across weeks to stay under weekly, but exceed monthly
      vi.setSystemTime(new Date('2026-03-02T10:00:00Z'));
      trackCost(uid, 0.90);
      vi.setSystemTime(new Date('2026-03-03T10:00:00Z'));
      trackCost(uid, 0.90);
      vi.setSystemTime(new Date('2026-03-04T10:00:00Z'));
      trackCost(uid, 0.90);
      vi.setSystemTime(new Date('2026-03-05T10:00:00Z'));
      trackCost(uid, 0.90);
      vi.setSystemTime(new Date('2026-03-06T10:00:00Z'));
      trackCost(uid, 0.40);
      // Week 10 total: $4.00

      vi.setSystemTime(new Date('2026-03-09T10:00:00Z'));
      trackCost(uid, 0.90);
      vi.setSystemTime(new Date('2026-03-10T10:00:00Z'));
      trackCost(uid, 0.90);
      vi.setSystemTime(new Date('2026-03-11T10:00:00Z'));
      trackCost(uid, 0.90);
      vi.setSystemTime(new Date('2026-03-12T10:00:00Z'));
      trackCost(uid, 0.90);
      vi.setSystemTime(new Date('2026-03-13T10:00:00Z'));
      trackCost(uid, 0.90);
      // Week 11 total: $4.50, monthly: $8.50

      vi.setSystemTime(new Date('2026-03-16T10:00:00Z'));
      trackCost(uid, 0.90);
      vi.setSystemTime(new Date('2026-03-17T10:00:00Z'));
      trackCost(uid, 0.90);
      // Week 12 total: $1.80, monthly: $10.20

      const { req, res, next, wasNextCalled } = mockReqResNext(uid);
      requireBudget(req, res, next);
      expect(wasNextCalled()).toBe(false);
      expect(res.statusCode).toBe(429);
      expect(res.body.error).toContain('Monthly');
    });
  });

  // --- trackTranslateCost (backwards compatibility alias) --------------------

  describe('trackTranslateCost', () => {
    it('is an alias for trackCost (merged budget)', () => {
      trackTranslateCost(uid, 0.10);
      expect(getUserCost(uid)).toBeCloseTo(0.10);
    });

    it('translation costs count toward combined API budget', () => {
      trackCost(uid, 0.40);         // OpenAI
      trackTranslateCost(uid, 0.15); // Translate
      expect(getUserCost(uid)).toBeCloseTo(0.55);
    });

    it('combined costs are checked by requireBudget', () => {
      trackCost(uid, 0.60);
      trackTranslateCost(uid, 0.45);
      // Total: $1.05, exceeds daily limit
      const { req, res, next, wasNextCalled } = mockReqResNext(uid);
      requireBudget(req, res, next);
      expect(wasNextCalled()).toBe(false);
      expect(res.statusCode).toBe(429);
    });
  });

  // --- Limit constants --------------------------------------------------------

  describe('exported limit constants', () => {
    it('exports combined API limits', () => {
      expect(DAILY_LIMIT).toBe(1.00);
      expect(WEEKLY_LIMIT).toBe(5.00);
      expect(MONTHLY_LIMIT).toBe(10.00);
    });
  });

  // --- flushAllUsage -----------------------------------------------------------

  describe('flushAllUsage', () => {
    it('is a function that resolves without error (no Firestore in test)', async () => {
      trackCost(uid, 0.10);
      trackTranslateCost(uid, 0.05);
      // Should not throw even without Firestore credentials
      await expect(flushAllUsage()).resolves.toBeUndefined();
    });
  });
});
