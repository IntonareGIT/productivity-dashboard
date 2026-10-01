import React, { useEffect, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { saveTopic } from '../libraryRepo';
import { db } from '../../../db/db';
import { getDefaultNoteTitle, uniqueDefaultNoteTitle } from '../../../db/noteTitle';
import type { Topic, TopicStatus } from '../../../types';

interface TopicModalProps {
  subjectId: string;
  topic: Topic | null; // null = creating new
  onClose: () => void;
}

const inputCls =
  'w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent';

const STATUS_OPTIONS: { value: TopicStatus; label: string }[] = [
  { value: 'not_started', label: 'Not started' },
  { value: 'studying', label: 'Studying' },
  { value: 'confident', label: 'Confident' },
];

export const TopicModal: React.FC<TopicModalProps> = ({ subjectId, topic, onClose }) => {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<TopicStatus>('not_started');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(topic?.title ?? '');
    setNotes(topic?.notes ?? '');
    setStatus(topic?.status ?? 'not_started');
    setError('');
  }, [topic]);

  const submit = async () => {
    // A blank title is no longer an error: it becomes the subject's default
    // ("Thermodynamics's Notes", numbered if that is taken). This is the UI's
    // half of the SAME rule the AI tools and the migration use, so a note
    // created by hand and one created by the assistant are named identically.
    // `saveTopic` still rejects a genuinely empty string, so the fallback is
    // resolved here where the subject name is available.
    let finalTitle = title.trim();
    if (!finalTitle && !topic) {
      const subject = await db.subjects.get(subjectId);
      const siblings = await db.topics.where('subjectId').equals(subjectId).toArray();
      finalTitle = uniqueDefaultNoteTitle(
        getDefaultNoteTitle(subject),
        siblings.map((t) => t.title),
      );
      setTitle(finalTitle);
    }
    if (!finalTitle) {
      setError('Title is required.');
      return;
    }
    setSaving(true);
    try {
      await saveTopic({ id: topic?.id, subjectId, title: finalTitle, notes, status });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={topic ? 'Edit Topic' : 'New Topic'} subtitle="Topics organize notes + resources within a subject">
      <div className="space-y-4">
        <label className="block">
          <span className="block text-xs text-content-secondary mb-1">Title</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Graph traversals"
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="block text-xs text-content-secondary mb-1">
            Notes <span className="text-content-tertiary">(markdown supported)</span>
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Write topic notes here… # headings, **bold**, `code`"
            rows={6}
            className={`${inputCls} resize-y min-h-[120px]`}
          />
        </label>

        <label className="block">
          <span className="block text-xs text-content-secondary mb-1">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as TopicStatus)} className={inputCls}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-4">
          <button
            onClick={onClose}
            className="px-4 min-h-[44px] rounded-xl text-sm text-content-secondary hover:text-content-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-5 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors"
          >
            {topic ? 'Save' : 'Add topic'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
