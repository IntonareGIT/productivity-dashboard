import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
// The app stylesheet must be imported or Tailwind emits no utilities and the
// browser would measure an unstyled box.
import '../src/styles/index.css';
import { AssistantChat } from '../src/features/ai/components/AssistantChat';
import { useAssistantStore } from '../src/stores/useAssistantStore';

/**
 * A bare page that mounts ONLY the assistant composer.
 *
 * The composer normally sits behind routing, a configured provider and a
 * Dexie-backed store, so driving it in a real browser would mean standing up all
 * of that first. This mounts the real component against real DOM, real CSS and
 * real event handling, which is exactly the surface the key handling needs.
 *
 * The store's `providerReady`/`busy` flags are set directly on the real store
 * (they are plain state) instead of seeding a fake provider row: writing to
 * IndexedDB behind Dexie's back caused a schema error, and the flags are all the
 * component actually reads.
 *
 * `send` is stubbed so the harness never calls a real API. The stub records what
 * was sent into `window.__sent`, which is what lets the test assert that Enter
 * sends and Shift+Enter does not.
 */
function Harness() {
  const configured = useAssistantStore((s) => s.providerReady);
  const setOpen = useAssistantStore((s) => s.setOpen);

  const [ready, setReady] = useState(configured);

  React.useEffect(() => {
    // Force the enabled state the composer checks before rendering it.
    useAssistantStore.setState({ providerReady: true, busy: false, open: true, view: [] });
    setOpen(true);
    setReady(true);
    useAssistantStore.setState({
      send: async (text: string) => {
        const w = window as unknown as { __sent: string[] };
        w.__sent = [...(w.__sent ?? []), text];
      },
    });
  }, [setOpen]);

  return (
    <div className="p-4 h-screen flex flex-col">
      {ready && (
        <AssistantChat onOpenSettings={() => {}} className="flex-1 min-h-0" />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);