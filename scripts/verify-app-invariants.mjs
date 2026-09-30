/**
 * App invariants that span several features.
 *
 * 1-7. Not-signed-in dashboard banner: the pure decision function plus the real
 *     <SignInBanner/> rendered through react-dom/server against a MOCKED
 *     account hook, MOCKED Dexie cloud observable and MOCKED icons. The shared
 *     useCloudAccount() hook and the db module are stubbed; the banner logic,
 *     markup and decision function are NOT.
 * 8.   AI provider sync policy (aiProviders is synced, seeding is guarded) and
 *     the absence of the deprecated `gemini-2.0-flash` model.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Inside the project: the bundle externalises `react`, so Node must resolve it
// from this project's node_modules rather than the OS temp dir.
const outDir = mkdtempSync(join(process.cwd(), '.verify-signin-banner-'));

/** Real stub files, so the test can import the controls it exposes. */
const hookStubPath = join(outDir, 'hook-stub.mjs');
const dbStubPath = join(outDir, 'db-stub.mjs');
const iconsStubPath = join(outDir, 'icons-stub.mjs');
const entryPath = join(outDir, 'entry.mjs');

writeFileSync(hookStubPath, `
/** Mutable test controls, read fresh on every render. */
export const control = { signedIn: false, busy: false, signInCalls: 0 };
export function useCloudAccount() {
  return {
    state: { signedIn: control.signedIn, email: null, status: '', tone: 'muted',
             pendingWork: false, errorMessage: null, diagnostics: null },
    busy: control.busy,
    signIn: async () => { control.signInCalls += 1; },
    signOut: async () => {},
    syncNow: async () => {},
    clearError: () => {},
  };
}
`);

writeFileSync(dbStubPath, `
/** MOCK of the addon's currentUser observable. */
export const control = { currentUserValue: undefined, subscribers: [] };
export const db = {
  cloud: {
    get currentUser() {
      return {
        get value() { return control.currentUserValue; },
        subscribe(fn) {
          control.subscribers.push(fn);
          return { unsubscribe() {} };
        },
      };
    },
  },
};
`);

writeFileSync(iconsStubPath, `
const mk = () => () => null;
export const CloudOff = mk();
export const LogIn = mk();
`);

writeFileSync(entryPath, `
export { SignInBanner } from ${JSON.stringify(resolve('src/features/dashboard/components/SignInBanner.tsx'))};
export { shouldShowBanner, SIGN_IN_BANNER_TEXT } from ${JSON.stringify(resolve('src/features/dashboard/components/signInBannerState.ts'))};
export { control as hookControl } from './hook-stub.mjs';
export { control as dbControl } from './db-stub.mjs';
`);

await build({
  entryPoints: [entryPath],
  outfile: join(outDir, 'bundle.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  logLevel: 'silent',
  // Keep ONE React instance: an inlined copy would be a different dispatcher
  // from the one react-dom/server uses ("Invalid hook call").
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  plugins: [
    {
      name: 'stub',
      setup(b) {
        b.onResolve({ filter: /useCloudAccount$/ }, () => ({ path: hookStubPath }));
        b.onResolve({ filter: /db\/db$/ }, () => ({ path: dbStubPath }));
        b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: iconsStubPath }));
      },
    },
  ],
});

const mod = await import(`file://${join(outDir, 'bundle.mjs').replace(/\\/g, '/')}`);
const { SignInBanner, shouldShowBanner, SIGN_IN_BANNER_TEXT, hookControl, dbControl } = mod;
const { renderToStaticMarkup } = await import('react-dom/server');
const { createElement } = await import('react');

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

const render = () => renderToStaticMarkup(createElement(SignInBanner));

/** Drive both mocks, then render the real component. */
const renderWith = ({ signedIn, currentUserValue }) => {
  hookControl.signedIn = signedIn;
  dbControl.currentUserValue = currentUserValue;
  return render();
};
// ---- 1. Pure decision table ---------------------------------------------
{
  const t = (i, s, d) => shouldShowBanner({ initialized: i, signedIn: s, dismissed: d });
  check('1 hidden while the state is still loading', t(false, false, false) === false);
  check('1 hidden while loading even if dismissed', t(false, false, true) === false);
  check('1 shown when settled and signed out', t(true, false, false) === true);
  check('1 hidden when signed in', t(true, true, false) === false);
  check('1 hidden when signed in and previously dismissed', t(true, true, true) === false);
  check('1 hidden after "Not now"', t(true, false, true) === false);
  check('1 signed-in check wins over dismiss (hides without a reload)', t(true, true, true) === false);
  check('1 banner text is the agreed copy',
    SIGN_IN_BANNER_TEXT ===
      'Not signed in. Your data is only saved on this device and is not backed up. Clearing browser data or losing this device will erase it.');
}

