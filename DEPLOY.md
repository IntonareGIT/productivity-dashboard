# Deploying the Personal Productivity Dashboard

The app is a fully static SPA (no backend, no environment variables). Every
build of `npm run build` produces a self-contained `dist/` folder — HTML, JS,
CSS, fonts, PWA icons, `manifest.webmanifest` and the service worker — that
can be served from any static host. All data stays in the visitor's own
browser (IndexedDB); nothing is sent anywhere.

## 1. Build

```bash
npm install
npm run build        # outputs static files to dist/
npm run preview      # optional: verify the production build locally
```

Confirm the PWA works before deploying:

1. Open the preview URL, then DevTools → Network → disable the network and
   reload — the app must still load (service worker precache).
2. DevTools → Application → Manifest — no missing icons or paths.

## 2a. Deploy to Netlify (simplest — no config needed)

**Option A — drag & drop**

1. Go to <https://app.netlify.com/drop>.
2. Drag the `dist/` folder onto the page. Done — you get a live HTTPS URL.

**Option B — CLI**

```bash
npm install -g netlify-cli
netlify deploy --prod --dir=dist
```

**Option C — Git integration**

1. Push this repo to GitHub/GitLab.
2. In Netlify: "Add new site → Import an existing project".
3. Build command: `npm run build` · Publish directory: `dist`.

## 2b. Deploy to Vercel

**Option A — CLI**

```bash
npm install -g vercel
vercel --prod        # accept defaults; Vite is auto-detected
```

**Option B — Git integration**

1. Push this repo to GitHub.
2. In Vercel: "Add New → Project" → import the repo.
3. Framework preset: **Vite** · Build command: `npm run build` ·
   Output directory: `dist`. Deploy.

> This project uses no client-side router paths (single page), so no SPA
> rewrite/redirect rules are required.

## 3. Install on a phone ("Add to Home Screen")

1. Visit the deployed HTTPS URL in the phone browser
   (HTTPS is required for PWA install + service worker).
2. **iOS Safari:** Share → *Add to Home Screen*.
   **Android Chrome:** menu (⋮) → *Install app* / *Add to Home screen*.
3. The app opens standalone with its own icon; after the first load it runs
   fully offline (all assets, fonts and data are local).

## 4. Updating the app later

Re-run `npm run build` and redeploy. The service worker uses
`registerType: 'autoUpdate'` — returning visitors get the new version on the
next visit; force-refresh once if a stale copy sticks around.
