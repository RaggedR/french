import type { Page } from '@playwright/test';
import {
  TEST_SESSION_ID,
  MOCK_TRANSCRIPT,
  MOCK_CHUNKS,
  MOCK_TRANSLATION,
  MOCK_SENTENCE,
} from './mock-data';

/**
 * Set up mock routes for all API endpoints.
 * Intercepts browser network requests so no real backend is needed.
 *
 * Options:
 * - chunks: override the chunks returned by /api/analyze (default: MOCK_CHUNKS)
 * - cached: if true, /api/analyze returns status='cached' with ready chunks (skips SSE)
 */
export async function setupMockRoutes(page: Page, options: {
  chunks?: typeof MOCK_CHUNKS;
  cached?: boolean;
} = {}) {
  const chunks = options.chunks ?? MOCK_CHUNKS;
  const cached = options.cached ?? true;

  // Block Firebase — auth fails gracefully, useDeck falls back to localStorage
  await page.route('**/*firebaseapp.com*/**', route => route.abort());
  await page.route('**/*googleapis.com/identitytoolkit/**', route => route.abort());
  await page.route('**/*firestore.googleapis.com/**', route => route.abort());

  // Block word frequency JSON to speed up tests (non-critical feature)
  await page.route('**/russian-word-frequencies.json', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );

  // POST /api/analyze → return session with chunks
  await page.route('**/api/analyze', async (route) => {
    const readyChunks = cached
      ? chunks.map(c => ({ ...c, status: 'ready', videoUrl: '/mock-video.mp4' }))
      : chunks;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: TEST_SESSION_ID,
        status: cached ? 'cached' : 'started',
        title: 'Test Video',
        totalDuration: 180,
        chunks: readyChunks,
        hasMoreChunks: false,
      }),
    });
  });

  // GET /api/session/:sessionId → session data
  await page.route('**/api/session/*/chunk/*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        videoUrl: '/mock-video.mp4',
        transcript: MOCK_TRANSCRIPT,
        title: 'Test Video — Part 1',
      }),
    });
  });

  // GET /api/session/:sessionId → session status
  await page.route('**/api/session/*', async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
      return;
    }

    const readyChunks = chunks.map(c => ({ ...c, status: 'ready', videoUrl: '/mock-video.mp4' }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ready',
        title: 'Test Video',
        contentType: 'video',
        totalDuration: 180,
        chunks: readyChunks,
        hasMoreChunks: false,
      }),
    });
  });

  // POST /api/download-chunk → chunk with video + transcript
  await page.route('**/api/download-chunk', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        videoUrl: '/mock-video.mp4',
        transcript: MOCK_TRANSCRIPT,
        title: 'Test Video — Part 1',
      }),
    });
  });

  // POST /api/translate → translation + dictionary
  await page.route('**/api/translate', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        word: body?.word || MOCK_TRANSLATION.word,
        translation: MOCK_TRANSLATION.translation,
        sourceLanguage: 'ru',
        dictionary: MOCK_TRANSLATION.dictionary,
      }),
    });
  });

  // POST /api/enrich-deck → batch dictionary lookup (return empty for E2E)
  await page.route('**/api/enrich-deck', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: {} }),
    });
  });

  // POST /api/generate-examples → GPT example sentences (return empty for E2E)
  await page.route('**/api/generate-examples', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ examples: {} }),
    });
  });

  // POST /api/extract-sentence → sentence + translation
  await page.route('**/api/extract-sentence', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SENTENCE),
    });
  });

  // GET /api/usage → mock combined API usage data
  await page.route('**/api/usage', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        daily: { used: 0.25, limit: 0.50 },    // Combined: 0.20 (OpenAI) + 0.05 (Translate)
        weekly: { used: 0.80, limit: 2.50 },   // Combined: 0.60 + 0.20
        monthly: { used: 2.25, limit: 5.00 },  // Combined: 1.75 + 0.50
      }),
    });
  });

  // DELETE /api/account → success
  await page.route('**/api/account', async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    }
  });

  // GET /api/subscription → trialing with no payment needed (default)
  await page.route('**/api/subscription', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'trialing',
        trialEnd: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
        trialDaysRemaining: 25,
        currentPeriodEnd: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        needsPayment: false,
        price: 5,
        priceDisplay: '$5/month',
      }),
    });
  });

  // POST /api/create-checkout-session → mock checkout URL
  await page.route('**/api/create-checkout-session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: 'https://checkout.stripe.com/test' }),
    });
  });

  // POST /api/create-portal-session → mock portal URL
  await page.route('**/api/create-portal-session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: 'https://billing.stripe.com/test' }),
    });
  });

  // GET /api/progress/:sessionId → SSE stream (immediate connected + complete)
  await page.route('**/api/progress/**', async (route) => {
    const sseBody = [
      `data: ${JSON.stringify({ type: 'connected', sessionId: TEST_SESSION_ID })}\n\n`,
      `data: ${JSON.stringify({
        type: 'complete',
        title: 'Test Video',
        totalDuration: 180,
        contentType: 'video',
        chunks: chunks.map(c => ({ ...c, status: 'ready', videoUrl: '/mock-video.mp4' })),
        hasMoreChunks: false,
      })}\n\n`,
    ].join('');

    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
      body: sseBody,
    });
  });

  // Serve a tiny valid MP4 for the video player (1-pixel transparent MP4)
  await page.route('**/mock-video.mp4', async (route) => {
    // Return a minimal valid MP4 (ftyp + moov atoms) to satisfy the video element
    // This is a base64 encoded ~300 byte MP4 with a single black frame
    const minimalMp4 = Buffer.from(
      'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAABxtZGF0AAAB' +
      'sGFuAQABtAAAABjm/+HkAAADPWmoYf//ow67JAoK+QAAC7gAAAAIAAAAAmQAAAABAAAA' +
      'AAAAAAAAAAAAAAAAAAAAAAAA//8AAAALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'base64'
    );
    await route.fulfill({
      status: 200,
      contentType: 'video/mp4',
      body: minimalMp4,
    });
  });
}

/**
 * Navigate to the player view by submitting a URL and auto-selecting a single chunk.
 * Requires setupMockRoutes() to have been called with cached: true and a single chunk.
 */
export async function navigateToPlayer(page: Page) {
  await page.goto('/');
  // Type in the video URL input and submit
  const urlInput = page.locator('input[placeholder*="ok.ru"]');
  await urlInput.fill('https://ok.ru/video/123456');
  await urlInput.press('Enter');
  // Wait for transcript words to appear (player view)
  await page.waitForSelector('.cursor-pointer', { timeout: 10000 });
}
