import { test, expect } from '@playwright/test';
import { TEST_SESSION_ID, MOCK_TRANSCRIPT } from '../fixtures/mock-data';

/**
 * Helper: set up mock routes for text mode (lib.ru) flow.
 * Text mode uses audio player (not video) and full-width transcript.
 */
async function setupTextModeRoutes(page: any, options: { chunks?: number; cached?: boolean } = {}) {
  const chunkCount = options.chunks ?? 1;
  const cached = options.cached ?? true;

  // Block Firebase
  await page.route('**/*firebaseapp.com*/**', (route: any) => route.abort());
  await page.route('**/*googleapis.com/identitytoolkit/**', (route: any) => route.abort());
  await page.route('**/*firestore.googleapis.com/**', (route: any) => route.abort());
  await page.route('**/russian-word-frequencies.json', (route: any) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );

  const textChunks = Array.from({ length: chunkCount }, (_, i) => ({
    id: `chunk-${i}`,
    index: i,
    startTime: i * 60,
    endTime: (i + 1) * 60,
    duration: 60,
    previewText: `Глава ${i + 1}. Это начало текста...`,
    wordCount: 100,
    status: cached ? 'ready' : 'pending',
    audioUrl: cached ? '/mock-audio.mp3' : null,
  }));

  // /api/analyze → text mode response
  await page.route('**/api/analyze', (route: any) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: TEST_SESSION_ID,
        status: cached ? 'cached' : 'started',
        title: 'Чехов — Чайка',
        totalDuration: chunkCount * 60,
        contentType: 'text',
        chunks: textChunks,
        hasMoreChunks: false,
      }),
    })
  );

  // Chunk data route (must be registered BEFORE session route — glob * is single-segment)
  await page.route('**/api/session/*/chunk/*', (route: any) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        audioUrl: '/mock-audio.mp3',
        transcript: MOCK_TRANSCRIPT,
        title: 'Чехов — Чайка — Section 1',
      }),
    })
  );

  // Session route
  await page.route('**/api/session/*', async (route: any) => {
    if (route.request().method() === 'DELETE') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ready',
        title: 'Чехов — Чайка',
        contentType: 'text',
        totalDuration: chunkCount * 60,
        chunks: textChunks.map(c => ({ ...c, status: 'ready', audioUrl: '/mock-audio.mp3' })),
        hasMoreChunks: false,
      }),
    });
  });

  // Download chunk route
  await page.route('**/api/download-chunk', (route: any) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        audioUrl: '/mock-audio.mp3',
        transcript: MOCK_TRANSCRIPT,
        title: 'Чехов — Чайка — Section 1',
      }),
    })
  );

  // Translate route
  await page.route('**/api/translate', (route: any) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ word: 'привет', translation: 'hello', sourceLanguage: 'ru' }),
    })
  );

  // Extract sentence route
  await page.route('**/api/extract-sentence', (route: any) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sentence: 'Привет, как дела?', translation: 'Hello, how are you?' }),
    })
  );

  // SSE progress (immediate complete for cached)
  await page.route('**/api/progress/**', (route: any) => {
    const events = [
      { type: 'connected', sessionId: TEST_SESSION_ID },
      {
        type: 'complete',
        title: 'Чехов — Чайка',
        totalDuration: chunkCount * 60,
        contentType: 'text',
        chunks: textChunks.map(c => ({ ...c, status: 'ready', audioUrl: '/mock-audio.mp3' })),
        hasMoreChunks: false,
      },
    ];
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: events.map((e: any) => `data: ${JSON.stringify(e)}\n\n`).join(''),
    });
  });

  // Mock audio file
  await page.route('**/mock-audio.mp3', (route: any) =>
    route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(100) })
  );
}

