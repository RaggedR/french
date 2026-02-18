/**
 * Per-user API cost tracker (daily / weekly / monthly limits).
 *
 * In-memory Maps serve as primary store (fast synchronous reads for middleware).
 * A write-behind cache persists to Firestore with 5s debounce per user.
 * On startup, initUsageStore() hydrates Maps from Firestore.
 *
 * OpenAI limits:    $1/day, $5/week, $10/month
 * Translate limits: $0.50/day, $2.50/week, $5/month
 *
 * Cost estimates:
 *   Whisper:           $0.006 / minute of audio
 *   GPT-4o:            ~$0.025 per call (punctuation, lemmatization)
 *   GPT-4o-mini:       ~$0.002 per call (sentence extraction)
 *   TTS:               $15 / 1M characters
 *   Google Translate:   $20 / 1M characters
 */

import { getFirestore } from 'firebase-admin/firestore';
import * as Sentry from '@sentry/node';

const DAILY_LIMIT = 1.00;    // $1/day per user
const WEEKLY_LIMIT = 5.00;   // $5/week per user
const MONTHLY_LIMIT = 10.00; // $10/month per user

const TRANSLATE_DAILY_LIMIT = 0.50;
const TRANSLATE_WEEKLY_LIMIT = 2.50;
const TRANSLATE_MONTHLY_LIMIT = 5.00;

// OpenAI: uid -> { cost, date/week/month }
const dailyCosts = new Map();
const weeklyCosts = new Map();
const monthlyCosts = new Map();

// Google Translate: uid -> { cost, date/week/month }
const translateDailyCosts = new Map();
const translateWeeklyCosts = new Map();
const translateMonthlyCosts = new Map();

// --- Firestore persistence (write-behind cache) ----------------------------

let db = null;

/** Lazy-init Firestore so tests can run without Firebase credentials. */
function getDb() {
  if (!db) {
    try { db = getFirestore(); } catch { /* tests / local without credentials */ }
  }
  return db;
}

const PERSIST_DEBOUNCE_MS = 5000;
const persistTimers = new Map();

/**
 * Debounced write of a user's cost data to Firestore.
 * Multiple trackCost calls within 5s produce a single write.
 */
