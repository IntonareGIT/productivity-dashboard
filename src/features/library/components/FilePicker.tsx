import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, FileText, Folder, FolderOpen, NotebookPen, Search, X } from 'lucide-react';
import type { Resource, Topic } from '../../../types';
import { Z } from '../../../components/ui/zIndex';
import {
  DEFAULT_KINDS,
  getChildren, getRecentNodes, lastLocation, noteOpened, pathToResource,
  pathToTopic, rememberLocation, searchAll,
  type PickerKinds, type PickerNode, type PickerWant,
} from './filePickerData';

export interface FilePickerProps {
  open: boolean;
  onClose: () => void;
  /** The file currently open, so the picker can start where it is. */
  currentResource?: Resource | null;
  /** The note currently open, for a notes pane. */
  currentTopic?: Topic | null;
  /** Filters what is openable: 'pdf' for the PDF viewer, 'image' for images. */
  want?: PickerWant;
  /**
   * Which kinds this caller can open. `['resource']` for the PDF and image
   * selectors, so a note is never offered to a viewer that cannot show one;
   * `['resource', 'note']` for the split pane's open menu, which can do both.
   */
  kinds?: PickerKinds;
  /**
   * Identifies the calling slot, normally the pane index. Two split panes each
   * pass their own, so each keeps its own selection AND its own remembered
   * location: browsing in one pane never moves the other one.
   */
  slotKey?: string;
  onPick: (resource: Resource) => void;
  /** Called instead of `onPick` when a NOTE row is chosen. */
  onPickNote?: (topic: Topic) => void;
}

/**
 * The drill-down file picker.
 *
 * Replaces a flat list of file names, which was unusable once files are called
 * "1-introduction" and that name repeats across subjects and folders.
 *
 * The navigation state is ONE array, the path from the root. There is no
 * per-level variable, so a folder eight levels deep works exactly like one two
 * levels deep, and Back is just "drop the last element".
 *
 * Rendered through a portal with the shared z-index scale so it can never be
 * clipped by a scrolling pane or a card. On a phone it is a bottom sheet; on a
 * desktop a centred dialog. Every row is a 44px button, so it works with a
 * thumb, and arrows, Enter, Backspace and Escape work from a keyboard.
 */
