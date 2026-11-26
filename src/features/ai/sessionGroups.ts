import type { ChatSession } from '../../types';

const now = new Date();
const todayKey = now.toDateString();
const yesterdayKey = new Date(now.getTime() - 86400000).toDateString();

/**
 * Group chat sessions as Today / Yesterday / Earlier, newest first within each
 * group. The same grouping the history drawer uses, so the sidebar list and the
 * drawer always agree.
 */
export function groupSessions(sessions: ChatSession[]): {
  today: ChatSession[];
  yesterday: ChatSession[];
  earlier: ChatSession[];
} {
  const today: ChatSession[] = [];
  const yesterday: ChatSession[] = [];
  const earlier: ChatSession[] = [];
  for (const s of [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const key = new Date(s.updatedAt).toDateString();
    if (key === todayKey) today.push(s);
    else if (key === yesterdayKey) yesterday.push(s);
    else earlier.push(s);
  }
  return { today, yesterday, earlier };
}

export function formatSessionDate(updatedAt: string): string {
  return new Date(updatedAt).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
