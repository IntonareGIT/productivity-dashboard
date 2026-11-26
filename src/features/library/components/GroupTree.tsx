import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Folder, FolderInput, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import type { Resource, ResourceGroup } from '../../../types';
import {
  buildGroupTree, deleteImpact, validGroupDestinations, type GroupNode,
} from '../groupTree';
import { GroupNameEditor } from './ResourceGroups';
import { toast } from '../../../stores/useToastStore';

/**
 * The "Move group" destination picker.
 *
 * Only VALID destinations are ever offered: the subject root and every group
 * that is neither the group itself nor one of its descendants. Building the
 * list with `validGroupDestinations` is what makes an illegal move impossible to
 * reach, rather than merely rejected after the fact.
 */
export const GroupMovePicker: React.FC<{
  groups: ResourceGroup[];
  group: GroupNode;
  onPick: (parentGroupId: string | null) => void;
  onCancel: () => void;
}> = ({ groups, group, onPick, onCancel }) => {
  const destinations = useMemo(
    () => validGroupDestinations(groups, group.id),
    [groups, group.id],
  );
  return (
    <div className="mt-2 rounded-lg border border-border bg-bg-surface p-2" data-move-group-picker>
      <p className="text-[11px] font-semibold text-content-secondary px-1 pb-1">
        Move “{group.name}” into
      </p>
      <div className="max-h-52 overflow-y-auto">
        {destinations.map((d) => (
          <button
            key={d.id ?? '__root__'}
            onClick={() => onPick(d.id)}
            className="w-full flex items-center gap-2 px-2 min-h-[40px] rounded-lg text-xs text-content-secondary hover:bg-bg-elevated text-left"
            style={{ paddingLeft: `${8 + d.depth * 12}px` }}
          >
            <Folder className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{d.id === null ? 'Top level of the subject' : d.path}</span>
          </button>
        ))}
      </div>
      <button
        onClick={onCancel}
        className="w-full mt-1 px-2 min-h-[36px] rounded-lg text-[11px] text-content-tertiary hover:text-content-primary"
      >
        Cancel
      </button>
    </div>
  );
};

/**
 * The delete confirmation, which states exactly what moves up.
 *
 * Deleting a nested group does NOT delete its children or its resources: they
 * move to the deleted group's parent. The user needs to see those numbers
 * before pressing the second button, which is the whole point of the two-step
 * confirmation.
 */
const GroupDeleteConfirm: React.FC<{
  impact: ReturnType<typeof deleteImpact>;
  groupName: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ impact, groupName, onConfirm, onCancel }) => (
  <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5" data-group-delete-confirm>
    <p className="text-[11px] text-content-primary">
      Delete “{groupName}”?
      {impact.resources > 0 && ` ${impact.resources} resource(s) will be kept.`}
      {impact.childGroups > 0 && ` ${impact.childGroups} group(s) will be kept.`}
    </p>
    <p className="text-[11px] text-content-secondary mt-1">
      {impact.resources > 0 || impact.childGroups > 0
        ? `Nothing is lost. They move up to ${impact.newParentName ? `“${impact.newParentName}”` : 'the top level of the subject'}.`
        : 'This group is empty, so there is nothing else to move.'}
    </p>
    <div className="flex gap-2 mt-2">
      <button
        onClick={onConfirm}
        className="flex-1 px-3 min-h-[36px] rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
      >
        Delete group
      </button>
      <button
        onClick={onCancel}
        className="flex-1 px-3 min-h-[36px] rounded-lg border border-border text-xs font-semibold text-content-secondary"
      >
        Cancel
      </button>
    </div>
  </div>
);

export interface GroupTreeProps {
  subjectId: string;
  groups: ResourceGroup[];
  resources: Resource[];
  collapsedIds: Set<string>;
  onToggleCollapsed: (groupId: string) => void;
  renamingGroupId: string | null;
  onStartRename: (groupId: string | null) => void;
  onCommitRename: (groupId: string, name: string) => Promise<void>;
  onCreateGroup: (name: string, parentGroupId: string | null) => Promise<void>;
  /** The name is passed alongside the id so the toast can report which group. */
  onDeleteGroup: (groupId: string, name: string) => Promise<void>;
  onMoveGroup: (groupId: string, newParentGroupId: string | null) => Promise<void>;
  /** Renders the resources of one group. */
  renderResources: (groupId: string) => React.ReactNode;
  /** Renders the resources that belong to no group. */
  renderUngrouped: () => React.ReactNode;
}

/**
 * The indented, collapsible group tree.
 *
 * One flat render pass over the pre-flattened tree, indenting by depth. That is
 * what makes ANY depth work without a recursive component and without per-level
 * state: expanding is a Set of ids remembered by the parent, and the tree is
 * rebuilt from Dexie whenever a group is created, moved or deleted.
 *
 * Every action is a plain button with a 40px minimum, so the whole thing works
 * with a thumb and needs no drag and drop.
 */
