import { db } from '../../../db/db';
import type { Resource, ResourceGroup, Subject } from '../../../types';
import { previewKindFor } from '../previewKind';
import { getChildGroups, getDescendants, getAncestors, pathOf, parentOf } from '../groupTree';

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
 *
 * The tree rules themselves are NOT repeated here: parents, depths, paths and
 * sibling ordering all come from the shared `groupTree` module, which the
 * Library tree, the AI tools and this picker all read.
 */

export type PickerNodeKind = 'subject' | 'group' | 'resource';

/**
 * Which kind of file the calling viewer can OPEN.
 *
 * A prop rather than a hard-coded rule, because the PDF viewer and the image
 * viewer share one picker and must each only ever be offered what they can
 * actually render. Distinct from `PickerNodeKind`: that says what a ROW is, this
 * says what this viewer can open.
 */
export type PickerWant = 'pdf' | 'image';

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

/**
 * Recently opened files, newest first, capped. Session-scoped, in memory.
 *
 * It stores the RESOURCE, not just the id and name, so tapping a row can
 * actually open the file rather than being a dead label. The id is stored too
 * because a row's position is what makes de-duplication possible, and a
 * resource can be re-opened after its title is renamed.
 */
const RECENT_LIMIT = 5;
const recent: PickerNode[] = [];

/** Remember a file as recently opened, newest first, without duplicates. */
export function noteOpened(node: PickerNode): void {
  if (node.kind !== 'resource' || !node.resource) return;
  const i = recent.findIndex((r) => r.id === node.id);
  if (i >= 0) recent.splice(i, 1);
  recent.unshift(node);
  if (recent.length > RECENT_LIMIT) recent.length = RECENT_LIMIT;
}

/** The last few opened files, as picker nodes, newest first. */
export function getRecentNodes(): PickerNode[] {
  return recent.slice();
}

/** Why a file cannot be opened here, or null when it can. */
function disabledReasonFor(r: Resource, want: PickerWant): string | null {
  const kind = previewKindFor(r);
  // A blob lives on this device only if it is actually here. A row synced from
  // another device carries metadata but no bytes, and opening it would fail.
  // This check comes FIRST so the message names the real problem: a synced row
  // has no MIME to judge, so a type check first would report "Not a PDF" for a
  // file that simply is not here.
  if (!r.blob) return 'File not available on this device';
  if (want === 'pdf' && kind !== 'pdf') return 'Not a PDF';
  if (want === 'image' && kind !== 'image') return 'Not an image';
  return null;
}

/**
 * Whether a file should be LISTED at all for this viewer.
 *
 * A file of the wrong type is dropped rather than shown disabled: the PDF
 * viewer listing every PNG would bury the PDFs in a long list of rows that
 * cannot be opened. A file that is the RIGHT type but has no bytes on this
 * device is still listed, dimmed, because it is genuinely the file the user is
 * looking for and saying so is more use than hiding it.
 */
