import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, format, startOfWeek } from 'date-fns';
import { CalendarClock, ChevronLeft, ChevronRight, Plane, Coffee, Briefcase } from 'lucide-react';
import { db } from '../../db/db';
import { defaultShiftConfig } from '../../db/defaultData';
import { Card } from '../../components/ui/Card';
import { getMonthSummary, getWeekSummary, type ResolvedShiftDay } from './shiftLogic';
import { indexOverridesByDate } from './shiftsRepo';
import { DayOverrideModal } from './components/DayOverrideModal';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function dayBlockClasses(day: ResolvedShiftDay): string {
  if (day.kind === 'pto') return 'bg-amber-500/12 border-amber-500/40';
  if (day.kind === 'off') return 'bg-bg-elevated/50 border-border';
  return 'bg-accent-subtle border-accent/40';
}

function DayStatusBlock({ day }: { day: ResolvedShiftDay }) {
  if (day.kind === 'pto') {
    return (
      <div className={`rounded-lg border p-2 h-full ${dayBlockClasses(day)}`}>
        <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold text-sm">
          <Plane className="w-3.5 h-3.5" />
          PTO
        </div>
        <div className="text-[11px] text-content-tertiary mt-1">No shift</div>
      </div>
    );
  }
  if (day.kind === 'off') {
    return (
      <div className={`rounded-lg border p-2 h-full ${dayBlockClasses(day)}`}>
        <div className="flex items-center gap-1.5 text-content-secondary font-semibold text-sm">
          <Coffee className="w-3.5 h-3.5" />
          Off
        </div>
        <div className="text-[11px] text-content-tertiary mt-1">Rest day</div>
      </div>
    );
  }
  return (
    <div className={`rounded-lg border p-2 h-full ${dayBlockClasses(day)}`}>
      <div className="flex items-center gap-1.5 text-accent font-semibold text-sm">
        <Briefcase className="w-3.5 h-3.5" />
        {day.hours}h shift
      </div>
      <div className="text-[11px] text-content-secondary mt-1 font-mono">
        {day.startTime}–{day.endTime}
      </div>
      {day.hasOverride && (
        <div className="text-[10px] uppercase tracking-wide text-content-tertiary mt-1 font-semibold">
          one-off
        </div>
      )}
    </div>
  );
}

