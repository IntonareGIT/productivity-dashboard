import React from 'react';
import { Card } from '../../components/ui/Card';
import { CalendarDays } from 'lucide-react';

export const CalendarPage: React.FC = () => {
  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2.5">
        <CalendarDays className="w-6 h-6 text-accent" />
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-content-primary">
          Calendar
        </h1>
      </div>
      <Card>
        <p className="text-sm text-content-secondary">
          Month and week calendar views with integrated shift backgrounds will be available in Phase 3.
        </p>
      </Card>
    </div>
  );
};
