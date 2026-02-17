import { test, expect } from '@playwright/test';
import { setupMockRoutes, navigateToPlayer } from '../fixtures/mock-routes';
import { MOCK_SINGLE_CHUNK } from '../fixtures/mock-data';

test.describe('Add word to deck', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
  });

  test('click word → popup → "Add to deck" → calls extract-sentence → shows "In deck"', async ({ page }) => {
    // Track extract-sentence calls
    let extractSentenceCalled = false;
    await page.route('**/api/extract-sentence', async (route) => {
      extractSentenceCalled = true;
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

    // Click a word to get translation popup
    await page.locator('text=рассказать').click();
    const popup = page.locator('.shadow-lg');
    await expect(popup).toBeVisible({ timeout: 5000 });

    // Wait for translation to load
    await expect(popup.locator('text=Hello')).toBeVisible({ timeout: 3000 });

    // Click "Add to deck"
    await popup.locator('text=Add to deck').click();

    // Wait for the "In deck" confirmation
    await expect(popup.locator('text=In deck')).toBeVisible({ timeout: 5000 });

    // Verify extract-sentence was called
    expect(extractSentenceCalled).toBe(true);
  });

  test('word already in deck shows "In deck" immediately', async ({ page }) => {
    // Pre-populate deck with the word
    await page.goto('/');
    await page.evaluate(() => {
      const card = {
        id: 'рассказать',
        word: 'рассказать',
        translation: 'to tell',
        sourceLanguage: 'ru',
        easeFactor: 2.5,
        interval: 0,
        repetition: 0,
        nextReviewDate: new Date().toISOString(),
        addedAt: new Date().toISOString(),
        lastReviewedAt: null,
      };
      localStorage.setItem('srs_deck', JSON.stringify([card]));
    });
    await page.reload();

    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
    await navigateToPlayer(page);

    // Click the word that's already in deck
    await page.locator('text=рассказать').click();
    const popup = page.locator('.shadow-lg');
    await expect(popup).toBeVisible({ timeout: 5000 });

    // Should show "In deck" checkmark instead of "Add to deck"
    await expect(popup.locator('text=In deck')).toBeVisible({ timeout: 5000 });
  });

  test('DeckBadge shows count after adding card', async ({ page }) => {
    await navigateToPlayer(page);

    // Initially no badge count (no due cards)
    const badge = page.locator('.bg-red-500');
    // Badge may or may not be visible initially

    // Click word and add to deck
    await page.locator('text=рассказать').click();
    const popup = page.locator('.shadow-lg');
    await expect(popup.locator('text=Hello')).toBeVisible({ timeout: 3000 });
    await popup.locator('text=Add to deck').click();
    await expect(popup.locator('text=In deck')).toBeVisible({ timeout: 5000 });

    // The DeckBadge should now reflect a card in the deck
    // Due count badge (red circle) should appear since the card's nextReviewDate is in the past
    await expect(badge).toBeVisible({ timeout: 3000 });
  });
});
