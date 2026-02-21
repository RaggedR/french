/**
 * Stripe subscription management — checkout, webhooks, status checks.
 *
 * Firestore collection: subscriptions/{userId}
 * In-memory cache with 5-min TTL avoids Firestore reads on every request.
 *
 * Trial: 30 days from first API request (lazy-created).
 * After trial: must subscribe ($5/month) via Stripe Checkout.
 * Webhooks sync Stripe state → Firestore → in-memory cache.
 */

import Stripe from 'stripe';
import { getFirestore } from 'firebase-admin/firestore';
import * as Sentry from '@sentry/node';

// ---------------------------------------------------------------------------
// Stripe SDK init (no-op if keys missing — allows tests to run)
// ---------------------------------------------------------------------------

let stripe = null;

/** Lazy-init Stripe SDK so env vars can be set after module load (tests). */
function getStripe() {
  if (!stripe && process.env.STRIPE_SECRET_KEY) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

// ---------------------------------------------------------------------------
// Firestore helper (lazy init, same pattern as usage.js)
// ---------------------------------------------------------------------------

let db = null;

function getDb() {
  if (!db) {
    try { db = getFirestore(); } catch { /* tests / local without credentials */ }
  }
  return db;
}

// ---------------------------------------------------------------------------
// In-memory cache: uid → { data: SubscriptionInfo, fetchedAt: number }
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const statusCache = new Map();

// In-memory fallback store for local dev when Firestore is unavailable.
// Mirrors Firestore subscriptions/{uid} docs so webhooks can update status.
const localStore = new Map();

export function clearSubscriptionCacheForTesting() {
  if (process.env.VITEST) {
    statusCache.clear();
    localStore.clear();
    stripe = null; // Force re-init with current env vars on next call
  } else {
    throw new Error('clearSubscriptionCacheForTesting() can only be called during tests');
  }
}

// ---------------------------------------------------------------------------
// Subscription price — single source of truth for display text
// ---------------------------------------------------------------------------

export const SUBSCRIPTION_PRICE = 5;           // dollars per month
export const SUBSCRIPTION_PRICE_DISPLAY = `$${SUBSCRIPTION_PRICE}/month`;

// ---------------------------------------------------------------------------
// getSubscriptionStatus — returns SubscriptionInfo for a user
// ---------------------------------------------------------------------------

const TRIAL_DAYS = 30;

/**
 * @param {string} uid - Firebase user ID
 * @returns {Promise<SubscriptionInfo>}
 *
 * SubscriptionInfo: {
 *   status: 'trialing' | 'active' | 'past_due' | 'canceled',
 *   trialEnd: string (ISO),
 *   trialDaysRemaining: number,
 *   currentPeriodEnd: string | null,
 *   stripeCustomerId: string | null,
 *   stripeSubscriptionId: string | null,
 *   needsPayment: boolean,
 * }
 */
export async function getSubscriptionStatus(uid) {
  // Check cache first
  const cached = statusCache.get(uid);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.data;
  }

  const firestore = getDb();
  let data;

  if (firestore) {
    try {
      const docRef = firestore.collection('subscriptions').doc(uid);
      const doc = await docRef.get();

      if (!doc.exists) {
        // Lazy-create trial
        const now = new Date();
        data = {
          status: 'trialing',
          trialStart: now.toISOString(),
          trialEnd: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          currentPeriodEnd: null,
          updatedAt: now.toISOString(),
        };
        await docRef.set(data);
      } else {
        data = doc.data();
      }
    } catch (err) {
      console.error('[Stripe] Firestore error, using in-memory fallback:', err.message);
    }
  }

  // Fallback: check in-memory local store (populated by webhooks when Firestore is down)
  if (!data) {
    data = localStore.get(uid);
  }

  // Last resort: create a new trial in local store
  if (!data) {
    const now = new Date();
    data = {
      status: 'trialing',
      trialStart: now.toISOString(),
      trialEnd: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      updatedAt: now.toISOString(),
    };
    localStore.set(uid, data);
  }

  const info = buildSubscriptionInfo(data);

  // Cache it
  statusCache.set(uid, { data: info, fetchedAt: Date.now() });

  return info;
}

function buildSubscriptionInfo(data) {
  const trialEnd = data.trialEnd ? new Date(data.trialEnd) : null;
  const now = new Date();
  const trialDaysRemaining = trialEnd
    ? Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
    : 0;

  let needsPayment = false;
  if (data.status === 'trialing') {
    needsPayment = trialEnd ? trialEnd <= now : true;
  } else if (data.status === 'canceled') {
    needsPayment = true;
  }
  // active and past_due → needsPayment = false

  return {
    status: data.status,
    trialEnd: data.trialEnd || null,
    trialDaysRemaining,
    currentPeriodEnd: data.currentPeriodEnd || null,
    stripeCustomerId: data.stripeCustomerId || null,
    stripeSubscriptionId: data.stripeSubscriptionId || null,
    needsPayment,
    price: SUBSCRIPTION_PRICE,
    priceDisplay: SUBSCRIPTION_PRICE_DISPLAY,
  };
}

// ---------------------------------------------------------------------------
// requireSubscription — Express middleware
// ---------------------------------------------------------------------------

