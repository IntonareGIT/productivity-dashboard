import React, { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { TodayTimelineStrip } from './components/TodayTimelineStrip';
import { PomodoroMiniWidget } from './components/PomodoroMiniWidget';
import { UpcomingDeadlinesCard } from './components/UpcomingDeadlinesCard';
import { WeeklyHoursCard } from './components/WeeklyHoursCard';
import { StatsCard } from './components/StatsCard';
import { SignInBanner } from './components/SignInBanner';
import type { NavTab } from '../../components/layout/Sidebar';
import { format } from 'date-fns';
import { occursOn } from '../calendar/recurrence';


interface DashboardPageProps {
  onNavigate: (tab: NavTab) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigate }) => {
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // Dexie live queries
  const allEvents = useLiveQuery(() => db.calendarEvents.toArray()) || [];
  const today = new Date();
  const events = useMemo(
    () => allEvents.filter((e) => occursOn(e, today)),
    [allEvents, todayStr]
  );

  const schedules = useLiveQuery(() => db.weeklySchedules.toArray()) || [];

  // All overrides feed both today's strip and this week's hours card.
  const overrides = useLiveQuery(
    () => db.shiftOverrides.toArray()
  ) || [];

  const pendingResources = useLiveQuery(
    () => db.resources.toArray()
  ) || [];

  const assessments = useLiveQuery(() => db.assessments.toArray()) || [];
  const subjects = useLiveQuery(() => db.subjects.toArray()) || [];
  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? null;

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Not-signed-in warning. Dashboard only, above the welcome heading. */}
      <SignInBanner />

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
          overrides={overrides}
          schedules={schedules}
          onNavigateCalendar={() => onNavigate('calendar')}
          onNavigateShifts={() => onNavigate('shifts')}
        />

        {/* Small card: Pomodoro mini-widget */}
        <PomodoroMiniWidget onNavigateFocus={() => onNavigate('focus')} />

        {/* Small card: upcoming deadlines */}
        <UpcomingDeadlinesCard
          resources={pendingResources}
          assessments={assessments}
          subjectName={subjectName}
          onNavigateLibrary={() => onNavigate('library')}
        />

        {/* Small card: this week's hours (live from the shift tracker) */}
        <WeeklyHoursCard
          overrides={overrides}
          schedules={schedules}
          onNavigateShifts={() => onNavigate('shifts')}
        />

        {/* Full-width: stats view (days studied, focus hours, sessions, resources) */}
        <div className="md:col-span-3">
          <StatsCard />
        </div>
      </div>
    </div>
  );
};
