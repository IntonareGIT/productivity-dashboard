import React from 'react';
import { format } from 'date-fns';
import { Maximize2, Check } from 'lucide-react';
import type { Agenda } from '../agenda';
import { fmtDuration, fmtMin } from '../freeHours';
import { setTodoDone } from '../../todos/todosRepo';

interface Props {
  agenda: Agenda;
  onExpand: () => void;
}

const DOT: Record<string, string> = {
  event: 'bg-sky-500',
  shift: 'bg-content-tertiary',
  free: 'bg-emerald-500',
  rest: 'bg-border-strong',
};

/** Small Today card: what is next, what is due. Expands into the full hour-by-hour agenda. */
export const TodayCompact: React.FC<Props> = ({ agenda, onExpand }) => {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const upcoming = agenda.blocks.filter((b) => b.kind !== 'rest' && b.end > nowMin).slice(0, 5);
  return (
    <section aria-label="Today" className="rounded-2xl border border-border bg-bg-surface p-4 card-enter">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-content-primary leading-tight">Today</h2>
          <p className="text-xs text-content-tertiary mt-0.5">
            {format(now, 'EEE, MMM d')} · {agenda.shiftLine} · {agenda.freeMinutes > 0 ? `${fmtDuration(agenda.freeMinutes)} free` : 'no free window'}
          </p>
        </div>
        <button
          onClick={onExpand}
          aria-label="Expand today's agenda"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-content-secondary hover:text-content-primary hover:border-border-strong"
        >
          <Maximize2 className="w-3.5 h-3.5" /> Expand
        </button>
      </header>

      {agenda.dueTodos.length > 0 && (
        <ul className="mt-3 space-y-1">
          {agenda.dueTodos.slice(0, 3).map((t) => (
            <li key={t.id} className="flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-1.5">
              <button
                onClick={() => void setTodoDone(t.id, true)}
                aria-label={`Complete "${t.title}"`}
                className="shrink-0 w-[18px] h-[18px] rounded-md border border-border hover:border-accent flex items-center justify-center"
              >
                <Check className="w-3 h-3 text-transparent" />
              </button>
              <span className="text-sm text-content-primary truncate flex-1">{t.title}</span>
              <span className="text-[11px] text-content-tertiary">due</span>
            </li>
          ))}
        </ul>
      )}

      <ul className="mt-3 divide-y divide-border">
        {upcoming.length === 0 && <li className="py-3 text-sm text-content-tertiary">Nothing else today.</li>}
        {upcoming.map((b) => (
          <li key={b.id} className="flex items-center gap-3 py-2">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[b.kind]}`} />
            <span className="w-24 shrink-0 text-xs font-mono text-content-tertiary">{fmtMin(b.start)}-{fmtMin(b.end % 1440)}</span>
            <span className="text-sm text-content-primary truncate">{b.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};
