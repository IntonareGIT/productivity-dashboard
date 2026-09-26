import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, format, startOfWeek } from 'date-fns';
import { CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react';
import { db } from '../../../db/db';
import { Card } from '../../../components/ui/Card';
import { dayEndTime } from '../../shifts/shiftLogic';
import { deleteWeeklySchedule, findUnassignedWeekStart } from '../../shifts/shiftsRepo';
import { WeeklyScheduleModal } from '../../shifts/components/WeeklyScheduleModal';

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const inputCls =
  'w-full bg-bg-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent';

/**
 * Settings section for weekly rosters: every week is its own independent
 * record — adding or editing one week never affects any other week.
 */
export const WeeklySchedulesSettings: React.FC = () => {
  const schedules = useLiveQuery(() => db.weeklySchedules.toArray()) ?? [];

  const sorted = useMemo(
    () => [...schedules].sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate)),
    [schedules]
  );

  // Week picked for the next "add" (defaults to the first unassigned Monday).
  const [newWeek, setNewWeek] = useState<string>(() => findUnassignedWeekStart([]));
  const [modalWeek, setModalWeek] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Keep the suggested week current once the stored list loads/changes.
  useEffect(() => {
    setNewWeek((current) =>
      schedules.some((s) => s.weekStartDate === current)
        ? findUnassignedWeekStart(schedules)
        : current
    );
  }, [schedules]);

  const snapToMonday = (value: string): string =>
    value
      ? format(startOfWeek(new Date(value + 'T00:00:00'), { weekStartsOn: 1 }), 'yyyy-MM-dd')
      : findUnassignedWeekStart(schedules);

  const weekLabel = (weekStartDate: string) => {
    const monday = new Date(weekStartDate + 'T00:00:00');
    return `Week of ${format(monday, 'MMM d')} – ${format(addDays(monday, 6), 'MMM d, yyyy')}`;
  };

  return (
    <Card
      title="Weekly Schedules"
      subtitle="Assign each week's roster as you receive it — weeks are independent"
      action={
        <span className="text-xs text-content-tertiary">
          {schedules.length} week{schedules.length === 1 ? '' : 's'} assigned
        </span>
      }
    >
      <div className="space-y-4">
        {/* Add a specific week */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 rounded-xl border border-border bg-bg-elevated/40 p-3">
          <label className="block flex-1">
            <span className="block text-xs text-content-secondary mb-1">
              Add a schedule for the week containing…
            </span>
            <input
              type="date"
              value={newWeek}
              onChange={(e) => setNewWeek(snapToMonday(e.target.value))}
              className={inputCls}
            />
          </label>
          <button
            onClick={() => setModalWeek(newWeek)}
            className="flex items-center justify-center gap-1.5 px-4 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add this week's schedule
          </button>
        </div>
        <p className="text-xs text-content-tertiary -mt-1">
          Snaps to the Monday of the chosen week — existing weeks are never modified.
        </p>

        {/* Assigned weeks */}
        {sorted.length === 0 ? (
          <p className="text-xs text-content-tertiary text-center py-4 border-t border-border/50">
            No weeks assigned yet — unassigned weeks show as “Unscheduled” on the Shifts page.
          </p>
        ) : (
          <div className="border-t border-border/50 divide-y divide-border/40">
            {sorted.map((schedule) => (
              <div
                key={schedule.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-content-primary truncate">
                    {weekLabel(schedule.weekStartDate)}
                  </p>
                  <p className="text-xs text-content-tertiary mt-0.5 flex items-center gap-2 flex-wrap">
                    <span className="flex items-center gap-1">
                      <CalendarClock className="w-3 h-3" />
                      {schedule.shiftStartTime}–
                      {dayEndTime(schedule.shiftStartTime, schedule.shiftLengthHours)} ·{' '}
                      {schedule.shiftLengthHours}h
                    </span>
                    <span>
                      Off:{' '}
                      {[...schedule.offDays]
                        .sort()
                        .map((d) => DAY_SHORT[d])
                        .join(', ') || 'none'}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setModalWeek(schedule.weekStartDate)}
                    className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl border border-border hover:bg-bg-elevated text-xs font-medium text-content-primary transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={() =>
                      deleteId === schedule.id
                        ? deleteWeeklySchedule(schedule.id)
                        : setDeleteId(schedule.id)
                    }
                    className={`flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl text-xs font-medium transition-colors ${
                      deleteId === schedule.id
                        ? 'bg-rose-600 text-white'
                        : 'text-rose-500 hover:bg-rose-500/10 border border-rose-500/30'
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {deleteId === schedule.id ? 'Confirm?' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalWeek && (
        <WeeklyScheduleModal
          weekStartDate={modalWeek}
          existing={schedules.find((s) => s.weekStartDate === modalWeek)}
          onClose={() => setModalWeek(null)}
        />
      )}
    </Card>
  );
};
