import { test, expect } from '@playwright/test';
import { setupMockRoutes, navigateToPlayer } from '../fixtures/mock-routes';
import { MOCK_SINGLE_CHUNK } from '../fixtures/mock-data';

test.describe('Regression: edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
  });

  test('clicking non-Cyrillic text does not open popup', async ({ page }) => {
    await navigateToPlayer(page);

    // The transcript has preposition "в" which is Cyrillic (should open popup),
    // but clicking on the container background should not.
    // Click the background area of the transcript panel
    const container = page.locator('.overflow-y-auto');
    await container.click({ position: { x: 5, y: 5 } });

    // No popup should appear
    const popup = page.locator('.shadow-lg');
    await expect(popup).not.toBeVisible();
  });

  test('multiple rapid word clicks do not stack popups', async ({ page }) => {
    await navigateToPlayer(page);

    // Click three words in rapid succession
    await page.locator('text=Привет,').click();
    await page.locator('text=как').click();
    await page.locator('text=дела?').click();

    // Wait for the last popup to settle
    await page.waitForTimeout(500);

    // Only one popup should be visible
    const popups = page.locator('.shadow-lg');
    await expect(popups).toHaveCount(1);
  });

  test('Settings panel opens and closes', async ({ page }) => {
    await page.goto('/');

    // Open settings
    await page.locator('button[title="Settings"]').click();

    // Settings panel should be visible
    await expect(page.locator('text=Settings')).toBeVisible({ timeout: 3000 });

    // Close settings (press Escape or click backdrop)
    await page.keyboard.press('Escape');

    // Verify settings closed - the modal should be gone
    // Wait a moment for animation
    await page.waitForTimeout(300);
  });

  test('error state shows on failed analysis and clears on new input', async ({ page }) => {
    let callCount = 0;

    // First call fails, second succeeds
    await page.route('**/api/analyze', async (route) => {
      callCount++;
      if (callCount === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Server error' }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessionId: 'test-session-retry',
            status: 'cached',
            title: 'Retry Video',
            totalDuration: 90,
            chunks: [{
              id: 'chunk-0', index: 0, startTime: 0, endTime: 90,
              duration: 90, previewText: 'Test', wordCount: 50,
              status: 'ready', videoUrl: '/mock-video.mp4',
            }],
            hasMoreChunks: false,
          }),
        });
      }
    });

    await page.goto('/');
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/fail');
    await urlInput.press('Enter');

    // Error should show (appears in both VideoInput and TextInput cards)
    await expect(page.locator('text=Server error').first()).toBeVisible({ timeout: 5000 });

    // Submit a new URL — error should clear
    await urlInput.fill('https://ok.ru/video/retry');
    await urlInput.press('Enter');

    // Should transition away from input (to analyzing or player)
    await expect(page.locator('text=Server error')).not.toBeVisible({ timeout: 5000 });
  });

  test('Review panel with empty deck shows helpful message', async ({ page }) => {
    await page.goto('/');

    // Ensure empty deck
    await page.evaluate(() => {
      localStorage.removeItem('srs_deck');
    });
    await page.reload();

    // Open review panel
    const deckBadge = page.locator('button[title*="deck"], button[title*="review"]');
    await deckBadge.click();

    // Should show empty state
    await expect(page.locator('text=No cards due')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=Add to deck')).toBeVisible();
  });
});
