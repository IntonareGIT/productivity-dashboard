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
  /**
   * Hosted inside a bounded pane (a split pane) rather than the scrolling page
   * body. The content then has to fill a definite height and scroll INSIDE
   * itself, otherwise the bottom cards (Stats) sit below the fold with no way
   * to reach them.
   */
  fill?: boolean;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigate, fill = false }) => {
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

  // The card list, shared by both layouts so the split pane and the full page
  // can never show different content.
  const cards = (
    <>
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
    </>
  );

  // `fill`: a definite-height flex column with ONE scrollable region holding
  // every card. Without `min-h-0` the inner region refuses to shrink below its
  // content, so the pane grows instead of scrolling and the bottom card
  // (Stats) sits below the fold with no scrollbar to reach it.
  if (fill) {
    return (
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain p-3 space-y-3 animate-in fade-in duration-200">
          {cards}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {cards}
    </div>
  );
};