export const ShiftsPage: React.FC = () => {
  const [anchor, setAnchor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const config = useLiveQuery(() => db.shiftConfig.get('default')) ?? defaultShiftConfig;
  const overrides = useLiveQuery(() => db.shiftOverrides.toArray()) ?? [];
  const overridesByDate = useMemo(() => indexOverridesByDate(overrides), [overrides]);

  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekSummary = useMemo(
    () => getWeekSummary(config, overridesByDate, anchor),
    [config, overridesByDate, anchor]
  );
  const monthSummary = useMemo(
    () => getMonthSummary(config, overridesByDate, anchor),
    [config, overridesByDate, anchor]
  );

  const weekLabel = `${format(weekStart, 'MMM d')} – ${format(
    addDays(weekStart, 6),
    'MMM d, yyyy'
  )}`;
  const selectedKey = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;

  return (
    <div className="space-y-5">
      {/* Header + week navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-2.5">
          <CalendarClock className="w-6 h-6 text-accent shrink-0" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-content-primary">
              Work Shifts
            </h1>
            <p className="text-xs text-content-tertiary">{weekLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => setAnchor(addDays(anchor, -7))}
            aria-label="Previous week"
            className="p-2.5 min-w-[44px] rounded-xl border border-border bg-bg-surface hover:bg-bg-elevated text-content-secondary hover:text-content-primary transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAnchor(new Date())}
            className="px-4 py-2.5 min-h-[44px] rounded-xl border border-border bg-bg-surface hover:bg-bg-elevated text-sm font-medium text-content-primary transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => setAnchor(addDays(anchor, 7))}
            aria-label="Next week"
            className="p-2.5 min-w-[44px] rounded-xl border border-border bg-bg-surface hover:bg-bg-elevated text-content-secondary hover:text-content-primary transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Weekly strip: Mon–Sun (7 columns on desktop, stacked rows on mobile) */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-2 sm:gap-3">
        {weekSummary.days.map((day, idx) => (
          <button
            key={day.dateKey}
            onClick={() => setSelectedDate(day.date)}
            className={`text-left rounded-xl border p-3 min-h-[84px] md:min-h-[150px] flex md:flex-col items-center md:items-stretch gap-3 md:gap-2 transition-all hover:border-border-strong ${
              day.isToday ? 'ring-2 ring-accent border-accent' : 'border-border bg-bg-surface'
            }`}
          >
            <div className="flex md:flex-col items-baseline md:items-start justify-between md:justify-start gap-1 w-auto md:w-full shrink-0">
              <span
                className={`text-xs font-semibold uppercase tracking-wide ${
                  day.isToday ? 'text-accent' : 'text-content-secondary'
                }`}
              >
                {DAY_NAMES[idx]}
              </span>
              <span
                className={`text-lg font-bold leading-none ${
                  day.isToday ? 'text-accent' : 'text-content-primary'
                }`}
              >
                {format(day.date, 'd')}
              </span>
            </div>
            <div className="flex-1 w-full min-w-0">
              <DayStatusBlock day={day} />
            </div>
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-content-tertiary">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-accent border border-accent/40" /> Shift
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-bg-elevated border border-border" /> Off day
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-amber-500/30 border border-amber-500/50" /> PTO
        </span>
        <span className="flex items-center gap-1.5">Tap a day to set PTO or adjust hours</span>
      </div>

      {/* Weekly + monthly summaries */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="This week" subtitle={weekLabel}>
          <div className="flex items-end justify-between mb-3">
            <div>
              <span className="text-3xl font-bold font-mono text-content-primary">
                {weekSummary.scheduledHours}h
              </span>
              <span className="text-xs text-content-secondary ml-2">scheduled</span>
            </div>
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-accent-subtle text-accent-text">
              {weekSummary.shiftCount} shifts
            </span>
          </div>
          <div className="w-full bg-bg-elevated h-2 rounded-full overflow-hidden mb-3">
            <div
              className="bg-accent h-full transition-all duration-300"
              style={{
                width: `${
                  weekSummary.scheduledHours > 0
                    ? Math.min(100, (weekSummary.workedHours / weekSummary.scheduledHours) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-content-secondary">
            <span>
              Worked{' '}
              <span className="font-semibold text-content-primary">
                {weekSummary.workedHours}h
              </span>
            </span>
            <span className="flex items-center gap-3">
              <span>{weekSummary.ptoCount} PTO</span>
              <span>{weekSummary.offCount} off</span>
            </span>
          </div>
        </Card>

        <Card title="This month" subtitle={monthSummary.label}>
          <div className="flex items-end justify-between mb-3">
            <div>
              <span className="text-3xl font-bold font-mono text-content-primary">
                {monthSummary.scheduledHours}h
              </span>
              <span className="text-xs text-content-secondary ml-2">scheduled</span>
            </div>
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-accent-subtle text-accent-text">
              {monthSummary.shiftCount} shifts
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-content-secondary border-t border-border/50 pt-3">
            <span>
              Standard shift{' '}
              <span className="font-semibold text-content-primary">
                {config.shiftLengthHours}h
              </span>{' '}
              from {config.startTime}
            </span>
            <span className="flex items-center gap-3">
              <span>{monthSummary.ptoCount} PTO</span>
              <span>{monthSummary.offCount} off</span>
            </span>
          </div>
        </Card>
      </div>

      {/* Day override editor */}
      <DayOverrideModal
        date={selectedDate}
        config={config}
        existingOverride={selectedKey ? overridesByDate[selectedKey] : undefined}
        onClose={() => setSelectedDate(null)}
      />
    </div>
  );
};
