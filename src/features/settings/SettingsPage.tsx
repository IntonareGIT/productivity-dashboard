import React from 'react';
import { Card } from '../../components/ui/Card';
import { Settings2, Palette } from 'lucide-react';
import { useStatusThemeStore } from '../../stores/useStatusThemeStore';
import { WeeklySchedulesSettings } from './components/WeeklySchedulesSettings';
import { PomodoroSettingsSection } from './components/PomodoroSettingsSection';
import { AiProvidersSettings } from './components/AiProvidersSettings';
import { ChatHistorySettings } from './components/ChatHistorySettings';
import { SyncSettings } from './components/SyncSettings';
import { DataBackupSection } from './components/DataBackupSection';
import type { UserStatus, ThemeMode, ColorScheme } from '../../types';

export const SettingsPage: React.FC = () => {
  const { mappings, updateMapping } = useStatusThemeStore();

  const statuses: UserStatus[] = ['Studying', 'Working', 'Researching', 'Playing'];
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
        subtitle="Map which color theme automatically activates when you switch your status in the top bar"
      >
        <div className="space-y-4 divide-y divide-border/40">
          {statuses.map((status) => {
            const current = mappings[status] || {
              status,
              theme: status.toLowerCase() as ThemeMode,
              colorScheme: 'dark' as ColorScheme,
            };

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
                    onChange={(e) =>
                      updateMapping(
                        status,
                        e.target.value as ThemeMode,
                        current.colorScheme
                      )
                    }
                    className="bg-bg-elevated border border-border text-content-primary text-xs rounded-xl px-3 py-2 outline-none focus:border-accent cursor-pointer"
                  >
                    {themeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={current.colorScheme}
                    onChange={(e) =>
                      updateMapping(
                        status,
                        current.theme,
                        e.target.value as ColorScheme
                      )
                    }
                    className="bg-bg-elevated border border-border text-content-primary text-xs rounded-xl px-3 py-2 outline-none focus:border-accent cursor-pointer"
                  >
                    <option value="dark">Dark Mode</option>
                    <option value="light">Light Mode</option>
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Export / import all app data */}
      <DataBackupSection />
    </div>
  );
};
