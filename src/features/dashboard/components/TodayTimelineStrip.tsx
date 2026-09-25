import React from 'react';
import { format } from 'date-fns';
import { Calendar, Clock, Briefcase, Plane, Coffee } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import type { CalendarEvent, ShiftConfig, ShiftOverride } from '../../../types';
import { resolveDay } from '../../shifts/shiftLogic';

interface TodayTimelineStripProps {
  events: CalendarEvent[];
  shiftConfig?: ShiftConfig;
  todayOverride?: ShiftOverride;
  onNavigateCalendar: () => void;
  onNavigateShifts: () => void;
}

/**
 * Full-width "today" strip: today's shift (from the shift tracker) merged
 * with today's calendar events on one horizontal timeline.
 */
export const TodayTimelineStrip: React.FC<TodayTimelineStripProps> = ({
  events,
  shiftConfig,
  todayOverride,
  onNavigateCalendar,
  onNavigateShifts,
}) => {
  const today = new Date();

  // Resolve today's shift through the shared shift logic (Phase 2).
  const day = shiftConfig
    ? resolveDay(
        shiftConfig,
        todayOverride ? { [todayOverride.date]: todayOverride } : {},
        today
      )
    : null;

  const shiftIcon = day?.kind === 'pto' ? Plane : day?.kind === 'off' ? Coffee : Briefcase;
  const ShiftIcon = shiftIcon;

  const shiftLabel = !day
    ? 'Loading schedule…'
    : day.kind === 'pto'
    ? 'Paid Time Off (PTO)'
    : day.kind === 'off'
    ? 'Scheduled Off Day'
    : day.hasOverride
    ? `${day.hours}h Custom Shift`
    : `${day.hours}h Work Shift`;

  const shiftTime = !day
    ? ''
    : day.kind === 'work'
    ? `${day.startTime} – ${day.endTime}`
    : day.kind === 'pto'
    ? 'Full day paid'
    : 'No shift today';

  return (
    <Card className="col-span-1 md:col-span-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3.5 pb-2 border-b border-border/40">
        <div className="flex items-center space-x-2">
          <Calendar className="w-4 h-4 text-accent" />
          <h3 className="font-semibold text-sm sm:text-base text-content-primary">
            Today's Timeline • {format(today, 'EEEE, MMMM d')}
          </h3>
        </div>
        <button
          onClick={onNavigateShifts}
          className="text-xs text-content-secondary hover:text-accent transition-colors font-medium self-start sm:self-auto"
        >
          Manage Shifts →
        </button>
      </div>

      {/* Horizontal timeline: shift block + calendar events */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <button
          onClick={onNavigateShifts}
          className={`p-3 rounded-xl border transition-all text-left flex flex-col justify-between min-h-[76px] ${
            day?.kind === 'pto'
              ? 'bg-amber-500/10 border-amber-500/30 hover:border-amber-500/60'
              : day?.kind === 'off'
              ? 'bg-bg-elevated/40 border-border/60 hover:border-border'
              : 'bg-accent-subtle border-accent/30 hover:border-accent'
          }`}
        >
          <div className="flex items-center justify-between mb-1 gap-2">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-content-secondary flex items-center gap-1.5">
              <ShiftIcon className="w-3.5 h-3.5" />
              Shift Status
            </span>
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                day?.kind === 'pto'
                  ? 'bg-amber-500'
                  : day?.kind === 'off'
                  ? 'bg-content-tertiary'
                  : 'bg-accent'
              }`}
            />
          </div>
          <div>
            <div className="text-sm font-semibold text-content-primary">{shiftLabel}</div>
            <div className="text-xs text-content-secondary mt-0.5 flex items-center space-x-1">
              <Clock className="w-3 h-3 flex-shrink-0" />
              <span className="font-mono">{shiftTime}</span>
              {day?.hasOverride && (
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-bg-elevated text-content-tertiary">
                  one-off
                </span>
              )}
            </div>
          </div>
        </button>

        {/* Today's calendar events */}
        <div className="md:col-span-3">
          {events.length === 0 ? (
            <button
              onClick={onNavigateCalendar}
              className="w-full h-full min-h-[76px] border border-dashed border-border rounded-xl p-3 flex items-center justify-center text-xs text-content-tertiary hover:border-accent transition-colors"
            >
              No calendar events today — tap to schedule one +
            </button>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {events.map((evt) => (
                <button
                  key={evt.id}
                  onClick={onNavigateCalendar}
                  className="p-2.5 rounded-xl bg-bg-elevated/60 border border-border hover:border-border-strong transition-colors flex flex-col justify-between text-left min-h-[76px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-content-primary truncate">
                      {evt.title}
                    </span>
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-accent-subtle text-accent-text flex-shrink-0">
                      {evt.category}
                    </span>
                  </div>
                  <div className="text-[11px] text-content-secondary mt-1 flex items-center space-x-1">
                    <Clock className="w-3 h-3 text-content-tertiary" />
                    <span className="font-mono">
                      {evt.startTime
                        ? `${evt.startTime}${evt.endTime ? `–${evt.endTime}` : ''}`
                        : 'All Day'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};
