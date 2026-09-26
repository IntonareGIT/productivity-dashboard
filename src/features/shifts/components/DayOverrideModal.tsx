import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Modal } from '../../../components/ui/Modal';
import { clearOverrideForDate, setOverrideForDate } from '../shiftsRepo';
import type { BaseDayKind } from '../shiftLogic';
import type { ShiftOverride, ShiftOverrideType } from '../../../types';

interface DayOverrideModalProps {
  date: Date | null;            // null = closed
  /** Base state for this date WITHOUT the override (from the week's record). */
  baseKind: BaseDayKind;
  /** That week's shift start/length (when it has a record). */
  baseStartTime?: string;
  baseHours?: number;
  existingOverride?: ShiftOverride;
  onClose: () => void;
}

const actionButton =
  'w-full text-left px-4 py-3 rounded-xl border transition-colors text-sm font-medium min-h-[48px]';

/**
 * Editor for a single date: mark PTO, take an unscheduled day off, apply a
 * one-off custom shift (hours/start time), or restore the default schedule.
 */
export const DayOverrideModal: React.FC<DayOverrideModalProps> = ({
  date,
  baseKind,
  baseStartTime = '09:00',
  baseHours = 9,
  existingOverride,
  onClose,
}) => {
  const [hours, setHours] = useState<number>(baseHours);
  const [startTime, setStartTime] = useState<string>(baseStartTime);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Re-initialize the form whenever a different date (or override) opens.
  useEffect(() => {
    if (!date) return;
    setHours(existingOverride?.shiftLengthHours ?? baseHours);
    setStartTime(existingOverride?.startTime ?? baseStartTime);
    setNote(existingOverride?.note ?? '');
  }, [date, existingOverride, baseHours, baseStartTime]);

  if (!date) return null;

  const dateKey = format(date, 'yyyy-MM-dd');

  const save = async (
    type: ShiftOverrideType,
    extra?: { startTime?: string; shiftLengthHours?: number }
  ) => {
    setSaving(true);
    try {
      await setOverrideForDate({ date: dateKey, type, note, ...extra });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await clearOverrideForDate(dateKey);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const isWorkDefault = baseKind === 'work';
  const baseDescription =
    baseKind === 'work'
      ? 'This date is a work day in this week’s schedule'
      : baseKind === 'off'
      ? 'This date is an off day in this week’s schedule'
      : 'This week has no schedule assigned yet';

  return (
    <Modal
      open
      onClose={onClose}
      title={format(date, 'EEEE, MMMM d, yyyy')}
      subtitle={
        existingOverride
          ? 'This date has a one-off override'
          : baseKind === 'unscheduled'
          ? 'Week unscheduled — overrides still apply'
          : 'Following this week’s schedule'
      }
    >
      <div className="space-y-4">
        {/* Quick actions */}
        <div className="space-y-2">
          <button
            disabled={saving}
            onClick={() => save('pto')}
            className={`${actionButton} ${
              existingOverride?.type === 'pto'
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-600 dark:text-amber-400'
                : 'bg-bg-elevated/50 border-border hover:border-amber-500/50 text-content-primary'
            }`}
          >
            <span className="block">Mark as PTO</span>
            <span className="block text-xs font-normal text-content-tertiary mt-0.5">
              Paid time off — no scheduled hours
            </span>
          </button>

          <button
            disabled={saving}
            onClick={() => save('custom_off')}
            className={`${actionButton} ${
              existingOverride?.type === 'custom_off'
                ? 'bg-bg-elevated border-border-strong text-content-primary'
                : 'bg-bg-elevated/50 border-border hover:border-border-strong text-content-primary'
            }`}
          >
            <span className="block">Take this day off</span>
            <span className="block text-xs font-normal text-content-tertiary mt-0.5">
              One-off day off without changing the recurring schedule
            </span>
          </button>

          {existingOverride && (
            <button
              disabled={saving}
              onClick={clear}
              className={`${actionButton} bg-bg-elevated/50 border-border hover:border-accent text-accent`}
            >
              <span className="block">Clear override</span>
              <span className="block text-xs font-normal text-content-tertiary mt-0.5">
                {baseDescription}
              </span>
            </button>
          )}
        </div>

        {/* One-off custom shift */}
        <div className="rounded-xl border border-border bg-bg-elevated/40 p-4 space-y-3">
          <div className="text-xs uppercase tracking-wider font-semibold text-content-secondary">
            {isWorkDefault ? 'Adjust this date' : 'Schedule a one-off shift'}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-content-secondary mb-1">Start time</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-content-secondary mb-1">Hours</span>
              <input
                type="number"
                min={0.5}
                max={24}
                step={0.5}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent"
              />
            </label>
          </div>
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">Note (optional)</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. handover, on-call, exam day…"
              className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent placeholder:text-content-tertiary"
            />
          </label>
          <button
            disabled={saving}
            onClick={() => save('custom_hours', { startTime, shiftLengthHours: hours })}
            className="w-full py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors min-h-[44px]"
          >
            Save custom shift
          </button>
        </div>
      </div>
    </Modal>
  );
};