export const FilePicker: React.FC<FilePickerProps> = ({
  open, onClose, currentResource, currentTopic, want = 'pdf',
  kinds = DEFAULT_KINDS, slotKey = 'default', onPick, onPickNote,
}) => {
  const [path, setPath] = useState<PickerNode[]>([]);
  const [rows, setRows] = useState<PickerNode[]>([]);
  const [recents, setRecents] = useState<PickerNode[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [cursor, setCursor] = useState(0);

  // A note counts as "the current item" exactly as a file does, so the picker
  // opens on the subject the open note lives in and highlights that note.
  const currentId = currentResource?.id ?? currentTopic?.id ?? null;

  // Where the picker opens, in the order the brief asks for: the currently open
  // item's own location first, then the last place this slot was left, then the
  // root. Re-run whenever it opens or the current item changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setQuery('');
    setRecents(getRecentNodes());
    void (async () => {
      const start = currentTopic
        ? await pathToTopic(currentTopic.id)
        : currentResource
          ? await pathToResource(currentResource.id)
          : (lastLocation(slotKey) ?? []);
      if (cancelled) return;
      setPath(start);
    })();
  }, [open, currentResource?.id, currentTopic?.id, slotKey]);

  const current = path.length > 0 ? path[path.length - 1] : null;

  // Remember the location as soon as it is reached, not only on close, so a
  // refresh mid-browse still lands somewhere sensible.
  useEffect(() => {
    if (open && path.length > 0) rememberLocation(slotKey, path);
  }, [open, path, slotKey]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const q = query.trim();
      const list = q
        ? await searchAll(q, want, currentId, kinds)
        : await getChildren(current, want, currentId, kinds);
      if (cancelled) return;
      setRows(list);
      setCursor(0);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, current, query, want, currentId, kinds]);

  // Focus the search box on open, so typing works without a tap.
  useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  /**
   * The rows actually on screen, and where the Recent section ends.
   *
   * Step 1 shows the Recent items ABOVE the subjects, rather than replacing
   * them: the brief asks for a Recent section at the top of step 1, and
   * subjects are step 1's real content. It only appears at the root and only
   * when something has been opened, because an empty heading is worse than no
   * heading. A search suppresses it, because a "Recent" heading in the middle
   * of search results would be a lie about where these rows came from.
   *
   * A Recent row the caller cannot open is filtered out here rather than shown
   * as a row that does nothing: a PDF viewer must not list a note just because
   * the user opened one in the other pane.
   */
  const usableRecents = recents.filter((n) => (
    n.kind === 'note' ? kinds.includes('note') : kinds.includes('resource')
  ));
  const showRecent = !query.trim() && path.length === 0 && usableRecents.length > 0;
  const visible = showRecent ? [...usableRecents, ...rows] : rows;
  const recentCount = showRecent ? usableRecents.length : 0;

  const goUp = useCallback(() => setPath((p) => p.slice(0, -1)), []);
  const goTo = useCallback((depth: number) => setPath((p) => p.slice(0, depth + 1)), []);

  const choose = useCallback((node: PickerNode) => {
    if (node.disabledReason) return;
    // A note is a leaf you open, not a folder you descend into.
    if (node.kind === 'note') {
      if (!node.topic || !onPickNote) return;
      noteOpened(node);
      onPickNote(node.topic);
      onClose();
      return;
    }
    if (node.kind !== 'resource' || !node.resource) {
      setPath((p) => [...p, node]);
      return;
    }
    noteOpened(node);
    onPick(node.resource);
    onClose();
  }, [onPick, onPickNote, onClose]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    // Backspace means "go back" only when it cannot mean "delete a character",
    // which is exactly when the search box is empty. Swallowing it inside a
    // text field would make the field impossible to correct.
    if (e.key === 'Backspace' && path.length > 0 && !query) {
      e.preventDefault(); goUp(); return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => {
        const next = Math.max(0, Math.min(visible.length - 1, c + (e.key === 'ArrowDown' ? 1 : -1)));
        rowRefs.current[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const row = visible[cursor];
      if (row) choose(row);
    }
  }, [visible, cursor, path.length, query, goUp, onClose, choose]);

  const crumbs = useMemo(
    () => [{ id: '', kind: 'subject' as const, name: 'Subjects', childCount: 0, path: 'Subjects' }, ...path],
    [path],
  );
  if (typeof document === 'undefined' || !open) return null;

return createPortal(
    <>
      <div className={`fixed inset-0 ${Z.backdrop} bg-black/40`} onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a file"
        data-file-picker
        onKeyDown={onKeyDown}
        className={`pointer-events-auto fixed ${Z.modal} flex flex-col bg-bg-surface border border-border shadow-2xl overflow-hidden
          inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t
          md:inset-y-0 md:left-1/2 md:right-auto md:top-1/2 md:bottom-auto md:-translate-x-1/2 md:-translate-y-1/2
          md:w-[520px] md:max-h-[80vh] md:rounded-2xl`}
      >
        {/* Breadcrumb: every part tappable, at any depth. */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border/60 bg-bg-elevated/50">
          <button
            onClick={goUp}
            disabled={path.length === 0}
            aria-label="Back"
            className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated disabled:opacity-30 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
            {crumbs.map((c, i) => (
              <React.Fragment key={`${c.kind}-${c.id}-${i}`}>
                {i > 0 && <span className="text-content-tertiary text-xs shrink-0">/</span>}
                <button
                  onClick={() => (i === 0 ? setPath([]) : goTo(i - 1))}
                  className="text-xs text-content-secondary hover:text-accent whitespace-nowrap shrink-0"
                >
                  {c.name}
                </button>
              </React.Fragment>
            ))}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search covers every subject and group at once. */}
        <div className="relative px-3 py-2 border-b border-border/60">
          <Search className="w-3.5 h-3.5 absolute left-5 top-1/2 -translate-y-1/2 text-content-tertiary" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all files and folders…"
            aria-label="Search files and folders"
            className="w-full bg-bg-elevated border border-border rounded-lg pl-8 pr-3 py-2 text-xs text-content-primary outline-none focus:border-accent placeholder:text-content-tertiary"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-1.5">
          {loading ? (
            <p className="text-xs text-content-tertiary p-3">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="text-xs text-content-tertiary p-3">
              {query ? 'Nothing matches that search.' : 'Nothing here yet.'}
            </p>
          ) : (
            visible.map((node, i) => {
              const isFolder = node.kind !== 'resource';
              return (
                <React.Fragment key={`${node.kind}-${node.id}-${i}`}>
                  {/* The Recent section heading. Not a button: it labels the rows
                      under it rather than going anywhere. */}
                  {i === recentCount && (
                    <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">
                      Recent
                    </p>
                  )}
                  <button
                    ref={(el) => { rowRefs.current[i] = el; }}
                    onClick={() => choose(node)}
                    disabled={Boolean(node.disabledReason)}
                    aria-current={node.isCurrent ? 'true' : undefined}
                    data-picker-row={node.id}
                    data-picker-kind={node.kind}
                    className={`w-full flex items-center gap-2 px-2.5 min-h-[44px] rounded-lg text-left transition-colors
                      ${node.disabledReason ? 'opacity-45 cursor-not-allowed' : 'hover:bg-bg-elevated'}
                      ${node.isCurrent ? 'bg-accent-subtle' : ''}`}
                  >
                    {/* A note needs its OWN icon, not the file one. Sharing the
                        file glyph would make a note indistinguishable from a
                        document called the same thing, which is the exact
                        confusion this picker exists to remove. */}
                    {isFolder
                      ? <Folder className="w-4 h-4 text-content-tertiary shrink-0" />
                      : node.kind === 'note'
                        ? <NotebookPen className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
                        : <FileText className="w-4 h-4 text-content-tertiary shrink-0" />}
                    <span className="min-w-0 flex-1">
                      {/* Two files with the same name are only distinguishable by
                          the path underneath, which is the whole reason this picker
                          exists. */}
                      <span className="block text-xs font-medium text-content-primary truncate">{node.name}</span>
                      {node.path && node.path !== node.name && (
                        <span className="block text-[10px] text-content-tertiary truncate">{node.path}</span>
                      )}
                      {node.disabledReason && (
                        <span className="block text-[10px] text-content-tertiary">{node.disabledReason}</span>
                      )}
                    </span>
                    {isFolder && node.childCount > 0 && (
                      <span className="text-[10px] text-content-tertiary shrink-0">{node.childCount}</span>
                    )}
                    {isFolder && <FolderOpen className="w-3.5 h-3.5 text-content-tertiary shrink-0" />}
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>
      </div>
    </>,
    document.body,
  );
};