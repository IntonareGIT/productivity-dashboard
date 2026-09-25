import React from 'react';
import { Card } from '../../components/ui/Card';
import { Timer } from 'lucide-react';
import { PomodoroMiniWidget } from '../dashboard/components/PomodoroMiniWidget';

export const FocusPage: React.FC = () => {
  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2.5">
        <Timer className="w-6 h-6 text-accent" />
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-content-primary">
          Focus & Pomodoro
        </h1>
      </div>
      <div className="max-w-md">
        <PomodoroMiniWidget onNavigateFocus={() => {}} />
      </div>
      <Card>
        <p className="text-sm text-content-secondary">
          Full circular countdown UI, 25/5 intervals, audio alarms, and Dexie session logs arrive in Phase 5.
        </p>
      </Card>
    </div>
  );
};
