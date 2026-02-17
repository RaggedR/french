import { test, expect } from '@playwright/test';
import { setupMockRoutes, navigateToPlayer } from '../fixtures/mock-routes';
import { TEST_SESSION_ID, MOCK_CHUNKS, MOCK_SINGLE_CHUNK, MOCK_TRANSCRIPT } from '../fixtures/mock-data';

test.describe('API interactions — button → API call → response → UI update', () => {

  // ─── POST /api/analyze ─────────────────────────────────────

  test('submitting URL sends POST /api/analyze with correct body', async ({ page }) => {
    let analyzeBody: any = null;

    await page.route('**/*firebaseapp.com*/**', route => route.abort());
    await page.route('**/*googleapis.com/identitytoolkit/**', route => route.abort());
    await page.route('**/*firestore.googleapis.com/**', route => route.abort());
    await page.route('**/russian-word-frequencies.json', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    // Intercept /api/analyze to capture the request body
    await page.route('**/api/analyze', async route => {
      analyzeBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: TEST_SESSION_ID,
          status: 'cached',
          title: 'Test Video',
          totalDuration: 180,
          chunks: MOCK_SINGLE_CHUNK.map(c => ({ ...c, status: 'ready', videoUrl: '/mock-video.mp4' })),
          hasMoreChunks: false,
        }),
      });
    });
    await page.route('**/api/session/*/chunk/*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ videoUrl: '/mock-video.mp4', transcript: MOCK_TRANSCRIPT, title: 'Test Video' }),
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
    await urlInput.fill('https://ok.ru/video/999888');
    await urlInput.press('Enter');

    // Wait for transition
    await expect(page.locator('text=Привет,')).toBeVisible({ timeout: 5000 });

    // Verify the API was called with the correct URL
    expect(analyzeBody).toEqual({ url: 'https://ok.ru/video/999888' });
  });

  // ─── POST /api/translate ───────────────────────────────────

  test('clicking word sends POST /api/translate with word and shows translation', async ({ page }) => {
    let translateBody: any = null;

    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });

    // Override translate route to capture request body
    await page.route('**/api/translate', async route => {
      translateBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          word: translateBody?.word || 'test',
          translation: 'to tell',
          sourceLanguage: 'ru',
        }),
      });
    });

    await navigateToPlayer(page);

    // Click a specific word
    await page.locator('text=рассказать').click();

    // Wait for translation popup
    await expect(page.locator('text=to tell')).toBeVisible({ timeout: 5000 });

    // Verify API was called with the correct word
    expect(translateBody).toEqual({ word: 'рассказать' });

    // Verify popup shows the word
    await expect(page.locator('.shadow-lg')).toBeVisible();
  });

  // ─── POST /api/extract-sentence ────────────────────────────

  test('Add to Deck sends POST /api/extract-sentence with context and word', async ({ page }) => {
    let extractBody: any = null;
    let extractCalled = false;

    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });

    // Override extract-sentence route to capture request
    await page.route('**/api/extract-sentence', async route => {
      extractBody = route.request().postDataJSON();
      extractCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sentence: 'Я хочу рассказать вам историю.',
          translation: 'I want to tell you a story.',
        }),
      });
    });

    await navigateToPlayer(page);
    await page.locator('text=рассказать').click();

    // Wait for translation to load
    await expect(page.locator('.shadow-lg')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Hello')).toBeVisible();

    // Click "Add to deck"
    await page.locator('text=Add to deck').click();

    // Wait for "In deck" confirmation
    await expect(page.locator('text=In deck')).toBeVisible({ timeout: 5000 });

    // Verify extract-sentence was called
    expect(extractCalled).toBe(true);
    expect(extractBody).toHaveProperty('word', 'рассказать');
    expect(extractBody).toHaveProperty('text');
    // The text should be a ~30-word context window around the clicked word
    expect(extractBody.text).toContain('рассказать');
  });

  // ─── POST /api/download-chunk ──────────────────────────────

  test('selecting chunk sends POST /api/download-chunk with sessionId and chunkId', async ({ page }) => {
    let downloadBody: any = null;

    await page.route('**/*firebaseapp.com*/**', route => route.abort());
    await page.route('**/*googleapis.com/identitytoolkit/**', route => route.abort());
    await page.route('**/*firestore.googleapis.com/**', route => route.abort());
    await page.route('**/russian-word-frequencies.json', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    // Analyze returns multi-chunk with pending status
    await page.route('**/api/analyze', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: TEST_SESSION_ID,
          status: 'cached',
          title: 'Test Video',
          totalDuration: 180,
          chunks: MOCK_CHUNKS.map(c => ({ ...c, status: 'pending' })),
          hasMoreChunks: false,
        }),
      })
    );

    // Capture download-chunk request body
    await page.route('**/api/download-chunk', async route => {
      downloadBody = route.request().postDataJSON();
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

    // Session + chunk routes
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
          chunks: MOCK_CHUNKS.map(c => ({ ...c, status: 'ready', videoUrl: '/mock-video.mp4' })),
          hasMoreChunks: false,
        }),
      })
    );
    await page.route('**/mock-video.mp4', route =>
      route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.alloc(100) })
    );
    await page.route('**/api/progress/**', route => {
      const events = [
        { type: 'connected', sessionId: TEST_SESSION_ID },
        { type: 'complete', title: 'Test Video', totalDuration: 180, contentType: 'video',
          chunks: MOCK_CHUNKS.map(c => ({ ...c, status: 'ready', videoUrl: '/mock-video.mp4' })),
          hasMoreChunks: false },
      ];
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''),
      });
    });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/123456');
    await urlInput.press('Enter');

    // Wait for chunk menu
    await expect(page.locator('text=Part 1')).toBeVisible({ timeout: 5000 });

    // Click Part 1
    await page.locator('text=Part 1').click();

    // Wait for player to load
    await expect(page.locator('text=Привет,')).toBeVisible({ timeout: 10000 });

    // Verify download-chunk was called with correct body
    expect(downloadBody).toEqual({
      sessionId: TEST_SESSION_ID,
      chunkId: 'chunk-0',
    });
  });

  // ─── Translation error handling ────────────────────────────

  test('translation API error shows error message in popup', async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });

    // Override translate to return error
    await page.route('**/api/translate', route =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Translation service unavailable' }),
      })
    );

    await navigateToPlayer(page);
    await page.locator('text=хочу').click();

    // Popup should show error
    await expect(page.locator('.shadow-lg')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Error')).toBeVisible();
  });

  // ─── Rate limit response ──────────────────────────────────

  test('429 rate limit on analyze shows error and allows retry', async ({ page }) => {
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
        // First call returns rate limit
        await route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Rate limit exceeded. Try again in 60 seconds.' }),
        });
      } else {
        // Second call succeeds
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessionId: TEST_SESSION_ID,
            status: 'cached',
            title: 'Test Video',
            totalDuration: 90,
            chunks: MOCK_SINGLE_CHUNK.map(c => ({ ...c, status: 'ready', videoUrl: '/mock-video.mp4' })),
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

    // First attempt — rate limited
    await urlInput.fill('https://ok.ru/video/ratelimited');
    await urlInput.press('Enter');
    await expect(page.locator('text=Rate limit').first()).toBeVisible({ timeout: 5000 });

    // Second attempt — succeeds
    await urlInput.fill('https://ok.ru/video/success');
    await urlInput.press('Enter');
    await expect(page.locator('text=Привет,')).toBeVisible({ timeout: 5000 });
  });
});
