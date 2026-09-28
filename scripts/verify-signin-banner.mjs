/**
 * Not-signed-in dashboard banner verification.
 *
 * Two layers:
 *  1. The pure decision function (shouldShowBanner), covering every
 *     initialized/signedIn/dismissed combination.
 *  2. The real <SignInBanner/> rendered through react-dom/server against a
 *     MOCKED account hook, MOCKED Dexie cloud observable and MOCKED icons, so
 *     the component under test is the real one.
 *
 * The shared useCloudAccount() hook and the db module are stubbed; the banner
 * logic, markup and decision function are NOT.
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

console.log('');
console.log(fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`);
console.log(`${pass} passed, ${fail} failed`);
rmSync(outDir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);

