import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Lazy-init Sentry — don't block first paint with 28KB gz of error monitoring.
// ErrorBoundary wraps the app after Sentry loads; in the meantime, a plain
// try/catch in React's own error handling covers crashes.
import('./sentry').catch(() => {
  // Sentry init failed (no DSN, blocked, etc.) — app works fine without it
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
