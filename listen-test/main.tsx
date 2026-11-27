import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The app stylesheet is required here too, or Tailwind emits no utilities and
// the button row measures as unstyled text.
import '../src/styles/index.css';
import { Card } from '../src/components/ui/Card';
import { MarkdownNotes } from '../src/features/library/components/MarkdownNotes';
import { NotesListen } from '../src/features/library/components/NotesListen';

/**
 * A bare page that mounts the notes view plus the Listen control.
 *
 * The real thing sits behind Dexie and a whole subject/topic hierarchy, so this
 * page is how the control is looked at and driven in a browser: real DOM, real
 * CSS, real events. Served only by `vite dev` at `/listen-test.html`.
 *
 * `?fake=1` swaps in a fake speech engine, because headless Chromium has no
 * voices. The fake is what lets the playing/paused states be screenshotted and
 * clicked through; the component code under test is untouched.
 */
function installFakeSpeech() {
  const fake: any = {
    speaking: false,
    paused: false,
    pending: false,
    onvoiceschanged: null,
    _timer: 0,
    _utt: null,
    getVoices: () => [
      { name: 'Google US English', lang: 'en-US', voiceURI: 'Google US English', localService: false, default: true },
      { name: 'Samantha', lang: 'en-US', voiceURI: 'Samantha', localService: true, default: false },
    ],
    addEventListener: () => {},
    removeEventListener: () => {},
    speak(u: SpeechSynthesisUtterance) {
      this.speaking = true;
      this._utt = u;
      window.clearTimeout(this._timer);
      this._timer = window.setTimeout(() => {
        this.speaking = false;
        u.onend?.(new Event('end') as any);
      }, 2500);
    },
    cancel() {
      window.clearTimeout(this._timer);
      this.speaking = false;
      this._utt = null;
    },
    pause() {
      this.paused = true;
      window.clearTimeout(this._timer);
    },
    resume() {
      this.paused = false;
      const u = this._utt;
      if (!u) return;
      this._timer = window.setTimeout(() => {
        this.speaking = false;
        u.onend?.(new Event('end') as any);
      }, 2500);
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
}

const NOTE = `# 1. Fundamentals of Vibration

Vibration is the motion of a body about a reference position. In mechanical systems it is described by displacement, velocity and acceleration, and every one of them can be written as a function of time.

## 1.1 Elements of a vibrating system

- **Mass or inertia**: stores kinetic energy, $T = \\frac{1}{2} m \\dot{x}^2$
- **Spring**: stores potential energy, $U = \\frac{1}{2} k x^2$
- **Damper**: removes energy, $c$ is the damping coefficient

The number of degrees of freedom is the number of independent coordinates needed to describe the motion. A single coordinate means a single degree of freedom, and the simplest case is the spring-mass system.

## 1.2 Natural frequency

$$ \\omega_n = \\sqrt{\\frac{k}{m}} $$

The natural frequency depends only on stiffness and mass, never on the amplitude of the motion. Halving the mass raises the natural frequency by a factor of 1.41.

## 1.3 Damped free vibration

The equation of motion is $m\ddot{x} + c\dot{x} + kx = 0$, and the damping ratio decides the shape of the response.

$$ \zeta = \frac{c}{2\sqrt{km}} $$

The general solution needs the roots of the characteristic equation, which is beyond a simple reading:

$$ s_{1,2} = -\zeta\omega_n \pm \omega_n\sqrt{\zeta^2 - 1} $$

![Logarithmic decrement between two peaks](/slides/vib-03-decrement.png)

## Self-check

1. What happens to the natural frequency when the spring stiffness is quadrupled?
2. A 2 kg mass hangs on a 800 N/m spring. Find the natural frequency.

**Answers:** 1. It doubles, because wn is proportional to the square root of k. 2. wn = 20 rad/s.`;

const HTML_NOTE = `<h2>2. Free vibration</h2>
<p>Free vibration happens when a system is disturbed and then left alone, so the only forces are the internal ones.</p>
<p>With no damping, the motion never stops: <span class="note-math" data-latex="x = A cos(w t)">x = A cos(w t)</span> and the amplitude stays constant.</p>
<p>Damping is measured by the damping ratio <strong>zeta</strong>, and it decides whether the system oscillates or just creeps back to rest.</p>
<img src="/slides/vib-02-decay.png" alt="decay curve" />`;

function Harness() {
  const fake = new URLSearchParams(window.location.search).has('fake');
  // The rendered note bodies, so Listen can highlight the sentence it reads and
  // can start from a selection made inside them.
  const mdBodyRef = React.useRef<HTMLDivElement>(null);
  const htmlBodyRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (fake) installFakeSpeech();
  }, [fake]);

  /**
   * Selects part of one sentence in the rich-text note, so the "start from
   * selection" path can be clicked through here. A real reader selects with the
   * mouse; this just does the same thing a drag would.
   */
  const selectPartOfSentence = () => {
    const root = htmlBodyRef.current;
    if (!root) return;
    const target = Array.from(root.querySelectorAll('p')).find((el) =>
      (el.textContent ?? '').includes('damping ratio'),
    );
    if (!target) return;
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !(node.textContent ?? '').includes('damping ratio')) node = walker.nextNode();
    if (!node) return;
    const at = (node.textContent ?? '').indexOf('damping ratio');
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + 'damping ratio'.length);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  return (
    <div className="p-4 sm:p-6 max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="select-sentence"
          onClick={selectPartOfSentence}
          className="px-3 py-2 min-h-[40px] rounded-xl border border-border text-xs font-semibold text-content-secondary"
        >
          Select "damping ratio" in note 2
        </button>
      </div>
      {/* The Library card, as it is now: ONE pinned header carrying the note
          title, the Listen transport and Edit notes, with the body scrolling
          underneath it. */}
      <Card title="Notes — 1-Fundamentals" subtitle="Markdown, LaTeX and code supported">
        <div className="flex flex-col gap-1.5 pb-2 border-b border-border/60">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex-1 basis-40 min-w-0 text-base font-semibold text-content-primary truncate">1-Fundamentals</span>
            <button className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl border border-border text-xs font-semibold text-content-secondary shrink-0">
              Edit notes
            </button>
          </div>
          <NotesListen text={NOTE} containerRef={mdBodyRef} />
        </div>
        <div ref={mdBodyRef} className="mt-3 max-h-[68vh] overflow-y-auto">
          <MarkdownNotes text={NOTE} />
        </div>
      </Card>

      <Card title="Notes — 2-Free vibration" subtitle="Rich-text note">
        <div className="flex flex-col gap-1.5 pb-2 border-b border-border/60">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex-1 basis-40 min-w-0 text-base font-semibold text-content-primary truncate">2-Free vibration</span>
            <button className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl border border-border text-xs font-semibold text-content-secondary shrink-0">
              Edit notes
            </button>
          </div>
          <NotesListen text={NOTE} html={HTML_NOTE} hasHtml containerRef={htmlBodyRef} />
        </div>
        <div ref={htmlBodyRef} className="mt-3 max-h-[68vh] overflow-y-auto">
          <MarkdownNotes text="" html={HTML_NOTE} hasHtml />
        </div>
      </Card>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
