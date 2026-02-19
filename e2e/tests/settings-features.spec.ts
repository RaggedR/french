import { test, expect } from '@playwright/test';
import { setupMockRoutes } from '../fixtures/mock-routes';
import { MOCK_SINGLE_CHUNK, makeDueCard } from '../fixtures/mock-data';

test.describe('Deck export', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
  });

  test('export button is disabled when deck is empty', async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title="Settings"]').click();
    await expect(page.locator('text=Settings').first()).toBeVisible({ timeout: 3000 });

    const exportBtn = page.getByTestId('export-deck-btn');
    await expect(exportBtn).toBeVisible();
    await expect(exportBtn).toBeDisabled();
    await expect(exportBtn).toContainText('No cards to export');
  });

  test('export button shows card count and triggers download', async ({ page }) => {
    // Pre-populate localStorage with a card so the deck has content
    const card = makeDueCard();
    await page.addInitScript((cardData) => {
      localStorage.setItem('srs_deck', JSON.stringify([cardData]));
    }, card);

    await page.goto('/');
    await page.locator('button[title="Settings"]').click();
    await expect(page.locator('text=Settings').first()).toBeVisible({ timeout: 3000 });

    const exportBtn = page.getByTestId('export-deck-btn');
    await expect(exportBtn).toBeEnabled();
    await expect(exportBtn).toContainText('Export 1 cards');

    // Set up download listener
    const downloadPromise = page.waitForEvent('download');
    await exportBtn.click();
    const download = await downloadPromise;

    // Verify filename pattern
    expect(download.suggestedFilename()).toMatch(/^russian-deck-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

test.describe('Legal documents in settings', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
  });

  test('ToS and Privacy Policy sections appear and expand/collapse', async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title="Settings"]').click();
    await expect(page.locator('text=Settings').first()).toBeVisible({ timeout: 3000 });

    // Headers visible
    const tosToggle = page.getByTestId('tos-toggle');
    const privacyToggle = page.getByTestId('privacy-toggle');
    await expect(tosToggle).toBeVisible();
    await expect(privacyToggle).toBeVisible();

    // Content initially hidden
    await expect(page.getByTestId('tos-content')).not.toBeVisible();
    await expect(page.getByTestId('privacy-content')).not.toBeVisible();

    // Click to expand ToS
    await tosToggle.click();
    await expect(page.getByTestId('tos-content')).toBeVisible();
    await expect(page.getByTestId('tos-content')).toContainText('Acceptance of Terms');

    // Click to collapse ToS
    await tosToggle.click();
    await expect(page.getByTestId('tos-content')).not.toBeVisible();

    // Click to expand Privacy
    await privacyToggle.click();
    await expect(page.getByTestId('privacy-content')).toBeVisible();
    await expect(page.getByTestId('privacy-content')).toContainText('Information We Collect');
  });
});

test.describe('Legal agreement on login screen', () => {
  test('shows agreement text with expandable legal docs', async ({ page }) => {
    // Set E2E no-auth flag so the E2E auth bypass starts in logged-out state
    await page.addInitScript(() => {
      (window as any).__E2E_NO_AUTH = true;
    });

    // Block Firebase and frequency data (not needed for login screen)
    await page.route('**/*firebaseapp.com*/**', route => route.abort());
    await page.route('**/*googleapis.com/identitytoolkit/**', route => route.abort());
    await page.route('**/*firestore.googleapis.com/**', route => route.abort());
    await page.route('**/russian-word-frequencies.json', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    await page.goto('/');

    // Agreement text should be visible
    const agreement = page.getByTestId('legal-agreement');
    await expect(agreement).toBeVisible({ timeout: 5000 });
    await expect(agreement).toContainText('By signing in');

    // Click ToS link to expand
    await page.getByTestId('login-tos-link').click();
    await expect(page.getByTestId('login-tos-content')).toBeVisible();
    await expect(page.getByTestId('login-tos-content')).toContainText('Acceptance of Terms');

    // Click Privacy link (should switch from ToS to Privacy)
    await page.getByTestId('login-privacy-link').click();
    await expect(page.getByTestId('login-privacy-content')).toBeVisible();
    await expect(page.getByTestId('login-tos-content')).not.toBeVisible();
  });
});

test.describe('Usage display', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
  });

  test('shows combined API usage bars with values from API', async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title="Settings"]').click();
    await expect(page.locator('text=Settings').first()).toBeVisible({ timeout: 3000 });

    // Usage section should appear with combined values from mock API
    await expect(page.locator('text=API Usage')).toBeVisible();
    await expect(page.locator('text=OpenAI + Google Translate (merged into single budget)')).toBeVisible();

    // Check that combined usage values are rendered (from mock /api/usage response)
    await expect(page.locator('text=$0.55 / $1.00')).toBeVisible();   // Daily: 0.45 + 0.10
    await expect(page.locator('text=$4.50 / $10.00')).toBeVisible();  // Monthly: 3.50 + 1.00
  });
});

test.describe('Account deletion', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
  });

  test('delete button requires typing DELETE', async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title="Settings"]').click();
    await expect(page.locator('text=Settings').first()).toBeVisible({ timeout: 3000 });

    // Danger zone visible
    await expect(page.locator('text=Danger Zone')).toBeVisible();

    const deleteBtn = page.getByTestId('delete-account-btn');
    const confirmInput = page.getByTestId('delete-confirm-input');

    // Button should be disabled by default
    await expect(deleteBtn).toBeDisabled();

    // Typing wrong text keeps it disabled
    await confirmInput.fill('delete');
    await expect(deleteBtn).toBeDisabled();

    // Typing exact "DELETE" enables it
    await confirmInput.fill('DELETE');
    await expect(deleteBtn).toBeEnabled();
  });

  test('successful deletion redirects to login screen', async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title="Settings"]').click();
    await expect(page.locator('text=Settings').first()).toBeVisible({ timeout: 3000 });

    // Type DELETE and click
    await page.getByTestId('delete-confirm-input').fill('DELETE');
    await page.getByTestId('delete-account-btn').click();

    // Should redirect to login screen (sign in button visible)
    await expect(page.locator('text=Sign in with Google')).toBeVisible({ timeout: 5000 });
  });
});
