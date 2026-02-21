/**
 * Per-user API cost tracker (daily / weekly / monthly limits).
 *
 * In-memory Maps serve as primary store (fast synchronous reads for middleware).
 * A write-behind cache persists to Firestore with 5s debounce per user.
 * On startup, initUsageStore() hydrates Maps from Firestore.
 *
 * Combined API limits: $0.50/day, $2.50/week, $5/month (OpenAI + Google Translate)
 *
 * Cost estimates:
 *   Whisper:           $0.006 / minute of audio
 *   GPT-4o:            ~$0.025 per call (punctuation, lemmatization)
 *   GPT-4o-mini:       ~$0.002 per call (sentence extraction)
 *   TTS:               $15 / 1M characters
 *   Google Translate:   $20 / 1M characters
 *
 * Test utilities:
 *   clearAllCostsForTesting() - Clears all cost Maps (test-only, requires VITEST env)
 */

import { getFirestore } from 'firebase-admin/firestore';
import * as Sentry from '@sentry/node';

export const DAILY_LIMIT = 0.50;    // $0.50/day per user
export const WEEKLY_LIMIT = 2.50;   // $2.50/week per user
export const MONTHLY_LIMIT = 5.00;  // $5/month per user

// Combined API costs: uid -> { cost, date/week/month }
const dailyCosts = new Map();
const weeklyCosts = new Map();
const monthlyCosts = new Map();

// Test-only helper to clear all Maps for test isolation
export function clearAllCostsForTesting() {
  if (process.env.VITEST) {
    dailyCosts.clear();
    weeklyCosts.clear();
    monthlyCosts.clear();
  } else {
    throw new Error('clearAllCostsForTesting() can only be called during tests');
  }
}

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
async function writeUsageToFirestore(uid) {
  const firestore = getDb();
  if (!firestore) return;
  await firestore.collection('usage').doc(uid).set({
    daily: dailyCosts.get(uid) || null,
    weekly: weeklyCosts.get(uid) || null,
    monthly: monthlyCosts.get(uid) || null,
    updatedAt: new Date().toISOString(),
  });
}

function persistUsage(uid) {
  if (persistTimers.has(uid)) clearTimeout(persistTimers.get(uid));
  persistTimers.set(uid, setTimeout(async () => {
    persistTimers.delete(uid);
    try {
      await writeUsageToFirestore(uid);
    } catch (err) {
      console.error(`[Usage] Persist failed for ${uid}:`, err.message);
      Sentry.captureException(err, { tags: { operation: 'usage_persist', uid }, level: 'warning' });
    }
  }, PERSIST_DEBOUNCE_MS));
}

/**
 * Flush all pending debounced writes immediately.
 * Call this on shutdown to avoid losing in-flight cost data.
 */
export async function flushAllUsage() {
  // Cancel all pending timers
  for (const [uid, timer] of persistTimers) {
    clearTimeout(timer);
    persistTimers.delete(uid);
  }
  // Collect all UIDs that have data
  const uids = new Set([
    ...dailyCosts.keys(), ...weeklyCosts.keys(), ...monthlyCosts.keys(),
  ]);
  if (uids.size === 0) return;
  console.log(`[Usage] Flushing data for ${uids.size} users...`);
  const writes = [...uids].map(uid =>
    writeUsageToFirestore(uid).catch(err =>
      console.error(`[Usage] Flush failed for ${uid}:`, err.message)
    )
  );
  await Promise.all(writes);
  console.log(`[Usage] Flush complete`);
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
      // New schema: flat structure
      if (data.daily?.date === today) dailyCosts.set(uid, data.daily);
      if (data.weekly?.week === week) weeklyCosts.set(uid, data.weekly);
      if (data.monthly?.month === month) monthlyCosts.set(uid, data.monthly);
      // Legacy schema: migrate openai+translate costs into single budget
      if (data.openai || data.translate) {
        const openaiDaily = (data.openai?.daily?.date === today) ? data.openai.daily.cost : 0;
        const translateDaily = (data.translate?.daily?.date === today) ? data.translate.daily.cost : 0;
        if (openaiDaily + translateDaily > 0) {
          dailyCosts.set(uid, { cost: openaiDaily + translateDaily, date: today });
        }
        const openaiWeekly = (data.openai?.weekly?.week === week) ? data.openai.weekly.cost : 0;
        const translateWeekly = (data.translate?.weekly?.week === week) ? data.translate.weekly.cost : 0;
        if (openaiWeekly + translateWeekly > 0) {
          weeklyCosts.set(uid, { cost: openaiWeekly + translateWeekly, week });
        }
        const openaiMonthly = (data.openai?.monthly?.month === month) ? data.openai.monthly.cost : 0;
        const translateMonthly = (data.translate?.monthly?.month === month) ? data.translate.monthly.cost : 0;
        if (openaiMonthly + translateMonthly > 0) {
          monthlyCosts.set(uid, { cost: openaiMonthly + translateMonthly, month });
        }
      }
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
      error: `Monthly API limit reached ($${MONTHLY_LIMIT.toFixed(2)}/month). Please try again next month.`,
    });
  }
  if (getUserWeeklyCost(req.uid) >= WEEKLY_LIMIT) {
    return res.status(429).json({
      error: `Weekly API limit reached ($${WEEKLY_LIMIT.toFixed(2)}/week). Please try again next week.`,
    });
  }
  if (getUserCost(req.uid) >= DAILY_LIMIT) {
    return res.status(429).json({
      error: `Daily API limit reached ($${DAILY_LIMIT.toFixed(2)}/day). Please try again tomorrow.`,
    });
  }
  next();
}

// --- Backwards compatibility alias -----------------------------------------

/** Alias for trackCost — Google Translate now shares the unified API budget. */
export function trackTranslateCost(uid, amount) {
  trackCost(uid, amount);
}

// --- Cost estimation helpers ------------------------------------------------

export const costs = {
  whisper: (durationSec) => (durationSec / 60) * 0.006,
  gpt4o: () => 0.025,
  gpt4oMini: () => 0.002,
  tts: (charCount) => (charCount / 1_000_000) * 15,
  translate: (charCount) => (charCount / 1_000_000) * 20,
};
