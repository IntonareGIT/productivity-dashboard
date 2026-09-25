import React, { useEffect, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { saveSubject } from '../libraryRepo';
import { DEFAULT_SUBJECT_COLOR, SUBJECT_PALETTE } from '../palette';
import type { Subject } from '../../../types';

interface SubjectModalProps {
  subject: Subject | null; // null = creating new
  onClose: () => void;
}

const inputCls =
  'w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent';

/** Add or edit a subject (name, description, color). */
export const SubjectModal: React.FC<SubjectModalProps> = ({ subject, onClose }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(DEFAULT_SUBJECT_COLOR);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(subject?.name ?? '');
    setDescription(subject?.description ?? '');
    setColor(subject?.color ?? DEFAULT_SUBJECT_COLOR);
    setError('');
  }, [subject]);

  const submit = async () => {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    try {
      await saveSubject({ id: subject?.id, name, description, color });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={subject ? 'Edit Subject' : 'New Subject'}
      subtitle={subject ? undefined : 'Color is independent of your theme'}
    >
      <div className="space-y-4">
        <label className="block">
          <span className="block text-xs text-content-secondary mb-1">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Advanced Algorithms"
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="block text-xs text-content-secondary mb-1">
            Description <span className="text-content-tertiary">(optional)</span>
          </span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. CS 501 — fall semester"
            className={inputCls}
          />
        </label>

        <div>
          <span className="block text-xs text-content-secondary mb-2">Card color</span>
          <div className="flex flex-wrap gap-2">
            {SUBJECT_PALETTE.map((c) => (
              <button
                key={c.hex}
                onClick={() => setColor(c.hex)}
                aria-label={c.name}
                title={c.name}
                className={`w-9 h-9 rounded-full transition-transform hover:scale-110 ${
                  color === c.hex
                    ? 'ring-2 ring-offset-2 ring-offset-bg-surface ring-content-primary scale-110'
                    : ''
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        </div>

        {/* Live preview */}
        <div className="rounded-xl border border-border p-3 flex items-center gap-3 bg-bg-elevated/40">
          <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          <span className="text-sm font-semibold text-content-primary truncate">
            {name.trim() || 'Subject preview'}
          </span>
        </div>

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
            {subject ? 'Save' : 'Create subject'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
