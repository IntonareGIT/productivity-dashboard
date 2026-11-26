import React from 'react';
import { BookMarked } from 'lucide-react';
import type { Resource, Subject, TodoItem, Topic } from '../../../types';

/** The optional Library link on a task: subject, then topic, then resource. */
export interface TodoLink {
  subjectId: string | null;
  topicId: string | null;
  resourceId: string | null;
}

export const emptyLink: TodoLink = { subjectId: null, topicId: null, resourceId: null };

interface PickerProps {
  link: TodoLink;
  onChange: (link: TodoLink) => void;
  subjects: Subject[];
  topics: Topic[];
  resources: Resource[];
}

/**
 * Cascading subject -> topic -> resource pickers. Picking a broader level
 * clears the narrower ones; everything is optional.
 */
export const TodoLinkPickers: React.FC<PickerProps> = ({ link, onChange, subjects, topics, resources }) => {
  const subjectTopics = topics.filter((t) => t.subjectId === link.subjectId);
  const topicResources = resources.filter((r) => (link.topicId ? r.topicId === link.topicId : r.subjectId === link.subjectId));
  const selectCls =
    'bg-bg-elevated/50 border border-border rounded-lg px-2 py-1.5 text-xs text-content-primary outline-none focus:border-accent max-w-[160px]';
  return (
    <>
      <select
        value={link.subjectId ?? ''}
        onChange={(e) => onChange({ subjectId: e.target.value || null, topicId: null, resourceId: null })}
        aria-label="Linked subject"
        className={selectCls}
      >
        <option value="">No subject</option>
        {subjects.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      {link.subjectId && subjectTopics.length > 0 && (
        <select
          value={link.topicId ?? ''}
          onChange={(e) => onChange({ ...link, topicId: e.target.value || null, resourceId: null })}
          aria-label="Linked topic"
          className={selectCls}
        >
          <option value="">Whole subject</option>
          {subjectTopics.map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
      )}
      {link.subjectId && topicResources.length > 0 && (
        <select
          value={link.resourceId ?? ''}
          onChange={(e) => onChange({ ...link, resourceId: e.target.value || null })}
          aria-label="Linked resource"
          className={selectCls}
        >
          <option value="">No resource</option>
          {topicResources.map((r) => (
            <option key={r.id} value={r.id}>{r.title}</option>
          ))}
        </select>
      )}
    </>
  );
};

interface BadgeProps {
  todo: TodoItem;
  lookups: {
    subjectName: (id?: string | null) => string | undefined;
    topicTitle: (id?: string | null) => string | undefined;
    resourceTitle: (id?: string | null) => string | undefined;
  };
}

/** Small "Subject › Topic › Resource" label under a task title. */
export const TodoLinkBadge: React.FC<BadgeProps> = ({ todo, lookups }) => {
  const parts = [
    lookups.subjectName(todo.subjectId),
    lookups.topicTitle(todo.topicId),
    lookups.resourceTitle(todo.resourceId),
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-accent/90">
      <BookMarked className="w-3 h-3" />
      {parts.join(' › ')}
    </span>
  );
};
