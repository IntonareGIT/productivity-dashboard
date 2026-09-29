import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { AssistantChat } from '../ai/components/AssistantChat';
import { ResourceViewer } from '../library/components/ResourceViewer';
import { DashboardPage } from '../dashboard/DashboardPage';
import type { NavTab } from '../../components/layout/Sidebar';
import type { Resource } from '../../types';
import { NotesPane } from './NotesPane';
import type { PaneSlot } from './splitModel';

interface PaneContentProps {
  slot: PaneSlot;
  onNavigate: (tab: NavTab) => void;
  onOpenAssistantSettings: () => void;
}

const Blank = ({ children }: { children: React.ReactNode }) => (
  <p className="p-4 text-xs text-content-tertiary">{children}</p>
);

/**
 * Renders whatever one pane is set to.
 *
 * PDF preview mounts the shared `ResourceViewer` (and therefore the shared
 * `PdfViewer`), so zoom/rotate/page nav and the render-cancellation fix behave
 * identically here, in a modal, and in full-screen preview. Each pane mounts
 * its OWN instance, so the same file can be open in both panes at once with
 * completely independent viewer state.
 */
export const PaneContent: React.FC<PaneContentProps> = ({
  slot, onNavigate, onOpenAssistantSettings,
}) => {
  // Resources are read live, so a pane opened on a file picks up edits.
  const resource = useLiveQuery(
    () => (slot.kind === 'pdf' && slot.resourceId
      ? db.resources.get(slot.resourceId)
      : Promise.resolve(undefined)),
    [slot.kind, slot.resourceId],
  ) as Resource | undefined;

  switch (slot.kind) {
    case 'empty':
      return (
        <div className="flex h-full items-center justify-center p-4">
          <p className="max-w-[22rem] text-center text-xs text-content-tertiary border border-dashed border-border rounded-xl px-4 py-6">
            Choose what to show in this pane: Dashboard, a PDF, Notes, or Assistant.
          </p>
        </div>
      );

    case 'dashboard':
      return <DashboardPage onNavigate={onNavigate} />;

    case 'assistant':
      // The same AssistantChat the bubble and /assistant page use, so history
      // and tools are shared; only the surrounding layout is narrower. The
      // wrapper is a definite-height flex column and the transcript scrolls
      // INSIDE it, so the composer never gets pushed out of the pane.
      return (
        <div className="h-full min-h-0 flex flex-col bg-bg-surface overflow-hidden">
          <AssistantChat
            onOpenSettings={onOpenAssistantSettings}
            className="flex-1 min-h-0"
          />
        </div>
      );

    case 'notes':
      return <NotesPane topicId={slot.topicId} />;

    case 'pdf':
      if (!slot.resourceId) return <Blank>Pick a PDF in this pane&apos;s header.</Blank>;
      if (!resource) return <Blank>Loading resource…</Blank>;
      // `embedded` renders the viewer without its own modal chrome, and the
      // viewer supplies its own full-screen control. The wrapper is
      // `overflow-hidden` on purpose: the PANE clips, and the PDF's own scroll
      // area (`overflow-y-auto`) does the scrolling. An `overflow-auto` wrapper
      // here would make the whole pane scroll as well, and the page controls
      // would drift away from the page.
      return (
        <div className="flex flex-col h-full min-h-0 overflow-hidden p-1">
          <EmbeddedResourceViewer resource={resource} />
        </div>
      );

    default:
      return <Blank>Nothing selected.</Blank>;
  }
};

/**
 * The shared ResourceViewer body, minus the modal wrapper, for use inside a
 * pane. Full-screen preview is raised by the split so it can cover everything.
 */
// The viewer owns its own fullscreen, so nothing is threaded in from the pane.
const EmbeddedResourceViewer: React.FC<{ resource: Resource }> = ({ resource }) => (
  <ResourceViewer
    resource={resource}
    onClose={() => { /* panes are closed by the pane header, not the viewer */ }}
    embedded
  />
);