function persistUsage(uid) {
  if (persistTimers.has(uid)) clearTimeout(persistTimers.get(uid));
  persistTimers.set(uid, setTimeout(async () => {
    persistTimers.delete(uid);
    const firestore = getDb();
    if (!firestore) return;
    try {
      await firestore.collection('usage').doc(uid).set({
        openai: {
          daily: dailyCosts.get(uid) || null,
          weekly: weeklyCosts.get(uid) || null,
          monthly: monthlyCosts.get(uid) || null,
        },
        translate: {
          daily: translateDailyCosts.get(uid) || null,
          weekly: translateWeeklyCosts.get(uid) || null,
          monthly: translateMonthlyCosts.get(uid) || null,
        },
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[Usage] Persist failed for ${uid}:`, err.message);
      Sentry.captureException(err, { tags: { operation: 'usage_persist', uid }, level: 'warning' });
    }
  }, PERSIST_DEBOUNCE_MS));
}

/**
 * Hydrate in-memory Maps from Firestore on startup.
 * Skips expired period data (stale days/weeks/months).
 */
export async function initUsageStore() {
  const firestore = getDb();
  if (!firestore) {
    console.log('[Usage] No Firestore, in-memory only');
    return;
  }
  try {
    // Only load docs updated this month (longest tracked period) to avoid full table scan
    const monthStart = getMonth() + '-01T00:00:00.000Z';
    const snapshot = await firestore.collection('usage')
      .where('updatedAt', '>=', monthStart)
      .get();
    let loaded = 0;
    const today = getToday();
    const week = getWeek();
    const month = getMonth();

    for (const doc of snapshot.docs) {
      const uid = doc.id;
      const data = doc.data();
      if (data.openai?.daily?.date === today) dailyCosts.set(uid, data.openai.daily);
      if (data.openai?.weekly?.week === week) weeklyCosts.set(uid, data.openai.weekly);
      if (data.openai?.monthly?.month === month) monthlyCosts.set(uid, data.openai.monthly);
      if (data.translate?.daily?.date === today) translateDailyCosts.set(uid, data.translate.daily);
      if (data.translate?.weekly?.week === week) translateWeeklyCosts.set(uid, data.translate.weekly);
      if (data.translate?.monthly?.month === month) translateMonthlyCosts.set(uid, data.translate.monthly);
      loaded++;
    }
    console.log(`[Usage] Loaded cost data for ${loaded} users`);
  } catch (err) {
    console.error('[Usage] Failed to load from Firestore:', err.message);
    Sentry.captureException(err, { tags: { operation: 'usage_init' }, level: 'error' });
  }
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

/** ISO week key, e.g. "2026-W08". Resets every Monday. */
function getWeek() {
  const d = new Date();
  const thu = new Date(d);
  thu.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const jan4 = new Date(thu.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((thu - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${thu.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getMonth() {
  return new Date().toISOString().slice(0, 7);
}

// --- OpenAI -----------------------------------------------------------------

export function getUserCost(uid) {
  const entry = dailyCosts.get(uid);
  if (!entry || entry.date !== getToday()) return 0;
  return entry.cost;
}

export function getUserWeeklyCost(uid) {
  const entry = weeklyCosts.get(uid);
  if (!entry || entry.week !== getWeek()) return 0;
  return entry.cost;
}

export function getUserMonthlyCost(uid) {
  const entry = monthlyCosts.get(uid);
  if (!entry || entry.month !== getMonth()) return 0;
  return entry.cost;
}

export function trackCost(uid, amount) {
  const today = getToday();
  const daily = dailyCosts.get(uid);
  if (!daily || daily.date !== today) {
    dailyCosts.set(uid, { cost: amount, date: today });
  } else {
    daily.cost += amount;
  }

  const week = getWeek();
  const weekly = weeklyCosts.get(uid);
  if (!weekly || weekly.week !== week) {
    weeklyCosts.set(uid, { cost: amount, week });
  } else {
    weekly.cost += amount;
  }

  const month = getMonth();
  const monthly = monthlyCosts.get(uid);
  if (!monthly || monthly.month !== month) {
    monthlyCosts.set(uid, { cost: amount, month });
  } else {
    monthly.cost += amount;
  }

  persistUsage(uid);
}

export function getRemainingBudget(uid) {
  const d = DAILY_LIMIT - getUserCost(uid);
  const w = WEEKLY_LIMIT - getUserWeeklyCost(uid);
  const m = MONTHLY_LIMIT - getUserMonthlyCost(uid);
  return Math.max(0, Math.min(d, w, m));
}

export function requireBudget(req, res, next) {
  if (getUserMonthlyCost(req.uid) >= MONTHLY_LIMIT) {
    return res.status(429).json({
      error: 'Monthly OpenAI limit reached ($10/month). Please try again next month.',
    });
  }
  if (getUserWeeklyCost(req.uid) >= WEEKLY_LIMIT) {
    return res.status(429).json({
      error: 'Weekly OpenAI limit reached ($5/week). Please try again next week.',
    });
  }
  if (getUserCost(req.uid) >= DAILY_LIMIT) {
    return res.status(429).json({
      error: 'Daily OpenAI limit reached ($1/day). Please try again tomorrow.',
    });
  }
  next();
}

// --- Google Translate -------------------------------------------------------

export function trackTranslateCost(uid, amount) {
  const today = getToday();
  const daily = translateDailyCosts.get(uid);
  if (!daily || daily.date !== today) {
    translateDailyCosts.set(uid, { cost: amount, date: today });
  } else {
    daily.cost += amount;
  }

  const week = getWeek();
  const weekly = translateWeeklyCosts.get(uid);
  if (!weekly || weekly.week !== week) {
    translateWeeklyCosts.set(uid, { cost: amount, week });
  } else {
    weekly.cost += amount;
  }

  const month = getMonth();
  const monthly = translateMonthlyCosts.get(uid);
  if (!monthly || monthly.month !== month) {
    translateMonthlyCosts.set(uid, { cost: amount, month });
  } else {
    monthly.cost += amount;
  }

  persistUsage(uid);
}

export function requireTranslateBudget(req, res, next) {
  const monthEntry = translateMonthlyCosts.get(req.uid);
  const monthlyCost = (monthEntry && monthEntry.month === getMonth()) ? monthEntry.cost : 0;
  if (monthlyCost >= TRANSLATE_MONTHLY_LIMIT) {
    return res.status(429).json({
      error: 'Monthly translation limit reached ($5/month). Please try again next month.',
    });
  }

  const weekEntry = translateWeeklyCosts.get(req.uid);
  const weeklyCost = (weekEntry && weekEntry.week === getWeek()) ? weekEntry.cost : 0;
  if (weeklyCost >= TRANSLATE_WEEKLY_LIMIT) {
    return res.status(429).json({
      error: 'Weekly translation limit reached ($2.50/week). Please try again next week.',
    });
  }

  const dayEntry = translateDailyCosts.get(req.uid);
  const dailyCost = (dayEntry && dayEntry.date === getToday()) ? dayEntry.cost : 0;
  if (dailyCost >= TRANSLATE_DAILY_LIMIT) {
    return res.status(429).json({
      error: 'Daily translation limit reached ($0.50/day). Please try again tomorrow.',
    });
  }

  next();
}

// --- Cost estimation helpers ------------------------------------------------

export const costs = {
  whisper: (durationSec) => (durationSec / 60) * 0.006,
  gpt4o: () => 0.025,
  gpt4oMini: () => 0.002,
  tts: (charCount) => (charCount / 1_000_000) * 15,
  translate: (charCount) => (charCount / 1_000_000) * 20,
};
