import React, { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { TodayTimelineStrip } from './components/TodayTimelineStrip';
import { PomodoroMiniWidget } from './components/PomodoroMiniWidget';
import { UpcomingDeadlinesCard } from './components/UpcomingDeadlinesCard';
import { WeeklyHoursCard } from './components/WeeklyHoursCard';
import { StatsCard } from './components/StatsCard';
import { SignInBanner } from './components/SignInBanner';
import { ExamCountdownCard } from './components/ExamCountdownCard';
import { FreeHoursCard } from './components/FreeHoursCard';
import { InstinctUpdatesCard } from './components/InstinctUpdatesCard';
import { TodoCard } from './components/TodoCard';
import { ReviewCard } from './components/ReviewCard';
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
  const topics = useLiveQuery(() => db.topics.toArray()) || [];
  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? null;

  // The card list, shared by both layouts so the split pane and the full page
  // can never show different content.
  const cards = (
    <>
      {/* Not-signed-in warning. Dashboard only, above the welcome heading. */}
      <SignInBanner />

      {/* Header */}
      <div className="pb-1">
        <h1 className="text-2xl font-semibold text-content-primary">Welcome back</h1>
        <p className="text-sm text-content-secondary mt-1">
          {format(new Date(), 'EEEE, MMMM d')}
        </p>
      </div>

      {/* Left: today, to-do, free hours. Right rail: exams, updates, glances. One column on phones and inside a split pane. */}
      <div className={fill ? 'flex flex-col gap-4' : 'grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-start'}>
        <div className={`flex flex-col gap-4 lg:gap-6 min-w-0 ${fill ? '' : 'lg:col-span-8'}`}>
          <TodayTimelineStrip
            events={events}
            overrides={overrides}
            schedules={schedules}
            onNavigateCalendar={() => onNavigate('calendar')}
            onNavigateShifts={() => onNavigate('shifts')}
          />
          <TodoCard onNavigateTodos={() => onNavigate('todos')} />
          <FreeHoursCard
            events={allEvents}  /* 3 days ahead, so every event, not just today's */
            overrides={overrides}
            schedules={schedules}
            assessments={assessments}
            subjects={subjects}
            topics={topics}
            resources={pendingResources}
            onNavigateFocus={() => onNavigate('focus')}
          />
          <StatsCard onNavigate={onNavigate} />
        </div>
        <div className={`flex flex-col gap-4 lg:gap-6 min-w-0 ${fill ? '' : 'lg:col-span-4'}`}>
          <ExamCountdownCard
            assessments={assessments}
            subjects={subjects}
            topics={topics}
            onNavigateLibrary={() => onNavigate('library')}
          />
          <InstinctUpdatesCard />
          <ReviewCard onNavigateLibrary={() => onNavigate('library')} />
          <UpcomingDeadlinesCard
            resources={pendingResources}
            assessments={assessments}
            subjectName={subjectName}
            onNavigateLibrary={() => onNavigate('library')}
          />
          <WeeklyHoursCard
            overrides={overrides}
            schedules={schedules}
            onNavigateShifts={() => onNavigate('shifts')}
          />
          <PomodoroMiniWidget onNavigateFocus={() => onNavigate('focus')} />
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
    <div className="space-y-6 animate-in fade-in duration-200">
      {cards}
    </div>
  );
};
