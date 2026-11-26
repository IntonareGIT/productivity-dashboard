/**
 * Pure logic for the exam countdown card: no React, no Dexie.
 *
 * Derived live from existing tables (assessments, topics). Nothing is stored.
 * "Still unstudied" means the subject's topics that are not yet marked
 * Confident, because the Library has no per-topic exam link.
 */
import { differenceInCalendarDays, parseISO } from 'date-fns';
import type { Assessment, Subject, Topic } from '../../types';

export interface ExamCountdownItem {
  assessmentId: string;
  subjectId: string;
  name: string;
  type: Assessment['type'];
  date: string;
  daysLeft: number;
  subjectName: string;
  subjectColor: string | null;
  totalTopics: number;
  /** Topics not yet Confident, "not started" first. */
  unstudied: Topic[];
  notStarted: number;
}

export const daysLeftText = (n: number): string =>
  n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `${n} days`;

export function buildExamCountdown(
  assessments: Assessment[],
  subjects: Subject[],
  topics: Topic[],
  now: Date = new Date(),
): ExamCountdownItem[] {
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const topicsBySubject = new Map<string, Topic[]>();
  for (const t of topics) {
    const list = topicsBySubject.get(t.subjectId) ?? [];
    list.push(t);
    topicsBySubject.set(t.subjectId, list);
  }
  const out: ExamCountdownItem[] = [];
  for (const a of assessments) {
    if (a.status !== 'upcoming') continue;
    if (a.type !== 'exam' && a.type !== 'quiz') continue;
    const date = (a.date ?? '').trim();
    if (!date) continue;
    const d = parseISO(date);
    if (Number.isNaN(d.getTime())) continue;
    const daysLeft = differenceInCalendarDays(d, now);
    if (daysLeft < 0) continue;
    const subject = subjectById.get(a.subjectId);
    if (!subject) continue;
    const all = (topicsBySubject.get(a.subjectId) ?? []).slice().sort((x, y) => x.order - y.order);
    const unstudied = all
      .filter((t) => t.status !== 'confident')
      .sort((x, y) => Number(y.status === 'not_started') - Number(x.status === 'not_started') || x.order - y.order);
    out.push({
      assessmentId: a.id,
      subjectId: a.subjectId,
      name: a.name,
      type: a.type,
      date,
      daysLeft,
      subjectName: subject.name,
      subjectColor: subject.color ?? null,
      totalTopics: all.length,
      unstudied,
      notStarted: unstudied.filter((t) => t.status === 'not_started').length,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
