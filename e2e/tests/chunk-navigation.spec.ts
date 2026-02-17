import { test, expect } from '@playwright/test';
import { setupMockRoutes } from '../fixtures/mock-routes';
import { TEST_SESSION_ID, MOCK_CHUNKS, MOCK_SINGLE_CHUNK, MOCK_TRANSCRIPT } from '../fixtures/mock-data';

test.describe('Chunk navigation', () => {
  test('multi-chunk: select Part 1, go back, select Part 2', async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_CHUNKS, cached: true });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/123456');
    await urlInput.press('Enter');

    // Chunk menu should appear
    await expect(page.locator('text=Part 1')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Part 2')).toBeVisible();

    // Select Part 1 → player view
    await page.locator('text=Part 1').click();
    await expect(page.locator('text=Привет,')).toBeVisible({ timeout: 10000 });

    // Go back to chunk menu
    await page.locator('text=All chunks').click();
    await expect(page.locator('text=Part 1')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Part 2')).toBeVisible();

    // Select Part 2 → player view loads again
    await page.locator('text=Part 2').click();
    await expect(page.locator('text=Привет,')).toBeVisible({ timeout: 10000 });
  });

  test('"Load different video or text" resets to input view', async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_CHUNKS, cached: true });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/123456');
    await urlInput.press('Enter');

    // Wait for chunk menu
    await expect(page.locator('text=Part 1')).toBeVisible({ timeout: 5000 });

    // Click reset button
    await page.locator('text=Load different video or text').click();

    // Should be back at input view
    await expect(page.locator('input[placeholder*="ok.ru"]')).toBeVisible();
    await expect(page.locator('text=Part 1')).not.toBeVisible();
  });

  test('single-chunk auto-selects directly to player (no chunk menu visible)', async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/123456');
    await urlInput.press('Enter');

    // Should go directly to player view, never showing chunk menu
    await expect(page.locator('text=Привет,')).toBeVisible({ timeout: 10000 });
    // Chunk menu's "All chunks" back link should NOT be visible (single chunk = no menu)
    await expect(page.locator('text=All chunks')).not.toBeVisible();
  });

  test('player back button returns to chunk menu (not input)', async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_CHUNKS, cached: true });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/123456');
    await urlInput.press('Enter');

    await expect(page.locator('text=Part 1')).toBeVisible({ timeout: 5000 });
    await page.locator('text=Part 1').click();
    await expect(page.locator('text=Привет,')).toBeVisible({ timeout: 10000 });

    // Back should go to chunk menu, NOT input
    await page.locator('text=All chunks').click();
    await expect(page.locator('text=Part 1')).toBeVisible({ timeout: 5000 });
    // Input should NOT be visible
    await expect(page.locator('input[placeholder*="ok.ru"]')).not.toBeVisible();
  });
});
