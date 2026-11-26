import React from 'react';
import { NoteEditor } from '../noteEditor/NoteEditor';
import { editorHtmlForTopic, updateTopicContentHtml } from '../libraryRepo';
import type { Topic } from '../../../types';
import { toast } from '../../../stores/useToastStore';

/**
 * The notes body used by BOTH the standalone Library editor and the split-pane
 * notes view, so the two cannot drift apart.
 *
 * This is the autosave layer. It writes to `contentHtml` (never to the markdown
 * `notes` field, which stays as the permanent original), debounced so a burst of
 * typing is one write, and reports when a save happened so the caller's existing
 * "Saved" indicator keeps working unchanged.
 *
 * The conversion from markdown to editor HTML happens here, LAZILY: opening a
 * note seeds the editor from the converted HTML but writes nothing back, so a
 * note that is only ever read stays byte-identical on disk. The first real edit
 * is what persists the new format.
 */
export const NotesEditorBody: React.FC<{
  topic: Topic;
  minHeight?: string;
  onSaved?: () => void;
}> = ({ topic, minHeight, onSaved }) => {
  const [html, setHtml] = React.useState(() => editorHtmlForTopic(topic));
  const timer = React.useRef<number | null>(null);
  // The note currently open, so a change of note cancels any pending save and
  // re-seeds from the new note's body instead of writing one note into another.
  const noteKey = topic.id;
  const lastSaved = React.useRef<string | null>(null);

  React.useEffect(() => {
    setHtml(editorHtmlForTopic(topic));
    lastSaved.current = null;
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [noteKey, topic]);

  const persist = React.useCallback((next: string) => {
    setHtml(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void updateTopicContentHtml(noteKey, next)
        .then(() => { lastSaved.current = next; onSaved?.(); })
        .catch(() => {
          // A failed autosave must be visible, not silent: the user would
          // otherwise believe a lost edit was stored.
          toast('error', 'Could not save notes', 'Your text is still here; try editing again.');
        });
    }, 700);
  }, [noteKey, onSaved]);

  return (
    <NoteEditor
      html={html}
      onChange={persist}
      noteKey={noteKey}
      minHeight={minHeight}
    />
  );
};
