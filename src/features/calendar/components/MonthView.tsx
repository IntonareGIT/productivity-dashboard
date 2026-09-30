import React, { useMemo } from 'react';
import { addDays, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import type { Assessment, Subject } from '../../../types';
import type { DayKind } from '../../shifts/shiftLogic';
import type { Occurrence } from '../recurrence';
import { CATEGORY_MAP } from '../categories';

interface MonthViewProps {
  anchor: Date; // any date within the displayed month
  occurrencesByDate: Record<string, Occurrence[]>;
  subjectsById: Record<string, Subject>;
  shiftKindByDate: Record<string, DayKind>;
  /** Assessments with a chosen date, grouped by date. Derived live. */
  assessmentsByDate?: Record<string, Assessment[]>;
  today: Date;
  onDayClick: (dateKey: string) => void;
  onEventClick: (occurrence: Occurrence) => void;
  /** Opens the day panel for a date (the "+x more" chip and a day tap). */
  onOpenDay: (dateKey: string) => void;
  onOpenAssessment: (assessment: Assessment) => void;
}

/** How many event chips fit in a cell before the "+x" takes over. */
const MAX_CHIPS = 2;

/**
 * How many dots fit in a mobile cell.
 *
 * Mobile shows small dots rather than text chips, so it fits more of them. But
 * the "+x" must still appear once the day has anything left over, otherwise a
 * phone has no route into the day panel at all. Three keeps the row to one line
 * on a 390px screen while leaving the fourth event to the "+x".
 */
const MOBILE_DOTS = 3;

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Only real shift days get a tint; 'off' and 'unscheduled' stay clear.
function tintClasses(kind: DayKind | undefined): string {
  if (kind === 'work') return 'bg-accent-subtle'; // subtle shift tint, not an event block
  if (kind === 'pto') return 'bg-amber-500/10';
  return '';
}

/** Month grid: 6 weeks × 7 days, shift-day tints, event chips with dynamic occurrences. */
export const MonthView: React.FC<MonthViewProps> = ({
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
  const cells = useMemo(() => {
    const first = startOfMonth(anchor);
    const gridStart = startOfWeek(first, { weekStartsOn: 1 });
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [anchor]);

  const todayKey = format(today, 'yyyy-MM-dd');

  return (
    <div className="rounded-2xl border border-border bg-bg-surface overflow-hidden">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-border bg-bg-elevated/40">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="py-2 text-center text-[11px] sm:text-xs font-semibold uppercase tracking-wide text-content-secondary"
          >
            {label}
          </div>
        ))}
      </div>

      {/* 42 day cells */}
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const dateKey = format(cell, 'yyyy-MM-dd');
          const occurrences = occurrencesByDate[dateKey] ?? [];
          const assessments = assessmentsByDate[dateKey] ?? [];
          const inMonth = isSameMonth(cell, anchor);
          const isToday = dateKey === todayKey;
          const kind = shiftKindByDate[dateKey];
          // Assessments are squeezed in only if there is room, so a busy day
          // still shows its events. An assessment is never hidden entirely: the
          // "+x" chip always accounts for everything not shown.
          const showAssessment = assessments.length > 0 ? 1 : 0;
          const visible = occurrences.slice(0, Math.max(0, MAX_CHIPS - showAssessment));
          const extra = occurrences.length - visible.length;

          return (
            <div
              key={dateKey}
              data-day-cell={dateKey}
              onClick={() => onDayClick(dateKey)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onDayClick(dateKey);
              }}
              className={`relative min-h-[74px] sm:min-h-[96px] md:min-h-[112px] p-1 sm:p-1.5 border-r border-b border-border/60 cursor-pointer transition-colors hover:bg-bg-elevated/40 ${tintClasses(
                kind
              )} ${inMonth ? '' : 'opacity-40'} ${
                isToday ? 'ring-2 ring-inset ring-accent' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`text-xs sm:text-sm font-semibold ${
                    isToday ? 'text-accent' : 'text-content-secondary'
                  }`}
                >
                  {format(cell, 'd')}
                </span>
                {kind === 'pto' && (
                  <span className="hidden sm:block text-[9px] font-bold uppercase text-amber-600 dark:text-amber-400">
                    PTO
                  </span>
                )}
              </div>

              {/* Chips. Every one of these is a real <button>, so they are
                  reachable by tap and by keyboard: no hover-only affordance. */}
              <div className="hidden sm:flex flex-col gap-1">
                {assessments.slice(0, showAssessment).map((a) => {
                  const subject = subjectsById[a.subjectId];
                  const color = subject?.color;
                  return (
                    <button
                      key={`a-${a.id}`}
                      data-month-assessment={a.id}
                      onClick={(e) => { e.stopPropagation(); onOpenAssessment(a); }}
                      aria-label={`${a.type}: ${a.name}`}
                      style={color ? { borderLeftColor: color, borderLeftWidth: '3px' } : undefined}
                      className="w-full text-left px-1.5 py-0.5 rounded text-[10px] leading-tight font-semibold truncate border border-dashed border-rose-500/50 text-rose-600 dark:text-rose-400 hover:opacity-80 transition-all"
                    >
                      {a.type === 'quiz' ? 'Quiz' : a.type === 'exam' ? 'Exam' : a.type === 'project' ? 'Project' : 'Task'}: {a.name}
                    </button>
                  );
                })}
                {visible.map((occ) => {
                  const evt = occ.event;
                  const meta = CATEGORY_MAP[evt.category];
                  const subject = evt.subjectId ? subjectsById[evt.subjectId] : undefined;
                  const subjectColor = subject?.color;

                  return (
                    <button
                      key={`${evt.id}-${occ.dateKey}`}
                      data-month-event={evt.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(occ);
                      }}
                      style={
                        subjectColor
                          ? { borderLeftColor: subjectColor, borderLeftWidth: '3px' }
                          : undefined
                      }
                      className={`w-full text-left px-1.5 py-0.5 rounded text-[10px] leading-tight font-medium truncate hover:opacity-80 transition-all ${meta.badge}`}
                    >
                      {evt.startTime && (
                        <span className="opacity-70 font-mono">{evt.startTime} </span>
                      )}
                      {evt.title}
                    </button>
                  );
                })}
                {/* "+x more" is now a BUTTON that opens the day panel, not a
                    dead label. This is the behaviour the old version lacked. */}
                {extra > 0 && (
                  <button
                    data-month-more={dateKey}
                    onClick={(e) => { e.stopPropagation(); onOpenDay(dateKey); }}
                    aria-label={`Show all ${occurrences.length} events on this day`}
                    className="w-full text-left px-1.5 py-0.5 rounded text-[10px] leading-tight font-semibold text-content-secondary hover:bg-bg-elevated transition-colors"
                  >
                    +{extra} more
                  </button>
                )}
              </div>

              {/* Compact dots (mobile): same tap targets, smaller. */}
              <div className="flex sm:hidden flex-wrap gap-1 mt-0.5">
                {assessments.slice(0, showAssessment).map((a) => {
                  const subject = subjectsById[a.subjectId];
                  return (
                    <button
                      key={`a-${a.id}`}
                      data-month-assessment={a.id}
                      onClick={(e) => { e.stopPropagation(); onOpenAssessment(a); }}
                      aria-label={`${a.type}: ${a.name}`}
                      className="w-2.5 h-2.5 rounded-sm border border-rose-500"
                      style={subject?.color ? { backgroundColor: subject.color } : undefined}
                    />
                  );
                })}
                {occurrences.slice(0, MOBILE_DOTS).map((occ) => {
                  const evt = occ.event;
                  const subject = evt.subjectId ? subjectsById[evt.subjectId] : undefined;
                  const subjectColor = subject?.color;

                  return (
                    <button
                      key={`${evt.id}-${occ.dateKey}`}
                      data-month-event={evt.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(occ);
                      }}
                      aria-label={evt.title}
                      style={subjectColor ? { backgroundColor: subjectColor } : undefined}
                      className={`w-2 h-2 rounded-full ${
                        subjectColor ? '' : CATEGORY_MAP[evt.category].dot
                      }`}
                    />
                  );
                })}
                // The mobile row shows fewer dots, so the "+x" appears sooner. The day must
                // be REACHABLE at every count: with only dots and no "+x", a
                // phone user has no way to open the full day at all, which is
                // the exact gap this phase closes.
                {occurrences.length > MOBILE_DOTS && (
                  <button
                    data-month-more={dateKey}
                    onClick={(e) => { e.stopPropagation(); onOpenDay(dateKey); }}
                    aria-label={`Show all ${occurrences.length} events on this day`}
                    className="text-[10px] font-semibold text-content-secondary px-1 min-h-[20px]"
                  >
                    +{occurrences.length - MOBILE_DOTS} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
