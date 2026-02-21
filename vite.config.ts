import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// https://vite.dev/config/
export default defineConfig({
  build: {
    sourcemap: 'hidden', // Generate for Sentry upload, don't expose in prod
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/firebase/auth') || id.includes('node_modules/@firebase/auth') ||
              id.includes('node_modules/firebase/app') || id.includes('node_modules/@firebase/app') ||
              id.includes('node_modules/@firebase/util') || id.includes('node_modules/@firebase/logger') ||
              id.includes('node_modules/@firebase/component') || id.includes('node_modules/idb/')) {
            return 'firebase-auth';
          }
          if (id.includes('node_modules/firebase/firestore') || id.includes('node_modules/@firebase/firestore') ||
              id.includes('node_modules/@firebase/webchannel-wrapper')) {
            return 'firebase-firestore';
          }
          if (id.includes('node_modules/@sentry/') || id.includes('node_modules/@sentry-internal/')) {
            return 'sentry';
          }
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    // Only upload source maps when auth token is available (CI deploy only)
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
        })]
      : []),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // Required for SSE (Server-Sent Events) to work properly
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Disable buffering for SSE endpoints
            if (req.url?.includes('/progress/')) {
              proxyReq.setHeader('Cache-Control', 'no-cache');
            }
          });
        },
      },
    },
  },
})
