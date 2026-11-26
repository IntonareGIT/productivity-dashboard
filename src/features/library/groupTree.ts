import type { ResourceGroup } from '../../types';

/**
 * The ONE place the nested-group rules live.
 *
 * Both the Library UI and the AI tools import this, so a rule can never be
 * enforced in one place and forgotten in the other. Nothing here touches Dexie
 * or React: it takes rows in and returns plain data, which is what makes it
 * testable without a browser and usable from a tool with no DOM.
 */

/**
 * How deep nesting may go.
 *
 * A group at the subject root is depth 1, its child is depth 2, and so on. Five
 * leaves room for "Term / Module / Week / Lecture / Handout" while keeping the
 * indented tree readable on a phone, where each level costs horizontal space.
 */
export const MAX_GROUP_DEPTH = 5;

/**
 * The minimum shape these helpers need.
 *
 * `name` is included because error messages and pickers must be able to say
 * WHICH group they mean ("Lectures / Week 1"), and `subjectId` because the
 * same-subject rule is checked here. Any full `ResourceGroup` satisfies it.
 */
type GroupRef = Pick<ResourceGroup, 'id' | 'parentGroupId' | 'name' | 'subjectId'>;

/** The parent of a group, normalised so "missing" and null mean the same thing. */
export function parentOf(group: Pick<ResourceGroup, 'parentGroupId'>): string | null {
  const p = group.parentGroupId;
  return p == null || p === '' ? null : String(p);
}

function byId(groups: GroupRef[], id: string | null) {
  if (id == null) return undefined;
  return groups.find((g) => g.id === id);
}

/**
 * The direct children of a parent.
 *
 * `parentId === null` means "the top level of the subject", so this is the one
 * function that answers both "what is at the root" and "what is under X".
 */
export function getChildGroups(groups: GroupRef[], parentId: string | null): GroupRef[] {
  return groups.filter((g) => parentOf(g) === parentId);
}

/** Every ancestor of a group, NEAREST FIRST, excluding the group itself. */
export function getAncestors(groups: GroupRef[], groupId: string): GroupRef[] {
  const out: GroupRef[] = [];
  // `seen` bounds the walk, so even a corrupt cycle already in the data cannot
  // spin forever.
  const seen = new Set<string>([groupId]);
  let current = parentOf(byId(groups, groupId) ?? { parentGroupId: null });
  while (current != null && !seen.has(current)) {
    const g = byId(groups, current);
    if (!g) break;
    out.push(g);
    seen.add(current);
    current = parentOf(g);
  }
  return out;
}

/** Every descendant of a group at ANY depth, excluding the group itself. */
export function getDescendants(groups: GroupRef[], groupId: string): GroupRef[] {
  const out: GroupRef[] = [];
  const seen = new Set<string>([groupId]);
  const queue = [...getChildGroups(groups, groupId)];
  while (queue.length > 0) {
    const next = queue.shift() as GroupRef;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    out.push(next);
    queue.push(...getChildGroups(groups, next.id));
  }
  return out;
}

/** 1 for a top-level group, 2 for its child, and so on. 0 when unknown. */
export function depthOf(groups: GroupRef[], groupId: string): number {
  if (!byId(groups, groupId)) return 0;
  return getAncestors(groups, groupId).length + 1;
}

/** True when `newParentId` is the group itself or anywhere beneath it. */
export function wouldCreateCycle(
  groups: GroupRef[],
  groupId: string,
  newParentId: string | null,
): boolean {
  if (newParentId == null) return false;
  if (newParentId === groupId) return true;
  return getDescendants(groups, groupId).some((d) => d.id === newParentId);
}

/** How many levels a subtree occupies, used to check the depth limit. */
export function subtreeHeight(groups: GroupRef[], groupId: string): number {
  const kids = getChildGroups(groups, groupId);
  if (kids.length === 0) return 1;
  return 1 + Math.max(...kids.map((k) => subtreeHeight(groups, k.id)));
}

