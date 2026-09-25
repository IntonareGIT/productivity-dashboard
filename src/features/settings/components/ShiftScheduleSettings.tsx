import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock, RotateCcw } from 'lucide-react';
import { db } from '../../../db/db';
import { defaultShiftConfig } from '../../../db/defaultData';
import { Card } from '../../../components/ui/Card';
import { dayEndTime } from '../../shifts/shiftLogic';
import { saveShiftConfig } from '../../shifts/shiftsRepo';

const DAY_LABELS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

/**
 * Settings section for the recurring schedule: off days, shift length and
 * start time. Persists to the singleton `shiftConfig` row.
 */
export const ShiftScheduleSettings: React.FC = () => {
  const config = useLiveQuery(() => db.shiftConfig.get('default')) ?? defaultShiftConfig;

  const [workingDays, setWorkingDays] = useState<number[]>(config.workingDays);
  const [hours, setHours] = useState<number>(config.shiftLengthHours);
  const [startTime, setStartTime] = useState<string>(config.startTime);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Sync local form when the stored config changes (e.g. after save).
  useEffect(() => {
    setWorkingDays(config.workingDays);
    setHours(config.shiftLengthHours);
    setStartTime(config.startTime);
    setDirty(false);
  }, [config.workingDays.join(','), config.shiftLengthHours, config.startTime]);

  const toggleDay = (day: number) => {
    const isWorking = workingDays.includes(day);
    if (isWorking && workingDays.length === 1) return; // keep >= 1 work day
    const next = isWorking
      ? workingDays.filter((d) => d !== day)
      : [...workingDays, day].sort();
    setWorkingDays(next);
    setDirty(true);
  };

  const persist = async () => {
    await saveShiftConfig({
      workingDays: [...workingDays].sort(),
      shiftLengthHours: hours,
      startTime,
    });
    setDirty(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const resetToDefaults = async () => {
    await saveShiftConfig({
      workingDays: [...defaultShiftConfig.workingDays],
      shiftLengthHours: defaultShiftConfig.shiftLengthHours,
      startTime: defaultShiftConfig.startTime,
    });
    setDirty(false);
  };

  const offCount = 7 - workingDays.length;

  return (
    <Card
      title="Work Schedule"
      subtitle="Default recurring schedule: off days, shift length and start time"
      action={
        <button
          onClick={resetToDefaults}
          className="flex items-center gap-1.5 text-xs text-content-secondary hover:text-accent transition-colors"
          title="Reset to defaults"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </button>
      }
    >
      <div className="space-y-5">
        {/* Off days / working days */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-content-primary">Working days</span>
            <span className="text-xs text-content-tertiary">
              {workingDays.length} on / {offCount} off
            </span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            {DAY_LABELS.map(({ value, label }) => {
              const isWorking = workingDays.includes(value);
              return (
                <button
                  key={value}
                  onClick={() => toggleDay(value)}
                  className={`min-h-[44px] rounded-xl border text-sm font-semibold transition-all ${
                    isWorking
                      ? 'bg-accent-subtle border-accent/50 text-accent'
                      : 'bg-bg-elevated/50 border-border text-content-tertiary hover:border-border-strong'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-content-tertiary mt-2">
            Days you toggle off become your days off —{' '}
            {offCount === 2
              ? 'currently 2 days off.'
              : `currently ${offCount} days off.`}
          </p>
        </div>

        {/* Length + start time */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium text-content-primary mb-2">
              Shift length (hours)
            </span>
            <input
              type="number"
              min={0.5}
              max={24}
              step={0.5}
              value={hours}
              onChange={(e) => {
                setHours(Number(e.target.value));
                setDirty(true);
              }}
              className="w-full bg-bg-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-content-primary mb-2">
              Shift start time
            </span>
            <input
              type="time"
              value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value);
                setDirty(true);
              }}
              className="w-full bg-bg-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent"
            />
          </label>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border/50 pt-4">
          <div className="flex items-center gap-2 text-xs text-content-secondary">
            <CalendarClock className="w-4 h-4 text-accent shrink-0" />
            <span>
              Shift runs{' '}
              <span className="font-semibold text-content-primary">
                {startTime}–{dayEndTime(startTime, hours)}
              </span>
            </span>
          </div>
          <button
            onClick={persist}
            disabled={!dirty}
            className={`px-5 min-h-[44px] rounded-xl text-sm font-semibold transition-all self-start sm:self-auto ${
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
