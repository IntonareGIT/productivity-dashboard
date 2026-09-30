import { db } from '../../db/db';
import { DEFAULT_NOTE_TITLE } from '../../db/noteTitle';
import type { Assessment, AssessmentStatus, AssessmentType, Resource, ResourceGroup, ResourceKind, Subject, Topic, TopicStatus } from '../../types';
import { newId } from '../../utils/id';

/* ---------------- Subjects ---------------- */

export interface SubjectInput {
  id?: string; // present = update
  name: string;
  description?: string;
  color: string;
  notes?: string;
}

export async function saveSubject(input: SubjectInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('Subject name is required');

  if (input.id) {
    const existing = await db.subjects.get(input.id);
    if (existing) {
      await db.subjects.put({
        ...existing,
        name,
        description: input.description?.trim() || undefined,
        color: input.color,
        notes: input.notes ?? existing.notes,
        updatedAt: new Date().toISOString(),
      });
      await ensureDefaultTopic(existing.id);
      return existing.id;
    }
  }

  const now = new Date().toISOString();
  const id = newId();
  const record: Subject = {
    id,
    name,
    description: input.description?.trim() || undefined,
    color: input.color,
    notes: input.notes ?? '',
    createdAt: now,
    updatedAt: now,
  };
  await db.subjects.put(record);
  await ensureDefaultTopic(id);
  return id;
}

export async function updateSubjectNotes(id: string, notes: string): Promise<void> {
  const existing = await db.subjects.get(id);
  if (!existing) return;
  await db.subjects.put({ ...existing, notes, updatedAt: new Date().toISOString() });
}

/** Delete subject + topics/groups/resources/assessments/events; unlink pomodoro sessions. */
export async function deleteSubjectCascade(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.subjects, db.topics, db.resources, db.resourceGroups, db.assessments, db.calendarEvents, db.pomodoroSessions],
    async () => {
      const res = await db.resources.where('subjectId').equals(id).toArray();
      if (res.length > 0) await db.resources.bulkDelete(res.map((r) => r.id));
      // Groups belong to a subject and go with it. The resources above are
      // deleted too, so nothing is left pointing at a removed group.
      const groups = await db.resourceGroups.where('subjectId').equals(id).toArray();
      if (groups.length > 0) await db.resourceGroups.bulkDelete(groups.map((g) => g.id));
      const asm = await db.assessments.where('subjectId').equals(id).toArray();
      if (asm.length > 0) await db.assessments.bulkDelete(asm.map((a) => a.id));
      const top = await db.topics.where('subjectId').equals(id).toArray();
      if (top.length > 0) await db.topics.bulkDelete(top.map((t) => t.id));
      const ev = await db.calendarEvents.where('subjectId').equals(id).toArray();
      if (ev.length > 0) await db.calendarEvents.bulkDelete(ev.map((e) => e.id));
      const sess = await db.pomodoroSessions.where('subjectId').equals(id).toArray();
      for (const s of sess) await db.pomodoroSessions.put({ ...s, subjectId: null, topicId: null });
      await db.subjects.delete(id);
    }
  );
}

/* ---------------- Topics ---------------- */

export interface TopicInput {
  id?: string;
  subjectId: string;
  title: string;
  notes?: string;
  status?: TopicStatus;
  order?: number;
}

