import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronsDown, ChevronsUp, Pause, Play, RotateCcw, SkipBack, SkipForward, Square, Volume2 } from 'lucide-react';
import { notesToSpeech } from './notesSpeech';
import { chunksFromDom } from './notesDomChunks';

/**
 * Read a note aloud with the voice the device already has.
 *
 * No service, no key, no download: the browser's own speech engine
 * (`speechSynthesis`) reads the note. Which voice that is depends on the device
 * — Apple's voices on iPhone and Mac, the Android speech engine on a phone,
 * Google's network voices in Chrome, Microsoft's natural voices in Edge — so
 * quality varies, and a device with no voices installed simply shows no button.
 *
 * While it reads, the sentence being spoken is highlighted in the note itself
 * and scrolled into view, and the controls move by sentence or by paragraph, so
 * a note can be followed and re-heard without hunting for the place.
 *
 * Two engine quirks shape the implementation:
 *
 *  - Desktop Chrome cuts a long utterance off after about fifteen seconds with
 *    Google's network voices, silently. Speaking one sentence at a time is the
 *    robust fix, and it is also what makes the highlight and the jumps exact.
 *  - Android's `pause()` is unreliable, so pausing there stops the queue and
 *    remembers the sentence to resume from.
 */

type Status = 'idle' | 'playing' | 'paused';

/** Reading speeds, slow to fast. 1 is the engine's natural pace. */
const RATES = [0.75, 1, 1.25, 1.5, 2] as const;

const RATE_KEY = 'notes-listen-rate';

/** Name of the highlight in the CSS Custom Highlight registry. */
const HIGHLIGHT_NAME = 'notes-listen';

/**
 * Two Listen controls can be on screen at once (a note in the library and a
 * note in the split pane), and the stylesheet rule is a single
 * `::highlight(notes-listen)`. So they share one highlight name, and only the
 * instance that painted it last may clear it: otherwise a note going idle would
 * wipe the highlight off the note that is still being read.
 */
let highlightOwner: object | null = null;

const clearHighlight = (token: object) => {
  if (highlightOwner !== token) return;
  highlightOwner = null;
  highlightRegistry()?.delete(HIGHLIGHT_NAME);
};

interface ListenChunk {
  text: string;
  heading?: boolean;
  pauseAfter?: number;
  /** Paragraph number, for the paragraph jumps. */
  block?: number;
  /** The sentence's place in the rendered note. */
  range?: Range | null;
}

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

/** Do two ranges overlap at all? */
/** Whether two ranges in the same note overlap, touching counted as overlap. */
function rangesIntersect(a: Range, b: Range): boolean {
  return a.isPointInRange(b.startContainer, b.startOffset)
    || a.isPointInRange(b.endContainer, b.endOffset)
    || b.isPointInRange(a.startContainer, a.startOffset);
}

/** The highlight registry, where the browser has one. */
function highlightRegistry(): { set: (name: string, h: unknown) => void; delete: (name: string) => void } | null {
  const css = (window as unknown as { CSS?: { highlights?: unknown } }).CSS;
  const registry = css?.highlights as { set: (n: string, h: unknown) => void; delete: (n: string) => void } | undefined;
  return registry ?? null;
}