export interface GroupNode {
  id: string;
  name: string;
  /** 1 for a top-level group. */
  depth: number;
  parentGroupId: string | null;
  /** Direct child groups only. */
  childGroupCount: number;
  /** Resources directly inside it, not counting any subgroup's. */
  resourceCount: number;
  /** Every group beneath it, for the "(N)" badge. */
  totalDescendantGroups: number;
  totalResources: number;
  /** "Lectures / Week 1" — the subject is NOT included. */
  path: string;
  /** From the subject down, for a picker breadcrumb. */
  pathIds: string[];
}

/**
 * Flatten a subject's groups into an indented, ordered tree.
 *
 * Siblings are ordered by their stored `order` then by name, using a NATURAL
 * comparison so "Week 2" sorts before "Week 10" rather than after it.
 */
export function buildGroupTree(
  groups: ResourceGroup[],
  resourceCountByGroup: Map<string, number>,
): GroupNode[] {
  const out: GroupNode[] = [];

  const sortSiblings = (rows: ResourceGroup[]) =>
    [...rows].sort((a, b) =>
      (a.order ?? 0) - (b.order ?? 0)
      || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  const walk = (parentId: string | null, depth: number, pathNames: string[], pathIds: string[]) => {
    const children = sortSiblings(
      groups.filter((g) => parentOf(g) === parentId) as ResourceGroup[],
    );
    for (const g of children) {
      const descendants = getDescendants(groups, g.id);
      const own = resourceCountByGroup.get(g.id) ?? 0;
      let total = own;
      for (const d of descendants) total += resourceCountByGroup.get(d.id) ?? 0;
      const nextNames = [...pathNames, g.name];
      const nextIds = [...pathIds, g.id];
      out.push({
        id: g.id,
        name: g.name,
        depth,
        parentGroupId: parentId,
        childGroupCount: getChildGroups(groups, g.id).length,
        resourceCount: own,
        totalDescendantGroups: descendants.length,
        totalResources: total,
        path: nextNames.join(' / '),
        pathIds: nextIds,
      });
      walk(g.id, depth + 1, nextNames, nextIds);
    }
  };

  walk(null, 1, [], []);

  // A group whose parent is missing (a partial sync) would never be reached by
  // the walk above. Surface it at the root rather than hiding the user's group.
  const reached = new Set(out.map((n) => n.id));
  for (const g of groups) {
    if (reached.has(g.id)) continue;
    const parent = parentOf(g);
    if (parent != null && groups.some((x) => x.id === parent)) continue;
    const own = resourceCountByGroup.get(g.id) ?? 0;
    out.push({
      id: g.id, name: g.name, depth: 1, parentGroupId: null,
      childGroupCount: 0, resourceCount: own,
      totalDescendantGroups: 0, totalResources: own,
      path: g.name, pathIds: [g.id],
    });
  }
  return out;
}

/** The readable path for a group, used in error messages and in the pickers. */
export function pathOf(groups: ResourceGroup[], groupId: string | null): string {
  if (groupId == null) return '';
  const g = groups.find((x) => x.id === groupId);
  if (!g) return '';
  return [...getAncestors(groups, groupId).reverse().map((a) => a.name), g.name].join(' / ');
}

export interface GroupRuleViolation {
  field: 'parent' | 'cycle' | 'depth' | 'name' | 'subject';
  message: string;
}

/**
 * Validate a create, rename or move. Returns null when the change is allowed.
 *
 * `groups` is the subject's CURRENT groups. `selfId` is set when changing an
 * existing group, and is excluded from the sibling-name check so a group keeping
 * its own name is not treated as a conflict with itself.
 */
export function validateGroupPlacement(opts: {
  groups: ResourceGroup[];
  subjectId: string;
  name: string;
  parentGroupId: string | null;
  selfId?: string | null;
}): GroupRuleViolation | null {
  const { groups, subjectId, name, parentGroupId, selfId = null } = opts;
  const trimmed = (name ?? '').trim();
  if (!trimmed) return { field: 'name', message: 'A group name is required.' };

  if (parentGroupId != null) {
    const parent = groups.find((g) => g.id === parentGroupId);
    if (!parent) {
      return { field: 'parent', message: 'That parent group no longer exists. Pick another destination.' };
    }
    // A group in another subject would put a child where its resources cannot
    // follow, because a resource may only join a group of its own subject.
    if (parent.subjectId !== subjectId) {
      return {
        field: 'subject',
        message: 'A group cannot be moved to another subject. It belongs to the subject it was created in.',
      };
    }
  }

  if (selfId != null) {
    if (parentGroupId === selfId) {
      return { field: 'cycle', message: 'A group cannot be inside itself.' };
    }
    if (wouldCreateCycle(groups, selfId, parentGroupId)) {
      return {
        field: 'cycle',
        message: 'That destination is inside this group, so moving it there would create a loop. Pick a group outside it.',
      };
    }
  }

  // Depth is measured from the root: where this group would sit, plus however
  // far its own subtree already reaches below it.
  const parentDepth = parentGroupId == null ? 0 : depthOf(groups, parentGroupId);
  const myNewDepth = parentDepth + 1;
  const height = selfId != null ? subtreeHeight(groups, selfId) : 1;
  const deepest = myNewDepth + height - 1;
  if (deepest > MAX_GROUP_DEPTH) {
    return {
      field: 'depth',
      message: `Groups can be nested at most ${MAX_GROUP_DEPTH} levels deep, and this would reach level ${deepest}. Move it higher, or flatten part of the tree first.`,
    };
  }

  const key = trimmed.toLowerCase();
  const clash = groups.find((g) =>
    g.id !== selfId
    && parentOf(g) === parentGroupId
    && g.name.trim().toLowerCase() === key);
  if (clash) {
    return {
      field: 'name',
      message: parentGroupId == null
        ? `There is already a group called "${clash.name}" at the top level of this subject. Choose a different name.`
        : `There is already a group called "${clash.name}" in "${pathOf(groups, parentGroupId)}". Choose a different name.`,
    };
  }

  return null;
}

/**
 * What a delete will move up, so the confirmation can say it before it happens.
 *
 * Nothing is ever deleted except the group itself: its child groups move up to
 * its parent (becoming top-level when it was top-level), and the resources
 * inside it follow them to that same place.
 */
export function deleteImpact(
  groups: ResourceGroup[],
  groupId: string,
  resourceCountByGroup: Map<string, number>,
): { childGroups: number; resources: number; newParentId: string | null; newParentName: string | null } {
  const group = groups.find((g) => g.id === groupId);
  const newParentId = group ? parentOf(group) : null;
  // The direct children move up one level, and their own subtrees come with
  // them, so the count must include every descendant rather than just the
  // immediate children.
  let groupsMoving = 0;
  for (const c of getChildGroups(groups, groupId)) {
    groupsMoving += 1 + getDescendants(groups, c.id).length;
  }
  return {
    childGroups: groupsMoving,
    resources: resourceCountByGroup.get(groupId) ?? 0,
    newParentId,
    newParentName: newParentId ? (groups.find((g) => g.id === newParentId)?.name ?? null) : null,
  };
}

/**
 * The destinations a group may be moved to.
 *
 * Excludes the group itself and everything beneath it, which is what makes the
 * move picker incapable of even OFFERING an illegal move. `null` (the subject
 * root) is always allowed.
 */
export function validGroupDestinations(
  groups: ResourceGroup[],
  groupId: string,
): { id: string | null; name: string; depth: number; path: string }[] {
  const blocked = new Set<string>([groupId, ...getDescendants(groups, groupId).map((d) => d.id)]);
  const allowed = groups.filter((g) => !blocked.has(g.id));
  const tree = buildGroupTree(allowed, new Map());
  return [
    { id: null, name: 'Top level', depth: 0, path: 'Top level' },
    ...tree.map((n) => ({ id: n.id, name: n.name, depth: n.depth, path: n.path })),
  ];
}


