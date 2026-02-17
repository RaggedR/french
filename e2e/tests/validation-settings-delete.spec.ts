import { test, expect } from '@playwright/test';
import { setupMockRoutes, navigateToPlayer } from '../fixtures/mock-routes';
import { TEST_SESSION_ID, MOCK_SINGLE_CHUNK, MOCK_CHUNKS, MOCK_TRANSCRIPT } from '../fixtures/mock-data';

test.describe('URL validation', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
  });

  test('video input rejects non-ok.ru URL', async ({ page }) => {
    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://youtube.com/watch?v=123');
    await urlInput.press('Enter');

    // Validation error should appear
    await expect(page.locator('text=Only ok.ru')).toBeVisible({ timeout: 3000 });
  });

  test('text input rejects non-lib.ru URL', async ({ page }) => {
    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="lib.ru"]');
    await urlInput.fill('https://ok.ru/video/123');
    await urlInput.press('Enter');

    // Validation error should appear
    await expect(page.locator('text=Only lib.ru')).toBeVisible({ timeout: 3000 });
  });

  test('validation error clears when user types new URL', async ({ page }) => {
    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');

    // Trigger validation error
    await urlInput.fill('https://badurl.com');
    await urlInput.press('Enter');
    await expect(page.locator('text=Only ok.ru')).toBeVisible({ timeout: 3000 });

    // Start typing — error should clear
    await urlInput.fill('https://ok.ru/video/123');
    await expect(page.locator('text=Only ok.ru')).not.toBeVisible();
  });

  test('empty input does not trigger submission', async ({ page }) => {
    let analyzeCalled = false;
    await page.route('**/api/analyze', async route => {
      analyzeCalled = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    // Just press Enter without typing anything
    await urlInput.press('Enter');

    // API should not have been called
    expect(analyzeCalled).toBe(false);
  });
});

test.describe('Settings panel', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
  });

  test('opens settings panel and shows frequency range inputs', async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title="Settings"]').click();

    // Settings panel visible
    await expect(page.locator('text=Settings').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=Word Frequency Underlining')).toBeVisible();

    // Frequency range inputs
    const fromInput = page.locator('input[placeholder="From"]');
    const toInput = page.locator('input[placeholder="To"]');
    await expect(fromInput).toBeVisible();
    await expect(toInput).toBeVisible();
  });

  test('closes settings with close button', async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title="Settings"]').click();
    await expect(page.locator('text=Word Frequency Underlining')).toBeVisible({ timeout: 3000 });

    // Click the X close button (SVG inside button)
    await page.locator('.fixed.right-0 button.text-gray-500').click();

    // Settings should be gone
    await expect(page.locator('text=Word Frequency Underlining')).not.toBeVisible({ timeout: 3000 });
  });

  test('closes settings by clicking backdrop', async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title="Settings"]').click();
    await expect(page.locator('text=Word Frequency Underlining')).toBeVisible({ timeout: 3000 });

    // Click the backdrop (the semi-transparent overlay)
    await page.locator('.bg-black\\/50').click({ force: true });

    await expect(page.locator('text=Word Frequency Underlining')).not.toBeVisible({ timeout: 3000 });
  });

  test('frequency range values persist after closing and reopening', async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title="Settings"]').click();
    await expect(page.locator('text=Word Frequency Underlining')).toBeVisible({ timeout: 3000 });

    // Set frequency range
    const fromInput = page.locator('input[placeholder="From"]');
    const toInput = page.locator('input[placeholder="To"]');
    await fromInput.fill('500');
    await toInput.fill('2000');

    // Close settings via close button
    await page.locator('.fixed.right-0 button.text-gray-500').click();
    await expect(page.locator('text=Word Frequency Underlining')).not.toBeVisible({ timeout: 3000 });

    // Reopen
    await page.locator('button[title="Settings"]').click();
    await expect(page.locator('text=Word Frequency Underlining')).toBeVisible({ timeout: 3000 });

    // Values should still be there
    await expect(fromInput).toHaveValue('500');
    await expect(toInput).toHaveValue('2000');
  });

  test('does not show API key fields (server-side only)', async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title="Settings"]').click();
    await expect(page.locator('text=Word Frequency Underlining')).toBeVisible({ timeout: 3000 });

    // API keys are server-side — no user-facing key inputs
    await expect(page.locator('text=Google Translate API Key')).not.toBeVisible();
    await expect(page.locator('input[type="password"]')).not.toBeAttached();
  });
});

test.describe('Delete session', () => {
  test('Load different video or text button resets state and allows new submission', async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_CHUNKS, cached: true });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/123456');
    await urlInput.press('Enter');

    // Chunk menu visible
    await expect(page.locator('text=Part 1')).toBeVisible({ timeout: 5000 });

    // Click reset
    await page.locator('text=Load different video or text').click();

    // Back to input view
    await expect(page.locator('input[placeholder*="ok.ru"]')).toBeVisible({ timeout: 3000 });

    // Can submit a new URL
    const newUrlInput = page.locator('input[placeholder*="ok.ru"]');
    await newUrlInput.fill('https://ok.ru/video/different');
    await newUrlInput.press('Enter');

    // Should go to chunk menu again
    await expect(page.locator('text=Part 1')).toBeVisible({ timeout: 5000 });
  });

  test('reset from player view returns to input', async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });

    // Navigate to player
    await navigateToPlayer(page);
    await expect(page.locator('text=Привет,')).toBeVisible({ timeout: 5000 });

    // Click reset
    await page.locator('text=Load different video or text').click();

    // Back to input view
    await expect(page.locator('input[placeholder*="ok.ru"]')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Player keyboard hints', () => {
  test('video player shows keyboard shortcut hints', async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
    await navigateToPlayer(page);

    // Keyboard hints should be visible
    await expect(page.locator('text=Space: play/pause')).toBeVisible();
    await expect(page.locator('text=seek ±5s')).toBeVisible();
  });
});