export const GroupTree: React.FC<GroupTreeProps> = ({
  subjectId, groups, resources, collapsedIds, onToggleCollapsed,
  renamingGroupId, onStartRename, onCommitRename,
  onCreateGroup, onDeleteGroup, onMoveGroup, renderResources, renderUngrouped,
}) => {
  // `undefined` means the editor is closed; `null` means the TOP-level editor.
  const [addingUnder, setAddingUnder] = useState<string | null | undefined>(undefined);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of resources) {
      if (r.groupId) m.set(r.groupId, (m.get(r.groupId) ?? 0) + 1);
    }
    return m;
  }, [resources]);

  const tree = useMemo(() => buildGroupTree(groups, counts), [groups, counts]);
  const byId = useMemo(() => new Map(tree.map((n) => [n.id, n])), [tree]);

  // Close any open editor whose group vanished underneath it.
  useEffect(() => {
    if (deleteId && !byId.has(deleteId)) setDeleteId(null);
    if (moveId && !byId.has(moveId)) setMoveId(null);
  }, [byId, deleteId, moveId]);

  // Run a group write and SURFACE the failure, so a rejected move never looks
  // like it worked.
  const run = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast('error', `Could not ${label}`, e instanceof Error ? e.message : String(e));
    }
  };

  const hasUngrouped = resources.some((r) => !r.groupId);

  return (
    <div className="space-y-2.5" data-group-tree={subjectId}>
      {tree.length === 0 && !hasUngrouped && (
        <p className="text-[11px] text-content-tertiary italic">
          No groups yet. Use “New group” to add one.
        </p>
      )}

      {tree.map((node) => {
        const collapsed = collapsedIds.has(node.id);
        const open = addingUnder === node.id;
        const impact = deleteImpact(groups, node.id, counts);
        return (
          <div
            key={node.id}
            data-group-node={node.id}
            data-depth={node.depth}
            // Indentation, not nesting of boxes: the whole tree stays flat in the
            // DOM, so a deep tree cannot overflow its container. Capped at 4
            // steps because a fifth level on a 360px phone would leave no room
            // for the name.
            className="rounded-xl border border-border/70 bg-bg-elevated/20 p-2.5"
            style={{ marginLeft: `${Math.min(node.depth - 1, 4) * 12}px` }}
          >
            <div className="flex items-center gap-1 min-h-[40px]">
              <button
                onClick={() => onToggleCollapsed(node.id)}
                aria-expanded={!collapsed}
                aria-label={`${collapsed ? 'Expand' : 'Collapse'} group ${node.path}`}
                className="flex items-center gap-2 min-h-[40px] min-w-0 flex-1 text-left"
              >
                <ChevronRight
                  className={`w-3.5 h-3.5 shrink-0 text-content-tertiary transition-transform ${collapsed ? '' : 'rotate-90'}`}
                />
                <span className="text-xs font-semibold text-content-primary truncate">{node.name}</span>
                {/* Resources AND subgroups: a folder that only contains other
                    folders must not look empty. */}
                <span className="text-[10px] font-semibold text-content-tertiary shrink-0">
                  {node.totalResources + node.totalDescendantGroups}
                </span>
              </button>

              <button
                onClick={() => { setAddingUnder(open ? undefined : node.id); onStartRename(null); }}
                aria-label={`New subgroup inside ${node.path}`}
                title="New subgroup"
                className="p-2 rounded-lg shrink-0 text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setMoveId(moveId === node.id ? null : node.id); setAddingUnder(undefined); }}
                aria-label={`Move group ${node.path}`}
                title="Move group"
                className="p-2 rounded-lg shrink-0 text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
              >
                <FolderInput className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setAddingUnder(undefined); onStartRename(node.id); }}
                aria-label={`Rename group ${node.path}`}
                title="Rename group"
                className="p-2 rounded-lg shrink-0 text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setAddingUnder(undefined); setDeleteId(deleteId === node.id ? null : node.id); }}
                aria-label={`Delete group ${node.path}`}
                title="Delete group"
                className="p-2 rounded-lg shrink-0 text-content-tertiary hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {renamingGroupId === node.id && (
              <div className="mt-2">
                <GroupNameEditor
                  initialName={node.name}
                  placeholder="Group name"
                  submitLabel="Save"
                  onSubmit={(name) => { onStartRename(null); void onCommitRename(node.id, name); }}
                  onCancel={() => onStartRename(null)}
                />
              </div>
            )}

            {moveId === node.id && (
              <GroupMovePicker
                groups={groups}
                group={node}
                onCancel={() => setMoveId(null)}
                onPick={(parentId) => {
                  setMoveId(null);
                  void run('move group', () => onMoveGroup(node.id, parentId));
                }}
              />
            )}

            {deleteId === node.id && (
              <GroupDeleteConfirm
                impact={impact}
                groupName={node.path}
                onCancel={() => setDeleteId(null)}
                onConfirm={() => {
                  setDeleteId(null);
                  void run('delete group', () => onDeleteGroup(node.id, node.name));
                }}
              />
            )}

            {open && (
              <div className="mt-2">
                <GroupNameEditor
                  placeholder={`New subgroup in ${node.name}`}
                  submitLabel="Create"
                  onSubmit={(name) => {
                    setAddingUnder(undefined);
                    void run('create group', () => onCreateGroup(name, node.id));
                  }}
                  onCancel={() => setAddingUnder(undefined)}
                />
              </div>
            )}

            {!collapsed && (
              <div className="space-y-2.5 mt-2">
                {node.resourceCount === 0 && node.childGroupCount === 0
                  ? <p className="text-[11px] text-content-tertiary italic">This group is empty.</p>
                  : renderResources(node.id)}
              </div>
            )}
          </div>
        );
      })}

      {hasUngrouped && <div className="space-y-2.5">{renderUngrouped()}</div>}
    </div>
  );
};
