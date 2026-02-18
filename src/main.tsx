import './sentry'; // Must be first import — initializes Sentry before other code runs
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<p className="p-8 text-center text-lg">Something went wrong. Please refresh the page.</p>}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
