import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Square, Volume2 } from 'lucide-react';
import { notesToSpeech } from './notesSpeech';

/**
 * Read a note aloud with the voice the device already has.
 *
 * No service, no key, no download: the browser's own speech engine
 * (`speechSynthesis`) reads the note. Which voice that is depends on the device
 * — Apple's voices on iPhone and Mac, the Android speech engine on a phone,
 * Google's network voices in Chrome, Microsoft's natural voices in Edge — so
 * quality varies, and a device with no voices installed simply shows no button.
 *
 * Two engine quirks shape the implementation:
 *
 *  - Desktop Chrome cuts a long utterance off after about fifteen seconds with
 *    Google's network voices, silently. Speaking one sentence at a time (the
 *    chunks `notesToSpeech` produces) is the robust fix, and it gives a progress
 *    count for free.
 *  - Android's `pause()` is unreliable, so pausing there stops the queue and
 *    remembers the sentence to resume from.
 */

type Status = 'idle' | 'playing' | 'paused';

/** Reading speeds, slow to fast. 1 is the engine's natural pace. */
const RATES = [0.75, 1, 1.25, 1.5, 2] as const;

const RATE_KEY = 'notes-listen-rate';

function readRate(): number {
  try {
    const stored = Number(window.localStorage.getItem(RATE_KEY));
    return RATES.includes(stored as (typeof RATES)[number]) ? stored : 1;
  } catch {
    return 1;
  }
}

function storeRate(rate: number): void {
  try {
    window.localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    // Private mode or a full quota: the speed just is not remembered.
  }
}

/**
 * Voice names that read notes well, best first.
 *
 * Chosen by name because the API exposes nothing better: a voice has a name, a
 * language and a local/online flag, and no quality score. These are the good
 * defaults shipped by each platform, and any English voice is a fine fallback.
 */
const VOICE_PREFERENCE = [
  /google us english/i,
  /microsoft (aria|jenny|ava|emma|andrew|guy|sonia).*natural/i,
  /samantha/i,
  /^alex$/i,
  /^daniel$/i,
  /google uk english/i,
];

function pickEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  if (!english.length) return null;
  for (const pattern of VOICE_PREFERENCE) {
    const hit = english.find((v) => pattern.test(v.name));
    if (hit) return hit;
  }
  // Prefer a voice that works offline, so reading does not depend on a network.
  return english.find((v) => v.localService) ?? english[0];
}

/** The voice list arrives late in Chrome; this keeps listening for it. */
function useEnglishVoice(): SpeechSynthesisVoice | null {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const load = () => {
      const picked = pickEnglishVoice(synth.getVoices());
      if (picked) setVoice((current) => (current?.voiceURI === picked.voiceURI ? current : picked));
    };
    load();
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', load);
    else synth.onvoiceschanged = load;
    // Chrome can fill the list after `voiceschanged` has already been missed.
    const retry = window.setTimeout(load, 1500);
    return () => {
      if (typeof synth.removeEventListener === 'function') synth.removeEventListener('voiceschanged', load);
      else synth.onvoiceschanged = null;
      window.clearTimeout(retry);
    };
  }, []);

  return voice;
}

const isAndroid = (): boolean =>
  typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

/**
 * Every mounted Listen control's stop function.
 *
 * The Library and the split pane can both be mounted, and a note can be open in
 * more than one place; two voices reading over each other is never what anyone
 * pressed. Starting one note stops every other.
 */
const readers = new Set<() => void>();