test.describe('Text mode (lib.ru) flow', () => {
  test('submitting lib.ru URL triggers text mode analysis', async ({ page }) => {
    let analyzeBody: any = null;

    await setupTextModeRoutes(page, { chunks: 1, cached: true });

    // Override to capture request
    await page.route('**/api/analyze', async route => {
      analyzeBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: TEST_SESSION_ID,
          status: 'cached',
          title: 'Чехов — Чайка',
          totalDuration: 60,
          contentType: 'text',
          chunks: [{ id: 'chunk-0', index: 0, startTime: 0, endTime: 60, duration: 60,
            previewText: 'Текст...', wordCount: 100, status: 'ready', audioUrl: '/mock-audio.mp3' }],
          hasMoreChunks: false,
        }),
      });
    });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="lib.ru"]');
    await urlInput.fill('http://lib.ru/PROZA/CHEKHOV/chaika.txt');
    await urlInput.press('Enter');

    // Should transition to player with transcript
    await expect(page.locator('text=Привет,')).toBeVisible({ timeout: 5000 });

    // Verify the correct URL was sent
    expect(analyzeBody).toEqual({ url: 'http://lib.ru/PROZA/CHEKHOV/chaika.txt' });
  });

  test('text mode shows audio player instead of video player', async ({ page }) => {
    await setupTextModeRoutes(page, { chunks: 1, cached: true });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="lib.ru"]');
    await urlInput.fill('http://lib.ru/PROZA/CHEKHOV/chaika.txt');
    await urlInput.press('Enter');

    // Wait for player view
    await expect(page.locator('text=Привет,')).toBeVisible({ timeout: 5000 });

    // Should have audio element, not video element
    await expect(page.locator('audio')).toBeAttached();
    await expect(page.locator('video')).not.toBeAttached();
  });

  test('text mode multi-section shows section menu with "Section" labels', async ({ page }) => {
    await setupTextModeRoutes(page, { chunks: 3, cached: true });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="lib.ru"]');
    await urlInput.fill('http://lib.ru/PROZA/CHEKHOV/chaika.txt');
    await urlInput.press('Enter');

    // Chunk menu should use "Section" labels for text mode
    await expect(page.locator('text=Section 1')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Section 2')).toBeVisible();
    await expect(page.locator('text=Section 3')).toBeVisible();
  });

  test('word click in text mode shows translation popup', async ({ page }) => {
    await setupTextModeRoutes(page, { chunks: 1, cached: true });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="lib.ru"]');
    await urlInput.fill('http://lib.ru/PROZA/CHEKHOV/chaika.txt');
    await urlInput.press('Enter');

    await expect(page.locator('text=Привет,')).toBeVisible({ timeout: 5000 });

    // Click a word — should show translation popup
    await page.locator('text=хочу').click();
    await expect(page.locator('.shadow-lg')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=hello')).toBeVisible();
  });
});

test.describe('Error recovery', () => {
  test('server 500 error shows message and allows new submission', async ({ page }) => {
    let callCount = 0;

    await page.route('**/*firebaseapp.com*/**', route => route.abort());
    await page.route('**/*googleapis.com/identitytoolkit/**', route => route.abort());
    await page.route('**/*firestore.googleapis.com/**', route => route.abort());
    await page.route('**/russian-word-frequencies.json', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    await page.route('**/api/analyze', async route => {
      callCount++;
      if (callCount === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal server error' }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessionId: TEST_SESSION_ID,
            status: 'cached',
            title: 'Test Video',
            totalDuration: 90,
            contentType: 'video',
            chunks: [{ id: 'chunk-0', index: 0, startTime: 0, endTime: 90, duration: 90,
              previewText: 'Test...', wordCount: 50, status: 'ready', videoUrl: '/mock-video.mp4' }],
            hasMoreChunks: false,
          }),
        });
      }
    });

    await page.route('**/api/session/*/chunk/*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ videoUrl: '/mock-video.mp4', transcript: MOCK_TRANSCRIPT, title: 'Test Video' }),
      })
    );
    await page.route('**/api/session/*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ready',
          title: 'Test Video',
          contentType: 'video',
          chunks: [{ id: 'chunk-0', index: 0, startTime: 0, endTime: 90, duration: 90,
            previewText: 'Test...', wordCount: 50, status: 'ready', videoUrl: '/mock-video.mp4' }],
          hasMoreChunks: false,
        }),
      })
    );
    await page.route('**/api/download-chunk', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ videoUrl: '/mock-video.mp4', transcript: MOCK_TRANSCRIPT, title: 'Test Video' }),
      })
    );
    await page.route('**/mock-video.mp4', route =>
      route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.alloc(100) })
    );

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');

    // First attempt fails
    await urlInput.fill('https://ok.ru/video/fail');
    await urlInput.press('Enter');
    await expect(page.locator('text=Internal server error').first()).toBeVisible({ timeout: 5000 });

    // Second attempt succeeds — error should clear
    await urlInput.fill('https://ok.ru/video/success');
    await urlInput.press('Enter');
    await expect(page.locator('text=Привет,')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Internal server error').first()).not.toBeVisible();
  });

  test('translate 429 shows error in popup without crashing', async ({ page }) => {
    const { setupMockRoutes, navigateToPlayer } = await import('../fixtures/mock-routes');
    const { MOCK_SINGLE_CHUNK } = await import('../fixtures/mock-data');

    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });

    // Override translate to return 429
    await page.route('**/api/translate', route =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Too many translation requests' }),
      })
    );

    await navigateToPlayer(page);
    await page.locator('text=хочу').click();

    // Popup should show error, not crash
    await expect(page.locator('.shadow-lg')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Error')).toBeVisible();
  });
});
