import { create } from 'zustand';
import { db } from '../db/db';
import type { UserStatus, ThemeMode, ColorScheme, ThemeStatusMapping } from '../types';
import { defaultThemeStatusMappings } from '../db/defaultData';

/* ---------------- Per-device vs synced UI preferences ----------------
 *
 * LIGHT/DARK is per-device and lives ONLY in localStorage. It is never synced,
 * so one device's brightness choice never overrides another's. A `storage`
 * listener propagates changes to other tabs of the same browser.
 *
 * STATUS and THEME OVERRIDE follow the user across devices. They are cached in
 * localStorage so the FIRST PAINT has no flash of the default theme, but the
 * synced `uiState` row wins once it arrives (see useUiState).
 *
 * The status -> theme MAPPING is a separate, synced concern (useThemeStatusMap).
 */

const LS_STATUS = 'pd.status';
const LS_OVERRIDE = 'pd.themeOverride';
const LS_SCHEME = 'pd.colorScheme';

/** The single uiState primary key. */
export const UI_STATE_KEY = 'current';

const STATUSES: UserStatus[] = ['Studying', 'Working', 'Researching', 'Playing'];
const THEMES: ThemeMode[] = ['studying', 'working', 'researching', 'playing'];

function readStatus(): UserStatus {
  try {
    const v = localStorage.getItem(LS_STATUS);
    return STATUSES.includes(v as UserStatus) ? (v as UserStatus) : 'Studying';
  } catch {
    return 'Studying';
  }
}
function readOverride(): ThemeMode | null {
  try {
    const v = localStorage.getItem(LS_OVERRIDE);
    return THEMES.includes(v as ThemeMode) ? (v as ThemeMode) : null;
  } catch {
    return null;
  }
}
function readScheme(): ColorScheme {
  try {
    return localStorage.getItem(LS_SCHEME) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode / storage disabled - preferences are best-effort.
  }
}

/** Code default mapping, used when no DB row exists for a status. */
export function defaultMappingFor(status: UserStatus): ThemeStatusMapping {
  return defaultThemeStatusMappings.find((m) => m.status === status) ?? {
    status, theme: 'studying', colorScheme: 'dark',
  };
}

interface StatusThemeState {
  currentStatus: UserStatus;
  currentTheme: ThemeMode;
  colorScheme: ColorScheme;
  /** Per-device theme override, or null when following the mapped theme. */
  themeOverride: ThemeMode | null;
  /** Effective status -> theme (DB row wins, code default is the fallback). */
  mappings: Record<UserStatus, ThemeStatusMapping>;
  setStatus: (status: UserStatus) => void;
  setThemeOverride: (theme: ThemeMode) => void;
  clearThemeOverride: () => void;
  toggleColorScheme: () => void;
  /**
   * Apply status/override that arrived from the synced `uiState` row (another
   * device, another tab). Updates the localStorage cache and applies the theme,
   * but NEVER writes back to Dexie — that is what prevents a write loop.
   */
  applyRemoteUiState: (status: UserStatus, override: ThemeMode | null) => void;
  /** Merge fresh (possibly synced) mapping rows and re-apply as needed. */
  setMappings: (rows: ThemeStatusMapping[]) => void;
}

const initialStatus = readStatus();
const initialOverride = readOverride();
const initialScheme = readScheme();
const initialMappings = Object.fromEntries(
  STATUSES.map((s) => [s, defaultMappingFor(s)])
) as Record<UserStatus, ThemeStatusMapping>;

/** The theme to show: an override wins, otherwise the active status's mapping. */
function resolveTheme(
  status: UserStatus,
  override: ThemeMode | null,
  mappings: Record<UserStatus, ThemeStatusMapping>
): ThemeMode {
  return override ?? mappings[status]?.theme ?? 'studying';
}

export function applyToDocument(theme: ThemeMode, scheme: ColorScheme): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.setAttribute('data-theme', theme);
  el.classList.toggle('dark', scheme === 'dark');
  el.classList.toggle('light', scheme === 'light');
}

/**
 * Persist the synced `uiState` row.
 *
 * Called ONLY from explicit user actions. Never called at startup, never
 * seeded — a fresh device therefore cannot push its fallback over the
 * account's real value. `applyRemoteUiState` deliberately does not call this,
 * which is what breaks the write loop when a remote value arrives.
 */
