import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The app stylesheet must be imported here too. Without it Tailwind generates no
// utility CSS, so the toolbar's `overflow-x-auto` / `whitespace-nowrap` / sizing
// classes silently do nothing and the browser checks measure an unstyled page.
import '../src/styles/index.css';
import { NoteEditor } from '../src/features/library/noteEditor/NoteEditor';

/**
 * A bare page that mounts ONLY the note editor.
 *
 * The editor normally lives deep inside the Library or split view behind Dexie
 * and routing, so driving it in a real browser would otherwise mean standing up
 * a whole subject/topic first. This page mounts the component directly against
 * real DOM, real CSS and real event handling, which is exactly the surface the
 * formatting checks need.
 *
 * Served only by `vite dev` at `/editor-test.html`; it is not in the production
 * build inputs.
 */
function Harness() {
  const [html, setHtml] = React.useState('<p>hello world</p>');
  return (
    <div className="p-4 max-w-xl">
      <NoteEditor html={html} onChange={setHtml} noteKey="harness" minHeight="min-h-[200px]" />
      <pre id="stored" className="mt-4 text-xs whitespace-pre-wrap">{html}</pre>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
