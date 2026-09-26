import React from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { usePomodoroStore } from '../../../stores/usePomodoroStore';

interface PomodoroMiniWidgetProps {
  onNavigateFocus: () => void;
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Dashboard mini-widget. The countdown itself is driven by the global engine
 * inside usePomodoroStore — no local interval here, so the Dashboard and the
 * Focus page always show the same single timer.
 */
export const PomodoroMiniWidget: React.FC<PomodoroMiniWidgetProps> = ({ onNavigateFocus }) => {
  const {
    isRunning,
    timeLeft,
    totalDuration,
    currentPhase,
    startTimer,
    pauseTimer,
    resetTimer,
  } = usePomodoroStore();

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const progressPercent =
    totalDuration > 0 ? Math.max(0, Math.min(100, ((totalDuration - timeLeft) / totalDuration) * 100)) : 0;
  const isIdle = timeLeft === totalDuration && !isRunning;
  const statusLabel = isRunning ? 'Active' : isIdle ? 'Idle' : 'Paused';

  return (
    <Card
      title="Focus Timer"
      subtitle={currentPhase === 'focus' ? 'Focus session' : 'Break time'}
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
          <div className="flex flex-col items-end gap-1">
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-semibold uppercase ${
                currentPhase === 'focus'
                  ? 'bg-accent-subtle text-accent-text'
                  : 'bg-emerald-500/20 text-emerald-500'
              }`}
            >
              {currentPhase.replace('_', ' ')}
            </span>
            <span className="flex items-center gap-1 text-[10px] font-semibold text-content-secondary">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isRunning
                    ? 'bg-emerald-500 animate-pulse'
                    : isIdle
                    ? 'bg-content-tertiary'
                    : 'bg-amber-500'
                }`}
              />
              {statusLabel}
            </span>
          </div>
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
            className="flex-1 flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-xl bg-bg-elevated hover:bg-border text-content-primary text-xs font-semibold transition-colors min-h-[44px]"
          >
            <Pause className="w-3.5 h-3.5" />
            <span>Pause</span>
          </button>
        ) : (
          <button
            onClick={startTimer}
            className="flex-1 flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-sm transition-colors min-h-[44px]"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{isIdle ? 'Start' : 'Resume'}</span>
          </button>
        )}
        <button
          onClick={resetTimer}
          className="p-2.5 rounded-xl bg-bg-elevated hover:bg-border text-content-secondary hover:text-content-primary transition-colors"
          title="Reset Timer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </Card>
  );
};
