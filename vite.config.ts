import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// https://vite.dev/config/
export default defineConfig({
  build: {
    sourcemap: 'hidden', // Generate for Sentry upload, don't expose in prod
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
