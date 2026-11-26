import { format } from 'date-fns';
import { db } from '../../db/db';
import type { QuickCapture } from '../../types';
import { saveResource } from '../library/libraryRepo';
import { ToolError, requireString, type ToolExecution } from './toolRuntime';
import type { ToolSpec } from './types';

/**
 * Quick capture tools: the inbox behind the top-bar capture button. Notes and
 * links wait with status 'inbox' until the assistant files them into a
 * subject; task captures never land here (they go straight to `todos`).
 */

const ID_HINT = 'The id from listCaptures / listSubjects / listTopics.';

async function requireCapture(id: string): Promise<QuickCapture> {
  const capture = await db.quickCaptures.get(id);
  if (!capture) throw new ToolError(`No capture with id "${id}".`);
  return capture;
}

async function requireSubjectId(id: string): Promise<string> {
  const subject = await db.subjects.get(id);
  if (!subject) throw new ToolError(`No subject with id "${id}".`);
  return subject.id;
}

export const CAPTURE_TOOL_SPECS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'listCaptures',
      description:
        'List quick captures. By default only the ones still waiting in the inbox; pass status "filed" or "all" to see the rest.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['inbox', 'filed', 'all'], description: 'Default "inbox".' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fileCapture',
      description:
        'File an inbox capture into the library. A note is appended to the topic notes; a link is saved as a link resource. Marks the capture filed.',
      parameters: {
        type: 'object',
        properties: {
          captureId: { type: 'string', description: ID_HINT },
          subjectId: { type: 'string', description: ID_HINT },
          topicId: { type: 'string', description: 'Optional topic inside the subject; defaults to the subject default topic.' },
          title: { type: 'string', description: 'For links: resource title. Defaults to the captured text.' },
        },
        required: ['captureId', 'subjectId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteCapture',
      description: 'Delete a capture permanently. Requires confirmation.',
      parameters: {
        type: 'object',
        properties: {
          captureId: { type: 'string', description: ID_HINT },
        },
        required: ['captureId'],
        additionalProperties: false,
      },
    },
  },
];

async function listCaptures(args: Record<string, unknown>): Promise<ToolExecution> {
  const status = String(args.status ?? 'inbox');
  let rows: QuickCapture[];
  if (status === 'all') {
    rows = await db.quickCaptures.reverse().sortBy('createdAt');
  } else if (status === 'filed' || status === 'inbox') {
    rows = await db.quickCaptures.where('status').equals(status).reverse().sortBy('createdAt');
  } else {
    throw new ToolError('"status" must be inbox, filed or all.');
  }
  return {
    ok: true,
    summary: rows.length
      ? `${rows.length} capture(s)${status === 'all' ? '' : ` with status ${status}`}.`
      : `No captures with status ${status}.`,
    data: rows.map((c) => ({ id: c.id, kind: c.kind, text: c.text, createdAt: c.createdAt, status: c.status })),
  };
}

async function fileCapture(args: Record<string, unknown>): Promise<ToolExecution> {
  const capture = await requireCapture(requireString(args, 'captureId'));
  if (capture.status === 'filed') throw new ToolError('That capture is already filed.');
  const subjectId = await requireSubjectId(requireString(args, 'subjectId'));
  let topicId = String(args.topicId ?? '').trim() || null;
  const now = new Date().toISOString();

  if (capture.kind === 'link') {
    const title = String(args.title ?? '').trim() || capture.text;
    await saveResource({ subjectId, topicId, kind: 'link', title, urlOrPath: capture.text });
    if (!topicId) {
      const res = await db.resources.where('subjectId').equals(subjectId).reverse().sortBy('createdAt');
      topicId = res[0]?.topicId ?? null;
    }
    await db.quickCaptures.put({ ...capture, status: 'filed', filedToSubjectId: subjectId, filedToTopicId: topicId });
    return {
      ok: true,
      summary: `Saved the link “${title}” as a resource and marked the capture filed.`,
      data: { captureId: capture.id, subjectId, topicId },
      toast: { kind: 'success', title: 'Link filed', description: title },
    };
  }

  // Note: append to the topic's notes, dated, like addTopicNote.
  let topic = topicId ? await db.topics.get(topicId) : undefined;
  if (!topic) {
    const topics = await db.topics.where('subjectId').equals(subjectId).sortBy('createdAt');
    topic = topics[0];
  }
  if (!topic) throw new ToolError('That subject has no topic to hold the note.');
  const stamp = format(new Date(), 'yyyy-MM-dd');
  const block = `## Captured (${stamp})\n\n${capture.text}`;
  const notes = topic.notes.trim() ? `${topic.notes}\n\n${block}` : block;
  await db.topics.put({ ...topic, notes, updatedAt: now });
  await db.quickCaptures.put({ ...capture, status: 'filed', filedToSubjectId: subjectId, filedToTopicId: topic.id });
  return {
    ok: true,
    summary: `Appended the note to “${topic.title}” and marked the capture filed.`,
    data: { captureId: capture.id, topicId: topic.id, title: topic.title },
    toast: { kind: 'success', title: 'Note filed', description: topic.title },
  };
}

async function deleteCapture(args: Record<string, unknown>): Promise<ToolExecution> {
  const capture = await requireCapture(requireString(args, 'captureId'));
  await db.quickCaptures.delete(capture.id);
  return {
    ok: true,
    summary: `Deleted the ${capture.kind} capture.`,
    data: { captureId: capture.id },
    toast: { kind: 'success', title: 'Capture deleted' },
  };
}

const HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<ToolExecution>> = {
  listCaptures,
  fileCapture,
  deleteCapture,
};

export const CAPTURE_TOOL_NAMES = Object.keys(HANDLERS);
export const CAPTURE_CONFIRM_TOOL_NAMES = new Set(['deleteCapture']);

export function executeCaptureTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolExecution> | null {
  const handler = HANDLERS[name];
  if (!handler) return null;
  return handler(args);
}

export function describeCaptureToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'fileCapture':
      return 'File an inbox capture into a subject.';
    case 'deleteCapture':
      return `Delete capture ${String(args.captureId ?? '')} permanently.`;
    default:
      return name;
  }
}
