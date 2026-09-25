import { db } from '../../db/db';
import type { Resource, Subject } from '../../types';
import { newId } from '../../utils/id';

/* ---------------- Subjects ---------------- */

export interface SubjectInput {
  id?: string; // present = update
  name: string;
  description?: string;
  color: string;
  notes?: string;
}

export async function saveSubject(input: SubjectInput): Promise<void> {
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
      return;
    }
  }

  const now = new Date().toISOString();
  const record: Subject = {
    id: newId(),
    name,
    description: input.description?.trim() || undefined,
    color: input.color,
    notes: input.notes ?? '',
    createdAt: now,
    updatedAt: now,
  };
  await db.subjects.put(record);
}

export async function updateSubjectNotes(id: string, notes: string): Promise<void> {
  const existing = await db.subjects.get(id);
  if (!existing) return;
  await db.subjects.put({ ...existing, notes, updatedAt: new Date().toISOString() });
}

/** Delete a subject and all of its resources. */
export async function deleteSubjectCascade(id: string): Promise<void> {
  const resources = await db.resources.where('subjectId').equals(id).toArray();
  if (resources.length > 0) {
    await db.resources.bulkDelete(resources.map((r) => r.id));
  }
  await db.subjects.delete(id);
}

/* ---------------- Resources ---------------- */

export interface ResourceInput {
  id?: string; // present = update
  subjectId: string;
  title: string;
  urlOrPath: string;
  tags: string[];
  dueDate?: string | null;
}

export async function saveResource(input: ResourceInput): Promise<void> {
  const title = input.title.trim();
  const urlOrPath = input.urlOrPath.trim();
  if (!title) throw new Error('Resource title is required');
  if (!urlOrPath) throw new Error('A URL or file path is required');

  const tags = input.tags.map((t) => t.trim()).filter(Boolean);

  if (input.id) {
    const existing = await db.resources.get(input.id);
    if (existing) {
      await db.resources.put({
        ...existing,
        title,
        urlOrPath,
        tags,
        dueDate: input.dueDate || null,
      });
      return;
    }
  }

  const record: Resource = {
    id: newId(),
    subjectId: input.subjectId,
    title,
    urlOrPath,
    tags,
    dueDate: input.dueDate || null,
    completed: false,
    createdAt: new Date().toISOString(),
  };
  await db.resources.put(record);
}

export async function toggleResourceCompleted(resource: Resource): Promise<void> {
  await db.resources.put({ ...resource, completed: !resource.completed });
}

export async function deleteResource(id: string): Promise<void> {
  await db.resources.delete(id);
}
