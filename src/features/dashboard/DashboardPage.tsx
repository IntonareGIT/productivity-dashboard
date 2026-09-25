import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { TodayTimelineStrip } from './components/TodayTimelineStrip';
import { PomodoroMiniWidget } from './components/PomodoroMiniWidget';
import { UpcomingDeadlinesCard } from './components/UpcomingDeadlinesCard';
import { WeeklyHoursCard } from './components/WeeklyHoursCard';
import type { NavTab } from '../../components/layout/Sidebar';
import { format } from 'date-fns';

interface DashboardPageProps {
  onNavigate: (tab: NavTab) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigate }) => {
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // Dexie live queries
  const events = useLiveQuery(
    () => db.calendarEvents.where('date').equals(todayStr).toArray(),
    [todayStr]
  ) || [];

  const shiftConfig = useLiveQuery(() => db.shiftConfig.get('default'));

  const todayOverride = useLiveQuery(
    () => db.shiftOverrides.where('date').equals(todayStr).first(),
    [todayStr]
  );

  const pendingResources = useLiveQuery(
    () => db.resources.toArray()
  ) || [];

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-content-primary">
            Welcome back
          </h1>
          <p className="text-xs sm:text-sm text-content-secondary mt-0.5">
            Here is your daily snapshot across shifts, calendar, and focus tasks.
          </p>
        </div>
      </div>

      {/* Bento-grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
        {/* Full-width "today" strip merging calendar events + work shift */}
        <TodayTimelineStrip
          events={events}
          shiftConfig={shiftConfig}
          todayOverride={todayOverride}
          onNavigateCalendar={() => onNavigate('calendar')}
          onNavigateShifts={() => onNavigate('shifts')}
        />

        {/* Small card: Pomodoro mini-widget */}
        <PomodoroMiniWidget onNavigateFocus={() => onNavigate('focus')} />

        {/* Small card: upcoming deadlines */}
        <UpcomingDeadlinesCard
          resources={pendingResources}
          onNavigateLibrary={() => onNavigate('library')}
        />

        {/* Small card: this week's hours */}
        <WeeklyHoursCard
          shiftConfig={shiftConfig}
          onNavigateShifts={() => onNavigate('shifts')}
        />
      </div>
    </div>
  );
};
