import { create } from 'zustand';
import { format } from 'date-fns';
import { db } from '../db/db';
import { defaultPomodoroSettings } from '../db/defaultData';
import { newId } from '../utils/id';
import type { PomodoroSession, PomodoroSettings } from '../types';

export type PomodoroPhase = 'focus' | 'short_break' | 'long_break';

interface PomodoroStoreState {
  isRunning: boolean;
  endsAt: number | null;      // epoch ms when the current phase ends
  timeLeft: number;           // seconds (kept fresh by the engine)
  totalDuration: number;      // seconds for the current phase
  currentPhase: PomodoroPhase;
  completedFocusCycles: number;
  currentSubject: string;     // "what was focused on"
  settings: PomodoroSettings;
  lastEvent: string | null;

  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  skipPhase: () => void;
  setPhase: (phase: PomodoroPhase) => void;
  setSubject: (subject: string) => void;
  loadSettings: (settings: PomodoroSettings) => void;
}

function phaseSeconds(phase: PomodoroPhase, s: PomodoroSettings): number {
  const minutes =
    phase === 'focus'
      ? s.focusDuration
      : phase === 'short_break'
      ? s.shortBreakDuration
      : s.longBreakDuration;
  return Math.max(1, Math.round(minutes)) * 60;
}

/* ---- Module-level singleton engine (one interval for the whole app) ---- */
let engineId: ReturnType<typeof setInterval> | null = null;
function stopEngine() {
  if (engineId !== null) {
    clearInterval(engineId);
    engineId = null;
  }
}

/* ---- Sound: synthesized two-tone chime (offline, no assets) ---- */
let audioCtx: AudioContext | null = null;
function ensureAudio() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
  } catch {
    // Audio unavailable — silence is acceptable.
  }
}
function playChime(enabled: boolean) {
  if (!enabled) return;
  try {
    if (!audioCtx) ensureAudio();
    const ctx = audioCtx;
    if (!ctx) return;
    const beep = (offset: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      const t0 = ctx.currentTime + offset;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.4);
    };
    beep(0);
    beep(0.5);
  } catch {
    // Ignore audio errors.
  }
}

/* ---- Browser notification ---- */
function fireNotification(title: string, body: string, enabled: boolean) {
  if (!enabled) return;
  if (typeof Notification === 'undefined') return;
  try {
    if (Notification.permission === 'granted') new Notification(title, { body });
  } catch {
    // Notifications unsupported in this context.
  }
}

export const usePomodoroStore = create<PomodoroStoreState>((set, get) => {
  const completePhase = () => {
    const s = get();
    stopEngine();
    const finished = s.currentPhase;
    const settings = s.settings;
    const now = new Date();

    // Persist completed focus sessions (spec: date, duration, focus target).
    if (finished === 'focus') {
      const session: PomodoroSession = {
        id: newId(),
        date: format(now, 'yyyy-MM-dd'),
        focusSubject: s.currentSubject.trim() || 'General Study',
        durationMinutes: settings.focusDuration,
        sessionType: 'focus',
        completedAt: now.toISOString(),
      };
      db.pomodoroSessions.put(session).catch(console.error);
    }

    // Choose the next phase: focus -> (long after N cycles) break -> focus.
    let cycles = s.completedFocusCycles;
    let next: PomodoroPhase;
    if (finished === 'focus') {
      cycles += 1;
      next = cycles >= settings.cyclesBeforeLongBreak ? 'long_break' : 'short_break';
    } else {
      next = 'focus';
      if (finished === 'long_break') cycles = 0;
    }
    const nextDur = phaseSeconds(next, settings);

    playChime(settings.soundEnabled);
    const eventTitle = finished === 'focus' ? 'Focus session complete' : 'Break over';
    const eventBody =
      finished === 'focus' ? 'Time for a break.' : 'Ready for the next focus session.';
    fireNotification(eventTitle, eventBody, settings.notificationEnabled);

    set({
      isRunning: false,
      endsAt: null,
      currentPhase: next,
      totalDuration: nextDur,
      timeLeft: nextDur,
      completedFocusCycles: cycles,
      lastEvent: `${eventTitle} — ${eventBody}`,
    });
  };

  const tick = () => {
    const s = get();
    if (!s.isRunning || s.endsAt === null) return;
    const remaining = Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000));
    if (remaining <= 0) {
      completePhase();
      return;
    }
    set({ timeLeft: remaining });
  };

  const defaultDuration = defaultPomodoroSettings.focusDuration * 60;

  return {
    isRunning: false,
    endsAt: null,
    timeLeft: defaultDuration,
    totalDuration: defaultDuration,
    currentPhase: 'focus',
    completedFocusCycles: 0,
    currentSubject: 'General Study',
    settings: defaultPomodoroSettings,
    lastEvent: null,

    startTimer: () => {
      const s = get();
      if (s.isRunning) return;
      const timeLeft = s.timeLeft > 0 ? s.timeLeft : s.totalDuration;
      ensureAudio(); // user gesture: unlock audio for the completion chime
      if (
        s.settings.notificationEnabled &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'default'
      ) {
        void Notification.requestPermission().catch(() => {});
      }
      stopEngine();
      engineId = setInterval(tick, 500);
      set({ isRunning: true, endsAt: Date.now() + timeLeft * 1000, timeLeft });
    },

    pauseTimer: () => {
      const s = get();
      if (!s.isRunning) return;
      stopEngine();
      const remaining =
        s.endsAt !== null ? Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000)) : s.timeLeft;
      set({ isRunning: false, endsAt: null, timeLeft: remaining });
    },

    resetTimer: () => {
      stopEngine();
      set({ isRunning: false, endsAt: null, timeLeft: get().totalDuration });
    },

    setPhase: (phase) => {
      stopEngine();
      const dur = phaseSeconds(phase, get().settings);
      set({
        isRunning: false,
        endsAt: null,
        currentPhase: phase,
        totalDuration: dur,
        timeLeft: dur,
      });
    },

    skipPhase: () => {
      const s = get();
      stopEngine();
      if (s.currentPhase === 'focus') {
        const dur = phaseSeconds('short_break', s.settings);
        set({
          isRunning: false,
          endsAt: null,
          currentPhase: 'short_break',
          totalDuration: dur,
          timeLeft: dur,
        });
      } else {
        const cycles = s.currentPhase === 'long_break' ? 0 : s.completedFocusCycles;
        const dur = phaseSeconds('focus', s.settings);
        set({
          isRunning: false,
          endsAt: null,
          currentPhase: 'focus',
          completedFocusCycles: cycles,
          totalDuration: dur,
          timeLeft: dur,
        });
      }
    },

    setSubject: (subject) => set({ currentSubject: subject }),

    loadSettings: (settings) => {
      const s = get();
      if (s.isRunning) {
        set({ settings }); // running phase keeps its current duration
        return;
      }
      const dur = phaseSeconds(s.currentPhase, settings);
      set({ settings, totalDuration: dur, timeLeft: dur });
    },
  };
});
