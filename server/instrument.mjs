import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  enabled: !!process.env.SENTRY_DSN,
  environment: process.env.GCS_BUCKET ? 'production' : 'development',
  release: process.env.GIT_SHA || 'dev',
  sendDefaultPii: true,
  tracesSampleRate: 0.2,
  beforeSend(event) {
    if (process.env.VITEST) return null; // Never send during tests
    return event;
  },
});
