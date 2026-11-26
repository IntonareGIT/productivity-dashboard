import React from 'react';

interface PomodoroDotsProps {
  /** Number of completed focus blocks (filled dots). */
  completed: number;
  /** Total number of focus blocks in the cycle (slot count). */
  total: number;
  /** True while the current focus block is running or paused (half-filled dot). */
  isCurrentActive: boolean;
  className?: string;
}

/**
 * Cycle progress dots with three states:
 *   - completed: filled with the focus color token
 *   - current:   half-filled with the focus token (running/paused focus block only)
 *   - remaining: outlined with the border token
 *
 * All three states are distinct in every theme because they resolve through
 * theme tokens (`--timer-focus`, `--border-strong`) rather than hard-coded
 * colors.
 */
export const PomodoroDots: React.FC<PomodoroDotsProps> = ({
  completed,
  total,
  isCurrentActive,
  className,
}) => {
  return (
    <span className={`flex items-center gap-1.5 ${className ?? ''}`}>
      {Array.from({ length: total }).map((_, i) => {
        const isCompleted = i < completed;
        const isCurrent = i === completed && isCurrentActive;
        return (
          <span
            key={i}
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              background: isCompleted
                ? 'var(--timer-focus)'
                : isCurrent
                ? 'linear-gradient(to right, var(--timer-focus) 50%, #0000 50%)'
                : 'transparent',
              border: isCompleted || isCurrent ? 'none' : '2px solid var(--border-strong)',
            }}
          />
        );
      })}
    </span>
  );
};
