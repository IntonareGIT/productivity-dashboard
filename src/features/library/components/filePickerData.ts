import { db } from '../../../db/db';
import type { Resource, ResourceGroup, Subject } from '../../../types';
import { previewKindFor } from '../previewKind';
import { getChildGroups, getAncestors, pathOf, parentOf } from '../groupTree';

/**
 * The picker's DATA logic, in one file.
 *
 * The UI calls `getChildren` and `pathOf` and never touches a Dexie table. That
 * is the whole point: the navigation is a PATH (an array of nodes from the
 * root) rather than one variable per level, so any depth works with the same
 * code and a deeper folder needs no new state.
 *
 * Naming files like "1-introduction" only works if the picker shows WHERE the
 * file is, so every resource node carries its full path back to the subject.
 */

export type PickerNodeKind = 'subject' | 'group' | 'resource';

export interface PickerNode {
  id: string;
  kind: PickerNodeKind;
  name: string;
  /** Groups + files directly inside, for the "(N)" badge. */
  childCount: number;
  /** Set when the row cannot be opened, with the reason to show. */
  disabledReason?: string;
  /** Readable path from the subject down, e.g. "Lectures / Week 1". */
  path: string;
  resource?: Resource;
  group?: ResourceGroup;
  /** True when this node is the currently open resource. */
  isCurrent?: boolean;
}

/** Recently opened files, newest first, capped. Session-scoped, in memory. */
const RECENT_LIMIT = 5;
const recent: { id: string; name: string; path: string }[] = [];

/** Remember a file as recently opened, newest first, without duplicates. */
export function noteOpened(node: PickerNode): void {
  if (node.kind !== 'resource' || !node.resource) return;
  const i = recent.findIndex((r) => r.id === node.id);
  if (i >= 0) recent.splice(i, 1);
  recent.unshift({ id: node.id, name: node.name, path: node.path });
  if (recent.length > RECENT_LIMIT) recent.length = RECENT_LIMIT;
}

/** The last few opened files, as picker nodes. */
export function getRecentNodes(): PickerNode[] {
  return recent.map((r) => ({
    id: r.id, kind: 'resource' as const, name: r.name, path: r.path, childCount: 0,
  }));
}

/** Why a file cannot be opened here, or null when it can. */
function disabledReasonFor(r: Resource, want: PickerNodeKind): string | null {
  const kind = previewKindFor(r);
  // A blob lives on this device only if it is actually here. A row synced from
  // another device carries metadata but no bytes, and opening it would fail.
  if (!r.blob) return 'File not available on this device';
  if (want === 'group' && kind !== 'pdf') return 'Not a PDF';
  if (want === 'resource' && kind !== 'image') return 'Not an image';
  return null;
}

/** Natural comparison, so "Week 2" sorts before "Week 10". */
const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** Everything the picker needs, read once per open. */
async function loadAll() {
  const [subjects, groups, resources] = await Promise.all([
    db.subjects.toArray(),
    db.resourceGroups.toArray(),
    db.resources.toArray(),
  ]);
  return { subjects, groups, resources };
}

/** "Subject / Lectures / Week 1" for one resource. */
function fullPath(subjects: Subject[], groups: ResourceGroup[], r: Resource): string {
  const subjectName = subjects.find((s) => s.id === r.subjectId)?.name ?? '';
  const g = r.groupId ? groups.find((x) => x.id === r.groupId) : null;
  const gPath = g ? pathOf(groups, g.id) : '';
  return [subjectName, gPath].filter(Boolean).join(' / ');
}

/**
 * The children of one node.
 *
 * A subject shows its top-level groups AND its ungrouped resources together, so
 * a subject with no folders goes straight to its files. A group shows its
 * subgroups and the resources directly inside it. An empty list is a legitimate
 * answer, not a failure.
 */
