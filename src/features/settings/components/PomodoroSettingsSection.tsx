import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Timer } from 'lucide-react';
import { db } from '../../../db/db';
import { defaultPomodoroSettings } from '../../../db/defaultData';
import { Card } from '../../../components/ui/Card';
import { usePomodoroStore } from '../../../stores/usePomodoroStore';

/**
 * Settings section for pomodoro durations (Phase 5). Persists to the
 * `appSettings` singleton row (id: 'pomodoro') and applies live to the
 * timer store.
 */
export const PomodoroSettingsSection: React.FC = () => {
  const row =
    useLiveQuery(() => db.appSettings.get('pomodoro')) ??
    { id: 'pomodoro', ...defaultPomodoroSettings };
  const loadSettings = usePomodoroStore((s) => s.loadSettings);

  const [focus, setFocus] = useState(row.focusDuration);
  const [shortBreak, setShortBreak] = useState(row.shortBreakDuration);
  const [longBreak, setLongBreak] = useState(row.longBreakDuration);
  const [cycles, setCycles] = useState(row.cyclesBeforeLongBreak);
  const [sound, setSound] = useState(row.soundEnabled);
  const [notify, setNotify] = useState(row.notificationEnabled);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setFocus(row.focusDuration);
    setShortBreak(row.shortBreakDuration);
    setLongBreak(row.longBreakDuration);
    setCycles(row.cyclesBeforeLongBreak);
    setSound(row.soundEnabled);
    setNotify(row.notificationEnabled);
    setDirty(false);
  }, [
    row.focusDuration,
    row.shortBreakDuration,
    row.longBreakDuration,
    row.cyclesBeforeLongBreak,
    row.soundEnabled,
    row.notificationEnabled,
  ]);

  const touch = (fn: () => void) => {
    fn();
    setDirty(true);
  };

  const persist = async () => {
    const next = {
      id: 'pomodoro',
      focusDuration: focus,
      shortBreakDuration: shortBreak,
      longBreakDuration: longBreak,
      cyclesBeforeLongBreak: cycles,
      soundEnabled: sound,
      notificationEnabled: notify,
    };
    await db.appSettings.put(next);
    loadSettings(next);
    setDirty(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const numberField = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    min = 1,
    max = 90
  ) => (
    <label className="block">
      <span className="block text-sm font-medium text-content-primary mb-2">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => touch(() => onChange(Number(e.target.value)))}
        className="w-full bg-bg-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent"
      />
    </label>
  );

  const toggle = (label: string, hint: string, value: boolean, onChange: (v: boolean) => void) => (
    <button
      onClick={() => touch(() => onChange(!value))}
      className="w-full flex items-center justify-between gap-3 py-2 min-h-[44px] text-left"
    >
      <span>
        <span className="block text-sm font-medium text-content-primary">{label}</span>
        <span className="block text-xs text-content-tertiary">{hint}</span>
      </span>
      <span
        className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 ${
          value ? 'bg-accent' : 'bg-bg-elevated border border-border'
        }`}
      >
        <span
          className={`block w-5 h-5 rounded-full bg-white transition-transform ${
            value ? 'translate-x-5' : ''
          }`}
        />
      </span>
    </button>
  );

  return (
    <Card
      title="Pomodoro"
      subtitle="Focus/break durations and completion alerts"
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {numberField('Focus (min)', focus, setFocus)}
          {numberField('Short break (min)', shortBreak, setShortBreak)}
          {numberField('Long break (min)', longBreak, setLongBreak)}
          {numberField('Cycles before long break', cycles, setCycles, 1, 12)}
        </div>

        <div className="divide-y divide-border/40 border-t border-border/50 pt-1">
          {toggle('Sound', 'Chime when a phase ends', sound, setSound)}
          {toggle(
            'Browser notification',
            'Notify even when the tab is in the background',
            notify,
            setNotify
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-4">
          <div className="flex items-center gap-2 text-xs text-content-secondary">
            <Timer className="w-4 h-4 text-accent" />
            <span>
              Pattern:{' '}
              <span className="font-semibold text-content-primary">
                {focus}/{shortBreak}/{longBreak}
              </span>{' '}
              × {cycles}
            </span>
          </div>
          <button
            onClick={persist}
            disabled={!dirty}
            className={`px-5 min-h-[44px] rounded-xl text-sm font-semibold transition-all ${
              saved
                ? 'bg-emerald-600 text-white'
                : dirty
                ? 'bg-accent hover:bg-accent-hover text-white'
                : 'bg-bg-elevated text-content-tertiary cursor-not-allowed'
            }`}
          >
            {saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>
    </Card>
  );
};
