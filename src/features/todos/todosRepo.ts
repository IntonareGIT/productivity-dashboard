import { db } from '../../db/db';
import { newId } from '../../utils/id';
import type { TodoItem } from '../../types';

/**
 * All to-do persistence goes through here so the page, the dashboard card, the
 * focus picker and the AI tools share one behavior (id shape, timestamps,
 * completion bookkeeping).
 */

export async function addTodo(input: {
  title: string;
  dueDate?: string | null;
  subjectId?: string | null;
  topicId?: string | null;
  resourceId?: string | null;
}): Promise<TodoItem> {
  const title = input.title.trim();
  if (!title) throw new Error('Task title is empty.');
  const todo: TodoItem = {
    id: newId(),
    title,
    done: false,
    createdAt: new Date().toISOString(),
    dueDate: input.dueDate ?? null,
    subjectId: input.subjectId ?? null,
    topicId: input.topicId ?? null,
    resourceId: input.resourceId ?? null,
  };
  await db.todos.add(todo);
  return todo;
}

export async function updateTodo(
  id: string,
  patch: Partial<Pick<TodoItem, 'title' | 'dueDate' | 'subjectId' | 'topicId' | 'resourceId' | 'sortIndex'>>
): Promise<void> {
  await db.todos.update(id, patch);
}

/** Complete or reopen. Reopening clears completedAt so history stays honest. */
export async function setTodoDone(id: string, done: boolean): Promise<void> {
  await db.todos.update(id, {
    done,
    completedAt: done ? new Date().toISOString() : null,
  });
}

export async function deleteTodo(id: string): Promise<void> {
  await db.todos.delete(id);
}

/** Open tasks first (by due date, then creation), completed below, newest last. */
export function sortTodos(todos: TodoItem[]): TodoItem[] {
  const key = (t: TodoItem) => t.dueDate ?? '9999-12-31';
  return [...todos].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (!a.done && !b.done) {
      if (a.sortIndex != null && b.sortIndex != null && a.sortIndex !== b.sortIndex)
        return a.sortIndex - b.sortIndex;
      const d = key(a).localeCompare(key(b));
      if (d !== 0) return d;
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}
