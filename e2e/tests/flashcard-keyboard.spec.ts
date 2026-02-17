import { test, expect } from '@playwright/test';
import { setupMockRoutes } from '../fixtures/mock-routes';
import { makeDueCard, makeReviewCard } from '../fixtures/mock-data';

test.describe('Flashcard keyboard shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page);
  });

  test('Again button re-queues card with countdown timer', async ({ page }) => {
    const card = makeDueCard({ word: 'книга', translation: 'book' });
    await page.goto('/');
    await page.evaluate((cards) => {
      localStorage.setItem('srs_deck', JSON.stringify(cards));
    }, [card]);
    await page.reload();

    const deckBadge = page.locator('button[title*="review"], button[title*="due"]');
    await deckBadge.click();
    await expect(page.locator('text=книга').first()).toBeVisible({ timeout: 3000 });

    // Show answer then click Again
    await page.locator('text=Show Answer').click();
    await page.getByRole('button', { name: /Again/ }).click();

    // Again re-queues with 1min delay → shows "Learning card coming up" countdown
    await expect(page.locator('text=Learning card coming up')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Reviewed 1 so far')).toBeVisible();
  });

  test('Hard button re-queues card with countdown timer', async ({ page }) => {
    const card = makeDueCard({ word: 'стол', translation: 'table' });
    await page.goto('/');
    await page.evaluate((cards) => {
      localStorage.setItem('srs_deck', JSON.stringify(cards));
    }, [card]);
    await page.reload();

    const deckBadge = page.locator('button[title*="review"], button[title*="due"]');
    await deckBadge.click();
    await expect(page.locator('text=стол').first()).toBeVisible({ timeout: 3000 });

    await page.locator('text=Show Answer').click();
    await page.getByRole('button', { name: /Hard/ }).click();

    // Hard re-queues with 5min delay → shows countdown
    await expect(page.locator('text=Learning card coming up')).toBeVisible({ timeout: 5000 });
  });

  test('key "3" rates Good and graduates card', async ({ page }) => {
    const card = makeDueCard({ word: 'дом', translation: 'house' });
    await page.goto('/');
    await page.evaluate((cards) => {
      localStorage.setItem('srs_deck', JSON.stringify(cards));
    }, [card]);
    await page.reload();

    const deckBadge = page.locator('button[title*="review"], button[title*="due"]');
    await deckBadge.click();
    await expect(page.locator('text=дом').first()).toBeVisible({ timeout: 3000 });

    await page.locator('text=Show Answer').click();

    // Press 3 → Good (graduates, single card → review complete)
    await page.keyboard.press('3');
    await expect(page.locator('text=Reviewed 1 card')).toBeVisible({ timeout: 5000 });
  });

  test('key "4" rates Easy and graduates card', async ({ page }) => {
    const card = makeDueCard({ word: 'вода', translation: 'water' });
    await page.goto('/');
    await page.evaluate((cards) => {
      localStorage.setItem('srs_deck', JSON.stringify(cards));
    }, [card]);
    await page.reload();

    const deckBadge = page.locator('button[title*="review"], button[title*="due"]');
    await deckBadge.click();
    await expect(page.locator('text=вода').first()).toBeVisible({ timeout: 3000 });

    await page.locator('text=Show Answer').click();

    // Press 4 → Easy (graduates, single card → review complete)
    await page.keyboard.press('4');
    await expect(page.locator('text=Reviewed 1 card')).toBeVisible({ timeout: 5000 });
  });

  test('rating buttons show interval previews', async ({ page }) => {
    const card = makeDueCard({ word: 'кот', translation: 'cat' });
    await page.goto('/');
    await page.evaluate((cards) => {
      localStorage.setItem('srs_deck', JSON.stringify(cards));
    }, [card]);
    await page.reload();

    const deckBadge = page.locator('button[title*="review"], button[title*="due"]');
    await deckBadge.click();
    await page.locator('text=Show Answer').click();

    // Rating buttons should show interval previews for learning phase (rep=0)
    // Again → 1m, Hard → 5m, Good → 1d, Easy → 5d
    await expect(page.locator('text=1m')).toBeVisible();
    await expect(page.locator('text=5m')).toBeVisible();
    await expect(page.locator('text=1d')).toBeVisible();
    await expect(page.locator('text=5d')).toBeVisible();
  });

  test('multiple due cards: advances to next after rating', async ({ page }) => {
    const card1 = makeDueCard({ id: 'кот', word: 'кот', translation: 'cat' });
    const card2 = makeDueCard({ id: 'собака', word: 'собака', translation: 'dog' });
    await page.goto('/');
    await page.evaluate((cards) => {
      localStorage.setItem('srs_deck', JSON.stringify(cards));
    }, [card1, card2]);
    await page.reload();

    const deckBadge = page.locator('button[title*="review"], button[title*="due"]');
    await deckBadge.click();

    // First card visible
    await expect(page.locator('.text-3xl').first()).toBeVisible({ timeout: 3000 });

    // Show and rate Good (click, not keyboard — more reliable in E2E)
    await page.locator('text=Show Answer').click();
    await page.getByRole('button', { name: /Good/ }).click();

    // Second card should now be shown — Show Answer should be visible again
    await expect(page.locator('text=Show Answer')).toBeVisible({ timeout: 3000 });

    // Rate the second card
    await page.locator('text=Show Answer').click();
    await page.getByRole('button', { name: /Good/ }).click();

    // Both reviewed → done (count should reflect total session, not reset mid-review)
    await expect(page.locator('text=Reviewed 2 card')).toBeVisible({ timeout: 5000 });
  });
});
