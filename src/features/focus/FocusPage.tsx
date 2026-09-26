import React from 'react';
import { Timer, Play, Pause, RotateCcw, SkipForward } from 'lucide-react';
import { usePomodoroStore, type PomodoroPhase } from '../../stores/usePomodoroStore';
import { SessionLog } from './components/SessionLog';

const PHASE_LABELS: Record<PomodoroPhase, string> = {
  focus: 'Focus',
  short_break: 'Short break',
  long_break: 'Long break',
};

const PHASE_ORDER: PomodoroPhase[] = ['focus', 'short_break', 'long_break'];

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const RING_SIZE = 264;
const RING_STROKE = 12;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;

export const FocusPage: React.FC = () => {
  const {
    isRunning,
    timeLeft,
    totalDuration,
    currentPhase,
    completedFocusCycles,
    currentSubject,
    settings,
    lastEvent,
    startTimer,
    pauseTimer,
    resetTimer,
    skipPhase,
    setPhase,
    setSubject,
  } = usePomodoroStore();

  const progress = totalDuration > 0 ? timeLeft / totalDuration : 0;
  const statusText = isRunning
    ? 'Running'
    : timeLeft < totalDuration
    ? 'Paused'
    : 'Idle';

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center space-x-2.5">
        <Timer className="w-6 h-6 text-accent shrink-0" />
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-content-primary">
            Focus
          </h1>
          <p className="text-xs text-content-tertiary">
            {settings.focusDuration}/{settings.shortBreakDuration}/
            {settings.longBreakDuration} · long break after{' '}
            {settings.cyclesBeforeLongBreak} cycles
          </p>
        </div>
      </div>

      {/* Large minimal countdown */}
      <div className="rounded-2xl border border-border bg-bg-surface p-5 sm:p-8 flex flex-col items-center">
        {/* Phase chips */}
        <div className="flex rounded-xl border border-border bg-bg-elevated/40 p-1 mb-6">
          {PHASE_ORDER.map((phase) => (
            <button
              key={phase}
              onClick={() => setPhase(phase)}
              className={`px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
                currentPhase === phase
                  ? 'bg-accent text-white'
                  : 'text-content-secondary hover:text-content-primary'
              }`}
            >
              {PHASE_LABELS[phase]}
            </button>
          ))}
        </div>

        {/* Ring */}
        <div className="relative">
          <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_R}
              fill="none"
              stroke="var(--bg-surface-elevated)"
              strokeWidth={RING_STROKE}
            />
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_R}
              fill="none"
              stroke="var(--accent-primary)"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - progress)}
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
              style={{ transition: 'stroke-dashoffset 0.4s linear' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-5xl sm:text-6xl font-bold tracking-tight text-content-primary">
              {formatSeconds(timeLeft)}
            </span>
            <span className="flex items-center gap-1.5 mt-2 text-xs font-semibold text-content-secondary">
              <span
                className={`w-2 h-2 rounded-full ${
                  isRunning
                    ? 'bg-emerald-500 animate-pulse'
                    : timeLeft < totalDuration
                    ? 'bg-amber-500'
                    : 'bg-content-tertiary'
                }`}
              />
              {statusText} · {PHASE_LABELS[currentPhase]}
            </span>
            {/* Cycle progress dots */}
            <span className="flex items-center gap-1.5 mt-3">
              {Array.from({ length: settings.cyclesBeforeLongBreak }).map((_, i) => (
                <span
                  key={i}
                  className={`w-2 h-2 rounded-full ${
                    i < completedFocusCycles ? 'bg-accent' : 'bg-bg-surface-elevated'
                  }`}
                />
              ))}
            </span>
          </div>
        </div>

        {/* Focus target */}
        <label className="w-full mt-6">
          <span className="block text-xs text-content-secondary mb-1.5 text-center">
            What are you focusing on?
          </span>
          <input
            value={currentSubject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Graph algorithms problem set"
            className="w-full bg-bg-elevated/50 border border-border rounded-xl px-4 py-3 text-sm text-content-primary text-center outline-none focus:border-accent placeholder:text-content-tertiary"
          />
        </label>

        {/* Controls */}
        <div className="flex items-center justify-center gap-3 mt-5 w-full">
          <button
            onClick={resetTimer}
            aria-label="Reset timer"
            className="p-4 rounded-2xl border border-border bg-bg-elevated/50 hover:bg-bg-elevated text-content-secondary hover:text-content-primary transition-colors"
          >
            <RotateCcw className="w-5 h-5" />
          </button>

          {isRunning ? (
            <button
              onClick={pauseTimer}
              className="flex-1 sm:flex-none sm:w-48 flex items-center justify-center gap-2 py-4 min-h-[56px] rounded-2xl bg-bg-elevated border border-border-strong hover:bg-border text-content-primary font-semibold transition-colors"
            >
              <Pause className="w-5 h-5" />
              Pause
            </button>
          ) : (
            <button
              onClick={startTimer}
              className="flex-1 sm:flex-none sm:w-48 flex items-center justify-center gap-2 py-4 min-h-[56px] rounded-2xl bg-accent hover:bg-accent-hover text-white font-semibold shadow-lg shadow-accent/20 transition-colors"
            >
              <Play className="w-5 h-5 fill-current" />
              {timeLeft < totalDuration ? 'Resume' : 'Start'}
            </button>
          )}

          <button
            onClick={skipPhase}
            aria-label="Skip to next phase"
            className="p-4 rounded-2xl border border-border bg-bg-elevated/50 hover:bg-bg-elevated text-content-secondary hover:text-content-primary transition-colors"
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        {lastEvent && (
          <p className="text-xs text-content-tertiary mt-4 text-center">{lastEvent}</p>
        )}
      </div>

      {/* Collapsed session log below the timer */}
      <SessionLog />
    </div>
  );
};
