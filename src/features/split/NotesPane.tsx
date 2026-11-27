import React, { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Pencil } from 'lucide-react';
import { db } from '../../db/db';
import { MarkdownNotes, NoteTitleInput } from '../library/components/MarkdownNotes';
import { NotesListen } from '../library/components/NotesListen';
import { NotesEditorBody } from '../library/components/NotesEditorBody';
import { updateTopicNotes, topicUsesHtml } from '../library/libraryRepo';
import type { Topic } from '../../types';

interface NotesPaneProps {
  topicId: string | undefined;
}

/**
 * Topic notes in a narrow pane.
 *
 * The SAME `NotesEditorBody` and the same autosave the Library uses, only
 * narrower (no Card chrome, no wide button row). Live from Dexie, so an edit made
 * in either place appears in both.
 */
export const NotesPane: React.FC<NotesPaneProps> = ({ topicId }) => {
  const topic = useLiveQuery(
    () => (topicId ? db.topics.get(topicId) : Promise.resolve(undefined)),
    [topicId],
  ) as Topic | undefined;

  const [editing, setEditing] = useState(false);
  // The rendered note, so Listen can highlight the sentence it is reading.
  const notesBodyRef = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setEditing(false);
    setSaved(false);
  }, [topicId]);

  if (!topicId) {
    return (
      <p className="p-4 text-xs text-content-tertiary">
        Pick a topic in this pane&apos;s header to show its notes.
      </p>
    );
  }
  if (!topic) {
    return (
      <p className="p-4 flex items-center gap-2 text-xs text-content-tertiary">
        <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
        Loading notes…
      </p>
    );
  }

  const onSaved = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  return editing ? (
    <div className="p-3 flex flex-col h-full min-h-0 gap-2">
      {/* The title sits ABOVE the body in BOTH the editing and reading states,
          so a note is never just an anonymous block of markdown. */}
      <NoteTitleInput
        topic={topic}
        className="w-full bg-transparent border-none outline-none text-base font-semibold text-content-primary placeholder:text-content-tertiary/60 shrink-0"
      />
      <NotesEditorBody topic={topic} minHeight="min-h-[160px]" onSaved={onSaved} />
      <div className="flex items-center justify-end gap-2 mt-2">
        {saved && (
          <span className="flex items-center gap-1 text-xs text-emerald-500 font-medium">
            <Check className="w-3.5 h-3.5" /> Saved
          </span>
        )}
        <button
          onClick={() => setEditing(false)}
          className="px-3 min-h-[40px] rounded-xl text-xs text-content-secondary hover:text-content-primary transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  ) : (
    <div className="flex flex-col h-full min-h-0">
      {/* The note's own header: the title, the Listen transport and Edit notes.
          The body scrolls in the box below it, so the transport never leaves the
          screen while a long note moves — and there is no separate bar at the
          bottom any more. */}
      <div className="shrink-0 flex flex-col gap-1.5 px-3 pt-2.5 pb-2 border-b border-border/60">
        <div className="flex flex-wrap items-center gap-2">
          <NoteTitleInput
            topic={topic}
            className="flex-1 basis-40 min-w-0 bg-transparent border-none outline-none text-base font-semibold text-content-primary placeholder:text-content-tertiary/60"
          />
          {saved && (
            <span className="flex items-center gap-1 text-xs text-emerald-500 font-medium">
              <Check className="w-3.5 h-3.5" /> Saved
            </span>
          )}
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl border border-border text-xs font-semibold text-content-secondary hover:text-content-primary transition-colors shrink-0"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit notes
          </button>
        </div>
        <NotesListen
          text={topic.notes}
          html={topic.contentHtml}
          hasHtml={topicUsesHtml(topic)}
          containerRef={notesBodyRef}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 py-3">
        <div ref={notesBodyRef}>
          <MarkdownNotes
            text={topic.notes}
            html={topic.contentHtml}
            hasHtml={topicUsesHtml(topic)}
          />
        </div>
      </div>
    </div>
  );
};
