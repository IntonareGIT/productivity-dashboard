import React, { useEffect, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { saveResource } from '../libraryRepo';
import type { Resource } from '../../../types';

interface ResourceModalProps {
  subjectId: string;
  resource: Resource | null; // null = creating new
  onClose: () => void;
}

const inputCls =
  'w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent';

/** Add or edit a linked resource (URL or file path) with tags and due date. */
export const ResourceModal: React.FC<ResourceModalProps> = ({
  subjectId,
  resource,
  onClose,
}) => {
  const [title, setTitle] = useState('');
  const [urlOrPath, setUrlOrPath] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(resource?.title ?? '');
    setUrlOrPath(resource?.urlOrPath ?? '');
    setTagsInput((resource?.tags ?? []).join(', '));
    setDueDate(resource?.dueDate ?? '');
    setError('');
  }, [resource]);

  const submit = async () => {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!urlOrPath.trim()) {
      setError('A URL or file path is required.');
      return;
    }
    setSaving(true);
    try {
      await saveResource({
        id: resource?.id,
        subjectId,
        title,
        urlOrPath,
        tags: tagsInput.split(',').map((t) => t.trim()).filter(Boolean),
        dueDate,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const previewTags = tagsInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  return (
    <Modal
      open
      onClose={onClose}
      title={resource ? 'Edit Resource' : 'Add Resource'}
      subtitle="Link a URL or a local file reference"
    >
      <div className="space-y-4">
        <label className="block">
          <span className="block text-xs text-content-secondary mb-1">Title</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Dijkstra — lecture notes"
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="block text-xs text-content-secondary mb-1">
            URL or file path
          </span>
          <input
            value={urlOrPath}
            onChange={(e) => setUrlOrPath(e.target.value)}
            placeholder="https://… or C:\Notes\graphs.pdf"
            className={`${inputCls} font-mono text-xs`}
          />
        </label>

        <label className="block">
          <span className="block text-xs text-content-secondary mb-1">
            Tags <span className="text-content-tertiary">(comma-separated)</span>
          </span>
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="graphs, midterm, must-read"
            className={inputCls}
          />
        </label>

        {previewTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 -mt-1">
            {previewTags.map((t, i) => (
              <span
                key={`${t}-${i}`}
                className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent-subtle text-accent-text"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <label className="block">
          <span className="block text-xs text-content-secondary mb-1">
            Due date <span className="text-content-tertiary">(optional — feeds dashboard deadlines)</span>
          </span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={inputCls}
          />
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
            {resource ? 'Save' : 'Add resource'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