export async function saveTopic(input: TopicInput): Promise<string> {
  const title = input.title.trim();
  if (!title) throw new Error('Topic title is required');
  if (!input.subjectId) throw new Error('subjectId is required');
  const subject = await db.subjects.get(input.subjectId);
  if (!subject) throw new Error('Subject not found');
  if (input.id) {
    const existing = await db.topics.get(input.id);
    if (existing) {
      await db.topics.put({
        ...existing,
        subjectId: input.subjectId,
        title,
        notes: input.notes ?? existing.notes,
        status: input.status ?? existing.status,
        order: input.order ?? existing.order,
        updatedAt: new Date().toISOString(),
      });
      return existing.id;
    }
  }
  const now = new Date().toISOString();
  const siblings = await db.topics.where('subjectId').equals(input.subjectId).toArray();
  const maxOrder = siblings.reduce((m, t) => Math.max(m, t.order ?? 0), -1);
  const record: Topic = {
    id: newId(),
    subjectId: input.subjectId,
    title,
    notes: input.notes ?? '',
    status: input.status ?? 'not_started',
    order: input.order ?? maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.topics.put(record);
  return record.id;
}

export async function updateTopicNotes(id: string, notes: string): Promise<void> {
  const existing = await db.topics.get(id);
  if (!existing) return;
  await db.topics.put({ ...existing, notes, updatedAt: new Date().toISOString() });
}

export async function setTopicStatus(id: string, status: TopicStatus): Promise<void> {
  const existing = await db.topics.get(id);
  if (!existing) return;
  await db.topics.put({ ...existing, status, updatedAt: new Date().toISOString() });
}

/**
 * Rename a note. An empty title falls back to the default rather than being
 * saved blank, so a note is never left with no label in a list.
 */
export async function setTopicTitle(id: string, title: string): Promise<void> {
  const existing = await db.topics.get(id);
  if (!existing) return;
  const next = title.trim() || DEFAULT_NOTE_TITLE;
  if (next === existing.title) return;
  await db.topics.put({ ...existing, title: next, updatedAt: new Date().toISOString() });
}

export async function deleteTopicCascade(id: string): Promise<void> {
  await db.transaction('rw', [db.topics, db.resources, db.pomodoroSessions], async () => {
    const res = await db.resources.where('topicId').equals(id).toArray();
    if (res.length > 0) await db.resources.bulkDelete(res.map((r) => r.id));
    const sess = await db.pomodoroSessions.where('topicId').equals(id).toArray();
    for (const s of sess) await db.pomodoroSessions.put({ ...s, topicId: null });
    await db.topics.delete(id);
  });
}

export async function ensureDefaultTopic(subjectId: string): Promise<string> {
  const existing = await db.topics.where('subjectId').equals(subjectId).sortBy('order');
  if (existing.length > 0) return existing[0].id;
  const subject = await db.subjects.get(subjectId);
  const now = new Date().toISOString();
  const record: Topic = {
    id: newId(),
    subjectId,
    // A real, editable default rather than the generic 'General' placeholder
    // that made every note look identical in lists and headers.
    title: DEFAULT_NOTE_TITLE,
    notes: subject?.notes ?? '',
    status: 'not_started',
    order: 0,
    createdAt: subject?.createdAt ?? now,
    updatedAt: now,
  };
  await db.topics.put(record);
  const legacy = await db.resources.where('subjectId').equals(subjectId).toArray();
  for (const r of legacy) {
    if (r.topicId === undefined || r.topicId === null) {
      await db.resources.put({ ...r, topicId: record.id, kind: r.kind ?? 'link' });
    }
  }
  return record.id;
}

/* ---------------- Resources (v5) ---------------- */

export interface ResourceInput {
  id?: string; // present = update
  subjectId: string;
  topicId?: string | null;
  kind?: ResourceKind;
  title: string;
  /** Mandatory for kind 'link', omitted for kind 'file'. See Resource.urlOrPath. */
  urlOrPath?: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  blob?: Blob | null;
  tags?: string[];
  dueDate?: string | null;
  completed?: boolean;
  /** Target group; null/undefined leaves the resource ungrouped. */
  groupId?: string | null;
}

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return (tags as unknown[]).map((t) => String(t).trim()).filter(Boolean);
}

/**
 * Resolve a requested group to one that actually exists AND belongs to
 * `subjectId`. Anything else yields null, so a bad id can never leave a resource
 * pointing at a foreign or missing group.
 */
async function validGroupFor(subjectId: string, groupId: string | null | undefined): Promise<string | null> {
  if (!groupId) return null;
  const group = await db.resourceGroups.get(groupId);
  if (!group || group.subjectId !== subjectId) return null;
  return group.id;
}

