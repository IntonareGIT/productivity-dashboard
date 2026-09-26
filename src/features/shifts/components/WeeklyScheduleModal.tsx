import React, { useEffect, useState } from 'react';
import { addDays, format } from 'date-fns';
import { Modal } from '../../../components/ui/Modal';
import { dayEndTime } from '../shiftLogic';
import { saveWeeklySchedule } from '../shiftsRepo';
import type { WeeklySchedule } from '../../../types';

interface WeeklyScheduleModalProps {
  /** Monday of the week being added/edited (yyyy-MM-dd). */
  weekStartDate: string;
  /** Existing record for this week, if any (edit mode). */
  existing?: WeeklySchedule;
  onClose: () => void;
}

const DAY_LABELS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

/** Creates/edits ONE week's record (upsert by weekStartDate — other weeks untouched). */
export const WeeklyScheduleModal: React.FC<WeeklyScheduleModalProps> = ({
  weekStartDate,
  existing,
  onClose,
}) => {
  const [offDays, setOffDays] = useState<number[]>(existing?.offDays ?? [6, 0]);
  const [startTime, setStartTime] = useState(existing?.shiftStartTime ?? '09:00');
  const [hours, setHours] = useState(existing?.shiftLengthHours ?? 9);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setOffDays(existing?.offDays ?? [6, 0]);
    setStartTime(existing?.shiftStartTime ?? '09:00');
    setHours(existing?.shiftLengthHours ?? 9);
    setError('');
  }, [weekStartDate, existing]);

  const monday = new Date(weekStartDate + 'T00:00:00');
  const rangeLabel = `${format(monday, 'MMM d')} – ${format(addDays(monday, 6), 'MMM d, yyyy')}`;

  const toggleDay = (day: number) => {
    setOffDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort()
    );
  };

  const submit = async () => {
    if (offDays.length >= 7) {
      setError('A week needs at least one working day.');
      return;
    }
    setSaving(true);
    try {
      await saveWeeklySchedule({
        weekStartDate,
        offDays,
        shiftStartTime: startTime,
        shiftLengthHours: hours,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? 'Edit week schedule' : 'Add week schedule'}
      subtitle={`Week of ${rangeLabel} — this record only`}
    >
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-content-primary">Days off</span>
            <span className="text-xs text-content-tertiary">{offDays.length} off</span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            {DAY_LABELS.map(({ value, label }) => {
              const isOff = offDays.includes(value);
              return (
                <button
                  key={value}
                  onClick={() => toggleDay(value)}
                  className={`min-h-[44px] rounded-xl border text-sm font-semibold transition-all ${
                    isOff
                      ? 'bg-bg-elevated border-border-strong text-content-primary'
                      : 'bg-accent-subtle border-accent/50 text-accent'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">Shift start</span>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">Shift length (h)</span>
            <input
              type="number"
              min={0.5}
              max={24}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent"
            />
          </label>
        </div>

        <div className="text-xs text-content-secondary border-t border-border/50 pt-3">
          Work shifts run{' '}
          <span className="font-semibold text-content-primary">
            {startTime}–{dayEndTime(startTime, hours)}
          </span>{' '}
          on working days this week.
        </div>

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-4">
          <button
            onClick={onClose}
            className="px-4 min-h-[44px] rounded-xl text-sm text-content-secondary hover:text-content-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-5 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors"
          >
            {existing ? 'Save this week' : 'Add schedule'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
