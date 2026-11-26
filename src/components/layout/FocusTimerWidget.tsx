import React, { useEffect } from 'react';
import { Pause, Play } from 'lucide-react';
import { usePomodoroStore } from '../../stores/usePomodoroStore';
import { PomodoroDots } from './PomodoroDots';

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const PHASE_LABELS: Record<string, string> = {
  focus: 'Focus',
  short_break: 'Short break',
  long_break: 'Long break',
};

interface FocusTimerWidgetProps {
  isCollapsed: boolean;
}

/**
 * Pomodoro cycle widget.
 *
 * Visible whenever `cycleActive` is true — in every phase, running, paused, or
 * waiting between phases. Stays visible through breaks so the user can continue
 * the cycle without reopening the timer. When the cycle completes it shows
 * "Cycle complete" for 5 seconds, then hides.
 *
 * Reads the same `usePomodoroStore` the main timer uses — no second timer is
 * created, and play/pause call the same store functions.
 */
export const FocusTimerWidget: React.FC<FocusTimerWidgetProps> = ({
  isCollapsed,
}) => {
  const {
    isRunning,
    timeLeft,
    totalDuration,
    currentPhase,
    completedFocusCycles,
    cycleActive,
    cycleComplete,
    settings,
    startTimer,
    pauseTimer,
    clearCycleComplete,
  } = usePomodoroStore();

  const totalBlocks = settings.cyclesBeforeLongBreak;
  const currentBlock = completedFocusCycles + 1;
  const label = PHASE_LABELS[currentPhase] ?? 'Focus';
  const isCurrentActive =
    currentPhase === 'focus' && (isRunning || timeLeft < totalDuration);

  useEffect(() => {
    if (!cycleComplete) return;
    const id = setTimeout(() => clearCycleComplete(), 5000);
    return () => clearTimeout(id);
  }, [cycleComplete, clearCycleComplete]);

  if (!cycleActive && !cycleComplete) return null;

  const token = `var(--timer-${currentPhase === 'focus' ? 'focus' : currentPhase === 'short_break' ? 'short-break' : 'long-break'})`;

  return (
    <div
      className={`flex items-center justify-center rounded-xl border border-border p-2 transition-colors duration-200 ${
        isCollapsed
          ? 'flex-col gap-2 min-h-[140px]'
          : 'flex-row gap-3 px-3 py-2.5'
      }`}
    >
      {cycleComplete && (
        <span
          className={`font-mono font-bold text-xs font-semibold text-content-secondary`}
          style={{ color: token }}
        >
          Cycle complete
        </span>
      )}
      {!cycleComplete && (
        <>
          <span
            className={`font-mono font-bold text-content-primary ${
              isCollapsed ? 'text-xs' : 'text-2xl sm:text-3xl'
            }`}
            style={{ color: token }}
          >
            {formatSeconds(timeLeft)}
          </span>
          {!isCollapsed && (
            <span
              className={`text-xs font-semibold text-content-secondary`}
              style={{ color: token }}
            >
              {currentPhase === 'focus'
                ? `${label} ${currentBlock} of ${totalBlocks}`
                : label}
            </span>
          )}
          {!isCollapsed && (
            <PomodoroDots
              completed={completedFocusCycles}
              total={totalBlocks}
              isCurrentActive={isCurrentActive}
              className="ml-auto"
            />
          )}
          {isCollapsed && (
            <PomodoroDots
              completed={completedFocusCycles}
              total={totalBlocks}
              isCurrentActive={isCurrentActive}
              className="w-[120px] mt-1"
            />
          )}
          <button
            onClick={isRunning ? pauseTimer : startTimer}
            aria-label={isRunning ? 'Pause timer' : 'Start timer'}
            className={`rounded-lg p-2 transition-colors ${
              isCollapsed ? 'w-8 h-8' : 'w-10 h-10'
            } text-content-primary hover:bg-bg-elevated`}
            style={{ color: token }}
          >
            {cycleComplete ? null : isRunning ? (
              <Pause className={`w-5 h-5 ${isCollapsed ? 'w-4 h-4' : ''}`} aria-hidden="true" />
            ) : (
              <Play className={`w-5 h-5 ${isCollapsed ? 'w-4 h-4' : ''}`} aria-hidden="true" />
            )}
          </button>
        </>
      )}
    </div>
  );
};
