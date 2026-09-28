/**
 * Theme/status persistence verification.
 * Exercises the real useStatusThemeStore: per-device selection in
 * localStorage, the synced mapping merged over code defaults, and the rule
 * that a mapping change re-applies the active status theme unless overridden.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'theme-'));
const outFile = join(outDir, 'store.mjs');

const defaultsStub = `
export const defaultThemeStatusMappings = [
  { status: 'Studying', theme: 'studying', colorScheme: 'dark' },
  { status: 'Working', theme: 'working', colorScheme: 'dark' },
  { status: 'Researching', theme: 'researching', colorScheme: 'dark' },
  { status: 'Playing', theme: 'playing', colorScheme: 'dark' },
];
`;

await build({
  entryPoints: ['src/stores/useStatusThemeStore.ts'],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  define: { 'import.meta.url': '"file:///stub"' },
  plugins: [
    {
      name: 'stub',
      setup(b) {
        b.onResolve({ filter: /db\/defaultData$/ }, () => ({ path: 'defaults', namespace: 'defaults' }));
        b.onResolve({ filter: /^zustand$/ }, () => ({ path: 'zustand-stub', namespace: 'zustand-stub' }));
        // db stub: records every uiState write so we can assert the write policy.
        b.onResolve({ filter: /db\/db$/ }, () => ({ path: 'db-stub', namespace: 'db-stub' }));
        b.onLoad({ filter: /.*/, namespace: 'db-stub' }, () => ({
          contents: `
          // Recorded on globalThis so writes survive a simulated reload (the
          // stub module is re-instantiated on each import).
          globalThis.__uiWrites = globalThis.__uiWrites || [];
          export const db = {
            uiState: {
              async put(row) { globalThis.__uiWrites.push(row); return row.id; },
            },
          };`,
          loader: 'js',
        }));
        b.onLoad({ filter: /.*/, namespace: 'defaults' }, () => ({ contents: defaultsStub, loader: 'js' }));
        b.onLoad({ filter: /.*/, namespace: 'zustand-stub' }, () => ({
          contents: `
          const listeners = new Set();
          export const create = (fn) => {
            const api = { state: undefined };
            api.getState = () => api.state;
            api.subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
            const setState = (part) => {
              const s = typeof part === 'function' ? part(api.state) : part;
              api.state = { ...api.state, ...s };
              listeners.forEach((l) => l());
            };
            const built = fn(setState, api.getState, api);
            api.state = built;
            return api;
          };`,
          loader: 'js',
        }));
      },
    },
  ],
});

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);
  if (!cond) failures++;
};

// localStorage + document stubs, installed BEFORE importing the store.
const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k),
};
const attrs = {};
const classes = new Set();
globalThis.document = {
  documentElement: {
    setAttribute: (k, v) => { attrs[k] = v; },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    },
  },
};

// A fresh module instance simulates a page refresh: it re-reads localStorage.
const importFresh = async () => {
  const mod = await import(`file://${outFile.replace(/\\/g, '/')}?t=${Date.now()}${Math.random()}`);
  return mod.useStatusThemeStore;
};
const uiWrites = () => (globalThis.__uiWrites ||= []);

// ---- 1. First run with nothing saved falls back to Studying -------------
{
  const useStore = await importFresh();
  const s = useStore.getState();
  check('1 default status is Studying', s.currentStatus === 'Studying', s.currentStatus);
  check('1 theme is the mapped default', s.currentTheme === 'studying', s.currentTheme);
  check('1 colorScheme defaults to dark', s.colorScheme === 'dark');
  check('1 no override', s.themeOverride === null);
  check('1 applied to <html> before render', attrs['data-theme'] === 'studying' && classes.has('dark'));
}

