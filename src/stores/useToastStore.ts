import { create } from 'zustand';

export type ToastKind = 'success' | 'info' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
}

const AUTO_DISMISS_MS = 4500;

/**
 * Tiny global toast queue. Used to confirm every action the AI assistant
 * performs so nothing happens silently (spec: visible confirmation).
 */
export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set({ toasts: [...get().toasts, { ...toast, id }] });
    window.setTimeout(() => get().dismiss(id), AUTO_DISMISS_MS);
    return id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

/** Imperative helper — usable from stores/tool executors, outside React. */
export function toast(kind: ToastKind, title: string, description?: string): string {
  return useToastStore.getState().push({ kind, title, description });
}
