import React from 'react';
import { Card } from '../../components/ui/Card';
import { CalendarClock } from 'lucide-react';

export const ShiftsPage: React.FC = () => {
  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2.5">
        <CalendarClock className="w-6 h-6 text-accent" />
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-content-primary">
          Work Shift Tracker
        </h1>
      </div>
      <Card>
        <p className="text-sm text-content-secondary">
          Weekly shift strip (Mon-Sun), PTO logging, and one-off adjustments will be implemented in Phase 2.
        </p>
      </Card>
    </div>
  );
};

