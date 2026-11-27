import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format } from 'date-fns';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';
import type { Assessment, CalendarEvent, Resource, ShiftOverride, Subject, Topic, TodoItem, WeeklySchedule } from '../../../types';
import { buildAgenda, type AgendaBlock } from '../agenda';
import { buildTargets, fmtDuration } from '../freeHours';
import { setTodoDone } from '../../todos/todosRepo';
import { useDeepLinkStore } from '../../../stores/useDeepLinkStore';
import type { NavTab } from '../../../components/layout/Sidebar';

const HOUR_PX = 56;
const GRID_START = 6; // 06:00
const GRID_END = 24;

interface Props {
  events: CalendarEvent[];
  overrides: ShiftOverride[];
  schedules: WeeklySchedule[];
  todos: TodoItem[];
  assessments: Assessment[];
  subjects: Subject[];
  topics: Topic[];
  resources: Resource[];
  onNavigate: (tab: NavTab) => void;
  /** Fill the parent card (bento tile) instead of sizing itself. */
  tile?: boolean;
}

const KIND_STYLE: Record<string, string> = {
  event: 'bg-sky-500/10 border-sky-500/40 text-content-primary',
  shift: 'bg-bg-elevated border-border-strong text-content-primary',
  rest: 'bg-transparent border-dashed border-border text-content-tertiary',
  free: 'bg-emerald-500/10 border-emerald-500/30 text-content-primary',
};

/**
 * One vertical hour-by-hour agenda for a day: classes, the shift, rest, free
 * study windows, and to-dos due. Step through days with the arrows.
 */
export const TodayAgenda: React.FC<Props> = ({
  events, overrides, schedules, todos, assessments, subjects, topics, resources, onNavigate, tile,
}) => {
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(new Date());
  const openCalendar = useDeepLinkStore((s) => s.openCalendar);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const date = useMemo(() => addDays(now, offset), [now, offset]);
  const agenda = useMemo(() => {
    const targets = buildTargets(assessments, subjects, topics, resources, now);
    return buildAgenda({ date, now, events, overrides, schedules, todos, targets });
  }, [date, now, events, overrides, schedules, todos, assessments, subjects, topics, resources]);

  const isToday = offset === 0;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const top = (m: number) => ((Math.min(Math.max(m, GRID_START * 60), GRID_END * 60) - GRID_START * 60) / 60) * HOUR_PX;
  const height = (GRID_END - GRID_START) * HOUR_PX;

  // Bring "now" (or the first block) into view on mount and when the day changes.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const anchor = isToday ? nowMin : agenda.blocks.find((b) => b.kind !== 'rest' && b.end > GRID_START * 60)?.start ?? GRID_START * 60;
    el.scrollTo({ top: Math.max(0, top(anchor) - 80) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  const visible = agenda.blocks.filter((b) => b.end > GRID_START * 60 && b.start < GRID_END * 60);
  const label = isToday ? 'Today' : offset === 1 ? 'Tomorrow' : format(date, 'EEEE');

  const clickBlock = (b: AgendaBlock) => {
    if (b.kind === 'event') { openCalendar(agenda.dateKey); onNavigate('calendar'); }
    else if (b.kind === 'shift') onNavigate('shifts');
    else if (b.kind === 'free') onNavigate('focus');
  };

  return (
    <section className={`flex flex-col min-h-0 ${tile ? 'h-full' : ''}`} aria-label="Agenda">
      <header className="flex items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-semibold text-content-primary leading-tight">{label}</h2>
          <p className="text-xs text-content-tertiary mt-0.5">
            {format(date, 'EEEE, MMMM d')} · {agenda.shiftLine} · {agenda.freeMinutes > 0 ? `${fmtDuration(agenda.freeMinutes)} free` : 'no free window'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {!isToday && (
            <button onClick={() => setOffset(0)} className="px-2 py-1 rounded-md text-xs text-content-secondary hover:bg-bg-elevated">Today</button>
          )}
          <button onClick={() => setOffset((o) => o - 1)} aria-label="Previous day" className="p-1.5 rounded-md text-content-secondary hover:bg-bg-elevated"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={() => setOffset((o) => o + 1)} aria-label="Next day" className="p-1.5 rounded-md text-content-secondary hover:bg-bg-elevated"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </header>

      {agenda.dueTodos.length > 0 && (
        <ul className="mb-3 space-y-1">
          {agenda.dueTodos.map((t) => (
            <li key={t.id} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 list-enter">
              <button
                onClick={() => void setTodoDone(t.id, true)}
                aria-label={`Complete "${t.title}"`}
                className="shrink-0 w-[18px] h-[18px] rounded-md border border-border hover:border-accent flex items-center justify-center"
              >
                <Check className="w-3 h-3 text-transparent" />
              </button>
              <span className="text-sm text-content-primary truncate flex-1">{t.title}</span>
              <span className="text-[11px] text-content-tertiary">
                {t.dueDate && t.dueDate < agenda.dateKey ? 'overdue' : 'due today'}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div
        ref={scroller}
        className={`relative overflow-y-auto overscroll-contain rounded-xl border border-border ${tile ? 'flex-1 min-h-0' : 'max-h-[min(760px,calc(100dvh-15rem))] min-h-[320px]'}`}
      >
        <div className="relative" style={{ height }}>
          {Array.from({ length: GRID_END - GRID_START + 1 }, (_, i) => GRID_START + i).map((h) => (
            <div key={h} className="absolute left-0 right-0 flex items-start" style={{ top: (h - GRID_START) * HOUR_PX }}>
              <span className="w-12 pr-2 -mt-2 text-right text-[11px] font-mono text-content-tertiary">
                {h === 24 ? '' : String(h).padStart(2, '0') + ':00'}
              </span>
              <div className="flex-1 border-t border-border/60" />
            </div>
          ))}

          <div className="absolute inset-y-0 left-12 right-2">
            {visible.map((b) => {
              const t = top(b.start);
              const h = Math.max(top(Math.min(b.end, GRID_END * 60)) - t, 22);
              const small = h < 40;
              const clickable = b.kind !== 'rest';
              const base = `absolute left-1 right-0 rounded-lg border px-2.5 ${small ? 'py-0.5' : 'py-1.5'} overflow-hidden text-left list-enter ${KIND_STYLE[b.kind]}`;
              const inner = (
                <div className={small ? 'flex items-baseline gap-2' : ''}>
                  <p className="text-xs font-semibold truncate">{b.title}</p>
                  {b.sub && <p className="text-[11px] text-content-tertiary truncate">{b.sub}</p>}
                </div>
              );
              return clickable ? (
                <button key={b.id} onClick={() => clickBlock(b)} className={`${base} hover:border-accent`} style={{ top: t, height: h }}>{inner}</button>
              ) : (
                <div key={b.id} className={base} style={{ top: t, height: h }}>{inner}</div>
              );
            })}

            {isToday && nowMin >= GRID_START * 60 && nowMin <= GRID_END * 60 && (
              <div className="absolute left-0 right-0 pointer-events-none" style={{ top: top(nowMin) }}>
                <div className="h-px bg-rose-500" />
                <div className="absolute -left-1 -top-[3px] w-[7px] h-[7px] rounded-full bg-rose-500" />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
