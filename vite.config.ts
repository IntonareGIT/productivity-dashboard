import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Productivity Dashboard',
        short_name: 'Productivity',
        description: 'Personal Productivity Dashboard: Library, Calendar, Shifts & Focus',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        // Only same-origin build assets are precached, so Dexie Cloud requests
        // (a different origin) are never served from, or written to, the cache.
        // Keeping runtimeCaching empty means Workbox registers no fetch handler
        // for cross-origin traffic, so sync requests always hit the network —
        // or fail cleanly while offline, rather than returning stale data.
        // `mjs` is essential, not optional: `pdfjs-dist`'s worker is emitted as
        // `pdf.worker.min-<hash>.mjs`, and it was the ONE file in dist without
        // an extension in this list. Workbox silently skipped it, so the app
        // installed and precached fine but every PDF failed offline with a
        // "Setting up fake worker failed / Failed to fetch dynamically
        // imported module" error — the viewer, not the network, was broken.
        // Adding `mjs` is what makes PDFs work with no connection.
        globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,woff,woff2,webmanifest}'],
        // Belt and braces: never let a stale precache entry point at a file
        // that a new build no longer emits, or the SW 404s on a cache hit.
        navigateFallback: 'index.html',
        runtimeCaching: []
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'lucide-react': path.resolve(__dirname, './node_modules/lucide-react/dist/esm/lucide-react.js')
    }
  }
});

