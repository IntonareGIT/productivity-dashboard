/**
 * To-do list tools for the assistant.
 *
 * addTodo, updateTodo and completeTodo run immediately (Omar's choice: the
 * list is cheap to edit). deleteTodo is the ONLY to-do tool in the
 * confirmation gate - a deleted task is gone, so the assistant asks first.
 *
 * When the model references a task by words we resolve the title exactly and
 * fail loudly on ambiguity rather than touching the wrong row; the spec tells
 * the model to call listTodos first when unsure.
 */
import { db } from '../../db/db';
import type { TodoItem } from '../../types';
import { addTodo, deleteTodo, setTodoDone, sortTodos, updateTodo } from '../todos/todosRepo';
import { ToolError, requireString, type ToolExecution } from './toolRuntime';
import type { ToolSpec } from './types';

const ID_HINT =
  'Must be an id returned by listTodos. Never guess an id - if you only have a title, call listTodos first.';

export const TODO_TOOL_SPECS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'listTodos',
      description:
        'List tasks on the to-do list with their ids, titles, due dates, done state and library links. Call this FIRST whenever you need a todoId, and whenever the user asks what is on the list.',
      parameters: {
        type: 'object',
        properties: {
          includeDone: { type: 'boolean', description: 'Include completed tasks. Default false.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addTodo',
      description: 'Add a task to the to-do list, optionally linked to a library subject/topic/resource and with a due date.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title.' },
          dueDate: { type: 'string', description: 'Optional due date, YYYY-MM-DD.' },
          subjectId: { type: 'string', description: `Optional linked subject. ${ID_HINT.replace('listTodos', 'listSubjects')}` },
          topicId: { type: 'string', description: 'Optional linked topic. Must belong to subjectId.' },
          resourceId: { type: 'string', description: 'Optional linked resource.' },
        },
        required: ['title'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateTodo',
      description: 'Edit a task: rename it, move its due date, or change its library link. Only the fields you pass change.',
      parameters: {
        type: 'object',
        properties: {
          todoId: { type: 'string', description: ID_HINT },
          title: { type: 'string' },
          dueDate: { type: 'string', description: 'YYYY-MM-DD, or empty string to clear.' },
          subjectId: { type: 'string', description: 'New subject link, or empty string to clear.' },
          topicId: { type: 'string', description: 'New topic link, or empty string to clear.' },
          resourceId: { type: 'string', description: 'New resource link, or empty string to clear.' },
        },
        required: ['todoId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'completeTodo',
      description: 'Mark a task done, or reopen it with done=false.',
      parameters: {
        type: 'object',
        properties: {
          todoId: { type: 'string', description: ID_HINT },
          done: { type: 'boolean', description: 'Default true.' },
        },
        required: ['todoId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteTodo',
      description: 'Permanently delete a task. This cannot be undone, so the user confirms it first.',
      parameters: {
        type: 'object',
        properties: {
          todoId: { type: 'string', description: ID_HINT },
        },
        required: ['todoId'],
        additionalProperties: false,
      },
    },
  },
];

export const TODO_TOOL_NAMES = TODO_TOOL_SPECS.map((s) => s.function.name);

const line = (t: TodoItem) =>
  `${t.done ? '[x]' : '[ ]'} ${t.title} (id: ${t.id})${t.dueDate ? ` - due ${t.dueDate}` : ''}`;

async function resolveTodo(idOrTitle: unknown): Promise<TodoItem> {
  const raw = requireString({ todoId: idOrTitle }, 'todoId');
  const all = await db.todos.toArray();
  const byId = all.find((t) => t.id === raw);
  if (byId) return byId;
  const exact = all.filter((t) => t.title.trim().toLowerCase() === raw.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new ToolError(
      `Several tasks are called "${raw}". Call listTodos and retry with the id. Nothing was changed.`
    );
  }
  throw new ToolError(`No task with id or exact title "${raw}". Call listTodos to see the current list.`);
}

export function describeTodoToolCall(name: string, argsJson: string): string {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || '{}') as Record<string, unknown>;
  } catch {
    /* fall through to a generic label */
  }
  switch (name) {
    case 'listTodos':
      return 'List to-do tasks';
    case 'addTodo':
      return `Add task "${String(args.title ?? '')}"`;
    case 'updateTodo':
      return 'Edit a task';
    case 'completeTodo':
      return args.done === false ? 'Reopen a task' : 'Complete a task';
    case 'deleteTodo':
      return 'Delete a task';
    default:
      return name;
  }
}

export async function executeTodoTool(name: string, args: Record<string, unknown>): Promise<ToolExecution | null> {
  switch (name) {
    case 'listTodos': {
      const all = sortTodos(await db.todos.toArray());
      const rows = args.includeDone ? all : all.filter((t) => !t.done);
      if (rows.length === 0) {
        return { ok: true, summary: args.includeDone ? 'The to-do list is empty.' : 'No open tasks.', data: args.includeDone ? 'The to-do list is empty.' : 'No open tasks.' };
      }
      const open = rows.filter((t) => !t.done).length;
      const listing = `${open} open, ${rows.length - open} done shown:\n` + rows.map(line).join('\n');
      return { ok: true, summary: listing, data: listing };
    }
    case 'addTodo': {
      const title = requireString(args, 'title');
      const due = args.dueDate == null || args.dueDate === '' ? null : String(args.dueDate);
      if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
        throw new ToolError(`dueDate must be YYYY-MM-DD (got "${due}"). Nothing was added.`);
      }
      const subjectId = (args.subjectId as string) || null;
      const topicId = (args.topicId as string) || null;
      const resourceId = (args.resourceId as string) || null;
      if (subjectId && !(await db.subjects.get(subjectId))) {
        throw new ToolError(`No subject with id "${subjectId}". Call listSubjects first. Nothing was added.`);
      }
      if (topicId && !(await db.topics.get(topicId))) {
        throw new ToolError(`No topic with id "${topicId}". Call listTopics first. Nothing was added.`);
      }
      if (resourceId && !(await db.resources.get(resourceId))) {
        throw new ToolError(`No resource with id "${resourceId}". Nothing was added.`);
      }
      const todo = await addTodo({
        title,
        dueDate: due,
        subjectId,
        topicId,
        resourceId,
      });
      return { ok: true, summary: `Added task "${todo.title}" (id: ${todo.id})${todo.dueDate ? `, due ${todo.dueDate}` : ''}.`, data: `Added task "${todo.title}" (id: ${todo.id})${todo.dueDate ? `, due ${todo.dueDate}` : ''}.` };
    }
    case 'updateTodo': {
      const todo = await resolveTodo(args.todoId);
      const patch: Parameters<typeof updateTodo>[1] = {};
      if (args.title != null) patch.title = requireString(args, 'title');
      if (args.dueDate != null) patch.dueDate = args.dueDate === '' ? null : String(args.dueDate);
      if (args.subjectId != null) patch.subjectId = args.subjectId === '' ? null : String(args.subjectId);
      if (args.topicId != null) patch.topicId = args.topicId === '' ? null : String(args.topicId);
      if (args.resourceId != null) patch.resourceId = args.resourceId === '' ? null : String(args.resourceId);
      if (Object.keys(patch).length === 0) {
        throw new ToolError('updateTodo needs at least one field to change. Nothing was changed.');
      }
      await updateTodo(todo.id, patch);
      return { ok: true, summary: `Updated task "${patch.title ?? todo.title}" (id: ${todo.id}).`, data: `Updated task "${patch.title ?? todo.title}" (id: ${todo.id}).` };
    }
    case 'completeTodo': {
      const todo = await resolveTodo(args.todoId);
      const done = args.done !== false;
      await setTodoDone(todo.id, done);
      return { ok: true, summary: done ? `Completed "${todo.title}".` : `Reopened "${todo.title}".`, data: done ? `Completed "${todo.title}".` : `Reopened "${todo.title}".` };
    }
    case 'deleteTodo': {
      const todo = await resolveTodo(args.todoId);
      await deleteTodo(todo.id);
      return { ok: true, summary: `Deleted task "${todo.title}".`, data: `Deleted task "${todo.title}".` };
    }
    default:
      return null;
  }
}
