import React, { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { TodayAgenda } from './components/TodayAgenda';
import { StatStrip } from './components/StatStrip';
import { buildAgenda } from './agenda';
import { buildTargets } from './freeHours';
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

  const todos = useLiveQuery(() => db.todos.toArray(), []) || [];
  const freeInfo = useMemo(() => {
    const now = new Date();
    const targets = buildTargets(assessments, subjects, topics, pendingResources, now);
    return buildAgenda({ date: now, now, events: allEvents, overrides, schedules, todos, targets });
  }, [allEvents, overrides, schedules, todos, assessments, subjects, topics, pendingResources]);

  const agenda = (
    <TodayAgenda
      events={allEvents}
      overrides={overrides}
      schedules={schedules}
      todos={todos}
      assessments={assessments}
      subjects={subjects}
      topics={topics}
      resources={pendingResources}
      onNavigate={onNavigate}
    />
  );

  const secondary = (
    <div className="flex flex-col gap-4 min-w-0">
      <InstinctUpdatesCard />
      <TodoCard onNavigateTodos={() => onNavigate('todos')} />
      <ReviewCard onNavigateLibrary={() => onNavigate('library')} />
      <ExamCountdownCard
        assessments={assessments}
        subjects={subjects}
        topics={topics}
        onNavigateLibrary={() => onNavigate('library')}
      />
      <FreeHoursCard
        events={allEvents}
        overrides={overrides}
        schedules={schedules}
        assessments={assessments}
        subjects={subjects}
        topics={topics}
        resources={pendingResources}
        onNavigateFocus={() => onNavigate('focus')}
      />
      <UpcomingDeadlinesCard
        resources={pendingResources}
        assessments={assessments}
        subjectName={subjectName}
        onNavigateLibrary={() => onNavigate('library')}
      />
      <WeeklyHoursCard overrides={overrides} schedules={schedules} onNavigateShifts={() => onNavigate('shifts')} />
      <PomodoroMiniWidget onNavigateFocus={() => onNavigate('focus')} />
      <StatsCard onNavigate={onNavigate} />
    </div>
  );

  const cards = (
    <>
      <SignInBanner />
      <StatStrip
        assessments={assessments}
        subjects={subjects}
        topics={topics}
        todos={todos}
        freeMinutes={freeInfo.freeMinutes}
        shiftLine={freeInfo.shiftLine}
        onNavigate={onNavigate}
      />
      {fill ? (
        <div className="flex flex-col gap-4">{agenda}{secondary}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 min-w-0">{agenda}</div>
          <aside className="lg:col-span-4 min-w-0" aria-label="More">{secondary}</aside>
        </div>
      )}
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
