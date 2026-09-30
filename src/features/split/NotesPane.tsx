import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Pencil } from 'lucide-react';
import { db } from '../../db/db';
import { MarkdownNotes, NoteTitleInput, NotesEditorBody } from '../library/components/MarkdownNotes';
import { updateTopicNotes } from '../library/libraryRepo';
import type { Topic } from '../../types';

interface NotesPaneProps {
  topicId: string | undefined;
}

/**
 * Topic notes in a narrow pane.
 *
 * The same markdown notes and the same `updateTopicNotes()` write the Library
 * uses — only the layout is narrower (no Card chrome, no wide button row). Live
 * from Dexie, so an edit made in either place appears in both.
 */
export const NotesPane: React.FC<NotesPaneProps> = ({ topicId }) => {
  const topic = useLiveQuery(
    () => (topicId ? db.topics.get(topicId) : Promise.resolve(undefined)),
    [topicId],
  ) as Topic | undefined;

  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  // Re-seed the draft whenever the selected topic changes.
  useEffect(() => {
    setDraft(topic?.notes ?? '');
    setEditing(false);
    setSaved(false);
  }, [topicId, topic?.notes]);

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

  const dirty = draft !== topic.notes;

  const save = async () => {
    await updateTopicNotes(topic.id, draft);
    setEditing(false);
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
      <NotesEditorBody
        value={draft}
        onChange={setDraft}
        minHeight="min-h-[160px]"
        textareaClassName="resize-none"
      />
      <div className="flex items-center justify-end gap-2 mt-2">
        <button
          onClick={() => { setDraft(topic.notes); setEditing(false); }}
          className="px-3 min-h-[40px] rounded-xl text-xs text-content-secondary hover:text-content-primary transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => void save()}
          disabled={!dirty}
          className="px-3 min-h-[40px] rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-xs font-semibold transition-colors"
        >
          Save notes
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
        <MarkdownNotes text={topic.notes} />
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