// ---- 2. Rendered output while signed out --------------------------------
{
  const out = renderWith({ signedIn: false, currentUserValue: { isLoggedIn: false } });
  check('2 banner renders when signed out', out.includes('Not signed in.'));
  check('2 renders the full warning copy', out.includes('not backed up') && out.includes('will erase it'));
  check('2 has role="status"', out.includes('role="status"'));
  check('2 has a Sign in button', out.includes('Sign in'));
  check('2 has a Not now button', out.includes('Not now'));
  check('2 is full width on desktop', /\bw-full\b/.test(out));
  check('2 stacks buttons below the text under 768px',
    out.includes('flex-col') && out.includes('sm:flex-row'));
  check('2 uses theme tokens, not fixed colours',
    out.includes('bg-accent-subtle') && out.includes('border-border') && out.includes('text-content-primary'));
  check('2 buttons meet the 44px touch target', out.includes('min-h-[44px]'));
}

// ---- 3. Hidden while the sign-in state is undetermined ------------------
{
  const out = renderWith({ signedIn: false, currentUserValue: undefined });
  check('3 hidden while the state is undetermined (no flash for signed-in users)',
    out === '', JSON.stringify(out));
}

// ---- 4. Hidden when signed in -------------------------------------------
{
  const out = renderWith({ signedIn: true, currentUserValue: { isLoggedIn: true, email: 'a@b.c' } });
  check('4 hidden when signed in', out === '', JSON.stringify(out));
}

// ---- 5. Real signed-in check, not currentUser truthiness ----------------
{
  // A currentUser object exists but isLoggedIn is false (the anonymous realm).
  // The hook reports signedIn:false, so the banner MUST show.
  const out = renderWith({ signedIn: false, currentUserValue: { userId: 'anon', isLoggedIn: false } });
  check('5 an anonymous currentUser object still shows the banner', out.includes('Not signed in'));
  // The reverse trap: a truthy currentUser must not be read as signed in.
  const out2 = renderWith({ signedIn: true, currentUserValue: { userId: 'u1', isLoggedIn: true } });
  check('5 a truthy currentUser alone does not force the banner off', out2 === '');
}

// ---- 6. "Not now" hides it until the next load --------------------------
{
  // "Not now" sets in-memory React state only. A new app load starts from
  // dismissed=false, so the banner returns.
  check('6 "Not now" hides the banner for this load',
    shouldShowBanner({ initialized: true, signedIn: false, dismissed: true }) === false);
  check('6 a fresh load brings the banner back (nothing persisted)',
    shouldShowBanner({ initialized: true, signedIn: false, dismissed: false }) === true);

  // Strip comments first: prose that MENTIONS localStorage must not count as
  // a use of it.
  const code = readFileSync('src/features/dashboard/components/SignInBanner.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  check('6 dismissal is not written to localStorage/sessionStorage',
    !/localStorage|sessionStorage/.test(code));
  check('6 dismissal is not written to the synced db',
    !/db\.[a-zA-Z]+\.(put|add|update|bulkPut)/.test(code));
  check('6 the banner never writes to the database at all',
    !/db\.(uiState|appSettings|themeStatusMap)/.test(code));
  check('6 "Not now" uses in-memory state only',
    /useState\(false\)/.test(code) && /setDismissed\(true\)/.test(code));
}

