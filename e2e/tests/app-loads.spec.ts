import { test, expect } from '@playwright/test';
import { setupMockRoutes } from '../fixtures/mock-routes';

test.describe('App loads', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page);
  });

  test('renders input form with URL inputs and submit buttons', async ({ page }) => {
    await page.goto('/');

    // Video input form
    const videoInput = page.locator('input[placeholder*="ok.ru"]');
    await expect(videoInput).toBeVisible();

    // Text input form
    const textInput = page.locator('input[placeholder*="lib.ru"]');
    await expect(textInput).toBeVisible();

    // Header elements
    await expect(page.locator('h1')).toContainText('Russian Video & Text');
  });

  test('shows DeckBadge and Settings icons in header', async ({ page }) => {
    await page.goto('/');

    // DeckBadge button (cards icon with title)
    const deckBadge = page.locator('button[title*="deck"], button[title*="review"]');
    await expect(deckBadge).toBeVisible();

    // Settings button
    const settingsBtn = page.locator('button[title="Settings"]');
    await expect(settingsBtn).toBeVisible();
  });

  test('header subtitle describes the app purpose', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('text=Paste a video or text URL')).toBeVisible();
  });
});