function persistUiState(status: UserStatus, themeOverride: ThemeMode | null): void {
  try {
    void db.uiState?.put({
      id: UI_STATE_KEY,
      status,
      themeOverride,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // No database (tests) or write failed — localStorage still holds the value.
  }
}

// Apply before React mounts so there is no flash of the default theme.
applyToDocument(resolveTheme(initialStatus, initialOverride, initialMappings), initialScheme);

/**
 * Cross-tab propagation of per-device preferences.
 *
 * The `storage` event fires in OTHER tabs of the same browser, which is exactly
 * how light/dark — never synced — reaches a sibling tab. Status and override are
 * already shared between tabs through the shared Dexie database, so they do not
 * need this path; listening anyway keeps a tab consistent even if Dexie is
 * momentarily unavailable.
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === null) {
      // storage.clear() in another tab: re-read everything.
      applyToDocument(resolveTheme(readStatus(), readOverride(), useStatusThemeStore.getState().mappings), readScheme());
      return;
    }
    const store = useStatusThemeStore.getState();
    if (e.key === LS_SCHEME) {
      applyToDocument(store.currentTheme, readScheme());
      useStatusThemeStore.setState({ colorScheme: readScheme() });
    } else if (e.key === LS_STATUS || e.key === LS_OVERRIDE) {
      const status = readStatus();
      const override = readOverride();
      applyToDocument(resolveTheme(status, override, store.mappings), store.colorScheme);
      useStatusThemeStore.setState({ currentStatus: status, themeOverride: override });
    }
  });
}

export const useStatusThemeStore = create<StatusThemeState>((set, get) => ({
  currentStatus: initialStatus,
  currentTheme: resolveTheme(initialStatus, initialOverride, initialMappings),
  colorScheme: initialScheme,
  themeOverride: initialOverride,
  mappings: initialMappings,

  setStatus: (status) => {
    // Picking a status clears any override, so the mapped theme applies.
    const theme = get().mappings[status]?.theme ?? 'studying';
    write(LS_STATUS, status);
    write(LS_OVERRIDE, null);
    persistUiState(status, null);
    applyToDocument(theme, get().colorScheme);
    set({ currentStatus: status, currentTheme: theme, themeOverride: null });
  },

  setThemeOverride: (theme) => {
    const { currentStatus, colorScheme } = get();
    write(LS_OVERRIDE, theme);
    persistUiState(currentStatus, theme);
    applyToDocument(theme, colorScheme);
    set({ themeOverride: theme, currentTheme: theme });
  },

  clearThemeOverride: () => {
    const { currentStatus, mappings, colorScheme } = get();
    const theme = mappings[currentStatus]?.theme ?? 'studying';
    write(LS_OVERRIDE, null);
    persistUiState(currentStatus, null);
    applyToDocument(theme, colorScheme);
    set({ themeOverride: null, currentTheme: theme });
  },

  toggleColorScheme: () => {
    const next: ColorScheme = get().colorScheme === 'dark' ? 'light' : 'dark';
    // Per-device only: this must NOT write the synced mapping or uiState row.
    write(LS_SCHEME, next);
    applyToDocument(get().currentTheme, next);
    set({ colorScheme: next });
  },

  applyRemoteUiState: (status, override) => {
    const cleanStatus = STATUSES.includes(status) ? status : 'Studying';
    const cleanOverride = THEMES.includes(override as ThemeMode) ? (override as ThemeMode) : null;
    const { mappings, colorScheme } = get();
    const theme = resolveTheme(cleanStatus, cleanOverride, mappings);

    // Refresh the startup cache, but do NOT touch Dexie here.
    write(LS_STATUS, cleanStatus);
    write(LS_OVERRIDE, cleanOverride);
    applyToDocument(theme, colorScheme);
    set({ currentStatus: cleanStatus, themeOverride: cleanOverride, currentTheme: theme });
  },

  setMappings: (rows) => {
    // Rebuild from the CODE defaults every time instead of merging into the
    // previous store value. A "Reset to default" deletes the row, so a deleted
    // mapping must fall back to the default immediately — merging would keep
    // the deleted mapping active until a reload.
    const merged: Record<string, ThemeStatusMapping> = {};
    for (const d of defaultThemeStatusMappings) {
      merged[d.status] = { ...d };
    }
    for (const r of rows) {
      // The row's `colorScheme` is legacy and intentionally ignored; only the
      // theme is read, so a synced row cannot flip a device's light/dark.
      if (STATUSES.includes(r.status) && THEMES.includes(r.theme)) {
        merged[r.status] = { ...merged[r.status], status: r.status, theme: r.theme };
      }
    }

    const { currentStatus, themeOverride, colorScheme } = get();
    // Re-apply when the active status's mapping changed, unless overridden.
    const theme = resolveTheme(currentStatus, themeOverride, merged);
    if (theme !== get().currentTheme) applyToDocument(theme, colorScheme);
    set({ mappings: merged, currentTheme: theme });
  },
}));