// ---- 7. Mounted on the Dashboard only -----------------------------------
{
  const dash = readFileSync('src/features/dashboard/DashboardPage.tsx', 'utf8');
  check('7 DashboardPage renders the banner', dash.includes('<SignInBanner />'));
  check('7 the banner sits above the "Welcome back" heading',
    dash.indexOf('<SignInBanner />') > -1 &&
    dash.indexOf('<SignInBanner />') < dash.indexOf('Welcome back'));

  const all = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name)) all.push(p);
    }
  };
  walk('src');
  // A mount is `<SignInBanner ... />`; the component's own definition of
  // `export const SignInBanner` is not a mount and must not be counted.
  const users = all.filter((f) => /<SignInBanner\b/.test(readFileSync(f, 'utf8')));
  check('7 only DashboardPage mounts it',
    users.length === 1 && users[0].replace(/\\/g, '/').endsWith('features/dashboard/DashboardPage.tsx'),
    users.map((u) => u.split(/[\\/]/).pop()).join(','));
}

// ---- 8. AI provider sync policy + no deprecated model -------------------
{
  const read = (p) => readFileSync(p, 'utf8');

  // 8a. aiProviders must NOT be excluded from sync any more.
  const cloudConfig = read('src/db/cloudConfig.ts');
  check('8 aiProviders is not in UNSYNCED_TABLES',
    !/UNSYNCED_TABLES[^=]*=\s*\[[^\]]*aiProviders/.test(cloudConfig));
  check('8 UNSYNCED_TABLES still exists as the single opt-out point',
    /export const UNSYNCED_TABLES/.test(cloudConfig));

  // 8b. The deprecated model is gone from code and docs, and the new one is in.
  const sources = [];
  const walkAll = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walkAll(p);
      else if (/\.(ts|tsx|mjs|js|css|json|md)$/.test(e.name)) sources.push(p);
    }
  };
  walkAll('src');
  // PROJECT.md is documentation, not code. The verify scripts are excluded:
  // this file necessarily names the deprecated model in order to assert it is
  // gone, so scanning itself would always fail.
  sources.push('PROJECT.md');
  const stale = sources.filter((f) => read(f).includes('gemini-2.0-flash'));
  check('8 no source or doc still names gemini-2.0-flash',
    stale.length === 0, stale.join(','));
  check('8 the default provider uses the new model',
    read('src/db/defaultData.ts').includes("modelName: 'gemini-3.1-flash-lite'"));
  check('8 the model placeholder uses the new model',
    read('src/features/settings/components/AiProvidersSettings.tsx')
      .includes('placeholder="e.g. gemini-3.1-flash-lite"'));

  // 8c. Seeding a now-synced table must be limited to signed-out devices.
  const defaults = read('src/db/defaultData.ts');
  const initBody = defaults.slice(defaults.indexOf('export async function initializeDatabaseDefaults'));
  check('8 aiProviders seeding is guarded by a signed-in check',
    /if \(!db\.cloud\?\.currentUser\?\.value\?\.isLoggedIn\)[\s\S]*db\.aiProviders\.put/.test(initBody));
  check('8 the guard uses the real isLoggedIn flag, not currentUser truthiness',
    initBody.includes('isLoggedIn') && !/db\.cloud\.currentUserId/.test(initBody));

  // 8d. No schema change was needed for the AI-provider work: v8 was the last
  // version added, and no .modify() upgrade was run on a synced table.
  //
  // v9 (note titles) came later and IS an intentional schema change, so this
  // guard is pinned to "nothing beyond v9", not to "nothing beyond v8".
  const dbSrc = read('src/db/db.ts');
  check('8 no schema version beyond v10 (resource groups) was added',
    !/this\.version\(1[1-9]\)/.test(dbSrc));
  check('8 no Version.upgrade() on any synced table',
    !/upgrade\s*\(\s*\)\s*\.modify\(\s*async\s*\(\s*t\s*,\s*c\s*\)\s*=>\s*\{[\s\S]*?aiProviders/i
      .test(dbSrc));

  // v9 itself must stay additive: the topics primary key is unchanged and the
  // upgrade may only write `title`/`updatedAt`, never the note body.
  const v9 = dbSrc.slice(dbSrc.indexOf('this.version(9)'));
  check('9 v9 keeps the topics primary key as `id`', /topics: 'id,/.test(v9));
  check('9 v9 upgrade only rewrites title', /put\(\{ \.\.\.t, title, updatedAt: now \}\)/.test(v9));
}

console.log('');
console.log(fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`);
console.log(`${pass} passed, ${fail} failed`);
rmSync(outDir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);

