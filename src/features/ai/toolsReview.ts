import { db } from '../../db/db';
import { dueTopics, nextReviewDate, reviewedPatch, REVIEW_INTERVAL_DAYS } from '../review/reviewLogic';
import { ToolError, requireString, type ToolExecution } from './toolRuntime';
import type { ToolSpec } from './types';

/**
 * Review reminder tools: list studied (confident) topics due for a spaced
 * review, and log a review (pushes the next reminder one interval out).
 */

export const REVIEW_TOOL_SPECS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'listReviewDue',
      description:
        'List topics due for a spaced review right now. Topics become review-tracked when their status is confident; reminders come after 1, 3, 7, 14 and 30 days.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'markTopicReviewed',
      description:
        'Log a review for a topic: stamps the review time and pushes the next reminder one interval out (1, 3, 7, 14, 30 days). Use a topicId from listReviewDue or listTopics.',
      parameters: {
        type: 'object',
        properties: {
          topicId: { type: 'string', description: 'The topic id.' },
        },
        required: ['topicId'],
        additionalProperties: false,
      },
    },
  },
];

async function listReviewDue(): Promise<ToolExecution> {
  const [topics, subjects] = await Promise.all([db.topics.toArray(), db.subjects.toArray()]);
  const name = (id: string) => subjects.find((s) => s.id === id)?.name ?? null;
  const due = dueTopics(topics);
  return {
    ok: true,
    summary: due.length
      ? `${due.length} topic(s) due for review.`
      : 'No topics due for review. Confident topics come back after 1, 3, 7, 14 and 30 days.',
    data: due.map((t) => ({
      topicId: t.id,
      title: t.title,
      subject: name(t.subjectId),
      dueSince: nextReviewDate(t)?.toISOString() ?? null,
      reviewStage: t.reviewStage ?? 0,
      totalStages: REVIEW_INTERVAL_DAYS.length,
    })),
  };
}

async function markTopicReviewed(args: Record<string, unknown>): Promise<ToolExecution> {
  const topic = await db.topics.get(requireString(args, 'topicId'));
  if (!topic) throw new ToolError(`No topic with id "${String(args.topicId)}".`);
  const patch = reviewedPatch(topic);
  await db.topics.put({ ...topic, ...patch });
  const done = (patch.reviewStage ?? 0) >= REVIEW_INTERVAL_DAYS.length;
  const next = done ? null : nextReviewDate({ ...topic, ...patch });
  return {
    ok: true,
    summary: done
      ? `Logged the review of “${topic.title}”. That was the last scheduled review - it will not remind again.`
      : `Logged the review of “${topic.title}”. Next reminder ${next?.toDateString()}.`,
    data: { topicId: topic.id, reviewStage: patch.reviewStage, nextReviewAt: next?.toISOString() ?? null },
    toast: { kind: 'success', title: 'Review logged', description: topic.title },
  };
}

const HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<ToolExecution>> = {
  listReviewDue,
  markTopicReviewed,
};

export const REVIEW_TOOL_NAMES = Object.keys(HANDLERS);

export function executeReviewTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolExecution> | null {
  const handler = HANDLERS[name];
  if (!handler) return null;
  return handler(args);
}