export const NotesListen: React.FC<{
  /** Markdown note body. Always the source when `hasHtml` is false. */
  text?: string;
  /** Rich-text body from the editor. */
  html?: string;
  /** Whether `contentFormat` says the note is stored as HTML. */
  hasHtml?: boolean;
  className?: string;
}> = ({ text = '', html, hasHtml = false, className = '' }) => {
  const chunks = useMemo(() => notesToSpeech({ text, html, hasHtml }), [text, html, hasHtml]);
  const [status, setStatus] = useState<Status>('idle');
  const [index, setIndex] = useState(0);
  const [rate, setRate] = useState<number>(() => readRate());

  const voice = useEnglishVoice();

  // Every handler reads through refs: an utterance started seconds ago must see
  // the CURRENT speed and voice, and a cancelled run must never resume itself.
  const chunksRef = useRef(chunks);
  const indexRef = useRef(0);
  const rateRef = useRef(rate);
  const voiceRef = useRef(voice);
  const statusRef = useRef<Status>('idle');
  /** Bumped on every stop/restart; stale callbacks compare against it. */
  const runRef = useRef(0);

  chunksRef.current = chunks;
  rateRef.current = rate;
  voiceRef.current = voice;
  statusRef.current = status;

  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const finish = useCallback(() => {
    runRef.current += 1;
    indexRef.current = 0;
    setIndex(0);
    setStatus('idle');
  }, []);

  /** Speak sentence `at`, then the next one, until the note runs out. */
  const speakFrom = useCallback((at: number) => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const list = chunksRef.current;
    if (at >= list.length) {
      finish();
      return;
    }

    const chunk = list[at];
    const utterance = new SpeechSynthesisUtterance(chunk.text);
    utterance.rate = rateRef.current;
    utterance.pitch = 1;
    // A voice object can go stale (the engine restarts, or the OS drops the
    // voice after sleep) and assigning one then throws. Falling back to the
    // language keeps the note readable instead of ending the read at sentence 1.
    try {
      if (voiceRef.current) {
        utterance.voice = voiceRef.current;
        utterance.lang = voiceRef.current.lang;
      } else {
        utterance.lang = 'en-US';
      }
    } catch {
      utterance.lang = 'en-US';
    }

    const run = runRef.current;
    const advance = () => {
      if (run !== runRef.current) return; // a newer run owns the queue
      indexRef.current = at + 1;
      setIndex(at + 1);
      // A cue tells the listener to look at the screen, so leave a moment to do
      // it before the next sentence starts.
      const wait = chunk.pauseAfter ?? 0;
      if (wait > 0) {
        window.setTimeout(() => {
          if (run === runRef.current) speakFrom(at + 1);
        }, wait);
      } else {
        speakFrom(at + 1);
      }
    };
    utterance.onend = advance;
    utterance.onerror = (event) => {
      if (run !== runRef.current) return;
      // 'interrupted'/'canceled' are our own stop/restart, not a failure.
      if (event.error === 'interrupted' || event.error === 'canceled') return;
      advance();
    };

    setStatus('playing');
    synth.speak(utterance);
  }, [finish, supported]);

  const stop = useCallback(() => {
    if (!supported) return;
    runRef.current += 1;
    window.speechSynthesis.cancel();
    indexRef.current = 0;
    setIndex(0);
    setStatus('idle');
  }, [supported]);

  const start = useCallback(() => {
    if (!supported || chunksRef.current.length === 0) return;
    // Silence any other note that is reading, then start this one from the top.
    readers.forEach((other) => { if (other !== stop) other(); });
    window.speechSynthesis.cancel();
    runRef.current += 1;
    indexRef.current = 0;
    setIndex(0);
    speakFrom(0);
  }, [speakFrom, stop, supported]);

  useEffect(() => {
    readers.add(stop);
    return () => { readers.delete(stop); };
  }, [stop]);

  const togglePause = useCallback(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    if (statusRef.current === 'playing') {
      if (isAndroid()) {
        // Android ignores pause() often enough that stopping is the honest move.
        runRef.current += 1;
        synth.cancel();
        setStatus('paused');
      } else {
        synth.pause();
        setStatus('paused');
      }
      return;
    }
    if (statusRef.current === 'paused') {
      if (isAndroid()) {
        setStatus('playing');
        speakFrom(indexRef.current);
      } else {
        synth.resume();
        setStatus('playing');
      }
    }
  }, [speakFrom, supported]);

  const changeRate = useCallback((next: number) => {
    setRate(next);
    storeRate(next);
    // A running utterance keeps the speed it started with, so restart the
    // current sentence at the new pace instead of waiting for the next one.
    if (statusRef.current === 'playing') {
      runRef.current += 1;
      window.speechSynthesis.cancel();
      speakFrom(indexRef.current);
    }
  }, [speakFrom]);

  // A different note (or an edit to this one) invalidates the queue. Not on
  // mount, though: a pane opening beside a note that is already reading must not
  // silence it.
  const startedOnce = useRef(false);
  useEffect(() => {
    if (!startedOnce.current) {
      startedOnce.current = true;
      return;
    }
    stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks]);

  // Leaving the page, or the pane closing, must not leave a voice talking.
  useEffect(() => () => {
    runRef.current += 1;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  if (!supported || chunks.length === 0) return null;

  const active = status !== 'idle';
  // Show the sentence being read, not the number finished: the first one is
  // playing from the moment Listen is pressed.
  const spoken = Math.min(index + 1, chunks.length);
  const percent = chunks.length ? Math.round((spoken / chunks.length) * 100) : 0;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        {!active ? (
          <button
            type="button"
            onClick={start}
            title="Read this note aloud. Formulas, code and images are skipped."
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-content-secondary hover:text-content-primary hover:border-accent transition-colors"
          >
            <Volume2 className="w-3.5 h-3.5" /> Listen
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={togglePause}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent bg-accent-subtle text-xs font-semibold text-accent-text transition-colors"
            >
              {status === 'playing' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {status === 'playing' ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              onClick={stop}
              aria-label="Stop reading"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-content-secondary hover:text-content-primary hover:border-border-strong transition-colors"
            >
              <Square className="w-3 h-3" /> Stop
            </button>
            <select
              value={rate}
              onChange={(e) => changeRate(Number(e.target.value))}
              aria-label="Reading speed"
              className="text-xs bg-bg-elevated border border-border rounded-lg px-2 py-1.5 text-content-primary outline-none focus:border-accent"
            >
              {RATES.map((option) => (
                <option key={option} value={option}>{option}×</option>
              ))}
            </select>
            {/* Not aria-live: a screen reader announcing "2 / 17" after every
                sentence would talk over the note it is already reading. */}
            <span className="text-xs text-content-tertiary tabular-nums">
              {spoken} / {chunks.length}
            </span>
          </>
        )}
      </div>
      {active && (
        <div className="mt-1.5 h-0.5 w-full rounded-full bg-bg-elevated overflow-hidden" aria-hidden="true">
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
};
