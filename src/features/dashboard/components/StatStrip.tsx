import React, { useMemo } from 'react';
import { format } from 'date-fns';
import type { Assessment, Subject, Topic, TodoItem } from '../../../types';
import { buildExamCountdown, daysLeftText } from '../examCountdown';
import { fmtDuration } from '../freeHours';
import type { NavTab } from '../../../components/layout/Sidebar';

interface Props {
  assessments: Assessment[];
  subjects: Subject[];
  topics: Topic[];
  todos: TodoItem[];
  freeMinutes: number;
  shiftLine: string;
  onNavigate: (tab: NavTab) => void;
}

const Tile: React.FC<{ label: string; value: string; sub?: string; onClick: () => void }> = ({ label, value, sub, onClick }) => (
  <button
    onClick={onClick}
    className="snap-start shrink-0 min-w-[148px] md:min-w-0 md:flex-1 text-left rounded-xl border border-border bg-bg-surface px-4 py-3 hover:border-border-strong card-enter"
  >
    <p className="text-[11px] text-content-tertiary">{label}</p>
    <p className="text-lg font-semibold text-content-primary leading-tight mt-0.5 truncate">{value}</p>
    {sub && <p className="text-[11px] text-content-secondary mt-0.5 truncate">{sub}</p>}
  </button>
);

/** A thin strip of the four numbers worth a glance: next exam, to-dos, free hours, shift. */
export const StatStrip: React.FC<Props> = ({ assessments, subjects, topics, todos, freeMinutes, shiftLine, onNavigate }) => {
  const next = useMemo(() => buildExamCountdown(assessments, subjects, topics)[0], [assessments, subjects, topics]);
  const open = todos.filter((t) => !t.done).length;
  const dueToday = todos.filter((t) => !t.done && t.dueDate && t.dueDate <= format(new Date(), 'yyyy-MM-dd')).length;
  return (
    <div className="flex gap-3 overflow-x-auto snap-x -mx-4 px-4 md:mx-0 md:px-0 pb-1">
      <Tile
        label="Next exam"
        value={next ? daysLeftText(next.daysLeft) : 'None'}
        sub={next ? `${next.name} · ${next.subjectName}` : 'No quizzes or exams ahead'}
        onClick={() => onNavigate('library')}
      />
      <Tile label="To-do" value={`${open} open`} sub={dueToday > 0 ? `${dueToday} due today` : 'Nothing due today'} onClick={() => onNavigate('todos')} />
      <Tile label="Free today" value={freeMinutes > 0 ? fmtDuration(freeMinutes) : 'None'} sub="study windows left" onClick={() => onNavigate('focus')} />
      <Tile label="Shift" value={shiftLine.replace('Shift ', '')} sub="today" onClick={() => onNavigate('shifts')} />
    </div>
  );
};
