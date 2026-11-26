import React, { lazy } from 'react';

/**
 * Dynamic import wrapper with chunk load failure recovery.
 *
 * When a service worker serves an old index.html that references stale chunk
 * hashes, dynamic imports fail with "Failed to fetch dynamically imported
 * module". This wrapper catches that specific failure and prompts the user to
 * reload, which clears the SW cache and fetches the new version.
 */
export interface ChunkLoadRecoveryOptions {
  /** Called when a chunk load failure is detected. Return true to show the reload UI. */
  onChunkLoadFailure?: (error: Error) => boolean;
  /** Called when the user clicks the reload button. */
  onReload?: () => void;
}

/** Default handler that shows a toast and offers a reload button. */
export function createDefaultChunkLoadHandler(
  showToast: (kind: 'error' | 'info', title: string, description?: string) => string,
  dismissToast: (id: string) => void,
): ChunkLoadRecoveryOptions {
  let reloadToastId: string | null = null;

  return {
    onChunkLoadFailure: (error: Error) => {
      // Only handle the specific "Failed to fetch dynamically imported module" error
      if (!/Failed to fetch dynamically imported module/i.test(error.message)) {
        return false;
      }
      // Dismiss any existing reload toast
      if (reloadToastId) {
        dismissToast(reloadToastId);
      }
      // Show a persistent toast with a reload action
      reloadToastId = showToast(
        'error',
        'A new version is available',
        'Click to reload and get the latest version.',
      );
      // We don't auto-reload - let the user decide
      return true;
    },
    onReload: () => {
      if (reloadToastId) {
        dismissToast(reloadToastId);
        reloadToastId = null;
      }
      // Clear all caches and reload
      if ('caches' in window) {
        caches.keys().then((names) => {
          names.forEach((name) => caches.delete(name));
        });
      }
      // Unregister all service workers
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((reg) => reg.unregister());
        });
      }
      // Force reload from network
      window.location.reload();
    },
  };
}

/**
 * Wraps a lazy import with chunk load failure detection.
 *
 * Usage:
 *   const MyComponent = lazyWithRecovery(() => import('./MyComponent'));
 */
export function lazyWithRecovery<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  options: ChunkLoadRecoveryOptions = {},
): React.LazyExoticComponent<T> {
  let hasShownRecovery = false;

  return lazy(async () => {
    try {
      const module = await importFn();
      hasShownRecovery = false; // Reset on success
      return module;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Check if this is a chunk load failure
      const isChunkLoadFailure = /Failed to fetch dynamically imported module/i.test(err.message);

      if (isChunkLoadFailure && !hasShownRecovery && options.onChunkLoadFailure) {
        hasShownRecovery = true;
        const shouldShow = options.onChunkLoadFailure(err);
        if (shouldShow && options.onReload) {
          // The toast was shown, but we still need to throw to let React
          // show the error boundary fallback. The user can click reload from the toast.
        }
      }

      // Re-throw so React's error boundary can catch it
      throw err;
    }
  });
}