export async function saveResource(input: ResourceInput): Promise<string> {
  const title = (input.title ?? '').trim();
  if (!title) throw new Error('Resource title is required');
  if (!input.subjectId) throw new Error('subjectId is required');
  const kind: ResourceKind = input.kind ?? 'link';
  const tags = cleanTags(input.tags);
  const dueDate = input.dueDate && input.dueDate.trim() ? input.dueDate.trim() : null;
  let urlOrPath = (input.urlOrPath ?? '').trim();
  if (kind === 'link' && !urlOrPath) throw new Error('A URL or file path is required');
  let topicId: string | null = input.topicId ?? null;
  if (input.id && !topicId) {
    const prev = await db.resources.get(input.id);
    if (prev?.topicId) topicId = prev.topicId;
  }
  if (!topicId) topicId = await ensureDefaultTopic(input.subjectId);
  if (input.id) {
    const existing = await db.resources.get(input.id);
    if (existing) {
      if (kind === 'file' && !urlOrPath) urlOrPath = existing.urlOrPath ?? '';
      // A group belongs to exactly one subject, so a resource that changes
      // subject can no longer stay in its old group: clear `groupId`. Same for
      // a change of topic, since grouping is per-subject and the resource is
      // re-homed within the Library.
      const subjectChanged = existing.subjectId !== input.subjectId;
      const groupId = subjectChanged ? null : (input.groupId !== undefined ? input.groupId : existing.groupId ?? null);
      await db.resources.put({
        ...existing,
        subjectId: input.subjectId,
        topicId,
        groupId,
        kind,
        title,
        urlOrPath,
        fileName: input.fileName !== undefined ? input.fileName : existing.fileName,
        mimeType: input.mimeType !== undefined ? input.mimeType : existing.mimeType,
        fileSize: input.fileSize !== undefined ? input.fileSize : existing.fileSize,
        blob: input.blob !== undefined ? input.blob : existing.blob,
        tags,
        dueDate,
        completed: input.completed ?? existing.completed ?? false,
      });
      return existing.id;
    }
  }
  const record: Resource = {
    id: newId(),
    subjectId: input.subjectId,
    topicId,
    // Only honour an incoming group if it really belongs to this subject —
    // otherwise the row would violate the one-group invariant from birth.
    groupId: await validGroupFor(input.subjectId, input.groupId),
    kind,
    title,
    urlOrPath,
    fileName: input.fileName ?? null,
    mimeType: input.mimeType ?? null,
    fileSize: input.fileSize ?? null,
    blob: input.blob ?? null,
    tags,
    dueDate,
    completed: input.completed ?? false,
    createdAt: new Date().toISOString(),
  };
  await db.resources.put(record);
  return record.id;
}

export function resourceObjectUrl(resource: Resource): string | null {
  if (resource.blob && typeof Blob !== 'undefined' && resource.blob instanceof Blob) {
    return URL.createObjectURL(resource.blob);
  }
  if (resource.urlOrPath && resource.urlOrPath.trim()) return resource.urlOrPath;
  return null;
}

export async function toggleResourceCompleted(resource: Resource): Promise<void> {
  const cur = (await db.resources.get(resource.id)) ?? resource;
  await db.resources.put({ ...cur, completed: !(cur.completed ?? false) });
}

export async function deleteResource(id: string): Promise<void> {
  await db.resources.delete(id);
}

/* ---------------- Resource groups (v10) ---------------- */

/**
 * A group is a lane over resources inside ONE subject. A resource keeps its own
 * `topicId` while grouped, so `groupId` and `topicId` are independent axes.
 */

export interface ResourceGroupInput {
  id?: string; // present = update (rename / reorder)
  subjectId: string;
  name: string;
  order?: number;
}

/** The next `order` for a group in this subject — appended to the end. */
export async function nextGroupOrder(subjectId: string): Promise<number> {
  const existing = await db.resourceGroups.where('subjectId').equals(subjectId).toArray();
  return existing.reduce((max, g) => Math.max(max, g.order ?? 0), -1) + 1;
}

export async function saveResourceGroup(input: ResourceGroupInput): Promise<string> {
  const name = (input.name ?? '').trim();
  if (!name) throw new Error('Group name is required');
  if (!input.subjectId) throw new Error('subjectId is required');
  const subject = await db.subjects.get(input.subjectId);
  if (!subject) throw new Error('Subject not found');

  if (input.id) {
    const existing = await db.resourceGroups.get(input.id);
    if (existing) {
      // A group can never be re-homed to another subject: its members are, by
      // definition, resources of that subject. Treat it as a rename/reorder.
      await db.resourceGroups.put({
        ...existing,
        name,
        order: input.order ?? existing.order,
      });
      return existing.id;
    }
  }

  const record: ResourceGroup = {
    id: newId(),
    subjectId: input.subjectId,
    name,
    order: input.order ?? (await nextGroupOrder(input.subjectId)),
    createdAt: new Date().toISOString(),
  };
  await db.resourceGroups.put(record);
  return record.id;
}

/** Rename a group in place. An empty name is rejected rather than saved blank. */
export async function renameResourceGroup(id: string, name: string): Promise<void> {
  const next = (name ?? '').trim();
  if (!next) return;
  const existing = await db.resourceGroups.get(id);
  if (!existing || existing.name === next) return;
  await db.resourceGroups.put({ ...existing, name: next });
}

