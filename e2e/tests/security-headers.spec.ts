import { test, expect } from '@playwright/test';
import { setupMockRoutes } from '../fixtures/mock-routes';
import { MOCK_SINGLE_CHUNK } from '../fixtures/mock-data';

/**
 * CSP violation tests — inject report-only CSP header matching our helmet config,
 * then verify the frontend doesn't trigger any violations during normal usage.
 *
 * E2E tests run against the Vite dev server (no Express), so we inject the CSP
 * header via Playwright route interception to test frontend compliance.
 *
 * Vite dev server injects inline scripts for HMR — these don't exist in production
 * builds, so we filter out script-src-elem/inline violations in our assertions.
 */

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' https://www.youtube.com",
  "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' https://lh3.googleusercontent.com https://www.google.com",
  "connect-src 'self' https://firestore.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://*.sentry.io",
  "media-src 'self' https://storage.googleapis.com https://*.mycdn.me https://*.userapi.com https://*.okcdn.ru https://ok.ru blob:",
  "frame-src 'self' https://www.youtube.com https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
].join('; ');

/** Filter out violations that only occur in Vite dev mode, not in production builds. */
function filterDevOnlyViolations(violations: Array<{ directive: string; blockedURI: string }>) {
  return violations.filter(v => {
    // Vite dev server injects inline <script> tags for HMR — production builds are bundled
    if (v.directive === 'script-src-elem' && v.blockedURI === 'inline') return false;
    return true;
  });
}

test.describe('Security Headers — CSP Compliance', () => {
  test('no CSP violations on page load, navigation, and word interaction', async ({ page }) => {
    // Register violation listener FIRST (before any routes or navigation)
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as any).__cspViolations = (window as any).__cspViolations || [];
        (window as any).__cspViolations.push({
          directive: e.violatedDirective,
          blockedURI: e.blockedURI,
          sourceFile: e.sourceFile,
        });
      });
    });

    // Inject CSP header on the initial HTML page response
    await page.route('http://localhost:5173/', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          'content-security-policy-report-only': CSP_DIRECTIVES,
        },
      });
    });

    // Set up mock API routes with a single chunk (auto-selects to player view)
    await setupMockRoutes(page, { chunks: MOCK_SINGLE_CHUNK, cached: true });

    // Phase 1: Load the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Phase 2: Navigate to player view (single chunk = auto-select)
    const urlInput = page.locator('input[placeholder*="ok.ru"]');
    await urlInput.fill('https://ok.ru/video/123456');
    await urlInput.press('Enter');
    await page.waitForSelector('.cursor-pointer', { timeout: 10000 });

    // Phase 3: Interact with a word (triggers translation popup)
    const word = page.locator('.cursor-pointer').first();
    await word.click();
    await page.waitForTimeout(500);

    // Assert: no production-relevant CSP violations occurred across all phases
    const cspViolations = await page.evaluate(() => (window as any).__cspViolations || []);
    const realViolations = filterDevOnlyViolations(cspViolations);
    expect(realViolations).toEqual([]);
  });
});
