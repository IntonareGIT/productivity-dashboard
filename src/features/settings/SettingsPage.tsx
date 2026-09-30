import React from 'react';
import { Card } from '../../components/ui/Card';
import { Settings2, Palette, Check, RotateCcw, Compass } from 'lucide-react';
import { useStatusThemeStore, defaultMappingFor } from '../../stores/useStatusThemeStore';
import { useThemeStatusMap } from '../../hooks/useThemeStatusMap';
import { WeeklySchedulesSettings } from './components/WeeklySchedulesSettings';
import { PomodoroSettingsSection } from './components/PomodoroSettingsSection';
import { AiProvidersSettings } from './components/AiProvidersSettings';
import { ChatHistorySettings } from './components/ChatHistorySettings';
import { SyncSettings } from './components/SyncSettings';
import { DataBackupSection } from './components/DataBackupSection';
import type { UserStatus, ThemeMode, ColorScheme } from '../../types';

/** Navigation into the About page, so it is reachable where the bottom bar
 *  has no room for it. */
export const SettingsPage: React.FC<{ onOpenAbout?: () => void }> = ({ onOpenAbout }) => {
  const { mappings, currentStatus, setStatus } = useStatusThemeStore();
  const { rows, saveMapping, resetMapping } = useThemeStatusMap();

  const statuses: UserStatus[] = ['Studying', 'Working', 'Researching', 'Playing'];
  /** Swatch per status, matching the profile menu. */
  const STATUS_SWATCH: Record<UserStatus, string> = {
    Studying: 'bg-indigo-500',
    Working: 'bg-zinc-500',
    Researching: 'bg-teal-500',
    Playing: 'bg-amber-500',
  };

  const themeOptions: { value: ThemeMode; label: string; desc: string }[] = [
    { value: 'studying', label: 'Cool Blue / Indigo', desc: 'Default for Studying' },
    { value: 'working', label: 'Neutral Slate / Graphite', desc: 'Default for Working' },
    { value: 'researching', label: 'Deep Teal / Emerald', desc: 'Default for Researching' },
    { value: 'playing', label: 'Warmer Purple / Amber', desc: 'Default for Playing' },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center space-x-2.5">
        <Settings2 className="w-6 h-6 text-accent" />
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-content-primary">
          Settings
        </h1>
      </div>

      {/* Per-week work rosters (each week is an independent record) */}
      <WeeklySchedulesSettings />

      {/* Pomodoro durations and alerts */}
      <PomodoroSettingsSection />

      {/* AI Providers (configurable OpenAI-compatible models) */}
      <AiProvidersSettings />

      {/* Assistant conversation history */}
      <ChatHistorySettings />

      {/* Cross-device sync (Dexie Cloud) */}
      <SyncSettings />

      {/* Theme to Status Mapping Section */}
      <Card
        title="Status to Theme Mapping"
        subtitle="Choose your current status, and map each status to the theme it activates"
      >
        {/* Current status selector — the same store action the profile menu uses,
            so changing status here and there stay in sync. */}
        <div className="mb-4 pb-4 border-b border-border/40">
          <p className="text-xs font-semibold text-content-primary mb-1.5">Current status</p>
          <p className="text-[11px] text-content-tertiary mb-2">
            Selecting a status applies its mapped theme immediately.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {statuses.map((s) => {
              const active = currentStatus === s;
              return (
                <button
                  key={s}
                  onClick={() => void setStatus(s)}
                  aria-pressed={active}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-medium transition-colors ${
                    active
                      ? 'border-accent bg-accent-subtle text-accent-text'
                      : 'border-border text-content-secondary hover:bg-bg-elevated hover:text-content-primary'
                  }`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_SWATCH[s]}`} />
                  <span className="flex-1 text-left">{s}</span>
                  {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4 divide-y divide-border/40">
          {statuses.map((status) => {
            // Effective value: the synced DB row if one exists, else the code
            // default. `isDefault` drives the "Reset to default" affordance.
            const current = mappings[status] ?? defaultMappingFor(status);
            const isDefault = !rows?.some((r) => r.status === status);

            return (
              <div
                key={status}
                className="pt-4 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div>
                  <div className="font-semibold text-sm text-content-primary flex items-center space-x-2">
                    <Palette className="w-4 h-4 text-accent" />
                    <span>{status} Status</span>
                  </div>
                  <p className="text-xs text-content-tertiary mt-0.5">
                    Controls color tokens when "{status}" is active in the top bar.
                  </p>
                </div>

                <div className="flex items-center space-x-3">
                  <select
                    value={current.theme}
                    onChange={(e) => void saveMapping(status, e.target.value as ThemeMode)}
                    className="bg-bg-elevated border border-border text-content-primary text-xs rounded-xl px-3 py-2 outline-none focus:border-accent cursor-pointer"
                  >
                    {themeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {isDefault ? (
                    <span className="text-[11px] text-content-tertiary px-1">Default</span>
                  ) : (
                    <button
                      onClick={() => void resetMapping(status)}
                      className="inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl border border-border text-xs font-semibold text-content-secondary hover:text-content-primary hover:bg-bg-elevated transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset to default
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Export / import all app data */}
      <DataBackupSection />

      {/* About & Help is not in the phone bottom bar (six items is already the
          limit there), so on a phone this is how you reach it. It is a real
          destination rather than a link out, so the same button works on
          desktop too. */}
      <Card title="About & Help" subtitle="What this app can do, and how to get the most out of it">
        <button
          onClick={onOpenAbout}
          className="inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl border border-border text-xs font-semibold text-content-secondary hover:text-content-primary hover:bg-bg-elevated transition-colors"
        >
          <Compass className="w-3.5 h-3.5" /> Open About &amp; Help
        </button>
      </Card>
    </div>
  );
};