/** Persist a manual reorder. Takes the full ordered id list. */
export async function reorderResourceGroups(subjectId: string, orderedIds: string[]): Promise<void> {
  await db.transaction('rw', db.resourceGroups, async () => {
    for (let i = 0; i < orderedIds.length; i += 1) {
      const g = await db.resourceGroups.get(orderedIds[i]);
      // Only rewrite rows of THIS subject, so a stale list cannot reorder
      // another subject's groups.
      if (g && g.subjectId === subjectId) await db.resourceGroups.put({ ...g, order: i });
    }
  });
}

/**
 * Delete a group and UNGROUP its resources.
 *
 * The resources are never deleted — losing a folder must not lose the work in
 * it — so every member simply has `groupId` cleared.
 */
export async function deleteResourceGroup(id: string): Promise<void> {
  await db.transaction('rw', [db.resourceGroups, db.resources], async () => {
    const members = await db.resources.where('groupId').equals(id).toArray();
    for (const r of members) await db.resources.put({ ...r, groupId: null });
    await db.resourceGroups.delete(id);
  });
}

/** Move one resource into a group (or out of it, with `null`). */
export async function moveResourceToGroup(resourceId: string, groupId: string | null): Promise<void> {
  const resource = await db.resources.get(resourceId);
  if (!resource) return;
  if (groupId === null) {
    if (!resource.groupId) return;
    await db.resources.put({ ...resource, groupId: null });
    return;
  }
  const group = await db.resourceGroups.get(groupId);
  if (!group) return;
  // The one invariant that matters: only same-subject resources may be grouped.
  if (group.subjectId !== resource.subjectId) return;
  if (resource.groupId === groupId) return;
  await db.resources.put({ ...resource, groupId });
}

/** Move several resources at once, skipping any that would cross a subject. */
export async function moveResourcesToGroup(resourceIds: string[], groupId: string | null): Promise<void> {
  if (resourceIds.length === 0) return;
  await db.transaction('rw', [db.resourceGroups, db.resources], async () => {
    const group = groupId ? await db.resourceGroups.get(groupId) : null;
    for (const id of resourceIds) {
      const r = await db.resources.get(id);
      if (!r) continue;
      if (groupId === null) { await db.resources.put({ ...r, groupId: null }); continue; }
      if (!group || group.subjectId !== r.subjectId) continue;
      await db.resources.put({ ...r, groupId });
    }
  });
}

/** Groups of a subject, in display order. */
export async function listResourceGroups(subjectId: string): Promise<ResourceGroup[]> {
  const rows = await db.resourceGroups.where('subjectId').equals(subjectId).toArray();
  return rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt));
}

/* ---------------- Assessments ---------------- */

export interface AssessmentInput {
  id?: string;
  subjectId: string;
  name: string;
  type: AssessmentType;
  date: string;
  weight?: number | null;
  status?: AssessmentStatus;
}

export async function saveAssessment(input: AssessmentInput): Promise<string> {
  const name = (input.name ?? '').trim();
  if (!name) throw new Error('Assessment name is required');
  if (!input.subjectId) throw new Error('subjectId is required');
  const date = (input.date ?? '').trim();
  if (!date) throw new Error('Assessment date is required');
  const type: AssessmentType = input.type ?? 'exam';
  const status: AssessmentStatus = input.status ?? 'upcoming';
  const weight = input.weight ?? null;
  if (input.id) {
    const existing = await db.assessments.get(input.id);
    if (existing) {
      await db.assessments.put({ ...existing, subjectId: input.subjectId, name, type, date, weight, status });
      return existing.id;
    }
  }
  const record: Assessment = {
    id: newId(),
    subjectId: input.subjectId,
    name,
    type,
    date,
    weight,
    status,
    createdAt: new Date().toISOString(),
  };
  await db.assessments.put(record);
  return record.id;
}

export async function toggleAssessmentStatus(assessment: Assessment): Promise<void> {
  const cur = (await db.assessments.get(assessment.id)) ?? assessment;
  const next: AssessmentStatus = cur.status === 'done' ? 'upcoming' : 'done';
  await db.assessments.put({ ...cur, status: next });
}

export async function deleteAssessment(id: string): Promise<void> {
  await db.assessments.delete(id);
}
