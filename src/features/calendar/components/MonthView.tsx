import React, { useMemo } from 'react';
import { addDays, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import type { Subject } from '../../../types';
import type { DayKind } from '../../shifts/shiftLogic';
import type { Occurrence } from '../recurrence';
import { CATEGORY_MAP } from '../categories';

interface MonthViewProps {
  anchor: Date; // any date within the displayed month
  occurrencesByDate: Record<string, Occurrence[]>;
  subjectsById: Record<string, Subject>;
  shiftKindByDate: Record<string, DayKind>;
  today: Date;
  onDayClick: (dateKey: string) => void;
  onEventClick: (occurrence: Occurrence) => void;
}

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
  today,
  onDayClick,
  onEventClick,
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
          const inMonth = isSameMonth(cell, anchor);
          const isToday = dateKey === todayKey;
          const kind = shiftKindByDate[dateKey];
          const visible = occurrences.slice(0, 2);
          const extra = occurrences.length - visible.length;

          return (
            <div
              key={dateKey}
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

              {/* Event chips (desktop) */}
              <div className="hidden sm:flex flex-col gap-1">
                {visible.map((occ) => {
                  const evt = occ.event;
                  const meta = CATEGORY_MAP[evt.category];
                  const subject = evt.subjectId ? subjectsById[evt.subjectId] : undefined;
                  const subjectColor = subject?.color;

                  return (
                    <button
                      key={`${evt.id}-${occ.dateKey}`}
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
                {extra > 0 && (
                  <span className="text-[10px] text-content-tertiary font-medium pl-0.5">
                    +{extra} more
                  </span>
                )}
              </div>

              {/* Compact dots (mobile) */}
              <div className="flex sm:hidden flex-wrap gap-1 mt-0.5">
                {occurrences.slice(0, 4).map((occ) => {
                  const evt = occ.event;
                  const subject = evt.subjectId ? subjectsById[evt.subjectId] : undefined;
                  const subjectColor = subject?.color;

                  return (
                    <button
                      key={`${evt.id}-${occ.dateKey}`}
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
                {occurrences.length > 4 && (
                  <span className="text-[9px] text-content-tertiary">
                    +{occurrences.length - 4}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
