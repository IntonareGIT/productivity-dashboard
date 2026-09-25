import React from 'react';
import { Briefcase, ArrowUpRight } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import type { ShiftConfig, ShiftOverride } from '../../../types';

interface WeeklyHoursCardProps {
  shiftConfig?: ShiftConfig;
  overrides?: ShiftOverride[];
  onNavigateShifts: () => void;
}

export const WeeklyHoursCard: React.FC<WeeklyHoursCardProps> = ({
  shiftConfig,
  overrides = [],
  onNavigateShifts,
}) => {
  // Compute default weekly scheduled hours
  const workingDaysCount = shiftConfig?.workingDays.length ?? 5;
  const shiftLength = shiftConfig?.shiftLengthHours ?? 9;
  const baseScheduledHours = workingDaysCount * shiftLength;

  // Approximate for current week placeholder
  const scheduledHours = baseScheduledHours;
  const workedHours = 0; // Starts from 0 until actual shifts logged/advanced

  const percentage = Math.min(100, Math.round((workedHours / scheduledHours) * 100)) || 0;

  return (
    <Card
      title="Weekly Shift Hours"
      subtitle="Current week progress"
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
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <span className="text-2xl font-bold font-mono text-content-primary">
              {workedHours}h
            </span>
            <span className="text-xs text-content-secondary ml-1.5 font-medium">
              / {scheduledHours}h scheduled
            </span>
          </div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent-subtle text-accent-text">
            {workingDaysCount} shift days
          </span>
        </div>

        {/* Bar */}
        <div className="w-full bg-bg-elevated h-2 rounded-full overflow-hidden">
          <div
            className="bg-accent h-full transition-all duration-300"
            style={{ width: `${Math.max(4, percentage)}%` }}
          />
        </div>
      </div>

      <div className="pt-3 border-t border-border/40 flex items-center justify-between text-xs text-content-secondary">
        <div className="flex items-center space-x-1.5">
          <Briefcase className="w-3.5 h-3.5 text-accent" />
          <span>{shiftLength}h standard shift length</span>
        </div>
        <span className="font-semibold text-content-primary">{shiftConfig?.startTime || '09:00'} start</span>
      </div>
    </Card>
  );
};
