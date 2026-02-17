import { test, expect } from '@playwright/test';
import { setupMockRoutes } from '../fixtures/mock-routes';
import { TEST_SESSION_ID, MOCK_CHUNKS, MOCK_SINGLE_CHUNK, MOCK_TRANSCRIPT } from '../fixtures/mock-data';

test.describe('Progress bar & SSE flow', () => {
  test('shows progress bars during non-cached analysis', async ({ page }) => {
    // Block Firebase
    await page.route('**/*firebaseapp.com*/**', route => route.abort());
    await page.route('**/*googleapis.com/identitytoolkit/**', route => route.abort());
    await page.route('**/*firestore.googleapis.com/**', route => route.abort());
    await page.route('**/russian-word-frequencies.json', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    // /api/analyze returns 'started' (not cached) → triggers SSE subscription
    await page.route('**/api/analyze', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: TEST_SESSION_ID, status: 'started' }),
      })
    );

    // SSE sends progress events WITHOUT 'complete' — keeps analyzing view active
    await page.route('**/api/progress/**', route => {
      const events = [
        { type: 'connected', sessionId: TEST_SESSION_ID },
        { type: 'audio', progress: 50, status: 'active', message: 'Downloading... (45s)' },
      ];
      const sseBody = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: sseBody,
      });
    });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/555');
    await urlInput.press('Enter');

    // Should show progress bar with "Audio" label (use .font-medium for exact ProgressBar label)
    await expect(page.locator('.font-medium:has-text("Audio")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=50%')).toBeVisible();
    await expect(page.locator('text=Downloading... (45s)')).toBeVisible();
  });

  test('progress bar shows multiple phases simultaneously', async ({ page }) => {
    await page.route('**/*firebaseapp.com*/**', route => route.abort());
    await page.route('**/*googleapis.com/identitytoolkit/**', route => route.abort());
    await page.route('**/*firestore.googleapis.com/**', route => route.abort());
    await page.route('**/russian-word-frequencies.json', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    await page.route('**/api/analyze', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: TEST_SESSION_ID, status: 'started' }),
      })
    );

    // SSE: audio complete + transcription active (no 'complete' event)
    await page.route('**/api/progress/**', route => {
      const events = [
        { type: 'connected', sessionId: TEST_SESSION_ID },
        { type: 'audio', progress: 100, status: 'complete' },
        { type: 'transcription', progress: 45, status: 'active', message: 'Transcribing...' },
      ];
      const sseBody = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: sseBody,
      });
    });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/555');
    await urlInput.press('Enter');

    // Both phases should be visible simultaneously
    await expect(page.locator('.font-medium:has-text("Audio")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=100%')).toBeVisible();
    await expect(page.locator('.font-medium:has-text("Transcription")')).toBeVisible();
    await expect(page.locator('text=45%')).toBeVisible();
  });

  test('SSE error event shows error message', async ({ page }) => {
    await page.route('**/*firebaseapp.com*/**', route => route.abort());
    await page.route('**/*googleapis.com/identitytoolkit/**', route => route.abort());
    await page.route('**/*firestore.googleapis.com/**', route => route.abort());
    await page.route('**/russian-word-frequencies.json', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    await page.route('**/api/analyze', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: TEST_SESSION_ID, status: 'started' }),
      })
    );

    // SSE sends error event
    await page.route('**/api/progress/**', route => {
      const events = [
        { type: 'connected', sessionId: TEST_SESSION_ID },
        { type: 'error', progress: 0, status: 'error', message: 'yt-dlp extraction failed' },
      ];
      const sseBody = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: sseBody,
      });
    });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/555');
    await urlInput.press('Enter');

    // Error message should appear
    await expect(page.locator('text=yt-dlp extraction failed').first()).toBeVisible({ timeout: 5000 });
  });

  test('cached analysis skips progress bar and shows chunks directly', async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_CHUNKS, cached: true });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/123456');
    await urlInput.press('Enter');

    // Should go directly to chunk menu (no progress bars)
    await expect(page.locator('text=Part 1')).toBeVisible({ timeout: 5000 });
    // Progress bar labels should NOT be visible
    await expect(page.locator('.font-medium:has-text("Audio")')).not.toBeVisible();
    await expect(page.locator('.font-medium:has-text("Transcription")')).not.toBeVisible();
  });

  test('SSE complete event transitions from analyzing to chunk menu', async ({ page }) => {
    await page.route('**/*firebaseapp.com*/**', route => route.abort());
    await page.route('**/*googleapis.com/identitytoolkit/**', route => route.abort());
    await page.route('**/*firestore.googleapis.com/**', route => route.abort());
    await page.route('**/russian-word-frequencies.json', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    await page.route('**/api/analyze', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: TEST_SESSION_ID, status: 'started' }),
      })
    );

    // SSE sends progress then complete with chunks
    await page.route('**/api/progress/**', route => {
      const events = [
        { type: 'connected', sessionId: TEST_SESSION_ID },
        { type: 'audio', progress: 100, status: 'complete' },
        { type: 'transcription', progress: 100, status: 'complete' },
        {
          type: 'complete', progress: 100, status: 'complete',
          title: 'Test Video', totalDuration: 180, contentType: 'video',
          chunks: MOCK_CHUNKS.map(c => ({ ...c, status: 'ready', videoUrl: '/mock-video.mp4' })),
          hasMoreChunks: false,
        },
      ];
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''),
      });
    });

    await page.route('**/mock-video.mp4', route =>
      route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.alloc(100) })
    );

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/555');
    await urlInput.press('Enter');

    // Should transition to chunk menu after complete event
    await expect(page.locator('text=Part 1')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Part 2')).toBeVisible();
  });
});