export async function getChildren(
  node: PickerNode | null,
  want: PickerNodeKind = 'subject',
  currentResourceId?: string | null,
): Promise<PickerNode[]> {
  const { subjects, groups, resources } = await loadAll();

  // ---- the root: every subject
  if (!node) {
    return subjects.slice().sort(byName).map((s) => {
      const folders = groups.filter((g) => g.subjectId === s.id && parentOf(g) === null).length;
      const loose = resources.filter((r) => r.subjectId === s.id && !r.groupId).length;
      return {
        id: s.id, kind: 'subject' as const, name: s.name,
        childCount: folders + loose, path: s.name,
      };
    });
  }

  if (node.kind === 'subject' || node.kind === 'group') {
    const out: PickerNode[] = [];
    // Direct subgroups of this node.
    const childGroups = (node.kind === 'subject'
      ? groups.filter((g) => g.subjectId === node.id && parentOf(g) === null)
      : getChildGroups(groups, node.id)) as ResourceGroup[];
    for (const g of childGroups) {
      const own = resources.filter((r) => r.groupId === g.id).length;
      out.push({
        id: g.id, kind: 'group', name: g.name, childCount: own,
        path: node.kind === 'subject' ? g.name : (pathOf(groups, g.id) || g.name), group: g,
      });
    }
    // Resources directly in this node: ungrouped ones at a subject, or the
    // ones whose groupId is this group.
    const here = node.kind === 'subject'
      ? resources.filter((r) => r.subjectId === node.id && !r.groupId)
      : resources.filter((r) => r.groupId === node.id);
    for (const r of here) {
      const disabled = disabledReasonFor(r, want);
      out.push({
        id: r.id, kind: 'resource', name: r.title, childCount: 0,
        path: fullPath(subjects, groups, r), resource: r,
        disabledReason: disabled ?? undefined,
        isCurrent: r.id === currentResourceId,
      });
    }
    // Groups first (they are the way down), then files, each naturally sorted.
    return out.sort((a, b) => (a.kind === b.kind ? byName(a, b) : a.kind === 'group' ? -1 : 1));
  }

  // A resource has nothing inside it.
  return [];
}

/**
 * Search every subject and group at once.
 *
 * The point of the whole picker: two files called "1-introduction" must be
 * distinguishable, so each hit carries its full path underneath the name.
 */
export async function searchAll(
  query: string,
  want: PickerNodeKind = 'subject',
  currentResourceId?: string | null,
): Promise<PickerNode[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const { subjects, groups, resources } = await loadAll();
  const out: PickerNode[] = [];

  for (const g of groups) {
    if (!g.name.toLowerCase().includes(q)) continue;
    if (disabledReasonForGroup(g, groups, resources, want)) continue;
    out.push({
      id: g.id, kind: 'group', name: g.name, childCount: 0,
      path: pathOf(groups, g.id) || g.name, group: g,
    });
  }
  for (const r of resources) {
    if (!r.title.toLowerCase().includes(q)) continue;
    const disabled = disabledReasonFor(r, want);
    if (disabled) continue;
    out.push({
      id: r.id, kind: 'resource', name: r.title, childCount: 0,
      path: fullPath(subjects, groups, r), resource: r,
      isCurrent: r.id === currentResourceId,
    });
  }
  // Files first: someone searching is usually after a file, not a folder.
  return out.sort((a, b) => (a.kind === b.kind ? byName(a, b) : a.kind === 'resource' ? -1 : 1));
}

/** A group that holds nothing the viewer can open is not worth showing. */
function disabledReasonForGroup(
  g: ResourceGroup,
  groups: ResourceGroup[],
  resources: Resource[],
  want: PickerNodeKind,
): string | null {
  const ids = [g.id, ...getChildGroups(groups, g.id).map((c) => c.id)];
  const inside = resources.filter((r) => ids.includes(r.groupId ?? ''));
  return inside.some((r) => !disabledReasonFor(r, want))
    ? null
    : 'Nothing here this viewer can open';
}

/**
 * The path from the subject down to a resource, as picker nodes.
 *
 * Used to OPEN the picker at the currently open file, so picking a neighbour is
 * one tap rather than a walk down from the root.
 */
export async function pathToResource(resourceId: string): Promise<PickerNode[]> {
  const { subjects, groups, resources } = await loadAll();
  const r = resources.find((x) => x.id === resourceId);
  if (!r) return [];
  const subject = subjects.find((s) => s.id === r.subjectId);
  if (!subject) return [];
  const out: PickerNode[] = [{
    id: subject.id, kind: 'subject', name: subject.name, childCount: 0, path: subject.name,
  }];
  if (r.groupId) {
    // `getAncestors` returns the minimal GroupRef shape, so every row is
    // re-read from the full list: the payload must be a real ResourceGroup.
    // The group's OWN row is included, not just its ancestors; leaving it out
    // made the picker open one level too high, so the currently open file was
    // not on screen and the highlight had nothing to mark.
    const ids = [...getAncestors(groups, r.groupId)].reverse().map((g) => g.id);
    ids.push(r.groupId);
    for (const id of ids) {
      const g = groups.find((x) => x.id === id);
      if (!g) continue;
      out.push({
        id: g.id, kind: 'group', name: g.name, childCount: 0,
        path: pathOf(groups, g.id) || g.name, group: g,
      });
    }
  }
  return out;
}