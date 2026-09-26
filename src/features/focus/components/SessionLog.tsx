import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import { ChevronDown, ListChecks } from 'lucide-react';
import { db } from '../../../db/db';

/**
 * Collapsed-by-default session log below the timer: date, duration, and
 * what was focused on, from the `pomodoroSessions` table.
 */
export const SessionLog: React.FC = () => {
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const recent =
    useLiveQuery(() =>
      db.pomodoroSessions.orderBy('completedAt').reverse().limit(30).toArray()
    ) ?? [];

  const todaySessions = useLiveQuery(
    () => db.pomodoroSessions.where('date').equals(todayStr).toArray(),
    [todayStr]
  ) ?? [];

  const todayMinutes = todaySessions
    .filter((s) => s.sessionType === 'focus')
    .reduce((sum, s) => sum + s.durationMinutes, 0);

  return (
    <details className="group rounded-2xl border border-border bg-bg-surface">
      <summary className="flex items-center justify-between px-4 sm:px-5 py-4 cursor-pointer list-none select-none min-h-[56px]">
        <span className="flex items-center gap-2.5">
          <ListChecks className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-content-primary">Session log</span>
          <span className="text-xs text-content-tertiary">
            {recent.length > 0
              ? `${todaySessions.length} today · ${todayMinutes} min today`
              : 'no sessions yet'}
          </span>
        </span>
        <ChevronDown className="w-4 h-4 text-content-tertiary transition-transform group-open:rotate-180" />
      </summary>

      <div className="px-4 sm:px-5 pb-4">
        {recent.length === 0 ? (
          <p className="text-xs text-content-tertiary py-3 text-center border-t border-border/50">
            Completed focus sessions will appear here.
          </p>
        ) : (
          <div className="border-t border-border/50 divide-y divide-border/40">
            {recent.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between gap-3 py-2.5 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-mono text-content-tertiary shrink-0 w-24 truncate">
                    {format(new Date(session.completedAt), 'MMM d, HH:mm')}
                  </span>
                  <span className="text-content-primary truncate">
                    {session.focusSubject}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-semibold text-content-secondary">
                    {session.durationMinutes} min
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent-subtle text-accent-text uppercase">
                    {session.sessionType.replace('_', ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
};