export const NotesListen: React.FC<{
  /** Markdown note body. Always the source when `hasHtml` is false. */
  text?: string;
  /** Rich-text body from the editor. */
  html?: string;
  /** Whether `contentFormat` says the note is stored as HTML. */
  hasHtml?: boolean;
  /** The rendered note, so the sentence being read can be highlighted in it. */
  containerRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}> = ({ text = '', html, hasHtml = false, containerRef, className = '' }) => {
  const [chunks, setChunks] = useState<ListenChunk[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [index, setIndex] = useState(0);
  const [rate, setRate] = useState<number>(() => readRate());

  const voice = useEnglishVoice();

  // Every handler reads through refs: an utterance started seconds ago must see
  // the CURRENT speed and voice, and a cancelled run must never resume itself.
  const chunksRef = useRef<ListenChunk[]>(chunks);
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

  /**
   * Build the sentences from the note as it is RENDERED, so each one can be
   * highlighted where it sits. Falls back to the pure text pipeline if the note
   * is not in the page (it is rendered below this control, so this runs once the
   * DOM exists).
   */
  useEffect(() => {
    const root = containerRef?.current;
    const fromDom = root ? chunksFromDom(root) : [];
    setChunks(fromDom.length
      ? fromDom
      : notesToSpeech({ text, html, hasHtml }).map((chunk) => ({ ...chunk })));
  }, [text, html, hasHtml, containerRef]);

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

  /**
   * Where to begin: the sentence containing the text Omar has selected, if he
   * has selected any inside this note, otherwise the top.
   */
  /**
   * The last selection made inside this note.
   *
   * Pressing the Listen button collapses the selection in every browser (a click
   * on a button drops the range), so reading the live selection alone would
   * always start at the top. Watching `selectionchange` keeps the range the
   * reader actually highlighted, and start() uses it once.
   */
  const rememberedSelection = useRef<Range | null>(null);
  useEffect(() => {
    const root = containerRef?.current;
    if (!root) return;
    const remember = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (root.contains(range.startContainer) && root.contains(range.endContainer)) {
        rememberedSelection.current = range.cloneRange();
      }
    };
    document.addEventListener('selectionchange', remember);
    return () => document.removeEventListener('selectionchange', remember);
  }, [containerRef]);

  const selectionStart = useCallback((): number => {
    const root = containerRef?.current;
    const selection = window.getSelection();
    const live = selection && selection.rangeCount > 0 && !selection.isCollapsed
      ? selection.getRangeAt(0)
      : null;
    const remembered = rememberedSelection.current;
    const selected = live && root?.contains(live.startContainer)
      ? live
      : remembered && root?.contains(remembered.startContainer) && root.contains(remembered.endContainer)
        ? remembered
        : null;
    if (!root || !selected) return 0;
    const found = chunksRef.current.findIndex((chunk) => chunk.range && rangesIntersect(chunk.range, selected));
    // One shot: after starting from a selection, a later Listen starts at the top.
    rememberedSelection.current = null;
    return found >= 0 ? found : 0;
  }, [containerRef]);

  const start = useCallback(() => {
    if (!supported || chunksRef.current.length === 0) return;
    // Silence any other note that is reading, then start this one.
    readers.forEach((other) => { if (other !== stop) other(); });
    window.speechSynthesis.cancel();
    runRef.current += 1;
    const at = selectionStart();
    indexRef.current = at;
    setIndex(at);
    speakFrom(at);
  }, [selectionStart, speakFrom, stop, supported]);

  /** Move the reading position, and the voice with it if it is running. */
  const seek = useCallback((target: number) => {
    const list = chunksRef.current;
    if (!list.length) return;
    const at = Math.max(0, Math.min(target, list.length - 1));
    indexRef.current = at;
    setIndex(at);
    if (statusRef.current === 'playing') {
      runRef.current += 1;
      window.speechSynthesis.cancel();
      speakFrom(at);
    }
  }, [speakFrom]);

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

  const jumpParagraph = useCallback((direction: 1 | -1) => {
    const list = chunksRef.current;
    const current = list[indexRef.current]?.block ?? 0;
    if (direction === 1) {
      const next = list.findIndex((chunk, i) => i > indexRef.current && (chunk.block ?? 0) > current);
      seek(next >= 0 ? next : list.length - 1);
      return;
    }
    let target = -1;
    for (let i = indexRef.current - 1; i >= 0; i -= 1) {
      if ((list[i].block ?? 0) < current) { target = i; break; }
    }
    if (target < 0) {
      seek(0);
      return;
    }
    // Walk back to the first sentence of that paragraph.
    const block = list[target].block;
    while (target > 0 && (list[target - 1].block ?? 0) === block) target -= 1;
    seek(target);
  }, [seek]);

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
  const instanceToken = useRef({});
  useEffect(() => () => {
    runRef.current += 1;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    clearHighlight(instanceToken.current);
  }, []);

  /**
   * Keep the highlight on the sentence being read, and bring it into view when
   * it has scrolled out of sight.
   */
  useEffect(() => {
    const registry = highlightRegistry();
    if (!registry) return;
    const chunk = status === 'idle' ? null : chunks[index];
    const HighlightCtor = (window as unknown as { Highlight?: new (r: Range) => unknown }).Highlight;
    if (!chunk?.range || !HighlightCtor) {
      clearHighlight(instanceToken.current);
      return;
    }
    highlightOwner = instanceToken.current;
    registry.set(HIGHLIGHT_NAME, new HighlightCtor(chunk.range));
    const rect = chunk.range.getBoundingClientRect();
    const viewport = window.innerHeight;
    if (rect.height > 0 && (rect.top < 96 || rect.bottom > viewport - 96)) {
      const node = chunk.range.startContainer;
      const el = node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    return () => clearHighlight(instanceToken.current);
  }, [chunks, index, status]);

  if (!supported || chunks.length === 0) return null;

  const active = status !== 'idle';
  // Show the sentence being read, not the number finished: the first one is
  // playing from the moment Listen is pressed.
  const spoken = Math.min(index + 1, chunks.length);
  const percent = chunks.length ? Math.round((index / chunks.length) * 100) : 0;

  const navButton = 'flex items-center justify-center w-8 h-8 rounded-lg border border-border text-content-secondary hover:text-content-primary hover:border-border-strong transition-colors';

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5">
        {!active ? (
          <button
            type="button"
            onClick={start}
            title="Read this note aloud. Formulas, code and images are skipped. Select text first to start from there."
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
            <button type="button" onClick={() => seek(0)} title="Start from the beginning" aria-label="Start from the beginning" className={navButton}>
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => seek(indexRef.current - 1)} title="Previous sentence" aria-label="Previous sentence" className={navButton}>
              <SkipBack className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => seek(indexRef.current + 1)} title="Next sentence" aria-label="Next sentence" className={navButton}>
              <SkipForward className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => jumpParagraph(-1)} title="Previous paragraph" aria-label="Previous paragraph" className={navButton}>
              <ChevronsUp className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => jumpParagraph(1)} title="Next paragraph" aria-label="Next paragraph" className={navButton}>
              <ChevronsDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={stop}
              aria-label="Stop reading"
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-border text-content-secondary hover:text-content-primary hover:border-border-strong transition-colors"
            >
              <Square className="w-3 h-3" />
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
