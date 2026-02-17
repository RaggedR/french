import { test, expect } from '@playwright/test';
import { setupMockRoutes, navigateToPlayer } from '../fixtures/mock-routes';
import { MOCK_CHUNKS, MOCK_SINGLE_CHUNK } from '../fixtures/mock-data';

test.describe('Video flow', () => {
  test('multi-chunk: submit URL → chunk menu appears', async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_CHUNKS, cached: true });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/123456');
    await urlInput.press('Enter');

    // Chunk menu should appear with both parts
    await expect(page.locator('text=Part 1')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Part 2')).toBeVisible();
  });

  test('multi-chunk: click Part 1 → player view with transcript', async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_CHUNKS, cached: true });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/123456');
    await urlInput.press('Enter');

    // Wait for chunk menu
    await expect(page.locator('text=Part 1')).toBeVisible({ timeout: 5000 });

    // Click Part 1
    await page.locator('text=Part 1').click();

    // Player view should show transcript words
    await expect(page.locator('text=Привет,')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=историю.')).toBeVisible();
  });

  test('single chunk: auto-selects and shows player directly', async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/789');
    await urlInput.press('Enter');

    // Should go directly to player (single chunk auto-select)
    await expect(page.locator('text=Привет,')).toBeVisible({ timeout: 5000 });
  });

  test('player shows progress bar track at bottom', async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
    await navigateToPlayer(page);

    // Progress bar track (the gray container — always visible)
    const progressTrack = page.locator('.h-1.bg-gray-200');
    await expect(progressTrack).toBeVisible();

    // The blue fill bar element exists (width starts at 0%)
    const progressFill = progressTrack.locator('.bg-blue-500');
    await expect(progressFill).toBeAttached();
  });

  test('player view: navigate back to chunk menu', async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_CHUNKS, cached: true });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/123456');
    await urlInput.press('Enter');

    // Click Part 1
    await page.locator('text=Part 1').click();
    await expect(page.locator('text=Привет,')).toBeVisible({ timeout: 5000 });

    // Navigate back
    await page.locator('text=All chunks').click();

    // Chunk menu should reappear
    await expect(page.locator('text=Part 1')).toBeVisible({ timeout: 5000 });
  });
});
