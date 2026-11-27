import React, { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { TodayAgenda } from './components/TodayAgenda';
import { BentoTile } from './components/BentoTile';
import { buildExamCountdown, daysLeftText } from './examCountdown';
import { fmtDuration } from './freeHours';
import { dueTopics } from '../review/reviewLogic';
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

  const next = useMemo(() => buildExamCountdown(assessments, subjects, topics)[0], [assessments, subjects, topics]);
  const open = todos.filter((t) => !t.done).length;
  const dueToday = todos.filter((t) => !t.done && t.dueDate && t.dueDate <= todayStr).length;
  const reviewDue = useMemo(() => dueTopics(topics).length, [topics]);

  const agenda = (
    <TodayAgenda
      tile
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

  const tiles = (
    <>
      <BentoTile label="Next exam" value={next ? daysLeftText(next.daysLeft) : 'None'} sub={next ? `${next.name} · ${next.subjectName}` : 'Nothing ahead'} onClick={() => onNavigate('library')} />
      <BentoTile label="To-do" value={`${open} open`} sub={dueToday > 0 ? `${dueToday} due today` : 'Nothing due today'} onClick={() => onNavigate('todos')} />
      <BentoTile label="Free today" value={freeInfo.freeMinutes > 0 ? fmtDuration(freeInfo.freeMinutes) : 'None'} sub="study windows left" onClick={() => onNavigate('focus')} />
      <BentoTile label="Shift" value={freeInfo.shiftLine.replace('Shift ', '')} sub="today" onClick={() => onNavigate('shifts')} />
      <BentoTile label="Review" value={reviewDue > 0 ? `${reviewDue} due` : 'Clear'} sub="topics to revisit" onClick={() => onNavigate('library')} />
      <BentoTile label="Focus" value="Start" sub="Pomodoro and timer" onClick={() => onNavigate('focus')} />
    </>
  );

  const lower = (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
      <div className="md:col-span-2 min-w-0"><InstinctUpdatesCard /></div>
      <div className="md:col-span-2 min-w-0"><TodoCard onNavigateTodos={() => onNavigate('todos')} /></div>
      <div className="md:col-span-2 min-w-0">
        <ExamCountdownCard assessments={assessments} subjects={subjects} topics={topics} onNavigateLibrary={() => onNavigate('library')} />
      </div>
      <div className="md:col-span-2 min-w-0">
        <FreeHoursCard events={allEvents} overrides={overrides} schedules={schedules} assessments={assessments} subjects={subjects} topics={topics} resources={pendingResources} onNavigateFocus={() => onNavigate('focus')} />
      </div>
      <div className="min-w-0"><ReviewCard onNavigateLibrary={() => onNavigate('library')} /></div>
      <div className="min-w-0"><UpcomingDeadlinesCard resources={pendingResources} assessments={assessments} subjectName={subjectName} onNavigateLibrary={() => onNavigate('library')} /></div>
      <div className="min-w-0"><WeeklyHoursCard overrides={overrides} schedules={schedules} onNavigateShifts={() => onNavigate('shifts')} /></div>
      <div className="min-w-0"><PomodoroMiniWidget onNavigateFocus={() => onNavigate('focus')} /></div>
      <div className="md:col-span-4 min-w-0"><StatsCard onNavigate={onNavigate} /></div>
    </div>
  );

  const cards = (
    <>
      <SignInBanner />
      <div className={`grid grid-cols-2 ${fill ? '' : 'md:grid-cols-4'} gap-3 md:gap-4 auto-rows-[128px] md:auto-rows-[136px]`}>
        <div className={`col-span-2 ${fill ? 'row-span-4' : 'row-span-4 md:row-span-3'} rounded-2xl border border-border bg-bg-surface p-4 card-enter min-h-0`}>
          {agenda}
        </div>
        {tiles}
      </div>
      {lower}
    </>
  );

  // `fill`: a definite-height flex column with ONE scrollable region holding
  // every card. Without `min-h-0` the inner region refuses to shrink below its
  // content, so the pane grows instead of scrolling and the bottom card
  // (Stats) sits below the fold with no scrollbar to reach it.
  if (fill) {
    return (
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain p-3 space-y-4 animate-in fade-in duration-200">
          {cards}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {cards}
    </div>
  );
};
