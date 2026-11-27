import React from 'react';
import { createRoot } from 'react-dom/client';
// The app stylesheet must be imported here too, or Tailwind emits no utility
// CSS and the pane is measured unstyled.
import '../src/styles/index.css';
import { MarkdownNotes, NoteTitleInput } from '../src/features/library/components/MarkdownNotes';
import type { Topic } from '../src/types';

/**
 * A bare page that mounts the note TITLE and BODY together, with two notes.
 *
 * The title input normally sits deep inside the Library's notes card and the
 * split-view notes pane, behind Dexie and routing, so driving it in a real
 * browser would otherwise mean standing up a subject, topics and a note first.
 * This page mounts the same components the app uses, against real DOM, real CSS
 * and real event handling.
 *
 * The two buttons stand in for the two ways the title can be asked to change:
 *  - "Next note": the pane is pointed at a different note (what switching topic
 *    in the Library, or picking another topic in the split-view header, does).
 *  - "Rename": the open note's stored title changes underneath the input, the
 *    way a Dexie Cloud sync or a rename made elsewhere arrives.
 *
 * The note ids are deliberately NOT in the database, so `setTopicTitle` finds no
 * row and writes nothing: the harness never touches IndexedDB or the cloud.
 *
 * Served only by `vite dev` at `/title-test.html`; not a production build input.
 */
const NOW = '2026-01-01T00:00:00.000Z';

const makeTopic = (id: string, title: string, notes: string): Topic => ({
  id,
  subjectId: 'harness-subject',
  title,
  notes,
  status: 'not_started',
  order: 0,
  createdAt: NOW,
  updatedAt: NOW,
});

const SEED: Topic[] = [
  makeTopic('harness-topic-a', "Fluid Mechanics II's Notes", 'Pumps, motors and hydraulic circuits.'),
  makeTopic('harness-topic-b', "Heat Transfer's Notes", 'Conduction, convection and radiation.'),
];

function Harness() {
  const [notes, setNotes] = React.useState<Topic[]>(SEED);
  const [index, setIndex] = React.useState(0);
  const topic = notes[index];

  return (
    <div className="p-4 max-w-xl">
      <div className="flex gap-2 mb-3">
        <button
          id="next"
          onClick={() => setIndex((i) => (i + 1) % notes.length)}
          className="px-3 py-2 rounded-xl border border-border text-xs font-semibold"
        >
          Next note
        </button>
        <button
          id="rename"
          onClick={() => setNotes((all) => all.map((t, i) => (
            i === index ? { ...t, title: `${t.title} (renamed)` } : t
          )))}
          className="px-3 py-2 rounded-xl border border-border text-xs font-semibold"
        >
          Rename
        </button>
      </div>
      <div id="pane" className="p-3 rounded-xl border border-border bg-bg-elevated">
        <NoteTitleInput topic={topic} />
        <div id="body" className="mt-2">
          <MarkdownNotes text={topic.notes} />
        </div>
      </div>
      <pre id="state" className="mt-4 text-xs whitespace-pre-wrap">{JSON.stringify({ id: topic.id, title: topic.title })}</pre>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);
