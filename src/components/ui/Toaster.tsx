import React from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useToastStore, type ToastKind } from '../../stores/useToastStore';
import { Z } from './zIndex';

const STYLES: Record<ToastKind, { wrap: string; icon: React.ComponentType<{ className?: string }> }> = {
  success: { wrap: 'border-emerald-500/40 bg-emerald-500/10', icon: CheckCircle2 },
  info: { wrap: 'border-border bg-bg-surface', icon: Info },
  error: { wrap: 'border-rose-500/40 bg-rose-500/10', icon: AlertTriangle },
};

/** Toast host: mounted once in App, renders every queued action confirmation. */
export const Toaster: React.FC = () => {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className={`fixed top-16 right-3 sm:right-4 ${Z.toast} flex flex-col gap-2 w-[calc(100vw-1.5rem)] sm:w-80 pointer-events-none`}>
      {toasts.map((t) => {
        const meta = STYLES[t.kind];
        const Icon = meta.icon;
        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3 py-2.5 shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150 ${meta.wrap}`}
          >
            <Icon
              className={`w-4 h-4 shrink-0 mt-0.5 ${
                t.kind === 'success' ? 'text-emerald-500' : t.kind === 'error' ? 'text-rose-500' : 'text-accent'
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-content-primary">{t.title}</p>
              {t.description && (
                <p className="text-[11px] text-content-secondary mt-0.5 break-words">{t.description}</p>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="p-1 -m-0.5 rounded text-content-tertiary hover:text-content-primary transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
