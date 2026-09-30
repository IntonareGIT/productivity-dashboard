import React from 'react';

/**
 * The first few stack frames, as `file:line` pairs.
 *
 * This is the diagnostic the user cannot otherwise get: on a phone there is no
 * console, and the bundle is minified, so "PdfViewer.tsx:691" in a report is the
 * difference between a fixable bug report and an unreproducible one. Depth is
 * limited because a full stack from a React render is long and scrolls the
 * banner off screen.
 */
const stackFrames = (error: unknown, limit = 6): string[] => {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return [];
  return error.stack
    .split('\n')
    .map((line) => line.trim())
    // Keep only real frames — the "at fn (url:line:col)" form — and drop the
    // leading "TypeError: message" line, which the message already shows.
    .filter((line) => /^at\s/.test(line))
    .slice(0, limit)
    // Strip the protocol and host so the line is short enough to read on a
    // phone: "at commit (PdfViewer.tsx:691:12)" rather than a 120-char URL.
    .map((line) => line.replace(/https?:\/\/[^/)]*\//g, '').replace(/:\d+:\d+\)?$/, ')'))
    .join('\n')
    .split('\n');
};

/** Shape of the payload we keep for the banner. */
interface LastError {
  kind: 'error' | 'rejection';
  message: string;
  /** Top stack frames, for reporting. Empty when unavailable. */
  stack: string[];
  at: number;
}

let lastError: LastError | null = null;
const listeners = new Set<() => void>();

/** Record an error and wake the banner. */
export const reportError = (kind: LastError['kind'], value: unknown) => {
  const message =
    value instanceof Error
      ? `${value.name}: ${value.message}`
      : typeof value === 'string'
        ? value
        : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();
  lastError = { kind, message, stack: stackFrames(value), at: Date.now() };
  for (const l of listeners) l();
};

/**
 * A small, dismissable banner for errors we cannot otherwise see — the user has
 * no console on a phone, and a blank page with no explanation is unactionable.
 * `window.onerror` and `unhandledrejection` cover the cases a React boundary
 * cannot: async continuations, pdf.js worker failures, and browser-level kills
 * that surface as a rejected promise.
 */
export const GlobalErrorBanner: React.FC = () => {
  const [err, setErr] = React.useState<LastError | null>(lastError);
  const [dismissedAt, setDismissedAt] = React.useState(0);

  React.useEffect(() => {
    const onError = (e: ErrorEvent) => {
      reportError('error', e.error ?? e.message);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      reportError('rejection', e.reason);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    const sync = () => setErr(lastError);
    listeners.add(sync);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      listeners.delete(sync);
    };
  }, []);

  if (!err || err.at === dismissedAt) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-2 bottom-2 z-[9999] rounded-lg border border-danger/40 bg-bg-elevated/95 px-3 py-2 text-[11px] shadow-lg backdrop-blur"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-content-primary">
            {err.kind === 'rejection' ? 'Unhandled promise rejection' : 'JavaScript error'}
          </p>
          {/* The message is the whole point: without a console this is the only
              diagnostic the user can report back. */}
          <p className="mt-0.5 break-words text-content-secondary">{err.message}</p>
          {/* File and line, so a report is actionable. */}
          {err.stack.length > 0 && (
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-content-tertiary">
              {err.stack.join('\n')}
            </pre>
          )}
        </div>
        <button
          type="button"
          onClick={() => setDismissedAt(err.at)}
          className="shrink-0 rounded px-1.5 py-0.5 text-content-tertiary hover:bg-bg-surface"
          aria-label="Dismiss error"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

interface BoundaryProps {
  children: React.ReactNode;
  /** Shown above the error, e.g. which viewer failed. */
  label?: string;
  /** Changing this remounts the subtree — the "Reload viewer" button. */
  reloadKey?: number;
  /** Bump to force a fresh mount (incremented by the "Reload viewer" button). */
  onReload?: () => void;
}

interface BoundaryState {
  error: Error | null;
}

/**
 * Contains a viewer crash to the viewer.
 *
 * Without this, a single throw inside a lazily-loaded viewer propagates to the
 * root and React unmounts the entire tree — which is exactly the "whole page
 * goes blank and I have to refresh" symptom. The boundary keeps the rest of the
 * dashboard alive and offers a local retry instead of a full reload.
 */
export class ViewerErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    // Recorded so the banner shows it even if this boundary is somehow bypassed.
    reportError('error', error);
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportError('error', error);
    // Kept for the console; the banner is the user-facing channel.
    console.error('[ViewerErrorBoundary]', this.props.label ?? 'viewer', error, info.componentStack);
  }

  private reload = () => {
    this.setState({ error: null });
    // Remounting is what actually recovers: the crashed viewer's canvases and
    // pdf.js state are gone with the old tree.
    this.props.onReload?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // File and line, so the report is actionable. Without a console on a phone
    // this is the only way to tell WHICH line threw.
    const frames = stackFrames(error, 4);
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center p-4">
        <div className="max-w-md rounded-lg border border-danger/40 bg-bg-surface p-4 text-center">
          <p className="text-sm font-semibold text-content-primary">Something went wrong while zooming</p>
          <p className="mt-1 break-words text-xs text-content-secondary">{error.name}: {error.message}</p>
          {frames.length > 0 && (
            <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-all text-left font-mono text-[10px] text-content-tertiary">
              {frames.join('\n')}
            </pre>
          )}
          <button
            type="button"
            onClick={this.reload}
            className="mt-3 rounded-md border border-border-strong bg-bg-elevated px-3 py-1.5 text-xs font-semibold text-content-primary hover:bg-bg-elevated/80"
          >
            Reload viewer
          </button>
        </div>
      </div>
    );
  }
}