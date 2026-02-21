/**
 * Unit tests for server/stripe.js — Stripe subscription management.
 *
 * Tests cover:
 * - getSubscriptionStatus: lazy trial creation, caching, needsPayment logic
 * - requireSubscription: middleware that gates API access
 * - createCheckoutSession: Stripe Checkout integration
 * - createPortalSession: Stripe Customer Portal
 * - handleWebhook: processing Stripe webhook events
 * - cancelSubscription: cleanup for account deletion
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Set env vars before stripe.js loads (module-level init checks these)
process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.STRIPE_PRICE_ID = 'price_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_mock';

// ---------------------------------------------------------------------------
// Mock firebase-admin/firestore — must come before stripe.js import
// ---------------------------------------------------------------------------

const mockFirestoreDoc = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
};

const mockFirestoreCollection = {
  doc: vi.fn(() => mockFirestoreDoc),
};

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: (name) => {
      if (name === 'subscriptions') return mockFirestoreCollection;
      return { doc: vi.fn(() => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() })) };
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock stripe SDK
// ---------------------------------------------------------------------------

const mockStripeCheckoutCreate = vi.fn();
const mockStripeBillingPortalCreate = vi.fn();
const mockStripeSubscriptionCancel = vi.fn();

vi.mock('stripe', () => {
  // Stripe SDK is imported as `import Stripe from 'stripe'` and called with `new Stripe(key)`.
  // The mock must be a constructable class.
  function MockStripe() {
    return {
      checkout: {
        sessions: {
          create: mockStripeCheckoutCreate,
        },
      },
      billingPortal: {
        sessions: {
          create: mockStripeBillingPortalCreate,
        },
      },
      subscriptions: {
        cancel: mockStripeSubscriptionCancel,
      },
      webhooks: {
        constructEvent: vi.fn(),
      },
    };
  }
  return { default: MockStripe };
});

// ---------------------------------------------------------------------------
// Mock @sentry/node
// ---------------------------------------------------------------------------

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  getSubscriptionStatus,
  requireSubscription,
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
  cancelSubscription,
  clearSubscriptionCacheForTesting,
} from './stripe.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockReqResNext(uid = 'test-user') {
  const req = { uid };
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, wasNextCalled: () => nextCalled };
}

function createFirestoreDoc(data) {
  return { exists: true, data: () => data };
}

function notFoundDoc() {
  return { exists: false, data: () => undefined };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stripe.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSubscriptionCacheForTesting();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- getSubscriptionStatus ------------------------------------------------

  describe('getSubscriptionStatus', () => {
    it('lazy-creates a trial for a new user', async () => {
      mockFirestoreDoc.get.mockResolvedValue(notFoundDoc());

      const status = await getSubscriptionStatus('new-user');

      expect(status.status).toBe('trialing');
      expect(status.needsPayment).toBe(false);
      expect(status.trialDaysRemaining).toBeGreaterThan(0);
      expect(status.trialDaysRemaining).toBeLessThanOrEqual(30);
      expect(status.stripeCustomerId).toBeNull();
      expect(status.stripeSubscriptionId).toBeNull();

      // Should have written to Firestore
      expect(mockFirestoreDoc.set).toHaveBeenCalledTimes(1);
      const setCall = mockFirestoreDoc.set.mock.calls[0][0];
      expect(setCall.status).toBe('trialing');
      expect(setCall.trialStart).toBeTruthy();
      expect(setCall.trialEnd).toBeTruthy();
    });

    it('returns existing trial from Firestore', async () => {
      const trialStart = new Date();
      const trialEnd = new Date(trialStart.getTime() + 30 * 24 * 60 * 60 * 1000);

      mockFirestoreDoc.get.mockResolvedValue(createFirestoreDoc({
        status: 'trialing',
        trialStart: trialStart.toISOString(),
        trialEnd: trialEnd.toISOString(),
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        updatedAt: new Date().toISOString(),
      }));

      const status = await getSubscriptionStatus('existing-trial');

      expect(status.status).toBe('trialing');
      expect(status.needsPayment).toBe(false);
      expect(status.trialDaysRemaining).toBeGreaterThan(0);
      // Should NOT have written to Firestore (existing doc)
      expect(mockFirestoreDoc.set).not.toHaveBeenCalled();
    });

    it('caches result within 5-min TTL', async () => {
      const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      mockFirestoreDoc.get.mockResolvedValue(createFirestoreDoc({
        status: 'trialing',
        trialStart: new Date().toISOString(),
        trialEnd: trialEnd.toISOString(),
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        updatedAt: new Date().toISOString(),
      }));

      // First call — reads Firestore
      await getSubscriptionStatus('cached-user');
      expect(mockFirestoreDoc.get).toHaveBeenCalledTimes(1);

      // Second call — should use cache
      await getSubscriptionStatus('cached-user');
      expect(mockFirestoreDoc.get).toHaveBeenCalledTimes(1);
    });

    it('re-fetches after cache expires', async () => {
      vi.useFakeTimers();
      const now = new Date('2026-03-15T10:00:00Z');
      vi.setSystemTime(now);

      const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      mockFirestoreDoc.get.mockResolvedValue(createFirestoreDoc({
        status: 'trialing',
        trialStart: now.toISOString(),
        trialEnd: trialEnd.toISOString(),
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        updatedAt: now.toISOString(),
      }));

      await getSubscriptionStatus('expire-cache-user');
      expect(mockFirestoreDoc.get).toHaveBeenCalledTimes(1);

      // Advance past 5-minute TTL
      vi.setSystemTime(new Date(now.getTime() + 6 * 60 * 1000));

      await getSubscriptionStatus('expire-cache-user');
      expect(mockFirestoreDoc.get).toHaveBeenCalledTimes(2);
    });

    it('returns active for paid subscriber', async () => {
      mockFirestoreDoc.get.mockResolvedValue(createFirestoreDoc({
        status: 'active',
        trialStart: new Date().toISOString(),
        trialEnd: new Date().toISOString(),
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_456',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      const status = await getSubscriptionStatus('paid-user');

      expect(status.status).toBe('active');
      expect(status.needsPayment).toBe(false);
      expect(status.stripeCustomerId).toBe('cus_123');
      expect(status.stripeSubscriptionId).toBe('sub_456');
    });

    it('returns needsPayment=true for expired trial', async () => {
      const pastTrialEnd = new Date(Date.now() - 24 * 60 * 60 * 1000); // yesterday
      mockFirestoreDoc.get.mockResolvedValue(createFirestoreDoc({
        status: 'trialing',
        trialStart: new Date(pastTrialEnd.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        trialEnd: pastTrialEnd.toISOString(),
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        updatedAt: new Date().toISOString(),
      }));

      const status = await getSubscriptionStatus('expired-trial-user');

      expect(status.status).toBe('trialing');
      expect(status.needsPayment).toBe(true);
      expect(status.trialDaysRemaining).toBe(0);
    });

    it('returns needsPayment=false for past_due (Stripe retrying)', async () => {
      mockFirestoreDoc.get.mockResolvedValue(createFirestoreDoc({
        status: 'past_due',
        trialStart: new Date().toISOString(),
        trialEnd: new Date().toISOString(),
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_456',
        currentPeriodEnd: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      const status = await getSubscriptionStatus('past-due-user');

      expect(status.status).toBe('past_due');
      expect(status.needsPayment).toBe(false);
    });

    it('returns needsPayment=true for canceled', async () => {
      mockFirestoreDoc.get.mockResolvedValue(createFirestoreDoc({
        status: 'canceled',
        trialStart: new Date().toISOString(),
        trialEnd: new Date().toISOString(),
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_456',
        currentPeriodEnd: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      const status = await getSubscriptionStatus('canceled-user');

      expect(status.status).toBe('canceled');
      expect(status.needsPayment).toBe(true);
    });
  });

  // --- requireSubscription ---------------------------------------------------

  describe('requireSubscription', () => {
    it('calls next() for trialing user within trial period', async () => {
      const trialEnd = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
      mockFirestoreDoc.get.mockResolvedValue(createFirestoreDoc({
        status: 'trialing',
        trialStart: new Date().toISOString(),
        trialEnd: trialEnd.toISOString(),
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        updatedAt: new Date().toISOString(),
      }));

      const { req, res, next, wasNextCalled } = mockReqResNext('trial-user');
      await requireSubscription(req, res, next);

      expect(wasNextCalled()).toBe(true);
      expect(res.statusCode).toBeNull();
    });

    it('calls next() for active subscriber', async () => {
      mockFirestoreDoc.get.mockResolvedValue(createFirestoreDoc({
        status: 'active',
        trialStart: new Date().toISOString(),
        trialEnd: new Date().toISOString(),
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_456',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      const { req, res, next, wasNextCalled } = mockReqResNext('active-user');
      await requireSubscription(req, res, next);

      expect(wasNextCalled()).toBe(true);
    });

    it('calls next() for past_due (Stripe retrying)', async () => {
      mockFirestoreDoc.get.mockResolvedValue(createFirestoreDoc({
        status: 'past_due',
        trialStart: new Date().toISOString(),
        trialEnd: new Date().toISOString(),
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_456',
        currentPeriodEnd: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      const { req, res, next, wasNextCalled } = mockReqResNext('past-due-user');
      await requireSubscription(req, res, next);

      expect(wasNextCalled()).toBe(true);
    });

    it('returns 403 for expired trial', async () => {
      const pastTrialEnd = new Date(Date.now() - 24 * 60 * 60 * 1000);
      mockFirestoreDoc.get.mockResolvedValue(createFirestoreDoc({
        status: 'trialing',
        trialStart: new Date(pastTrialEnd.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        trialEnd: pastTrialEnd.toISOString(),
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        updatedAt: new Date().toISOString(),
      }));

      const { req, res, next, wasNextCalled } = mockReqResNext('expired-user');
      await requireSubscription(req, res, next);

      expect(wasNextCalled()).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/subscription required/i);
    });

    it('returns 403 for canceled subscription', async () => {
      mockFirestoreDoc.get.mockResolvedValue(createFirestoreDoc({
        status: 'canceled',
        trialStart: new Date().toISOString(),
        trialEnd: new Date().toISOString(),
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_456',
        currentPeriodEnd: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      const { req, res, next, wasNextCalled } = mockReqResNext('canceled-user');
      await requireSubscription(req, res, next);

      expect(wasNextCalled()).toBe(false);
      expect(res.statusCode).toBe(403);
    });
  });

  // --- createCheckoutSession -------------------------------------------------

  describe('createCheckoutSession', () => {
    it('creates a Stripe checkout session with customer_email for new user', async () => {
      // New user — no stripeCustomerId
      mockFirestoreDoc.get.mockResolvedValue(notFoundDoc());
      mockStripeCheckoutCreate.mockResolvedValue({
        url: 'https://checkout.stripe.com/session/cs_test_123',
      });

      const result = await createCheckoutSession('user-1', 'user@example.com', 'https://app.example.com');

      expect(result.url).toBe('https://checkout.stripe.com/session/cs_test_123');
      expect(mockStripeCheckoutCreate).toHaveBeenCalledTimes(1);

      const args = mockStripeCheckoutCreate.mock.calls[0][0];
      expect(args.mode).toBe('subscription');
      expect(args.client_reference_id).toBe('user-1');
      expect(args.customer_email).toBe('user@example.com');
      expect(args.customer).toBeUndefined();
      expect(args.subscription_data.metadata.firebaseUid).toBe('user-1');
      expect(args.success_url).toContain('https://app.example.com');
    });

    it('reuses existing Stripe customer on resubscribe', async () => {
      // Existing user with stripeCustomerId (e.g., canceled and resubscribing)
      mockFirestoreDoc.get.mockResolvedValue(createFirestoreDoc({
        status: 'canceled',
        trialStart: new Date().toISOString(),
        trialEnd: new Date().toISOString(),
        stripeCustomerId: 'cus_existing_123',
        stripeSubscriptionId: 'sub_old_456',
        currentPeriodEnd: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      mockStripeCheckoutCreate.mockResolvedValue({
        url: 'https://checkout.stripe.com/session/cs_test_reuse',
      });

      const result = await createCheckoutSession('user-resub', 'user@example.com', 'https://app.example.com');

      expect(result.url).toBe('https://checkout.stripe.com/session/cs_test_reuse');
      const args = mockStripeCheckoutCreate.mock.calls[0][0];
      expect(args.customer).toBe('cus_existing_123');
      expect(args.customer_email).toBeUndefined();
    });
  });

  // --- createPortalSession ---------------------------------------------------

  describe('createPortalSession', () => {
    it('creates a Stripe portal session with correct return URL', async () => {
      mockStripeBillingPortalCreate.mockResolvedValue({
        url: 'https://billing.stripe.com/session/bps_test_456',
      });

      const result = await createPortalSession('cus_123', 'https://app.example.com');

      expect(result.url).toBe('https://billing.stripe.com/session/bps_test_456');
      expect(mockStripeBillingPortalCreate).toHaveBeenCalledTimes(1);
      const args = mockStripeBillingPortalCreate.mock.calls[0][0];
      expect(args.customer).toBe('cus_123');
      expect(args.return_url).toBe('https://app.example.com');
    });
  });

  // --- handleWebhook ---------------------------------------------------------

  describe('handleWebhook', () => {
    it('handles checkout.session.completed — sets status to active', async () => {
      // Pre-populate cache so we can verify invalidation
      const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      mockFirestoreDoc.get.mockResolvedValue(createFirestoreDoc({
        status: 'trialing',
        trialStart: new Date().toISOString(),
        trialEnd: trialEnd.toISOString(),
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        updatedAt: new Date().toISOString(),
      }));
      await getSubscriptionStatus('checkout-user');

      await handleWebhook({
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: 'checkout-user',
            customer: 'cus_new_123',
            subscription: 'sub_new_456',
          },
        },
      });

      expect(mockFirestoreDoc.set).toHaveBeenCalled();
      const setCall = mockFirestoreDoc.set.mock.calls[0][0];
      expect(setCall.status).toBe('active');
      expect(setCall.stripeCustomerId).toBe('cus_new_123');
      expect(setCall.stripeSubscriptionId).toBe('sub_new_456');
    });

    it('handles customer.subscription.updated — updates status', async () => {
      await handleWebhook({
        type: 'customer.subscription.updated',
        data: {
          object: {
            metadata: { firebaseUid: 'sub-updated-user' },
            status: 'active',
            customer: 'cus_123',
            id: 'sub_456',
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
          },
        },
      });

      expect(mockFirestoreDoc.set).toHaveBeenCalled();
      const setCall = mockFirestoreDoc.set.mock.calls[0][0];
      expect(setCall.status).toBe('active');
      expect(setCall.stripeCustomerId).toBe('cus_123');
    });

    it('handles customer.subscription.deleted — sets status to canceled', async () => {
      await handleWebhook({
        type: 'customer.subscription.deleted',
        data: {
          object: {
            metadata: { firebaseUid: 'deleted-sub-user' },
            status: 'canceled',
            customer: 'cus_123',
            id: 'sub_456',
            current_period_end: Math.floor(Date.now() / 1000),
          },
        },
      });

      expect(mockFirestoreDoc.set).toHaveBeenCalled();
      const setCall = mockFirestoreDoc.set.mock.calls[0][0];
      expect(setCall.status).toBe('canceled');
    });

    it('handles invoice.payment_failed — sets status to past_due', async () => {
      await handleWebhook({
        type: 'invoice.payment_failed',
        data: {
          object: {
            subscription_details: { metadata: { firebaseUid: 'payment-failed-user' } },
            customer: 'cus_123',
            subscription: 'sub_456',
          },
        },
      });

      expect(mockFirestoreDoc.set).toHaveBeenCalled();
      const setCall = mockFirestoreDoc.set.mock.calls[0][0];
      expect(setCall.status).toBe('past_due');
    });

    it('invalidates cache on webhook update', async () => {
      // First, cache a subscription status
      mockFirestoreDoc.get.mockResolvedValue(createFirestoreDoc({
        status: 'trialing',
        trialStart: new Date().toISOString(),
        trialEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        updatedAt: new Date().toISOString(),
      }));
      await getSubscriptionStatus('cache-invalidate-user');
      expect(mockFirestoreDoc.get).toHaveBeenCalledTimes(1);

      // Webhook fires
      await handleWebhook({
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: 'cache-invalidate-user',
            customer: 'cus_999',
            subscription: 'sub_999',
          },
        },
      });

      // Next getSubscriptionStatus should re-fetch from Firestore (cache invalidated)
      mockFirestoreDoc.get.mockResolvedValue(createFirestoreDoc({
        status: 'active',
        trialStart: new Date().toISOString(),
        trialEnd: new Date().toISOString(),
        stripeCustomerId: 'cus_999',
        stripeSubscriptionId: 'sub_999',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      const status = await getSubscriptionStatus('cache-invalidate-user');
      expect(mockFirestoreDoc.get).toHaveBeenCalledTimes(2);
      expect(status.status).toBe('active');
    });

    it('ignores unknown event types without error', async () => {
      await expect(handleWebhook({
        type: 'some.unknown.event',
        data: { object: {} },
      })).resolves.toBeUndefined();
    });
  });

  // --- cancelSubscription ----------------------------------------------------

  describe('cancelSubscription', () => {
    it('calls Stripe SDK to cancel', async () => {
      mockStripeSubscriptionCancel.mockResolvedValue({ id: 'sub_123', status: 'canceled' });

      await cancelSubscription('sub_123');

      expect(mockStripeSubscriptionCancel).toHaveBeenCalledWith('sub_123');
    });
  });
});