export async function requireSubscription(req, res, next) {
  try {
    const status = await getSubscriptionStatus(req.uid);
    if (status.needsPayment) {
      return res.status(403).json({
        error: 'Subscription required. Your free trial has ended or your subscription was canceled.',
        subscriptionStatus: status.status,
      });
    }
    next();
  } catch (err) {
    console.error('[Stripe] requireSubscription error:', err.message);
    Sentry.captureException(err, { tags: { operation: 'requireSubscription', uid: req.uid } });
    // Fail open — don't block users if Firestore is down
    next();
  }
}

// ---------------------------------------------------------------------------
// createCheckoutSession — redirect user to Stripe Checkout
// ---------------------------------------------------------------------------

export async function createCheckoutSession(uid, email, requestOrigin) {
  const s = getStripe();
  if (!s) throw new Error('Stripe not configured');
  if (!process.env.STRIPE_PRICE_ID) throw new Error('STRIPE_PRICE_ID not configured');

  const baseUrl = requestOrigin || process.env.APP_URL || 'http://localhost:5173';

  // Reuse existing Stripe customer to avoid duplicates on resubscribe
  const subStatus = await getSubscriptionStatus(uid);
  const customerParam = subStatus.stripeCustomerId
    ? { customer: subStatus.stripeCustomerId }
    : { customer_email: email };

  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    client_reference_id: uid,
    ...customerParam,
    subscription_data: {
      metadata: { firebaseUid: uid },
    },
    success_url: `${baseUrl}?subscription=success`,
    cancel_url: `${baseUrl}?subscription=canceled`,
  });

  return { url: session.url };
}

// ---------------------------------------------------------------------------
// createPortalSession — redirect user to Stripe Customer Portal
// ---------------------------------------------------------------------------

export async function createPortalSession(stripeCustomerId, requestOrigin) {
  const s = getStripe();
  if (!s) throw new Error('Stripe not configured');

  const baseUrl = requestOrigin || process.env.APP_URL || 'http://localhost:5173';

  const session = await s.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: baseUrl,
  });

  return { url: session.url };
}

// ---------------------------------------------------------------------------
// handleWebhook — process Stripe webhook events
// ---------------------------------------------------------------------------

export async function handleWebhook(event) {
  // Helper: persist subscription data to Firestore or in-memory fallback
  async function persistSubscription(uid, data) {
    const firestore = getDb();
    let persisted = false;
    if (firestore) {
      try {
        await firestore.collection('subscriptions').doc(uid).set(data, { merge: true });
        persisted = true;
      } catch (err) {
        console.error('[Stripe] Firestore write failed, using in-memory:', err.message);
      }
    }
    if (!persisted) {
      // Merge into local store
      const existing = localStore.get(uid) || {};
      localStore.set(uid, { ...existing, ...data });
    }
    statusCache.delete(uid);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const uid = session.client_reference_id;
      if (!uid) {
        console.warn('[Stripe] checkout.session.completed without client_reference_id');
        return;
      }
      await persistSubscription(uid, {
        status: 'active',
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription,
        currentPeriodEnd: null, // Will be set by subscription.updated webhook
        updatedAt: new Date().toISOString(),
      });
      console.log(`[Stripe] Checkout completed for ${uid}`);
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const uid = subscription.metadata?.firebaseUid;
      if (!uid) {
        console.warn('[Stripe] subscription.updated without firebaseUid metadata');
        return;
      }
      await persistSubscription(uid, {
        status: subscription.status,
        stripeCustomerId: subscription.customer,
        stripeSubscriptionId: subscription.id,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      });
      console.log(`[Stripe] Subscription updated for ${uid}: ${subscription.status}`);
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const uid = subscription.metadata?.firebaseUid;
      if (!uid) {
        console.warn('[Stripe] subscription.deleted without firebaseUid metadata');
        return;
      }
      await persistSubscription(uid, {
        status: 'canceled',
        stripeCustomerId: subscription.customer,
        stripeSubscriptionId: subscription.id,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      });
      console.log(`[Stripe] Subscription deleted for ${uid}`);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const uid = invoice.subscription_details?.metadata?.firebaseUid;
      if (!uid) {
        console.warn('[Stripe] invoice.payment_failed without firebaseUid metadata');
        return;
      }
      await persistSubscription(uid, {
        status: 'past_due',
        stripeCustomerId: invoice.customer,
        stripeSubscriptionId: invoice.subscription,
        updatedAt: new Date().toISOString(),
      });
      console.log(`[Stripe] Payment failed for ${uid}`);
      break;
    }

    default:
      // Ignore unknown events
      break;
  }
}

// ---------------------------------------------------------------------------
// cancelSubscription — for account deletion cleanup
// ---------------------------------------------------------------------------

export async function cancelSubscription(subscriptionId) {
  const s = getStripe();
  if (!s) {
    console.log('[Stripe] No Stripe SDK, skipping cancel');
    return;
  }
  await s.subscriptions.cancel(subscriptionId);
}

// ---------------------------------------------------------------------------
// initSubscriptionStore — optional startup warm-up
// ---------------------------------------------------------------------------

export async function initSubscriptionStore() {
  // Currently a no-op — subscriptions are loaded on-demand per user.
  // Could pre-warm cache for recently active users in the future.
  console.log('[Stripe] Subscription store ready');
}

// ---------------------------------------------------------------------------
// Stripe webhook signature verification helper
// ---------------------------------------------------------------------------

export function constructWebhookEvent(rawBody, signature) {
  const s = getStripe();
  if (!s) throw new Error('Stripe not configured');
  if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  return s.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}
