# Overnight report — not-signed-in Dashboard banner

**Branch:** `feature/signin-banner` (created from `main` at `8910722`; `main` was
not modified and nothing was pushed).
**Commit:** `1aa1b59` — *Add not-signed-in warning banner to the Dashboard*
(single commit on the branch).

## Status tree check (safety rule 1)

The first `git status` was **clean**, so the branch was created as instructed.

## What was done

A warning banner at the top of the Dashboard, above the "Welcome back" heading,
shown whenever the user is known to be signed out, with **Sign in** and
**Not now** buttons.

New files:

- `src/features/dashboard/components/SignInBanner.tsx` — the component.
- `src/features/dashboard/components/signInBannerState.ts` — the pure
  `shouldShowBanner()` decision plus the banner copy, deliberately free of
  React/Dexie/browser APIs so it can be verified directly.
- `scripts/verify-signin-banner.mjs` — the verification script.

Modified:

- `src/features/dashboard/DashboardPage.tsx` — mounts `<SignInBanner />` above
  the heading. This is the **only** file that mounts it.
- `package.json` — added a `verify` script chaining all five verify scripts.
- `PROJECT.md` — new §1.13.2 plus file-tree entries.

## Requirement mapping

| Requirement | How it is met |
| --- | --- |
| Real signed-in check | `useCloudAccount().state.signedIn`, i.e. the addon's `isLoggedIn` — the same value Settings → Sync uses. Never the mere existence of a `currentUser` object, which also exists for the anonymous realm. |
| Shared hook only | The banner calls that hook and its existing `signIn()`. The hook, sign-in/out logic, sync setup, schema and theme code are all untouched. |
| Copy | Exact agreed wording, held in `SIGN_IN_BANNER_TEXT` and asserted by the test so UI and test cannot drift. |
| No startup flash | The hook exposes no `initialized` flag, so one is derived **inside the banner only**: a lazy `useState` initializer reads `db.cloud.currentUser?.value` during the *first render*, and a `useEffect` subscribes for later changes. The hook was not modified. |
| "Not now" until next load | In-memory React state only. Nothing is written to the synced database, `localStorage` or `sessionStorage` — all three are asserted absent from the component source. |
| Hides on sign-in, no reload | `shouldShowBanner()` checks `signedIn` **before** `dismissed`, so signing in wins regardless of the dismiss state. |
| Warning style, all 4 themes | `bg-accent-subtle`, `border-border`, `text-content-primary` — tokens defined per theme in light and dark — plus the `text-amber-500` icon colour already used for the `warn` tone in `SyncAccountPanel`. |
| Full width / responsive | `w-full`; `flex-col` with `sm:flex-row` stacks the buttons below the text under 768px. |
| Accessible | `role="status"`; icon is `aria-hidden`; buttons keep the 44px touch target used elsewhere. |
| Dashboard only | A test walks all `.tsx` files and asserts exactly one mount, in `DashboardPage`. |

## Tested

`npm run build` passes (TypeScript + Vite, `✓ built in 12.76s`).

`npm run verify` — all five scripts pass:

- `verify-signin-banner.mjs` — **30 passed, 0 failed**
- `verify-theme-persistence.mjs` — ALL CHECKS PASSED
- `verify-extended-tools.mjs` — ALL CHECKS PASSED
- `verify-chat-history.mjs` — ALL CHECKS PASSED
- `verify-thought-signature.mjs` — ALL CHECKS PASSED

The banner script renders the **real** component through `react-dom/server`
against a mocked account hook, a mocked `currentUser` observable and mocked
icons. It covers hidden-while-loading, shown-when-signed-out,
hidden-when-signed-in, the anonymous-`currentUser` trap in both directions,
"Not now" hiding it and returning on a fresh load, the required
markup/role/responsive classes, and Dashboard-only mounting.

## Could not be tested

**No visual/browser verification.** There is no browser automation in this
environment, so the following were confirmed by inspecting the rendered markup
and the theme token definitions, but never seen on screen:

- Actual readability across all four themes in light and dark.
- The real responsive breakpoint behaviour at 768px.
- The real startup flash behaviour with a live Dexie Cloud connection.

