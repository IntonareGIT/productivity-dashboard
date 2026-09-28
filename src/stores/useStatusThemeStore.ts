import { create } from 'zustand';
import type { UserStatus, ThemeMode, ColorScheme, ThemeStatusMapping } from '../types';
import { defaultThemeStatusMappings } from '../db/defaultData';

/* ---------------- Per-device UI preferences (localStorage) ----------------
 *
 * The CURRENT SELECTION is device-local and must never be synced:
 *   - current status
 *   - an optional theme override ("Override colors")
 *   - light/dark
 *
 * They are read synchronously at module load and applied to <html> before React
 * renders, so there is no flash of the default theme. The status -> theme
 * MAPPING is a separate, synced concern (see useThemeStatusMap).
 *
 * Previously these lived in the synced `themeStatusMap` row (or nowhere at all),
 * so a refresh lost the selection and a theme change leaked across devices.
 */

const LS_STATUS = 'pd.status';
const LS_OVERRIDE = 'pd.themeOverride';
const LS_SCHEME = 'pd.colorScheme';

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

// Apply before React mounts so there is no flash of the default theme.
applyToDocument(resolveTheme(initialStatus, initialOverride, initialMappings), initialScheme);

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
    applyToDocument(theme, get().colorScheme);
    set({ currentStatus: status, currentTheme: theme, themeOverride: null });
  },

  setThemeOverride: (theme) => {
    write(LS_OVERRIDE, theme);
    applyToDocument(theme, get().colorScheme);
    set({ themeOverride: theme, currentTheme: theme });
  },

  clearThemeOverride: () => {
    const { currentStatus, mappings, colorScheme } = get();
    const theme = mappings[currentStatus]?.theme ?? 'studying';
    write(LS_OVERRIDE, null);
    applyToDocument(theme, colorScheme);
    set({ themeOverride: null, currentTheme: theme });
  },

  toggleColorScheme: () => {
    const next: ColorScheme = get().colorScheme === 'dark' ? 'light' : 'dark';
    // Per-device only: this must NOT write the synced mapping row.
    write(LS_SCHEME, next);
    applyToDocument(get().currentTheme, next);
    set({ colorScheme: next });
  },

  setMappings: (rows) => {
    const merged = { ...get().mappings };
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
