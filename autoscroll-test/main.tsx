import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/index.css';
import { AssistantSurface } from '../src/features/ai/components/AssistantSurface';
import { useAssistantStore } from '../src/stores/useAssistantStore';

/**
 * A bare page that mounts ONLY the assistant surface with command-bar layout.
 *
 * The surface normally sits behind routing, a configured provider and a
 * Dexie-backed store. This mounts the real component against real DOM, real CSS
 * and real event handling for browser autoscroll testing.
 *
 * Layout is read from URL: ?layout=bubble|fullscreen|split
 */
function Harness() {
  const [ready, setReady] = useState(false);
  const layout = (() => {
    if (typeof window === 'undefined') return 'bubble';
    const params = new URLSearchParams(window.location.search);
    const l = params.get('layout');
    return (l === 'fullscreen' || l === 'split' || l === 'bubble') ? l : 'bubble';
  })();

  React.useEffect(() => {
    // Force the enabled state the surface checks before rendering it.
    useAssistantStore.setState({
      providerReady: true,
      busy: false,
      open: true,
      view: [],
      models: [{ id: 'test-model', displayName: 'Test Model', hasKey: true, modelId: 'gemini-1.5' }],
      selectedModelId: 'test-model',
      send: async (text: string) => {
        const w = window as unknown as { __sent: string[]; __view: any[] };
        w.__sent = [...(w.__sent ?? []), text];
        // Simulate streaming: add user message, then assistant message
        w.__view = [
          ...(w.__view ?? []),
          { id: 'user-' + Date.now(), role: 'user', text, timestamp: Date.now() },
        ];
        useAssistantStore.setState({ view: w.__view });

        // Simulate streaming reply after a delay
        setTimeout(() => {
          const assistantId = 'assistant-' + Date.now();
          const replyText = 'This is a streaming reply that will be long enough to test autoscroll. '.repeat(3) + 'End of reply.';
          w.__view = [...(w.__view ?? []), { id: assistantId, role: 'assistant', text: replyText, timestamp: Date.now() }];
          useAssistantStore.setState({ view: w.__view, busy: false });
        }, 200);
      },
      stop: () => {},
      retryLast: () => {},
      confirmPending: () => {},
      cancelPending: () => {},
      clearChat: () => {},
      loadSessions: () => {},
      newSession: () => {},
      selectSession: () => {},
      removeSession: () => {},
      renameSession: () => {},
      fetchModels: () => {},
      setDraft: (text: string) => useAssistantStore.setState({ draft: text }),
      setModel: (id: string) => useAssistantStore.setState({ selectedModelId: id }),
      setOpen: (open: boolean) => useAssistantStore.setState({ open }),
      setAssistantRedesign: (v: boolean) => useAssistantStore.setState({ assistantRedesign: v }),
    });
    setReady(true);
  }, []);

  return (
    <div className="p-4 h-screen flex flex-col">
      {ready && (
        <AssistantSurface layout={layout} />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);

// Expose test helpers
if (typeof window !== 'undefined') {
  (window as any).__testHelpers = {
    getShowJump: () => {
      // This will be set by the component via a ref
      return (window as any).__assistantShowJump ?? false;
    },
    setShowJump: (v: boolean) => {
      (window as any).__assistantShowJump = v;
    },
  };
}