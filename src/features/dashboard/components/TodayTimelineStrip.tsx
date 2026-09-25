import React from 'react';
import { format } from 'date-fns';
import { Calendar, Clock, AlertCircle } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import type { CalendarEvent, ShiftConfig, ShiftOverride } from '../../../types';

interface TodayTimelineStripProps {
  events: CalendarEvent[];
  shiftConfig?: ShiftConfig;
  todayOverride?: ShiftOverride;
  onNavigateCalendar: () => void;
  onNavigateShifts: () => void;
}

export const TodayTimelineStrip: React.FC<TodayTimelineStripProps> = ({
  events,
  shiftConfig,
  todayOverride,
  onNavigateCalendar,
  onNavigateShifts,
}) => {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sun, 1 = Mon ...
  const formattedToday = format(today, 'yyyy-MM-dd');

  // Determine shift state for today
  let isShiftDay = shiftConfig ? shiftConfig.workingDays.includes(dayOfWeek) : true;
  let shiftLabel = '9h Work Shift';
  let shiftTime = shiftConfig ? `${shiftConfig.startTime} - 18:00` : '09:00 - 18:00';
  let isPto = false;
  let isCustomOff = false;

  if (todayOverride) {
    if (todayOverride.type === 'pto') {
      isShiftDay = false;
      isPto = true;
      shiftLabel = 'Paid Time Off (PTO)';
    } else if (todayOverride.type === 'custom_off') {
      isShiftDay = false;
      isCustomOff = true;
      shiftLabel = 'Scheduled Off Day';
    } else if (todayOverride.type === 'custom_hours') {
      isShiftDay = true;
      shiftLabel = `${todayOverride.shiftLengthHours || 8}h Custom Shift`;
      if (todayOverride.startTime) {
        shiftTime = `${todayOverride.startTime} (custom)`;
      }
    }
  } else if (!isShiftDay) {
    shiftLabel = 'Scheduled Off Day';
  }

  return (
    <Card className="col-span-1 md:col-span-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3.5 pb-2 border-b border-border/40">
        <div className="flex items-center space-x-2">
          <Calendar className="w-4 h-4 text-accent" />
          <h3 className="font-semibold text-sm sm:text-base text-content-primary">
            Today's Timeline • {format(today, 'EEEE, MMMM d')}
          </h3>
        </div>
        <div className="flex items-center space-x-2 text-xs">
          <button
            onClick={onNavigateShifts}
            className="text-content-secondary hover:text-accent transition-colors font-medium cursor-pointer"
          >
            Manage Shifts →
          </button>
        </div>
      </div>

      {/* Horizontal timeline strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* Work Shift Badge / Block */}
        <div
          onClick={onNavigateShifts}
          className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
            isPto
              ? 'bg-amber-500/10 border-amber-500/30 hover:border-amber-500/60'
              : !isShiftDay
              ? 'bg-bg-elevated/40 border-border/60 hover:border-border'
              : 'bg-accent-subtle border-accent/30 hover:border-accent'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-content-secondary">
              Shift Status
            </span>
            <span
              className={`w-2 h-2 rounded-full ${
                isPto ? 'bg-amber-500' : !isShiftDay ? 'bg-content-tertiary' : 'bg-accent'
              }`}
            />
          </div>
          <div>
            <div className="text-sm font-semibold text-content-primary truncate">{shiftLabel}</div>
            <div className="text-xs text-content-secondary mt-0.5 flex items-center space-x-1">
              <Clock className="w-3 h-3 flex-shrink-0" />
              <span>{isShiftDay ? shiftTime : isPto ? 'Full Day Paid' : 'No shift today'}</span>
            </div>
          </div>
        </div>

        {/* Calendar Events preview */}
        <div className="md:col-span-3">
          {events.length === 0 ? (
            <div 
              onClick={onNavigateCalendar}
              className="h-full min-h-[70px] border border-dashed border-border rounded-xl p-3 flex items-center justify-center text-xs text-content-tertiary hover:border-accent cursor-pointer transition-colors"
            >
              <span>No other calendar events today. Tap to schedule an event +</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {events.slice(0, 3).map((evt) => (
                <div
                  key={evt.id}
                  onClick={onNavigateCalendar}
                  className="p-2.5 rounded-xl bg-bg-elevated/60 border border-border hover:border-border-strong cursor-pointer transition-colors flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-content-primary truncate">
                      {evt.title}
                    </span>
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-accent-subtle text-accent-text">
                      {evt.category}
                    </span>
                  </div>
                  <div className="text-[11px] text-content-secondary mt-1 flex items-center space-x-1">
                    <Clock className="w-3 h-3 text-content-tertiary" />
                    <span>{evt.startTime ? `${evt.startTime} ${evt.endTime ? `- ${evt.endTime}` : ''}` : 'All Day'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};
