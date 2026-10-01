import React, { useEffect, useRef, useState } from 'react';
import { Check, FolderInput, FolderPlus, X } from 'lucide-react';
import type { ResourceGroup } from '../../../types';
import { moveResourceToGroup, saveResourceGroup } from '../libraryRepo';
import { buildGroupTree } from '../groupTree';
import { toast } from '../../../stores/useToastStore';
import { GroupNameEditor } from './ResourceGroups';

/**
 * "Move to group" for a single resource.
 *
 * A popover of tappable rows rather than a native <select>: every option has to
 * say "No group" and "New group…", which a select cannot express, and a list of
 * full-width rows is the pattern that actually works with a thumb.
 *
 * Closes on outside pointerdown, on Escape, and after a choice. Opened by a
 * button, so it never depends on a hover or a long-press.
 */
export const MoveToGroupMenu: React.FC<{
  resourceId: string;
  subjectId: string;
  currentGroupId: string | null;
  groups: ResourceGroup[];
  onMoved?: () => void;
}> = ({ resourceId, subjectId, currentGroupId, groups, onMoved }) => {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // `pointerdown` in the capture phase so the menu closes before the tap lands
    // on whatever is underneath it.
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = async (groupId: string | null) => {
    // Surface a failure instead of closing silently: if the write is rejected the
    // menu must not look like the move happened.
    try {
      await moveResourceToGroup(resourceId, groupId);
      setOpen(false);
      onMoved?.();
    } catch (e) {
      toast('error', 'Could not move resource', e instanceof Error ? e.message : String(e));
    }
  };

  const createAndMove = async (name: string) => {
    try {
      const id = await saveResourceGroup({ subjectId, name });
      await moveResourceToGroup(resourceId, id);
      toast('success', 'Group created', name);
      setCreating(false);
      setOpen(false);
      onMoved?.();
    } catch (e) {
      toast('error', 'Could not create group', e instanceof Error ? e.message : String(e));
    }
  };

  // The tree is rendered from the SHARED builder, so the menu shows the same
  // indentation, the same natural ordering and the same paths as the Library
  // tree and the Phase 2 AI tools. A flat list of names is exactly what made
  // "Week 1" ambiguous once groups could nest.
  const tree = buildGroupTree(groups, new Map());

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => { setOpen((v) => !v); setCreating(false); }}
        aria-label="Move to group"
        aria-expanded={open}
        className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
      >
        <FolderInput className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-bg-surface shadow-lg py-1 overflow-hidden"
        >
          {creating ? (
            <div className="p-2">
              <GroupNameEditor
                placeholder="New group"
                submitLabel="Create"
                onSubmit={(n) => void createAndMove(n)}
                onCancel={() => setCreating(false)}
              />
            </div>
          ) : (
            <>
              {/* Every row is a real button with a 40px min height: a thumb tap,
                  not a drag and not a hover-only affordance. */}
              <button
                role="menuitem"
                onClick={() => void choose(null)}
                className="w-full flex items-center gap-2 px-3 min-h-[40px] text-xs text-content-secondary hover:bg-bg-elevated text-left"
              >
                <X className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">No group</span>
                {currentGroupId === null && <Check className="w-3.5 h-3.5 ml-auto text-accent shrink-0" />}
              </button>
              <div className="my-1 border-t border-border/60" />
              <div className="max-h-64 overflow-y-auto">
                {tree.map((node) => (
                  <button
                    key={node.id}
                    role="menuitem"
                    onClick={() => void choose(node.id)}
                    data-group-option={node.id}
                    data-depth={node.depth}
                    // Indent by depth so nested groups are unambiguous.
                    className="w-full flex items-center gap-2 px-3 min-h-[40px] text-xs text-content-secondary hover:bg-bg-elevated text-left"
                    style={{ paddingLeft: `${12 + (node.depth - 1) * 12}px` }}
                  >
                    <FolderInput className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{node.name}</span>
                    {currentGroupId === node.id && <Check className="w-3.5 h-3.5 ml-auto text-accent shrink-0" />}
                  </button>
                ))}
              </div>
              <div className="my-1 border-t border-border/60" />
              <button
                role="menuitem"
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2 px-3 min-h-[40px] text-xs font-semibold text-accent hover:bg-bg-elevated text-left"
              >
                <FolderPlus className="w-3.5 h-3.5 shrink-0" /> New group…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
