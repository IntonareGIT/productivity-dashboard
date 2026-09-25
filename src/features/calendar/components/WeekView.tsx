import React, { useMemo } from 'react';
import { addDays, format, startOfWeek } from 'date-fns';
import { Plus } from 'lucide-react';
import type { CalendarEvent } from '../../../types';
import { CATEGORY_MAP } from '../categories';

interface WeekViewProps {
  anchor: Date; // any date within the displayed week
  eventsByDate: Record<string, CalendarEvent[]>;
  shiftKindByDate: Record<string, 'work' | 'off' | 'pto'>;
  today: Date;
  onDayClick: (dateKey: string) => void;
  onEventClick: (event: CalendarEvent) => void;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function headerTint(kind: 'work' | 'off' | 'pto' | undefined): string {
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
  eventsByDate,
  shiftKindByDate,
  today,
  onDayClick,
  onEventClick,
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
        const events = eventsByDate[dateKey] ?? [];
        const kind = shiftKindByDate[dateKey];
        const isToday = dateKey === todayKey;

        return (
          <div
            key={dateKey}
            className="rounded-xl border border-border bg-bg-surface overflow-hidden flex flex-col"
          >
            {/* Day header (tinted for shift days) */}
            <button
              onClick={() => onDayClick(dateKey)}
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
              {events.length === 0 ? (
                <button
                  onClick={() => onDayClick(dateKey)}
                  className="w-full h-full min-h-[48px] flex items-center justify-center text-[11px] text-content-tertiary hover:text-accent transition-colors"
                >
                  No events
                </button>
              ) : (
                events.map((evt) => {
                  const meta = CATEGORY_MAP[evt.category];
                  return (
                    <button
                      key={evt.id}
                      onClick={() => onEventClick(evt)}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium hover:opacity-80 transition-opacity ${meta.badge}`}
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
            </div>
          </div>
        );
      })}
    </div>
  );
};
