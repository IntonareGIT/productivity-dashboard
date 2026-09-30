import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Pencil } from 'lucide-react';
import { db } from '../../db/db';
import { MarkdownNotes, NoteTitleInput } from '../library/components/MarkdownNotes';
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
    <div className="p-3 flex flex-col h-full min-h-0">
      <NoteTitleInput
        topic={topic}
        className="w-full bg-transparent border-none outline-none text-base font-semibold text-content-primary placeholder:text-content-tertiary/60 shrink-0 mb-1"
      />
      <div className="flex-1 min-h-0 overflow-auto">
        <MarkdownNotes
          text={topic.notes}
          html={topic.contentHtml}
          hasHtml={topicUsesHtml(topic)}
        />
      </div>
      <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-border/50">
        {saved && (
          <span className="flex items-center gap-1 text-xs text-emerald-500 font-medium">
            <Check className="w-3.5 h-3.5" /> Saved
          </span>
        )}
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl border border-border text-xs font-semibold text-content-secondary hover:text-content-primary transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" /> Edit notes
        </button>
      </div>
    </div>
  );
};
