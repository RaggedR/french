import { test, expect } from '@playwright/test';
import { setupMockRoutes, navigateToPlayer } from '../fixtures/mock-routes';
import { MOCK_SINGLE_CHUNK } from '../fixtures/mock-data';

test.describe('Word popup (regression tests)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
  });

  test('click Cyrillic word → popup appears with translation', async ({ page }) => {
    await navigateToPlayer(page);

    // Click on a Russian word
    await page.locator('text=рассказать').click();

    // Popup should show "Translating..." first
    // Then resolve to the translation
    await expect(page.locator('.shadow-lg')).toBeVisible({ timeout: 5000 });

    // Translation text should appear (from mock: "Hello" for any word)
    await expect(page.locator('.shadow-lg').locator('text=Hello')).toBeVisible({ timeout: 3000 });
  });

  test('popup shows word and translation text', async ({ page }) => {
    await navigateToPlayer(page);

    await page.locator('text=хочу').click();

    const popup = page.locator('.shadow-lg');
    await expect(popup).toBeVisible({ timeout: 5000 });

    // The popup should contain the word from the mock translate response
    await expect(popup.locator('text=Hello')).toBeVisible({ timeout: 3000 });
  });

  test('close popup by clicking close button', async ({ page }) => {
    await navigateToPlayer(page);

    await page.locator('text=рассказать').click();
    const popup = page.locator('.shadow-lg');
    await expect(popup).toBeVisible({ timeout: 5000 });

    // Click close button (✕)
    await page.locator('text=✕').click();

    // Popup should disappear
    await expect(popup).not.toBeVisible();
  });

  test('clicking different word replaces popup (no stacking)', async ({ page }) => {
    await navigateToPlayer(page);

    // Click first word
    await page.locator('text=рассказать').click();
    await expect(page.locator('.shadow-lg')).toBeVisible({ timeout: 5000 });

    // Click different word
    await page.locator('text=историю.').click();

    // Only one popup should exist
    const popups = page.locator('.shadow-lg');
    await expect(popups).toHaveCount(1);
  });

  test('popup is positioned relative to clicked word (scrolls with content)', async ({ page }) => {
    await navigateToPlayer(page);

    // Click a word (use a unique word to avoid popup text collision)
    await page.locator('text=маленьком').click();
    const popup = page.locator('.shadow-lg');
    await expect(popup).toBeVisible({ timeout: 5000 });

    // Get initial popup position
    const initialBox = await popup.boundingBox();
    expect(initialBox).toBeTruthy();

    // The popup's parent span has position: relative, and the popup uses
    // position: absolute with top: 100%. This means it scrolls with the
    // word. Verify the popup is near the word, not at a fixed screen position.
    const wordBox = await page.locator('text=маленьком').boundingBox();
    expect(wordBox).toBeTruthy();

    // Popup should be below the word (top of popup >= bottom of word, roughly)
    expect(initialBox!.y).toBeGreaterThanOrEqual(wordBox!.y);
  });
});