The manual checklist below covers these.


## Decisions made (no one was available to ask)

1. **The theme has no dedicated warning token.** Rather than add one (which
   would mean touching theme files, out of scope for a banner), the banner uses
   the existing theme-neutral tokens. `bg-accent-subtle` is a translucent tint
   of each theme's own accent, so it stays legible in all four themes.
2. **"Not now" uses in-memory state, not `sessionStorage`.** The brief allowed
   either. `sessionStorage` survives a reload, which would contradict "hides it
   until the next app load", so in-memory state is the correct reading.
3. **Derived `initialized` during render, not in an effect.** The brief
   suggested waiting for the observable's first value. Doing that inside
   `useEffect` meant one frame where a signed-in user could see the banner, and
   it also made the component untestable under `react-dom/server` (effects do
   not run). Reading `.value` in a lazy `useState` initializer is strictly
   safer and still respects "work it out inside the banner component only".
4. **Split pure logic from the component.** `shouldShowBanner()` lives in its
   own module so the decision table is testable without React, and so the copy
   and the visibility rules cannot drift apart.
5. **Added an `npm run verify` script.** The four existing verify scripts were
   not wired into `package.json`. The new one makes "every existing verify
   script must pass" a single command. No dependencies were added.
6. **Two test bugs were found and fixed** (not component bugs): a regex matched
   the word "localStorage" inside my own comment, and the Dashboard-only check
   counted the component's own definition as a mount. Both tests were corrected
   to strip comments and to match a real `<SignInBanner />` mount.

## Files touched

```
A  scripts/verify-signin-banner.mjs
A  src/features/dashboard/components/SignInBanner.tsx
A  src/features/dashboard/components/signInBannerState.ts
M  src/features/dashboard/DashboardPage.tsx
M  package.json
M  PROJECT.md
```

`dexie-cloud.key` and `dexie-cloud.json` were never opened, printed or
committed. No `git push`, `reset --hard`, `clean` or forced command was run.
No dependencies added, no files deleted.

## Final state

`git log --oneline` (branch `feature/signin-banner`):

```
1aa1b59 Add not-signed-in warning banner to the Dashboard
1d7bbb8 Sync status and theme override across devices via a uiState row
8910722 Fix theme/status lost on refresh and leaking across devices
cf2d813 Remove top-bar status pill; merge menu sections into 'Mood and theme'
b76a6b1 Add top-bar profile menu with account, status and theme controls
```

Note `1d7bbb8` (the `uiState` sync work) was committed earlier in the session,
before this branch was created, so it appears in the history above but is not
part of this banner task.

`git status`:

```
On branch feature/signin-banner
nothing to commit, working tree clean
```

## Manual checklist for you

Please run these in a real browser — this is the part I could not automate.

1. **Incognito window shows the banner.** Open the app in an incognito window
   (signed out). The warning should appear at the top of the Dashboard, above
   "Welcome back".
2. **It appears on the Dashboard only.** Visit Library, Calendar, Focus,
   Settings, Assistant. The banner must not appear on any of them.
3. **Signing in makes it disappear.** With the banner showing, click **Sign in**
   and complete the flow. The banner should vanish immediately, with no reload.
4. **"Not now" hides it until refresh.** Reload the page first so the banner is
   back, then click **Not now**. It should hide at once. Now reload the page —
   the banner should reappear (dismissal lasts only for that app load).
5. **A signed-in window never shows it, including right after reload.** In a
   window where you are already signed in, open the Dashboard, then hard-reload
   (Ctrl/Ctrl+Shift+R). The banner must not flash or appear at any point.
6. **Theme and light/dark legibility.** While signed out and on the Dashboard,
   switch through all four themes and toggle light/dark in each. The banner text
   and buttons should stay readable everywhere. Try the `playing` theme (amber
   accent) and `researching` (indigo) specifically, as these differ most.
7. **Responsive layout.** Narrow the window below 768px. The **Sign in** and
   **Not now** buttons should stack below the text rather than sit beside it.
8. **Dismissal is not synced.** In a signed-in window, set the status/theme on
   one device and confirm no "not signed in" banner state appears on the other.
