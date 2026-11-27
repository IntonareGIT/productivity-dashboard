import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { TodayAgenda } from './components/TodayAgenda';
import { TodayCompact } from './components/TodayCompact';
import { Minimize2 } from 'lucide-react';
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

  const [expandedRaw, setExpandedRaw] = useState(() => {
    try { return localStorage.getItem('dash.todayExpanded') === '1'; } catch { return false; }
  });
  const expanded = expandedRaw && !fill;
  const setExpanded = (v: boolean) => {
    setExpandedRaw(v);
    try { localStorage.setItem('dash.todayExpanded', v ? '1' : '0'); } catch { /* ignore */ }
  };

  // Cards flow into balanced columns (no empty holes under short cards).
  const item = 'mb-4 break-inside-avoid';
  const cardList = (
    <>
      {!expanded && (
        <div className={item}>
          <TodayCompact agenda={freeInfo} onExpand={() => setExpanded(true)} />
        </div>
      )}
      <div className={item}><InstinctUpdatesCard /></div>
      <div className={item}><TodoCard onNavigateTodos={() => onNavigate('todos')} /></div>
      <div className={item}><ReviewCard onNavigateLibrary={() => onNavigate('library')} /></div>
      <div className={item}>
        <ExamCountdownCard assessments={assessments} subjects={subjects} topics={topics} onNavigateLibrary={() => onNavigate('library')} />
      </div>
      <div className={item}>
        <FreeHoursCard events={allEvents} overrides={overrides} schedules={schedules} assessments={assessments} subjects={subjects} topics={topics} resources={pendingResources} onNavigateFocus={() => onNavigate('focus')} />
      </div>
      <div className={item}>
        <UpcomingDeadlinesCard resources={pendingResources} assessments={assessments} subjectName={subjectName} onNavigateLibrary={() => onNavigate('library')} />
      </div>
      <div className={item}><WeeklyHoursCard overrides={overrides} schedules={schedules} onNavigateShifts={() => onNavigate('shifts')} /></div>
      <div className={item}><PomodoroMiniWidget onNavigateFocus={() => onNavigate('focus')} /></div>
      <div className={item}><StatsCard onNavigate={onNavigate} /></div>
    </>
  );

  const cols = fill
    ? 'columns-1'
    : expanded
      ? 'columns-1 md:columns-2 xl:columns-1 min-[1500px]:columns-2'
      : 'columns-1 md:columns-2 xl:columns-3 min-[1800px]:columns-4';

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
      {expanded && !fill ? (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4 items-start">
          <div className="min-w-0 xl:sticky xl:top-0">
            <button
              onClick={() => setExpanded(false)}
              aria-label="Collapse today's agenda"
              className="mb-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-content-secondary hover:text-content-primary hover:border-border-strong"
            >
              <Minimize2 className="w-3.5 h-3.5" /> Collapse
            </button>
            {agenda}
          </div>
          <div className={`${cols} gap-4`}>{cardList}</div>
        </div>
      ) : (
        <div className={`${cols} gap-4`}>{cardList}</div>
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
