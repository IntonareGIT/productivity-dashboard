import React, { useMemo } from 'react';
import { Hourglass, ArrowRight } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import type { Assessment, CalendarEvent, Resource, ShiftOverride, Subject, Topic, WeeklySchedule } from '../../../types';
import { buildFreeDays, buildTargets, fmtDuration, fmtMin } from '../freeHours';

interface FreeHoursCardProps {
  events: CalendarEvent[];
  overrides: ShiftOverride[];
  schedules: WeeklySchedule[];
  assessments: Assessment[];
  subjects: Subject[];
  topics: Topic[];
  resources: Resource[];
  onNavigateFocus: () => void;
}

/**
 * Real study windows for the next three days, around classes/events and shifts
 * (including a night shift spilling into the next morning), each with a
 * suggestion drawn from upcoming exams and due resources. Tap to open Focus.
 */
export const FreeHoursCard: React.FC<FreeHoursCardProps> = ({
  events, overrides, schedules, assessments, subjects, topics, resources, onNavigateFocus,
}) => {
  const days = useMemo(() => {
    const now = new Date();
    const targets = buildTargets(assessments, subjects, topics, resources, now);
    return buildFreeDays({ events, overrides, schedules, targets, now, days: 3 });
  }, [events, overrides, schedules, assessments, subjects, topics, resources]);

  return (
    <Card
      title="Free Hours"
      subtitle="Study windows around classes and shifts"
      action={
        <button onClick={onNavigateFocus} className="text-xs text-accent font-medium hover:underline flex items-center space-x-1">
          <span>Focus</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      }
    >
      <div className="grid grid-cols-1 gap-3">
        {days.map((day) => (
          <div key={day.dateKey} className="rounded-xl border border-border bg-bg-elevated/40 p-3 flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-content-primary">{day.label}</span>
              <span className="text-[11px] font-mono text-content-secondary">
                {day.totalMinutes > 0 ? fmtDuration(day.totalMinutes) : 'none'}
              </span>
            </div>
            {day.note && <p className="text-[10px] text-content-tertiary -mt-1">{day.note}</p>}
            {day.windows.length === 0 ? (
              <p className="text-[11px] text-content-tertiary py-2">No free window of 45 min or more.</p>
            ) : (
              day.windows.map((w) => (
                <button
                  key={w.start}
                  type="button"
                  onClick={onNavigateFocus}
                  aria-label={`Free ${fmtMin(w.start)} to ${fmtMin(w.end)} ${day.label}, open Focus`}
                  className="text-left rounded-lg border border-border bg-bg-surface hover:border-accent transition-colors px-2.5 py-2"
                >
                  <div className="flex items-center gap-1.5 text-[11px] font-mono text-content-primary">
                    <Hourglass className="w-3 h-3 text-accent shrink-0" />
                    <span>{fmtMin(w.start)}–{fmtMin(w.end)}</span>
                    <span className="text-content-tertiary">· {fmtDuration(w.minutes)}</span>
                  </div>
                  <p className="text-[11px] text-content-secondary mt-1 truncate">
                    {w.target ? w.target.label : 'Open study time: review notes'}
                  </p>
                  {w.target && <p className="text-[10px] text-content-tertiary truncate">{w.target.reason}</p>}
                </button>
              ))
            )}
          </div>
        ))}
      </div>
    </Card>
  );
};