function listableFor(r: Resource, want: PickerWant): boolean {
  if (!r.blob) return true;
  const kind = previewKindFor(r);
  return want === 'pdf' ? kind === 'pdf' : kind === 'image';
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
 * The children of one node, or the root's subjects when `node` is null.
 *
 * A subject shows its top-level groups AND its ungrouped resources together, so
 * a subject with no folders goes straight to its files. A group shows its
 * subgroups and the resources directly inside it. An empty list is a legitimate
 * answer, not a failure.
 *
 * `node` is matched by KIND as well as id, because a group's id and a subject's
 * id are both plain strings and the caller may hold only a breadcrumb.
 */
export async function getChildren(
  node: PickerNode | null,
  want: PickerWant = 'pdf',
  currentResourceId?: string | null,
): Promise<PickerNode[]> {
  const { subjects, groups, resources } = await loadAll();

  // ---- the root: every subject
  if (!node) {
    return subjects.slice().sort(byName).map((s) => {
      const folders = groups.filter((g) => g.subjectId === s.id && parentOf(g) === null).length;
      const loose = resources.filter((r) => r.subjectId === s.id && !r.groupId && listableFor(r, want)).length;
      return {
        id: s.id, kind: 'subject' as const, name: s.name,
        childCount: folders + loose, path: s.name,
      };
    });
  }

  if (node.kind === 'subject' || node.kind === 'group') {
    const out: PickerNode[] = [];
    // Direct subgroups of this node. `getChildGroups` is the shared rule for
    // "the direct children of X", so the picker cannot drift from the Library
    // tree or the AI tools about what a child is.
    const childGroups = (node.kind === 'subject'
      ? groups.filter((g) => g.subjectId === node.id && parentOf(g) === null)
      : getChildGroups(groups, node.id)) as ResourceGroup[];
    // A stored `order` wins over the name when one exists, which is what the
    // brief asks for and what the Library tree already does; groups without one
    // fall back to the natural name comparison so "Week 2" beats "Week 10".
    childGroups.sort((a, b) =>
      ((a.order ?? 0) - (b.order ?? 0)) || byName(a, b));
    for (const g of childGroups) {
      // The badge counts everything a tap would reveal: subgroups AND the files
      // directly inside, counting only files this viewer can open.
      const kids = getChildGroups(groups, g.id).length
        + resources.filter((r) => r.groupId === g.id && listableFor(r, want)).length;
      out.push({
        id: g.id, kind: 'group', name: g.name, childCount: kids,
        path: node.kind === 'subject' ? g.name : (pathOf(groups, g.id) || g.name), group: g,
      });
    }
    // Resources directly in this node: ungrouped ones at a subject, or the
    // ones whose groupId is this group.
    const here = node.kind === 'subject'
      ? resources.filter((r) => r.subjectId === node.id && !r.groupId)
      : resources.filter((r) => r.groupId === node.id);
    for (const r of here) {
      if (!listableFor(r, want)) continue;
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
 *
 * A search is the one place a NOT-openable file is never shown at all. Searching
 * "slides" and being handed a row that cannot open is worse than no result,
 * because the list looks like it is doing its job.
 */
export async function searchAll(
  query: string,
  want: PickerWant = 'pdf',
  currentResourceId?: string | null,
): Promise<PickerNode[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const { subjects, groups, resources } = await loadAll();
  const out: PickerNode[] = [];

  // Subjects too: the brief asks for one box that searches every subject and
  // group at once, and a subject whose NAME matches is a legitimate hit.
  for (const s of subjects) {
    if (!s.name.toLowerCase().includes(q)) continue;
    if (!subjectHasOpenable(s.id, groups, resources, want)) continue;
    out.push({ id: s.id, kind: 'subject', name: s.name, childCount: 0, path: s.name });
  }

  for (const g of groups) {
    if (!g.name.toLowerCase().includes(q)) continue;
    if (groupHoldsNothingOpenable(g, groups, resources, want)) continue;
    out.push({
      id: g.id, kind: 'group', name: g.name, childCount: 0,
      path: pathOf(groups, g.id) || g.name, group: g,
    });
  }
  for (const r of resources) {
    if (!r.title.toLowerCase().includes(q)) continue;
    if (!listableFor(r, want) || disabledReasonFor(r, want)) continue;
    out.push({
      id: r.id, kind: 'resource', name: r.title, childCount: 0,
      path: fullPath(subjects, groups, r), resource: r,
      isCurrent: r.id === currentResourceId,
    });
  }
  // Files first: someone searching is usually after a file, not a folder. Then
  // groups, then subjects, each naturally sorted.
  const rank = (k: PickerNodeKind) => (k === 'resource' ? 0 : k === 'group' ? 1 : 2);
  return out.sort((a, b) => (a.kind === b.kind ? byName(a, b) : rank(a.kind) - rank(b.kind)));
}

/**
 * Whether anything under a group (at ANY depth) is openable by this viewer.
 *
 * The whole subtree is walked, not just the direct children, because a group
 * whose only files sit two levels down is very much worth offering.
 */
function groupHoldsNothingOpenable(
  g: ResourceGroup,
  groups: ResourceGroup[],
  resources: Resource[],
  want: PickerWant,
): boolean {
  const inside = new Set<string>([g.id, ...getDescendants(groups, g.id).map((d) => d.id)]);
  return !resources.some((r) => inside.has(r.groupId ?? '')
    && listableFor(r, want) && !disabledReasonFor(r, want));
}

/** The same question for a whole subject. */
function subjectHasOpenable(
  subjectId: string,
  groups: ResourceGroup[],
  resources: Resource[],
  want: PickerWant,
): boolean {
  const ids = new Set<string>(groups.filter((g) => g.subjectId === subjectId).map((g) => g.id));
  const inSubject = resources.filter((r) => r.subjectId === subjectId);
  const loose = inSubject.some((r) => !r.groupId && listableFor(r, want) && !disabledReasonFor(r, want));
  const grouped = inSubject.some((r) => ids.has(r.groupId ?? '')
    && listableFor(r, want) && !disabledReasonFor(r, want));
  return loose || grouped || ids.size > 0;
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

/* ===== the last place the picker was left, per session ===== */

/**
 * Where the picker was last time it was opened, keyed by the caller's slot.
 *
 * The brief asks for two fallbacks in order: the currently open file's location
 * first, and if nothing is open, the last used location. Keyed rather than a
 * single global, because each split pane has its OWN selection and its own
 * remembered place, so pane 1 being in Thermodynamics must never move pane 2.
 */
const lastLocations = new Map<string, PickerNode[]>();

/** Remember where a slot left the picker. */
export function rememberLocation(slotKey: string, path: PickerNode[]): void {
  // A path of just the root is not a place worth returning to.
  if (path.length === 0) return;
  lastLocations.set(slotKey, path.slice());
}

/** The remembered path for a slot, or null when there is not one yet. */
export function lastLocation(slotKey: string): PickerNode[] | null {
  return lastLocations.get(slotKey)?.slice() ?? null;
}

/** The label for a resource: its title with its full path beside it. */
export async function labelForResource(resourceId: string): Promise<{ title: string; path: string } | null> {
  const { subjects, groups, resources } = await loadAll();
  const r = resources.find((x) => x.id === resourceId);
  if (!r) return null;
  return { title: r.title, path: fullPath(subjects, groups, r) };
}