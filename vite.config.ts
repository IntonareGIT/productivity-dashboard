import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs';

// Copies the pdf.js decoder assets (wasm, cmaps, standard fonts, ICC profiles)
// from node_modules into `/pdfjs/...`, in both the dev server and the build.
// Without them pdf.js cannot draw JBIG2/JPEG2000 scans (pages come out blank).
// They are fetched on demand, not precached, so the service worker stays small.
const PDFJS_ASSET_DIRS = ['wasm', 'cmaps', 'standard_fonts', 'iccs'];
function copyPdfjsAssets(): Plugin {
  const root = path.resolve(__dirname, 'node_modules/pdfjs-dist');
  let outDir = 'dist';
  return {
    name: 'copy-pdfjs-assets',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
        const file = path.join(root, rel);
        const dir = rel.split('/')[0];
        if (!PDFJS_ASSET_DIRS.includes(dir) || !file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        if (file.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      for (const dir of PDFJS_ASSET_DIRS) {
        const from = path.join(root, dir);
        if (fs.existsSync(from)) fs.cpSync(from, path.join(outDir, 'pdfjs', dir), { recursive: true });
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    // Injected at build time and shown on the About / Help page. `toISOString`
    // so the page can slice it into a readable date without parsing.
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    copyPdfjsAssets(),
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
        runtimeCaching: [],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB
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
