import React, { useEffect } from 'react';
import { Play, Pause, RotateCcw, Timer } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { usePomodoroStore } from '../../../stores/usePomodoroStore';

interface PomodoroMiniWidgetProps {
  onNavigateFocus: () => void;
}

export const PomodoroMiniWidget: React.FC<PomodoroMiniWidgetProps> = ({ onNavigateFocus }) => {
  const {
    isRunning,
    timeLeft,
    totalDuration,
    currentPhase,
    startTimer,
    pauseTimer,
    resetTimer,
    tick,
  } = usePomodoroStore();

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isRunning) {
      interval = setInterval(() => {
        tick();
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning, tick]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const progressPercent = Math.max(0, Math.min(100, ((totalDuration - timeLeft) / totalDuration) * 100));

  return (
    <Card
      title="Focus Timer"
      subtitle={currentPhase === 'focus' ? 'Active Focus Session' : 'Break Time'}
      action={
        <button
          onClick={onNavigateFocus}
          className="text-xs text-accent font-medium hover:underline"
        >
          Open App →
        </button>
      }
      className="flex flex-col justify-between"
    >
      <div className="my-2">
        <div className="flex items-center justify-between">
          <div className="font-mono text-3xl font-bold tracking-tight text-content-primary">
            {formattedTime}
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-semibold uppercase ${
              currentPhase === 'focus'
                ? 'bg-accent-subtle text-accent-text'
                : 'bg-emerald-500/20 text-emerald-400'
            }`}
          >
            {currentPhase.replace('_', ' ')}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-bg-elevated h-2 rounded-full overflow-hidden mt-3">
          <div
            className="bg-accent h-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="flex items-center space-x-2 mt-4 pt-3 border-t border-border/40">
        {isRunning ? (
          <button
            onClick={pauseTimer}
            className="flex-1 flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl bg-bg-elevated hover:bg-border text-content-primary text-xs font-semibold transition-colors"
          >
            <Pause className="w-3.5 h-3.5" />
            <span>Pause</span>
          </button>
        ) : (
          <button
            onClick={startTimer}
            className="flex-1 flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-sm transition-colors"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Start</span>
          </button>
        )}
        <button
          onClick={resetTimer}
          className="p-2 rounded-xl bg-bg-elevated hover:bg-border text-content-secondary hover:text-content-primary transition-colors"
          title="Reset Timer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </Card>
  );
};
