import React, { useEffect, useRef, useState } from 'react';
import { Check, Settings as SettingsIcon, UserRound } from 'lucide-react';
import { useStatusThemeStore } from '../../stores/useStatusThemeStore';
import { useCloudAccount } from '../../features/settings/components/useCloudAccount';
import { SyncAccountPanel } from '../../features/settings/components/SyncAccountPanel';
import type { NavTab } from '../layout/Sidebar';
import type { ThemeMode, UserStatus } from '../../types';

const STATUSES: { value: UserStatus; color: string }[] = [
  { value: 'Studying', color: 'bg-indigo-500' },
  { value: 'Working', color: 'bg-zinc-500' },
  { value: 'Researching', color: 'bg-teal-500' },
  { value: 'Playing', color: 'bg-amber-500' },
];

const THEMES: { value: ThemeMode; label: string; swatch: string }[] = [
  { value: 'studying', label: 'Indigo', swatch: 'bg-indigo-500' },
  { value: 'working', label: 'Slate', swatch: 'bg-zinc-500' },
  { value: 'researching', label: 'Teal', swatch: 'bg-teal-500' },
  { value: 'playing', label: 'Amber', swatch: 'bg-amber-500' },
];

const DOT: Record<string, string> = {
  ok: 'bg-emerald-500',
  busy: 'bg-accent animate-pulse',
  warn: 'bg-amber-500',
  error: 'bg-rose-500',
  muted: 'bg-content-tertiary',
};

interface ProfileMenuProps {
  onNavigate: (tab: NavTab) => void;
}

/**
 * Top-bar profile button + menu.
 *
 * Desktop: dropdown anchored to the avatar. Under 768px: a full-width bottom
 * sheet. Closes on outside click, Escape, and after any option that navigates.
 * Account state is shared with Settings via `useCloudAccount()`, so there is no
 * second source of truth.
 */
export const ProfileMenu: React.FC<ProfileMenuProps> = ({ onNavigate }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const { state } = useCloudAccount();
  const {
    currentStatus, setStatus, currentTheme, colorScheme, toggleColorScheme, updateMapping,
  } = useStatusThemeStore();

  // Close on outside click and on Escape (returns focus to the trigger).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (tab: NavTab) => {
    onNavigate(tab);
    setOpen(false);
  };

  const initial = state.signedIn && state.email ? state.email.charAt(0).toUpperCase() : null;

  const sectionTitle = 'px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider font-semibold text-content-tertiary';
  const row = 'w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 rounded-lg transition-colors';

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={state.signedIn ? `Account menu, signed in as ${state.email}` : 'Account menu, not signed in'}
        className="relative w-9 h-9 rounded-full bg-bg-elevated border border-border hover:border-accent transition-colors flex items-center justify-center text-xs font-semibold text-content-primary"
      >
        {initial ? initial : <UserRound className="w-4 h-4 text-content-secondary" />}
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-surface ${DOT[state.tone]}`}
          title={state.status}
        />
      </button>

      {open && (
        <>
          {/* Click-away backdrop; transparent on desktop, dims the sheet on mobile. */}
          <div className="fixed inset-0 z-40 md:bg-transparent" onClick={() => setOpen(false)} aria-hidden="true" />

          <div
            role="menu"
            aria-label="Account and appearance"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-bg-surface p-3 shadow-2xl md:absolute md:inset-auto md:right-0 md:top-full md:mt-2 md:w-80 md:rounded-2xl md:border md:max-h-[80vh]"
          >
            <div className="md:hidden pb-2">
              <div className="mx-auto h-1 w-10 rounded-full bg-border" />
            </div>

            {/* (a) Account — shared with Settings → Sync */}
            <div className={sectionTitle}>Account</div>
            <div className="px-3 pb-2">
              <SyncAccountPanel variant="plain" showDiagnostics={false} />
            </div>

            {/* (b) Current status */}
            <div className={`${sectionTitle} border-t border-border/60 pt-3`}>Current status</div>
            {STATUSES.map((s) => (
              <button
                key={s.value}
                role="menuitemradio"
                aria-checked={currentStatus === s.value}
                onClick={() => void setStatus(s.value)}
                className={`${row} ${
                  currentStatus === s.value
                    ? 'bg-accent-subtle text-accent-text font-medium'
                    : 'text-content-secondary hover:bg-bg-elevated hover:text-content-primary'
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${s.color}`} />
                <span className="flex-1">{s.value}</span>
                {currentStatus === s.value && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            ))}

            {/* (c) Theme */}
            <div className={`${sectionTitle} border-t border-border/60 pt-3`}>Theme</div>
            <div className="grid grid-cols-2 gap-1.5 px-3">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  role="menuitemradio"
                  aria-checked={currentTheme === t.value}
                  onClick={() => {
                    // Applies immediately and persists until the status changes,
                    // at which point that status's mapped theme takes over.
                    void updateMapping(currentStatus, t.value, colorScheme);
                  }}
                  className={`flex items-center gap-2 px-2 py-2 rounded-lg text-xs border transition-colors ${
                    currentTheme === t.value
                      ? 'border-accent bg-accent-subtle text-accent-text font-medium'
                      : 'border-border text-content-secondary hover:bg-bg-elevated'
                  }`}
                >
                  <span className={`w-3.5 h-3.5 rounded-full shrink-0 ${t.swatch}`} />
                  {t.label}
                </button>
              ))}
            </div>
            <button
              role="menuitem"
              onClick={toggleColorScheme}
              className={`${row} mt-1 text-content-secondary hover:bg-bg-elevated hover:text-content-primary`}
            >
              {colorScheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            </button>
            <button
              role="menuitem"
              onClick={() => go('settings')}
              className="mb-1 mt-1 w-full px-3 text-left text-[11px] text-content-tertiary underline underline-offset-2 hover:text-content-primary"
            >
              Change status to theme mapping
            </button>

            {/* Settings link */}
            <div className="border-t border-border/60 pt-1.5 mt-1.5">
              <button
                role="menuitem"
                onClick={() => go('settings')}
                className={`${row} text-content-secondary hover:bg-bg-elevated hover:text-content-primary`}
              >
                <SettingsIcon className="w-4 h-4 shrink-0" />
                Settings
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

