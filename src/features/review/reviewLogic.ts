import type { Topic } from '../../types';

/**
 * Review reminders: once a topic is marked confident, it comes back for a
 * spaced review after 1, 3, 7, 14 then 30 days. Each "Reviewed" tap moves it
 * one step out; after the last step it stops reminding. All state lives on
 * two optional Topic fields (lastReviewedAt, reviewStage), so old rows work
 * unchanged and nothing is ever deleted.
 */

export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A topic is review-tracked once Omar marks it confident. */
export function isReviewTracked(topic: Topic): boolean {
  return topic.status === 'confident';
}

/** True when every scheduled review is done and reminders stop. */
export function isReviewComplete(topic: Topic): boolean {
  return (topic.reviewStage ?? 0) >= REVIEW_INTERVAL_DAYS.length;
}

/** When the next review falls due (ISO string), or null when not tracked. */
export function nextReviewDate(topic: Topic): Date | null {
  if (!isReviewTracked(topic)) return null;
  const stage = Math.min(topic.reviewStage ?? 0, REVIEW_INTERVAL_DAYS.length - 1);
  const base = new Date(topic.lastReviewedAt ?? topic.updatedAt).getTime();
  return new Date(base + REVIEW_INTERVAL_DAYS[stage] * DAY_MS);
}

export function isReviewDue(topic: Topic, now: Date = new Date()): boolean {
  if (!isReviewTracked(topic) || isReviewComplete(topic)) return false;
  const due = nextReviewDate(topic);
  return due !== null && due.getTime() <= now.getTime();
}

export function dueTopics(topics: Topic[], now: Date = new Date()): Topic[] {
  return topics
    .filter((t) => isReviewDue(t, now))
    .sort((a, b) => (nextReviewDate(a)?.getTime() ?? 0) - (nextReviewDate(b)?.getTime() ?? 0));
}

/** Fields to write when a review is logged. */
export function reviewedPatch(topic: Topic, now: Date = new Date()): Partial<Topic> {
  return {
    lastReviewedAt: now.toISOString(),
    reviewStage: (topic.reviewStage ?? 0) + 1,
    updatedAt: now.toISOString(),
  };
}
