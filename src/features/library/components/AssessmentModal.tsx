import React, { useEffect, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { saveAssessment } from '../libraryRepo';
import type { Assessment, AssessmentStatus, AssessmentType } from '../../../types';

interface AssessmentModalProps {
  subjectId: string;
  assessment: Assessment | null; // null = creating new
  onClose: () => void;
}

const inputCls =
  'w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent';

const TYPE_OPTIONS: { value: AssessmentType; label: string }[] = [
  { value: 'exam', label: 'Exam' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'assignment', label: 'Assignment' },
  { value: 'project', label: 'Project' },
];

const STATUS_OPTIONS: { value: AssessmentStatus; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'done', label: 'Done' },
];

export const AssessmentModal: React.FC<AssessmentModalProps> = ({ subjectId, assessment, onClose }) => {
  const [name, setName] = useState('');
  const [type, setType] = useState<AssessmentType>('exam');
  const [date, setDate] = useState('');
  const [weight, setWeight] = useState('');
  const [status, setStatus] = useState<AssessmentStatus>('upcoming');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(assessment?.name ?? '');
    setType(assessment?.type ?? 'exam');
    setDate(assessment?.date ?? '');
    setWeight(assessment?.weight != null ? String(assessment.weight) : '');
    setStatus(assessment?.status ?? 'upcoming');
    setError('');
  }, [assessment]);

  const submit = async () => {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    // The date is OPTIONAL (Phase 5). An assessment with no date still exists
    // and still shows in its subject; it simply does not appear on the calendar.
    if (date.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      setError('Date must be a valid date.');
      return;
    }
    const parsedWeight = weight.trim() === '' ? null : Number(weight);
    if (parsedWeight !== null && (Number.isNaN(parsedWeight) || parsedWeight < 0 || parsedWeight > 100)) {
      setError('Weight must be a number between 0 and 100.');
      return;
    }
    setSaving(true);
    try {
      await saveAssessment({ id: assessment?.id, subjectId, name, type, date, weight: parsedWeight, status });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={assessment ? 'Edit Assessment' : 'New Assessment'} subtitle="Exams, quizzes, assignments & projects">
      <div className="space-y-4">
        <label className="block">
          <span className="block text-xs text-content-secondary mb-1">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Midterm 1"
            className={inputCls}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as AssessmentType)} className={inputCls}>
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as AssessmentStatus)} className={inputCls}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">
              Date <span className="text-content-tertiary">(optional)</span>
            </span>
            {/* A native date input IS the date picker, and it clears to empty. */}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className={inputCls} />
          </label>
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">
              Weight % <span className="text-content-tertiary">(optional)</span>
            </span>
            <input
              type="number"
              min={0}
              max={100}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="e.g. 25"
              className={inputCls}
            />
          </label>
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
            {assessment ? 'Save' : 'Add assessment'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
