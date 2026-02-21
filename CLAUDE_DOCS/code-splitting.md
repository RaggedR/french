# Feature: Code Splitting
> Bundle split from a single 384KB gz chunk into multiple lazy-loaded chunks (~102KB gz initial load).

## Overview
The frontend uses Vite's `manualChunks` (function form) and React.lazy() to defer heavy dependencies that aren't needed at boot time. This reduces initial load by ~73%.

### Architecture
- **Eager chunks** (loaded immediately): `react-vendor` (60KB gz), `firebase-auth` (31KB gz), `index` app code (11KB gz)
- **Lazy chunks** (loaded on demand): `sentry` (27KB gz, background init), `firebase-firestore` (107KB gz, after auth), `VideoPlayer` + hls.js (171KB gz, on player view), component modals

### Important: `manualChunks` must use the function form
The object/array form (`{ 'react-vendor': ['react', 'react-dom'] }`) does NOT catch sub-path imports like `react-dom/client` or transitive deps like `scheduler`. The function form matches on `id.includes('node_modules/...')` which correctly captures all sub-modules.

### Key Files
- `src/firebase-auth.ts` — Firebase app + auth initialization (eager, needed at boot)
- `src/firebase-db.ts` — Firestore initialization (lazy, imported dynamically by useDeck)
- `src/firebase.ts` — Re-export barrel for backwards compatibility (tests mock this path)
- `src/hooks/useDeck.ts` — Uses dynamic `import()` for Firestore via `getFirestoreHelpers()`
- `src/App.tsx` — React.lazy() for LandingPage, PaywallScreen, SettingsPanel, ReviewPanel, VideoPlayer, AudioPlayer, TranscriptPanel
- `src/main.tsx` — Lazy Sentry init via `import('./sentry')`, no ErrorBoundary wrapper (Sentry's global handlers still catch errors once loaded)
- `vite.config.ts` — `manualChunks` function for vendor splitting

### Testing Notes
- Tests that render lazy components need `await screen.findByTestId()` instead of `screen.getByTestId()`
- API service tests mock both `../src/firebase-auth` and `../src/firebase` using `vi.hoisted()` for shared mock objects

## Resources
- [Vite manualChunks docs](https://rollupjs.org/configuration-options/#output-manualchunks)

## Assets
- `vite.config.ts`
- `src/main.tsx`
- `src/firebase-auth.ts`, `src/firebase-db.ts`, `src/firebase.ts`
- `src/hooks/useDeck.ts`
- `src/App.tsx`
- `tests/app.test.tsx`, `tests/api-service.test.ts`
