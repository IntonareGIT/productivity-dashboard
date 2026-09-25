import { create } from 'zustand';

export type PomodoroPhase = 'focus' | 'short_break' | 'long_break';

interface PomodoroStoreState {
  isRunning: boolean;
  timeLeft: number; // in seconds
  totalDuration: number; // in seconds
  currentPhase: PomodoroPhase;
  currentSubject: string;
  completedCycles: number;
  
  // Controls
  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  setTimeLeft: (seconds: number) => void;
  setPhase: (phase: PomodoroPhase) => void;
  setSubject: (subject: string) => void;
  tick: () => void;
  incrementCycles: () => void;
}

export const usePomodoroStore = create<PomodoroStoreState>((set) => ({
  isRunning: false,
  timeLeft: 25 * 60,
  totalDuration: 25 * 60,
  currentPhase: 'focus',
  currentSubject: 'General Study',
  completedCycles: 0,

  startTimer: () => set({ isRunning: true }),
  pauseTimer: () => set({ isRunning: false }),
  resetTimer: () =>
    set((state) => ({
      isRunning: false,
      timeLeft: state.totalDuration,
    })),
  setTimeLeft: (seconds: number) => set({ timeLeft: seconds }),
  setPhase: (phase: PomodoroPhase) => {
    let duration = 25 * 60;
    if (phase === 'short_break') duration = 5 * 60;
    if (phase === 'long_break') duration = 15 * 60;
    set({
      currentPhase: phase,
      totalDuration: duration,
      timeLeft: duration,
      isRunning: false,
    });
  },
  setSubject: (subject: string) => set({ currentSubject: subject }),
  tick: () =>
    set((state) => {
      if (state.timeLeft <= 1) {
        return { timeLeft: 0, isRunning: false };
      }
      return { timeLeft: state.timeLeft - 1 };
    }),
  incrementCycles: () => set((state) => ({ completedCycles: state.completedCycles + 1 })),
}));