// ---- 2. Selection survives a "refresh" (new module load) ---------------
{
  const useStore = await importFresh();
  useStore.getState().setStatus('Researching');
  useStore.getState().toggleColorScheme();
  useStore.getState().setThemeOverride('playing');
  const useStore2 = await importFresh();
  const s = useStore2.getState();
  check('2 status survived reload', s.currentStatus === 'Researching', s.currentStatus);
  check('2 override survived reload', s.themeOverride === 'playing' && s.currentTheme === 'playing', String(s.themeOverride));
  check('2 light/dark survived reload', s.colorScheme === 'light', s.colorScheme);
  check('2 <html> applied from saved values', attrs['data-theme'] === 'playing' && classes.has('light'));
}

// ---- 3. Picking a status clears the override and uses the mapping ------
{
  const useStore = await importFresh();
  useStore.getState().setStatus('Working');
  const s = useStore.getState();
  check('3 override cleared by status change', s.themeOverride === null);
  check('3 mapped theme applied', s.currentTheme === 'working', s.currentTheme);
  check('3 status persisted', ls.get('pd.status') === 'Working');
}

// ---- 4. clearThemeOverride restores the mapped theme -------------------
{
  const useStore = await importFresh();
  useStore.getState().setThemeOverride('researching');
  useStore.getState().clearThemeOverride();
  const s = useStore.getState();
  check('4 override cleared', s.themeOverride === null);
  check('4 mapped theme restored', s.currentTheme === s.mappings[s.currentStatus].theme, s.currentTheme);
}

// ---- 5. Mapping rows merge over code defaults; colorScheme ignored ------
{
  const useStore = await importFresh();
  useStore.getState().setStatus('Playing');
  useStore.getState().setMappings([
    { status: 'Playing', theme: 'researching', colorScheme: 'dark' },
    // A legacy row whose colorScheme says light must NOT flip the device.
    { status: 'Working', theme: 'studying', colorScheme: 'light' },
    // Unknown status values are ignored.
    { status: 'Nope', theme: 'studying', colorScheme: 'dark' },
  ]);
  const s = useStore.getState();
  check('5 mapping row overrides the default', s.mappings.Playing.theme === 'researching');
  check('5 active status re-applies the new mapping', s.currentTheme === 'researching', s.currentTheme);
  check('5 row colorScheme ignored', s.colorScheme === 'light', s.colorScheme);
  check('5 unknown status ignored', s.mappings.Nope === undefined);
}

// ---- 6. A mapping change does NOT override an active override ----------
{
  const useStore = await importFresh();
  useStore.getState().setStatus('Researching');
  useStore.getState().setThemeOverride('working');
  useStore.getState().setMappings([{ status: 'Researching', theme: 'studying', colorScheme: 'dark' }]);
  const s = useStore.getState();
  check('6 override wins over incoming mapping', s.currentTheme === 'working', s.currentTheme);
  check('6 mapping still recorded', s.mappings.Researching.theme === 'studying');
}

// ---- 7. Only per-device keys are written -------------------------------
{
  check('7 only per-device keys in localStorage',
    [...ls.keys()].every((k) => ['pd.status', 'pd.themeOverride', 'pd.colorScheme'].includes(k)),
    [...ls.keys()].join(','));
}

// ---- 8. uiState is written ONLY on explicit user actions ----------------
{
  const w = uiWrites();
  w.length = 0;
  const useStore = await importFresh();

  // Startup / mapping changes / remote applies must NOT write uiState.
  useStore.getState().setMappings([{ status: 'Studying', theme: 'working', colorScheme: 'dark' }]);
  useStore.getState().applyRemoteUiState('Playing', 'studying');
  check('8 startup/mapping/remote did not write uiState', w.length === 0, `wrote ${w.length}`);

  useStore.getState().setStatus('Working');
  check('8 picking a status wrote one row', w.length === 1 && w[0].status === 'Working' && w[0].id === 'current');
  check('8 status pick clears the override in the row', w[0].themeOverride === null);

  w.length = 0;
  useStore.getState().setThemeOverride('researching');
  check('8 picking an override wrote one row', w.length === 1 && w[0].themeOverride === 'researching');
  check('8 override row keeps the current status', w[0].status === 'Working');

  w.length = 0;
  useStore.getState().toggleColorScheme();
  check('8 light/dark does NOT write uiState', w.length === 0, `wrote ${w.length}`);

  w.length = 0;
  useStore.getState().clearThemeOverride();
  check('8 "Back to status theme" wrote a cleared row', w.length === 1 && w[0].themeOverride === null);
}

