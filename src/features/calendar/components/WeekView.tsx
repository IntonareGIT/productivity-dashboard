import React, { useMemo } from 'react';
import { addDays, format, startOfWeek } from 'date-fns';
import { Plus } from 'lucide-react';
import type { Assessment, Subject } from '../../../types';
import type { DayKind } from '../../shifts/shiftLogic';
import type { Occurrence } from '../recurrence';
import { CATEGORY_MAP } from '../categories';

interface WeekViewProps {
  anchor: Date; // any date within the displayed week
  occurrencesByDate: Record<string, Occurrence[]>;
  subjectsById: Record<string, Subject>;
  shiftKindByDate: Record<string, DayKind>;
  /** Assessments with a chosen date, grouped by date. Derived live. */
  assessmentsByDate?: Record<string, Assessment[]>;
  today: Date;
  onDayClick: (dateKey: string) => void;
  onEventClick: (occurrence: Occurrence) => void;
  /** Opens the day panel for a date. */
  onOpenDay: (dateKey: string) => void;
  onOpenAssessment: (assessment: Assessment) => void;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function headerTint(kind: DayKind | undefined): string {
  if (kind === 'work') return 'bg-accent-subtle';
  if (kind === 'pto') return 'bg-amber-500/10';
  return 'bg-bg-elevated/40';
}

/**
 * Week view: 7 day columns on desktop; single-column stacked day sections
 * below md (768px).
 */
export const WeekView: React.FC<WeekViewProps> = ({
  anchor,
  occurrencesByDate,
  subjectsById,
  shiftKindByDate,
  assessmentsByDate = {},
  today,
  onDayClick,
  onEventClick,
  onOpenDay,
  onOpenAssessment,
}) => {
  const days = useMemo(() => {
    const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [anchor]);

  const todayKey = format(today, 'yyyy-MM-dd');

  return (
    <div className="grid grid-cols-1 md:grid-cols-7 gap-2 md:gap-1.5">
      {days.map((day, idx) => {
        const dateKey = format(day, 'yyyy-MM-dd');
        const occurrences = occurrencesByDate[dateKey] ?? [];
        const assessments = assessmentsByDate[dateKey] ?? [];
        const kind = shiftKindByDate[dateKey];
        const isToday = dateKey === todayKey;

        return (
          <div
            key={dateKey}
            className="rounded-xl border border-border bg-bg-surface overflow-hidden flex flex-col"
          >
            {/* Day header (tinted for shift days). Opens the day panel. */}
            <button
              onClick={() => onOpenDay(dateKey)}
              className={`w-full text-left px-2.5 py-2 flex items-center justify-between gap-2 transition-colors hover:opacity-80 ${headerTint(
                kind
              )} ${isToday ? 'ring-2 ring-inset ring-accent' : ''}`}
            >
              <span className="flex items-baseline gap-1.5 min-w-0">
                <span
                  className={`text-xs font-semibold uppercase tracking-wide ${
                    isToday ? 'text-accent' : 'text-content-secondary'
                  }`}
                >
                  {WEEKDAY_LABELS[idx]}
                </span>
                <span
                  className={`text-sm font-bold ${
                    isToday ? 'text-accent' : 'text-content-primary'
                  }`}
                >
                  {format(day, 'd')}
                </span>
              </span>
              <span className="flex items-center gap-1">
                {kind === 'pto' && (
                  <span className="text-[9px] font-bold uppercase text-amber-600 dark:text-amber-400">
                    PTO
                  </span>
                )}
                <Plus className="w-3.5 h-3.5 text-content-tertiary" />
              </span>
            </button>

            {/* Events */}
            <div className="p-1.5 space-y-1.5 flex-1 min-h-[64px] md:min-h-[140px]">
              {assessments.map((a) => {
                const subject = subjectsById[a.subjectId];
                return (
                  <button
                    key={`a-${a.id}`}
                    data-month-assessment={a.id}
                    onClick={() => onOpenAssessment(a)}
                    className="w-full text-left px-2 py-1.5 rounded-lg text-xs font-semibold border border-dashed border-rose-500/50 text-rose-600 dark:text-rose-400 hover:opacity-80 transition-all"
                    style={subject?.color ? { borderLeftColor: subject.color, borderLeftWidth: '3px' } : undefined}
                  >
                    <span className="truncate">
                      {a.type === 'quiz' ? 'Quiz' : a.type === 'exam' ? 'Exam' : a.type === 'project' ? 'Project' : 'Task'}: {a.name}
                    </span>
                  </button>
                );
              })}
              {occurrences.length === 0 && assessments.length === 0 ? (
                <button
                  onClick={() => onDayClick(dateKey)}
                  className="w-full h-full min-h-[48px] flex items-center justify-center text-[11px] text-content-tertiary hover:text-accent transition-colors"
                >
                  No events
                </button>
              ) : (
                occurrences.map((occ) => {
                  const evt = occ.event;
                  const meta = CATEGORY_MAP[evt.category];
                  const subject = evt.subjectId ? subjectsById[evt.subjectId] : undefined;
                  const subjectColor = subject?.color;

                  return (
                    <button
                      key={`${evt.id}-${occ.dateKey}`}
                      onClick={() => onEventClick(occ)}
                      style={
                        subjectColor
                          ? { borderLeftColor: subjectColor, borderLeftWidth: '3px' }
                          : undefined
                      }
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium hover:opacity-80 transition-all ${meta.badge}`}
                    >
                      <span className="flex items-baseline gap-1.5">
                        <span className="font-mono text-[10px] opacity-70 shrink-0">
                          {evt.startTime ?? 'All day'}
                        </span>
                        <span className="truncate">{evt.title}</span>
                      </span>
                    </button>
                  );
                })
              )}
              {/* Always a real button: opens the day panel, works by tap. */}
              <button
                data-open-day={dateKey}
                onClick={() => onOpenDay(dateKey)}
                aria-label={`Show the full day for ${dateKey}`}
                className="w-full px-2 py-1 rounded-lg text-[10px] font-semibold text-content-secondary border border-border hover:bg-bg-elevated transition-colors"
              >
                View day
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
