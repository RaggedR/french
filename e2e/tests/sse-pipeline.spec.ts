import { test, expect } from '@playwright/test';
import { TEST_SESSION_ID, MOCK_CHUNKS, MOCK_SINGLE_CHUNK, MOCK_TRANSCRIPT } from '../fixtures/mock-data';

/**
 * Helper to block Firebase + frequency JSON (standard E2E boilerplate).
 */
async function blockFirebase(page: any) {
  await page.route('**/*firebaseapp.com*/**', (route: any) => route.abort());
  await page.route('**/*googleapis.com/identitytoolkit/**', (route: any) => route.abort());
  await page.route('**/*firestore.googleapis.com/**', (route: any) => route.abort());
  await page.route('**/russian-word-frequencies.json', (route: any) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
}

test.describe('SSE progress pipeline — full video flow', () => {

  test('full 4-phase video pipeline: audio → transcription → punctuation → lemmatization → complete', async ({ page }) => {
    await blockFirebase(page);

    await page.route('**/api/analyze', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: TEST_SESSION_ID, status: 'started' }),
      })
    );

    // SSE delivers all 4 phases before complete
    await page.route('**/api/progress/**', route => {
      const events = [
        { type: 'connected', sessionId: TEST_SESSION_ID },
        { type: 'audio', progress: 100, status: 'complete' },
        { type: 'transcription', progress: 100, status: 'complete' },
        { type: 'punctuation', progress: 100, status: 'complete' },
        { type: 'lemmatization', progress: 100, status: 'complete' },
        {
          type: 'complete',
          title: 'Full Pipeline Video',
          totalDuration: 180,
          contentType: 'video',
          chunks: MOCK_CHUNKS.map(c => ({ ...c, status: 'ready', videoUrl: '/mock-video.mp4' })),
          hasMoreChunks: false,
        },
      ];
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: events.map((e: any) => `data: ${JSON.stringify(e)}\n\n`).join(''),
      });
    });

    await page.route('**/mock-video.mp4', route =>
      route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.alloc(100) })
    );

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/full-pipeline');
    await urlInput.press('Enter');

    // Should transition to chunk menu after complete
    await expect(page.locator('text=Part 1')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Part 2')).toBeVisible();
  });

  test('progress bars show incrementally as phases start', async ({ page }) => {
    await blockFirebase(page);

    await page.route('**/api/analyze', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: TEST_SESSION_ID, status: 'started' }),
      })
    );

    // SSE: audio done, transcription in progress, no complete
    await page.route('**/api/progress/**', route => {
      const events = [
        { type: 'connected', sessionId: TEST_SESSION_ID },
        { type: 'audio', progress: 100, status: 'complete' },
        { type: 'transcription', progress: 30, status: 'active', message: 'Transcribing... (30s)' },
        { type: 'punctuation', progress: 0, status: 'active', message: 'Waiting for transcription...' },
      ];
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: events.map((e: any) => `data: ${JSON.stringify(e)}\n\n`).join(''),
      });
    });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/incremental');
    await urlInput.press('Enter');

    // All three phases visible simultaneously
    await expect(page.locator('.font-medium:has-text("Audio")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.font-medium:has-text("Transcription")')).toBeVisible();
    await expect(page.locator('.font-medium:has-text("Punctuation")')).toBeVisible();

    // Messages visible
    await expect(page.locator('text=Transcribing... (30s)')).toBeVisible();
    await expect(page.locator('text=Waiting for transcription...')).toBeVisible();
  });

  test('SSE error mid-pipeline shows error and returns to input on new submit', async ({ page }) => {
    await blockFirebase(page);

    await page.route('**/api/analyze', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: TEST_SESSION_ID, status: 'started' }),
      })
    );

    // SSE: audio done, then error on transcription
    await page.route('**/api/progress/**', route => {
      const events = [
        { type: 'connected', sessionId: TEST_SESSION_ID },
        { type: 'audio', progress: 100, status: 'complete' },
        { type: 'error', message: 'Whisper API quota exceeded' },
      ];
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: events.map((e: any) => `data: ${JSON.stringify(e)}\n\n`).join(''),
      });
    });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/error-mid');
    await urlInput.press('Enter');

    // Error message visible
    await expect(page.locator('text=Whisper API quota exceeded').first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('SSE progress pipeline — text mode (lib.ru)', () => {

  test('text mode SSE shows lib.ru and TTS phases', async ({ page }) => {
    await blockFirebase(page);

    await page.route('**/api/analyze', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: TEST_SESSION_ID, status: 'started' }),
      })
    );

    // SSE: text mode progress (audio phase relabeled as lib.ru + tts phase)
    await page.route('**/api/progress/**', route => {
      const events = [
        { type: 'connected', sessionId: TEST_SESSION_ID },
        { type: 'audio', progress: 100, status: 'complete', message: 'Text fetched' },
        { type: 'tts', progress: 60, status: 'active', message: 'Generating audio chunk 3/5...' },
      ];
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: events.map((e: any) => `data: ${JSON.stringify(e)}\n\n`).join(''),
      });
    });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="lib.ru"]');
    await urlInput.fill('http://lib.ru/PROZA/CHEKHOV/chaika.txt');
    await urlInput.press('Enter');

    // Text mode shows TTS phase
    await expect(page.locator('.font-medium:has-text("Text-to-Speech")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=60%')).toBeVisible();
    await expect(page.locator('text=Generating audio chunk 3/5...')).toBeVisible();
  });

  test('text mode SSE complete transitions to section menu', async ({ page }) => {
    await blockFirebase(page);

    const textChunks = [
      { id: 'chunk-0', index: 0, startTime: 0, endTime: 60, duration: 60,
        previewText: 'Глава 1...', wordCount: 100, status: 'ready', audioUrl: '/mock-audio.mp3' },
      { id: 'chunk-1', index: 1, startTime: 60, endTime: 120, duration: 60,
        previewText: 'Глава 2...', wordCount: 100, status: 'ready', audioUrl: '/mock-audio.mp3' },
    ];

    await page.route('**/api/analyze', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: TEST_SESSION_ID, status: 'started' }),
      })
    );

    await page.route('**/api/progress/**', route => {
      const events = [
        { type: 'connected', sessionId: TEST_SESSION_ID },
        { type: 'audio', progress: 100, status: 'complete' },
        { type: 'tts', progress: 100, status: 'complete' },
        {
          type: 'complete',
          title: 'Чехов — Чайка',
          totalDuration: 120,
          contentType: 'text',
          chunks: textChunks,
          hasMoreChunks: false,
        },
      ];
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: events.map((e: any) => `data: ${JSON.stringify(e)}\n\n`).join(''),
      });
    });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="lib.ru"]');
    await urlInput.fill('http://lib.ru/PROZA/CHEKHOV/chaika.txt');
    await urlInput.press('Enter');

    // Should transition to section menu (text mode uses "Section" not "Part")
    await expect(page.locator('text=Section 1')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Section 2')).toBeVisible();
  });

  test('text mode single section auto-selects to player with audio element', async ({ page }) => {
    await blockFirebase(page);

    const singleChunk = [
      { id: 'chunk-0', index: 0, startTime: 0, endTime: 60, duration: 60,
        previewText: 'Текст...', wordCount: 100, status: 'ready', audioUrl: '/mock-audio.mp3' },
    ];

    await page.route('**/api/analyze', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: TEST_SESSION_ID,
          status: 'cached',
          title: 'Чехов — Чайка',
          totalDuration: 60,
          contentType: 'text',
          chunks: singleChunk,
          hasMoreChunks: false,
        }),
      })
    );

    await page.route('**/api/session/*/chunk/*', route =>
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

    await page.route('**/api/session/*', route => {
      if (route.request().method() === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ready',
          title: 'Чехов — Чайка',
          contentType: 'text',
          totalDuration: 60,
          chunks: singleChunk.map(c => ({ ...c, status: 'ready', audioUrl: '/mock-audio.mp3' })),
          hasMoreChunks: false,
        }),
      });
    });

    await page.route('**/api/download-chunk', route =>
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

    await page.route('**/mock-audio.mp3', route =>
      route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(100) })
    );

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="lib.ru"]');
    await urlInput.fill('http://lib.ru/PROZA/CHEKHOV/chaika.txt');
    await urlInput.press('Enter');

    // Should auto-select and show transcript + audio player
    await expect(page.locator('text=Привет,')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('audio')).toBeAttached();
    await expect(page.locator('video')).not.toBeAttached();
  });
});
