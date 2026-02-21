import { test, expect } from '@playwright/test';
import { setupMockRoutes } from '../fixtures/mock-routes';
import { MOCK_SINGLE_CHUNK } from '../fixtures/mock-data';

test.describe('Paywall — expired trial', () => {
  test('paywall appears when trial has expired', async ({ page }) => {
    // Override the E2E subscription to simulate an expired trial
    await page.addInitScript(() => {
      (window as any).__E2E_SUBSCRIPTION = {
        status: 'trialing',
        trialEnd: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        trialDaysRemaining: 0,
        currentPeriodEnd: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        needsPayment: true,
        price: 5,
        priceDisplay: '$5/month',
      };
    });

    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
    await page.goto('/');

    // Paywall should be visible
    await expect(page.locator('text=Free Trial Ended')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('subscribe-btn')).toBeVisible();
    await expect(page.locator('text=$5')).toBeVisible();
  });

  test('subscribe button triggers redirect', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_SUBSCRIPTION = {
        status: 'trialing',
        trialEnd: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        trialDaysRemaining: 0,
        currentPeriodEnd: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        needsPayment: true,
        price: 5,
        priceDisplay: '$5/month',
      };
    });

    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
    await page.goto('/');

    await expect(page.getByTestId('subscribe-btn')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('subscribe-btn').click();

    // In E2E mode, the subscribe handler sets a flag instead of redirecting
    const redirected = await page.evaluate(() => (window as any).__E2E_CHECKOUT_REDIRECTED);
    expect(redirected).toBe(true);
  });

  test('sign out from paywall returns to login', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_SUBSCRIPTION = {
        status: 'canceled',
        trialEnd: new Date().toISOString(),
        trialDaysRemaining: 0,
        currentPeriodEnd: null,
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_456',
        needsPayment: true,
        price: 5,
        priceDisplay: '$5/month',
      };
    });

    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
    await page.goto('/');

    // Paywall should show "Subscription Canceled"
    await expect(page.locator('text=Subscription Canceled')).toBeVisible({ timeout: 5000 });

    // Click sign out
    await page.getByTestId('paywall-sign-out').click();

    // Should go back to login screen
    await expect(page.locator('text=Sign in with Google')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Paywall — active subscription', () => {
  test('paywall does NOT appear during active trial', async ({ page }) => {
    // Default E2E subscription is active, so no override needed
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
    await page.goto('/');

    // Should see the main app, not the paywall
    await expect(page.locator('text=Russian Video & Text').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Free Trial Ended')).not.toBeVisible();
  });
});

test.describe('Settings — subscription display', () => {
  test('shows trial countdown for trialing user', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_SUBSCRIPTION = {
        status: 'trialing',
        trialEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
        trialDaysRemaining: 15,
        currentPeriodEnd: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        needsPayment: false,
        price: 5,
        priceDisplay: '$5/month',
      };
    });

    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
    await page.goto('/');

    // Open settings
    await page.locator('button[title="Settings"]').click();
    await expect(page.locator('text=Settings').first()).toBeVisible({ timeout: 3000 });

    // Check subscription section
    const subSection = page.getByTestId('subscription-section');
    await expect(subSection).toBeVisible();
    await expect(subSection.locator('text=Free trial')).toBeVisible();
    await expect(page.getByTestId('trial-days-remaining')).toContainText('15 days remaining');
  });

  test('shows manage button for active subscriber', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_SUBSCRIPTION = {
        status: 'active',
        trialEnd: null,
        trialDaysRemaining: 0,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_456',
        needsPayment: false,
        price: 5,
        priceDisplay: '$5/month',
      };
    });

    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });
    await page.goto('/');

    // Open settings
    await page.locator('button[title="Settings"]').click();
    await expect(page.locator('text=Settings').first()).toBeVisible({ timeout: 3000 });

    // Check subscription section
    const subSection = page.getByTestId('subscription-section');
    await expect(subSection).toBeVisible();
    await expect(subSection.locator('text=Active')).toBeVisible();
    await expect(page.getByTestId('manage-subscription-btn')).toBeVisible();

    // Click manage
    await page.getByTestId('manage-subscription-btn').click();
    const portalRedirected = await page.evaluate(() => (window as any).__E2E_PORTAL_REDIRECTED);
    expect(portalRedirected).toBe(true);
  });
});
