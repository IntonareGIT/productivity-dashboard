import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /**
   * `md` is the default compact dialog. `lg` is a wide surface for content
   * that needs room to be readable — a PDF preview, for example, which is
   * rendered fit-to-width and would otherwise be squeezed into ~28rem.
   */
  size?: 'md' | 'lg';
  children: React.ReactNode;
}

const SIZES = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-6xl',
} as const;

/**
 * Centered modal on desktop (sm+), bottom sheet on mobile.
 * Closes on Escape and on backdrop click.
 */
export const Modal: React.FC<ModalProps> = ({ open, onClose, title, subtitle, size = 'md', children }) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full ${SIZES[size]} max-h-[90vh] overflow-y-auto bg-bg-surface border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl animate-in fade-in duration-150`}
      >
        <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-border/60 sticky top-0 bg-bg-surface z-10">
          <div>
            <h2 className="font-semibold text-base text-content-primary">{title}</h2>
            {subtitle && <p className="text-xs text-content-tertiary mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 -m-1 rounded-lg text-content-secondary hover:text-content-primary hover:bg-bg-elevated transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
};
