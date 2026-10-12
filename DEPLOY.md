# Deploying the Personal Productivity Dashboard

The app is a static SPA plus one serverless function (`/api/ai`, the AI
gateway). Every build of `npm run build` produces a self-contained `dist/`
folder — HTML, JS, CSS, fonts, PWA icons, `manifest.webmanifest` and the
service worker — that can be served from any static host. All data stays in the
visitor's own browser (IndexedDB); nothing is sent anywhere — except assistant
chat requests, which go to `/api/ai` after the user signs in to Dexie Cloud.

> **The AI assistant only works where `/api/ai` runs.** A plain static host
> (Netlify drag & drop, GitHub Pages) serves the UI fine, but assistant chat
> requests will fail because there is no server side to attach the model key.
> Deploy to Vercel (below) for the full assistant.

## 0. AI gateway environment variables (Vercel)

Set these on the Vercel project (Dashboard → Settings → Environment
Variables) — they are the ONLY place model keys live:

| Variable         | Required | Purpose                                                     |
| ---------------- | -------- | ----------------------------------------------------------- |
| `GEMINI_API_KEY` | yes*     | Server-side key for Gemini, the default upstream            |
| `GROQ_API_KEY`   | yes*     | Server-side key for Groq (used when requested, or as backup)|
| `GEMINI_MODEL`   | no       | Override the Gemini model (default `gemini-3.1-flash-lite`) |
| `GROQ_MODEL`     | no       | Override the Groq model (default `llama-3.3-70b-versatile`) |

\* At least one of the two keys must be set. Keys are never committed, never
sent to the browser, and the gateway scrubs both from every response it
returns.

Each request to `/api/ai` must carry `Authorization: Bearer <Dexie Cloud
access token>`; the gateway verifies it with Dexie Cloud (`GET
/token/validate`, expecting `200 { valid: true }`) and answers 401 for
anything else — including a missing header.


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

## 2c. R2 file storage (required for file uploads)

File uploads go to a Cloudflare R2 bucket via presigned PUT URLs. The bucket
needs CORS rules, otherwise browser PUTs fail with a network error and the
object lands at 0 bytes — that is the usual cause of "Upload failed: network
error".

Set these environment variables on the Vercel project (Dashboard → Settings →
Environment Variables):

| Variable                 | Required | Purpose                                            |
| ------------------------ | -------- | -------------------------------------------------- |
| `R2_ACCOUNT_ID`          | yes      | Cloudflare account ID                              |
| `R2_ACCESS_KEY_ID`       | yes      | R2 access key ID                                   |
| `R2_SECRET_ACCESS_KEY`   | yes      | R2 secret access key                               |
| `R2_BUCKET`              | yes      | Bucket name (`dashboard-files`)                    |

Then add this CORS rule to the bucket (via `wrangler` or the R2 dashboard):

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "HEAD", "DELETE"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "MaxAge": 86400
  }
]
```

`DELETE` is required, not optional: deleting a cloud copy sends a presigned
DELETE, which is never a "simple" request and therefore needs the preflight
to succeed. Leaving it out is exactly why "Could not delete from the cloud"
returns `Failed to fetch` — the same CORS failure as uploads, with the object
sitting at 0 bytes.

`AllowedOrigins: ["*"]` is fine here — the presigned URL itself is the
authentication, so CORS does not widen access.

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
