import React, { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { endOfWeek, format, isWithinInterval, startOfWeek } from 'date-fns';
import { BarChart3, BookOpenCheck, CalendarCheck2, Timer } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { db } from '../../../db/db';
import type { NavTab } from '../../../components/layout/Sidebar';

/**
 * Simple stats view (Phase 6): days studied this week, focus hours this
 * month, sessions this week, and library completion — all derived from
 * existing pomodoro/library data (no new schema).
 */
interface StatsCardProps {
  /** Each tile opens the page its number comes from. */
  onNavigate?: (tab: NavTab) => void;
}

export const StatsCard: React.FC<StatsCardProps> = ({ onNavigate }) => {
  const sessions = useLiveQuery(() => db.pomodoroSessions.toArray()) ?? [];
  const resources = useLiveQuery(() => db.resources.toArray()) ?? [];

  const stats = useMemo(() => {
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    const monthKey = format(now, 'yyyy-MM');

    const inWeek = sessions.filter((s) =>
      isWithinInterval(new Date(s.completedAt), { start: weekStart, end: weekEnd })
    );
    const focusWeek = inWeek.filter((s) => s.sessionType === 'focus');
    const daysStudied = new Set(focusWeek.map((s) => s.date)).size;
    const focusMonthMinutes = sessions
      .filter((s) => s.sessionType === 'focus' && s.date.startsWith(monthKey))
      .reduce((sum, s) => sum + s.durationMinutes, 0);

    const doneResources = resources.filter((r) => r.completed).length;

    return {
      daysStudied,
      focusHours: Math.round((focusMonthMinutes / 60) * 10) / 10,
      sessionsThisWeek: focusWeek.length,
      doneResources,
      totalResources: resources.length,
    };
  }, [sessions, resources]);

  const tiles = [
    {
      icon: CalendarCheck2,
      value: `${stats.daysStudied}`,
      label: 'Days studied this week',
      tab: 'focus' as NavTab,
    },
    {
      icon: Timer,
      value: `${stats.focusHours}h`,
      label: 'Focus hours this month',
      tab: 'focus' as NavTab,
    },
    {
      icon: BarChart3,
      value: `${stats.sessionsThisWeek}`,
      label: 'Focus sessions this week',
      tab: 'focus' as NavTab,
    },
    {
      icon: BookOpenCheck,
      value: `${stats.doneResources}/${stats.totalResources}`,
      label: 'Resources completed',
      tab: 'library' as NavTab,
    },
  ];

  return (
    <Card title="Stats" subtitle="From your focus sessions and library">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((tile) => (
          <button
            key={tile.label}
            type="button"
            onClick={() => onNavigate?.(tile.tab)}
            aria-label={`${tile.label}: open ${tile.tab === 'focus' ? 'Focus' : 'Library'}`}
            className="text-left rounded-xl border border-border bg-bg-elevated/40 hover:border-accent transition-colors p-3 sm:p-4 flex flex-col gap-1.5"
          >
            <tile.icon className="w-4 h-4 text-accent" />
            <span className="text-xl sm:text-2xl font-bold font-mono text-content-primary leading-none">
              {tile.value}
            </span>
            <span className="text-[11px] text-content-secondary leading-tight">
              {tile.label}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
};
