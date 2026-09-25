import React, { useMemo } from 'react';
import { Briefcase, ArrowUpRight } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import type { ShiftConfig, ShiftOverride } from '../../../types';
import { getWeekSummary } from '../../shifts/shiftLogic';
import { indexOverridesByDate } from '../../shifts/shiftsRepo';

interface WeeklyHoursCardProps {
  shiftConfig?: ShiftConfig;
  overrides?: ShiftOverride[];
  onNavigateShifts: () => void;
}

/**
 * This week's worked vs scheduled hours, computed from the shift tracker
 * (default schedule + one-off overrides/PTO).
 */
export const WeeklyHoursCard: React.FC<WeeklyHoursCardProps> = ({
  shiftConfig,
  overrides = [],
  onNavigateShifts,
}) => {
  const summary = useMemo(() => {
    if (!shiftConfig) return null;
    return getWeekSummary(shiftConfig, indexOverridesByDate(overrides), new Date());
  }, [shiftConfig, overrides]);

  const scheduled = summary?.scheduledHours ?? 0;
  const worked = summary?.workedHours ?? 0;
  const percentage = scheduled > 0 ? Math.min(100, (worked / scheduled) * 100) : 0;

  return (
    <Card
      title="Weekly Shift Hours"
      subtitle="Worked vs scheduled this week"
      action={
        <button
          onClick={onNavigateShifts}
          className="text-xs text-accent font-medium hover:underline flex items-center space-x-1"
        >
          <span>Schedule</span>
          <ArrowUpRight className="w-3 h-3" />
        </button>
      }
      className="flex flex-col justify-between"
    >
      <div className="my-2">
        <div className="flex items-baseline justify-between mb-2 gap-2">
          <div>
            <span className="text-2xl font-bold font-mono text-content-primary">{worked}h</span>
            <span className="text-xs text-content-secondary ml-1.5 font-medium">
              / {scheduled}h scheduled
            </span>
          </div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent-subtle text-accent-text whitespace-nowrap">
            {summary?.shiftCount ?? 0} shifts
          </span>
        </div>

        <div className="w-full bg-bg-elevated h-2 rounded-full overflow-hidden">
          <div
            className="bg-accent h-full transition-all duration-300"
            style={{ width: `${Math.max(scheduled > 0 && worked > 0 ? 4 : 0, percentage)}%` }}
          />
        </div>
      </div>

      <div className="pt-3 border-t border-border/40 flex items-center justify-between text-xs text-content-secondary gap-2">
        <div className="flex items-center space-x-1.5 min-w-0">
          <Briefcase className="w-3.5 h-3.5 text-accent shrink-0" />
          <span className="truncate">
            {shiftConfig?.shiftLengthHours ?? 9}h standard · {shiftConfig?.startTime ?? '09:00'}{' '}
            start
          </span>
        </div>
        <span className="whitespace-nowrap font-semibold text-content-primary">
          {summary?.ptoCount ?? 0} PTO
        </span>
      </div>
    </Card>
  );
};
