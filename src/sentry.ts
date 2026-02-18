import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || '',
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_GIT_SHA || 'dev',
  tracesSampleRate: 0.2,
  beforeSend(event) {
    if (import.meta.env.VITE_E2E_TEST) return null;
    return event;
  },
});
