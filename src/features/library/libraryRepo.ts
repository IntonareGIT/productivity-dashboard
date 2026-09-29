import { db } from '../../db/db';
import type { Assessment, AssessmentStatus, AssessmentType, Resource, ResourceKind, Subject, Topic, TopicStatus } from '../../types';
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

/** Delete subject + topics/resources/assessments/events; unlink pomodoro sessions. */
export async function deleteSubjectCascade(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.subjects, db.topics, db.resources, db.assessments, db.calendarEvents, db.pomodoroSessions],
    async () => {
      const res = await db.resources.where('subjectId').equals(id).toArray();
      if (res.length > 0) await db.resources.bulkDelete(res.map((r) => r.id));
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
    title: 'General',
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
}

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return (tags as unknown[]).map((t) => String(t).trim()).filter(Boolean);
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
      await db.resources.put({
        ...existing,
        subjectId: input.subjectId,
        topicId,
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