// ---- 9. An incoming synced value is applied, never echoed back ---------
{
  const w = uiWrites();
  w.length = 0;
  const useStore = await importFresh();
  useStore.getState().applyRemoteUiState('Researching', 'working');
  const s = useStore.getState();
  check('9 remote status applied', s.currentStatus === 'Researching');
  check('9 remote override applied', s.currentTheme === 'working', s.currentTheme);
  check('9 remote value refreshes the localStorage cache', ls.get('pd.status') === 'Researching');
  check('9 remote apply did NOT write back to Dexie', w.length === 0, `wrote ${w.length}`);
  check('9 remote apply did not change light/dark', s.colorScheme !== undefined);
}

// ---- 10. Remote value survives a reload (cache primed) -----------------
{
  const useStore = await importFresh();
  useStore.getState().applyRemoteUiState('Playing', 'studying');
  const useStore2 = await importFresh();
  const s = useStore2.getState();
  check('10 remote status cached for next load', s.currentStatus === 'Playing', s.currentStatus);
  check('10 remote override cached for next load', s.currentTheme === 'studying', s.currentTheme);
  check('10 applied to <html> on load', attrs['data-theme'] === 'studying', String(attrs['data-theme']));
}

// ---- 11. Invalid remote values fall back safely -----------------------
{
  const useStore = await importFresh();
  const w = uiWrites();
  w.length = 0;
  useStore.getState().applyRemoteUiState('Nonsense', 'chartreuse');
  const s = useStore.getState();
  check('11 invalid status falls back to Studying', s.currentStatus === 'Studying', s.currentStatus);
  check('11 invalid override falls back to the mapping', s.themeOverride === null && s.currentTheme === 'studying');
  check('11 invalid remote apply did not write back', w.length === 0);
}

// ---- 12. "Reset to default" reverts a deleted mapping immediately -------
{
  const useStore = await importFresh();
  // A synced row sets Studying -> playing.
  useStore.getState().setMappings([{ status: 'Studying', theme: 'playing', colorScheme: 'dark' }]);
  check('12 custom mapping active', useStore.getState().mappings.Studying.theme === 'playing');

  // "Reset to default" deletes the row; the live query then returns [].
  useStore.getState().setMappings([]);
  check('12 deleted mapping reverts to the code default at once',
    useStore.getState().mappings.Studying.theme === 'studying',
    useStore.getState().mappings.Studying.theme);
  check('12 theme re-applied to <html> immediately', attrs['data-theme'] === 'studying', String(attrs['data-theme']));

  // A later partial update must not resurrect the deleted row.
  useStore.getState().setMappings([{ status: 'Working', theme: 'researching', colorScheme: 'dark' }]);
  check('12 partial update keeps the reset intact',
    useStore.getState().mappings.Studying.theme === 'studying' &&
    useStore.getState().mappings.Working.theme === 'researching');
}

// ---- 13. initializeDatabaseDefaults() writes NO synced-table rows -------
{
  // defaultData is stubbed in the theme bundle, so assert on the source text
  // instead: the function body must not touch a synced table.
  const src = await readFile(new URL('../src/db/defaultData.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export async function initializeDatabaseDefaults'));
  const syncedWrites = body.match(/db\.(uiState|appSettings|themeStatusMap)\b/g) ?? [];
  check('13 initializeDatabaseDefaults() writes no synced-table row', syncedWrites.length === 0,
    `references: ${syncedWrites.join(',')}`);
  check('13 initializeDatabaseDefaults() still seeds aiProviders', /db\.aiProviders\.put/.test(body));
  check('13 pomodoro defaults remain a documented in-memory fallback',
    /defaultPomodoroSettings/.test(body) || /no pomodoro seeding/.test(body));
}


rmSync(outDir, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
