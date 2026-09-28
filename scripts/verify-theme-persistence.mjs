/**
 * Theme/status persistence verification.
 * Exercises the real useStatusThemeStore: per-device selection in
 * localStorage, the synced mapping merged over code defaults, and the rule
 * that a mapping change re-applies the active status theme unless overridden.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
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

rmSync(outDir, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
