import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { CATEGORIES } from '../categories';
import { deleteEvent, saveEvent } from '../eventsRepo';
import type { CalendarEvent, EventCategory } from '../../../types';

interface EventModalProps {
  /** null = closed. Either an existing event or a new one for `newDate`. */
  event: CalendarEvent | null;
  newDate: string | null; // yyyy-MM-dd when creating
  onClose: () => void;
}

const inputCls =
  'w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent';

/** Add/edit/delete a calendar event. */
export const EventModal: React.FC<EventModalProps> = ({ event, newDate, onClose }) => {
  const open = Boolean(event || newDate);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [category, setCategory] = useState<EventCategory>('personal');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(event?.title ?? '');
    setDate(event?.date ?? newDate ?? '');
    setStartTime(event?.startTime ?? '');
    setEndTime(event?.endTime ?? '');
    setCategory(event?.category ?? 'personal');
    setError('');
    setConfirmDelete(false);
  }, [open, event, newDate]);

  if (!open) return null;

  const submit = async () => {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (startTime && endTime && endTime < startTime) {
      setError('End time must be after start time.');
      return;
    }
    setSaving(true);
    try {
      await saveEvent({ id: event?.id, title, date, startTime, endTime, category });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!event) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      await deleteEvent(event.id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const displayDate = date
    ? format(new Date(date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')
    : '';

  return (
    <Modal
      open
      onClose={onClose}
      title={event ? 'Edit Event' : 'New Event'}
      subtitle={displayDate}
    >
      <div className="space-y-4">
        <label className="block">
          <span className="block text-xs text-content-secondary mb-1">Title</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Algorithms lecture"
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="block text-xs text-content-secondary mb-1">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">
              Start <span className="text-content-tertiary">(optional)</span>
            </span>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">
              End <span className="text-content-tertiary">(optional)</span>
            </span>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>

        <div>
          <span className="block text-xs text-content-secondary mb-1.5">Category</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                onClick={() => setCategory(c.value)}
                className={`min-h-[40px] rounded-lg border text-xs font-semibold transition-all ${
                  category === c.value
                    ? `${c.badge} border-current`
                    : 'bg-bg-elevated/50 border-border text-content-tertiary hover:border-border-strong'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-4">
          {event ? (
            <button
              onClick={remove}
              disabled={saving}
              className={`flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl text-sm font-medium transition-colors ${
                confirmDelete
                  ? 'bg-rose-600 text-white'
                  : 'text-rose-500 hover:bg-rose-500/10'
              }`}
            >
              <Trash2 className="w-4 h-4" />
              {confirmDelete ? 'Confirm delete?' : 'Delete'}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
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
              {event ? 'Save' : 'Add event'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
