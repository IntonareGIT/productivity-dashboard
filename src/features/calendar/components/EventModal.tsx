import React, { useEffect, useState } from 'react';
import { format, parse } from 'date-fns';
import { Repeat, Trash2, TriangleAlert } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { deleteEvent, saveEvent, updateEventWithScope, deleteEventWithScope, periodConflictsOn, type EventInput, type SeriesScope } from '../eventsRepo';
import { isRecurring, parseDateKey } from '../recurrence';
import {
  CATEGORIES, EVENT_KINDS, EVENT_KIND_LABEL, PERIODS, periodByNumber, usesPeriod,
} from '../categories';
import { db } from '../../../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import type { CalendarEvent, EventCategory, EventKind, RecurrenceType } from '../../../types';

interface EventModalProps {
  /** null = closed. Either an existing event or a new one for `newDate`. */
  event: CalendarEvent | null;
  newDate: string | null; // yyyy-MM-dd when creating
  /** Date of the clicked occurrence — required for series scopes. */
  occurrenceDate?: string | null;
  /** Library prefill: links the new event to a subject. */
  subjectId?: string | null;
  subjectName?: string;
  prefillTitle?: string;
  defaultRecurrenceType?: RecurrenceType;
  onClose: () => void;
}

const inputCls =
  'w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent';

const REPEAT_OPTIONS: { value: RecurrenceType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'custom', label: 'Custom' },
];

const DAY_CHIPS: { value: number; label: string }[] = [
  { value: 1, label: 'M' },
  { value: 2, label: 'T' },
  { value: 3, label: 'W' },
  { value: 4, label: 'T' },
  { value: 5, label: 'F' },
  { value: 6, label: 'S' },
  { value: 0, label: 'S' },
];

type EndMode = 'never' | 'date' | 'count';

/** Add/edit/delete a calendar event, with recurrence and series scopes. */
export const EventModal: React.FC<EventModalProps> = ({
  event,
  newDate,
  occurrenceDate = null,
  subjectId = null,
  subjectName,
  prefillTitle,
  defaultRecurrenceType = 'none',
  onClose,
}) => {
  const open = Boolean(event || newDate);

  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [category, setCategory] = useState<EventCategory>('personal');
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('none');
  const [interval, setIntervalDays] = useState(2);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [endMode, setEndMode] = useState<EndMode>('never');
  const [endDate, setEndDate] = useState('');
  const [endCount, setEndCount] = useState(10);
  const [scope, setScope] = useState<SeriesScope>('this');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // --- subject / kind / period (schema v12) ---
  // `subjectId` here is the EXISTING link the assistant already uses; the kind and
  // period are new optional fields stored beside it, never a second way to link.
  const [kindSubjectId, setKindSubjectId] = useState<string>('');
  const [eventKind, setEventKind] = useState<EventKind | ''>('');
  const [period, setPeriod] = useState<number | ''>('');
  /**
   * When a period sets the times, the time fields are read-only. The user can
   * override with a small "Custom time" switch, because a real timetable clash
   * sometimes happens and silently forcing the period times would be worse.
   */
  const [customTime, setCustomTime] = useState(false);
  /** Non-blocking warning: another lecture already occupies this period. */
  const [clash, setClash] = useState<CalendarEvent[]>([]);
  const subjects = useLiveQuery(() => db.subjects.toArray()) ?? [];

  useEffect(() => {
    if (!open) return;
    const anchorDate = event?.date ?? newDate ?? format(new Date(), 'yyyy-MM-dd');
    setTitle(event?.title ?? prefillTitle ?? '');
    setDate(anchorDate);
    setStartTime(event?.startTime ?? '');
    setEndTime(event?.endTime ?? '');
    setCategory(event?.category ?? 'class');
    setRecurrenceType(event?.recurrenceType ?? (event ? 'none' : defaultRecurrenceType));
    setIntervalDays(event?.recurrenceInterval ?? 2);
    setDaysOfWeek(event?.recurrenceDaysOfWeek ?? [parseDateKey(anchorDate).getDay()]);
    if (event?.recurrenceEndDate) {
      setEndMode('date');
      setEndDate(event.recurrenceEndDate);
      setEndCount(10);
    } else if (event?.recurrenceCount) {
      setEndMode('count');
      setEndCount(event.recurrenceCount);
      setEndDate('');
    } else {
      setEndMode('never');
      setEndDate('');
      setEndCount(10);
    }
    setScope('this');
    setError('');
    setConfirmDelete(false);
    // Existing events have no kind/period, so both read as "not set" and the
    // time fields behave exactly as they did before this feature.
    const existingSubject = event?.subjectId ?? subjectId ?? '';
    setKindSubjectId(existingSubject);
    setEventKind(event?.eventKind ?? '');
    setPeriod(event?.period ?? '');
    // A stored event with a period keeps the period times unless its saved times
    // disagree with them, which means the user had already customised them.
    const p = event?.period ?? null;
    const fromPeriod = periodByNumber(p);
    setCustomTime(Boolean(fromPeriod && event?.startTime && event.startTime !== fromPeriod.start));
    setClash([]);
  }, [open, event, newDate, prefillTitle, defaultRecurrenceType, subjectId]);

  // A period owns the times. Times are derived from the SHARED PERIODS list
  // rather than restated here, so the form and the assistant cannot disagree.
  const effectivePeriod = period === '' ? null : Number(period);
  const periodTimes = periodByNumber(effectivePeriod);
  const timesFromPeriod = Boolean(periodTimes && !customTime);
  const shownStart = timesFromPeriod ? (periodTimes as { start: string }).start : startTime;
  const shownEnd = timesFromPeriod ? (periodTimes as { end: string }).end : endTime;

  // Clear a period when the kind stops being a timetabled one, so "Studying"
  // can never keep a leftover period.
  const changeKind = (next: EventKind) => {
    setEventKind(next);
    if (!usesPeriod(next)) { setPeriod(''); setCustomTime(false); }
  };

  /**
   * Warn, never block: a second lecture in the same period is usually a
   * timetable mistake, but sometimes it is deliberate (a make-up class), so the
   * save button stays enabled and only a note appears.
   *
   * Declared ABOVE the `if (!open) return null` on purpose. A hook after an
   * early return is skipped when the modal is closed and run when it opens,
   * which changes the hook order between renders and React treats that as a
   * different component. `useLiveQuery` above is subject to the same rule.
   */
  useEffect(() => {
    if (!open || !usesPeriod(eventKind || null) || effectivePeriod == null) {
      setClash([]);
      return;
    }
    let live = true;
    void periodConflictsOn(date, effectivePeriod, event?.id)
      .then((rows) => { if (live) setClash(rows); })
      .catch(() => { if (live) setClash([]); });
    return () => { live = false; };
  }, [open, date, eventKind, effectivePeriod, event?.id]);

  if (!open) return null;

  const editingRecurring = Boolean(event && isRecurring(event));
  // The prop `subjectId` is a fixed link supplied by the caller (e.g. the
  // subject's own "add event" flow); the dropdown is the editable default.
  const linkedSubject = kindSubjectId || subjectId || event?.subjectId || '';

  const buildInput = (): EventInput => ({
    id: event?.id,
    title,
    date,
    startTime: shownStart,
    endTime: shownEnd,
    category,
    recurrenceType,
    recurrenceInterval: recurrenceType === 'custom' ? interval : null,
    recurrenceDaysOfWeek: recurrenceType === 'weekly' ? daysOfWeek : null,
    recurrenceEndDate: recurrenceType === 'none' || endMode !== 'date' ? null : endDate,
    recurrenceCount: recurrenceType === 'none' || endMode !== 'count' ? null : endCount,
    subjectId: linkedSubject || null,
    eventKind: eventKind || null,
    period: effectivePeriod,
  });

  const submit = async () => {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (startTime && endTime && endTime < startTime) {
      setError('End time must be after start time.');
      return;
    }
    if (recurrenceType === 'weekly' && daysOfWeek.length === 0) {
      setError('Pick at least one day for the weekly repeat.');
      return;
    }
    setSaving(true);
    try {
      if (!event) {
        await saveEvent(buildInput());
      } else if (!isRecurring(event)) {
        await saveEvent(buildInput());
      } else {
        await updateEventWithScope(event, occurrenceDate ?? event.date, scope, buildInput());
      }
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
      if (isRecurring(event)) {
        await deleteEventWithScope(event, occurrenceDate ?? event.date, scope);
      } else {
        await deleteEvent(event.id);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const displayDate = date ? format(new Date(date + 'T00:00:00'), 'EEEE, MMMM d, yyyy') : '';

  return (
    <Modal
      open
      onClose={onClose}
      title={event ? 'Edit Event' : 'New Event'}
      subtitle={displayDate}
    >
      <div className="space-y-4">
        {linkedSubject && (
          <div className="flex items-center gap-2 text-xs text-accent bg-accent-subtle rounded-lg px-3 py-2">
            <Repeat className="w-3.5 h-3.5 shrink-0" />
            Linked to {subjectName ?? 'Library subject'}
          </div>
        )}

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

        {/* Subject / Type / Period. "Type" only appears once a subject is chosen,
            and "Period" only for the timetabled types. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">Subject</span>
            <select
              value={kindSubjectId}
              onChange={(e) => {
                setKindSubjectId(e.target.value);
                // Dropping the subject clears the type: a type with no subject
                // would be a claim about nothing.
                if (!e.target.value) { setEventKind(''); setPeriod(''); setCustomTime(false); }
              }}
              aria-label="Subject"
              className={inputCls}
            >
              <option value="">None</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>

          {linkedSubject && (
            <label className="block">
              <span className="block text-xs text-content-secondary mb-1">Type</span>
              <select
                value={eventKind}
                onChange={(e) => changeKind(e.target.value as EventKind)}
                aria-label="Type"
                className={inputCls}
              >
                <option value="">None</option>
                {EVENT_KINDS.map((k) => (
                  <option key={k} value={k}>{EVENT_KIND_LABEL[k]}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        {linkedSubject && usesPeriod(eventKind || null) && (
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">Period</span>
            <select
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value === '' ? '' : Number(e.target.value));
                setCustomTime(false);
              }}
              aria-label="Period"
              className={inputCls}
            >
              <option value="">Choose a period</option>
              {PERIODS.map((p) => (
                <option key={p.n} value={p.n}>
                  Period {p.n} ({p.start} to {p.end})
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Non-blocking warning. The save button stays enabled on purpose. */}
        {clash.length > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
            <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Period {effectivePeriod} already has {clash.map((c) => c.title).join(', ')} on this day.
              You can still save.
            </span>
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">
              Start <span className="text-content-tertiary">(optional)</span>
            </span>
            <input
              type="time"
              value={shownStart}
              onChange={(e) => setStartTime(e.target.value)}
              readOnly={timesFromPeriod}
              aria-label="Start time"
              className={`${inputCls} ${timesFromPeriod ? 'opacity-70' : ''}`}
            />
          </label>
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">
              End <span className="text-content-tertiary">(optional)</span>
            </span>
            <input
              type="time"
              value={shownEnd}
              onChange={(e) => setEndTime(e.target.value)}
              readOnly={timesFromPeriod}
              aria-label="End time"
              className={`${inputCls} ${timesFromPeriod ? 'opacity-70' : ''}`}
            />
          </label>
        </div>

        {/* Only meaningful while a period owns the times. */}
        {timesFromPeriod && (
          <button
            type="button"
            onClick={() => {
              setCustomTime(true);
              // Seed the editable fields with the period's times so switching
              // to custom does not blank them.
              setStartTime(shownStart);
              setEndTime(shownEnd);
            }}
            className="self-start text-xs text-content-secondary hover:text-content-primary underline underline-offset-2 transition-colors"
          >
            Custom time
          </button>
        )}
        {customTime && effectivePeriod != null && (
          <button
            type="button"
            onClick={() => setCustomTime(false)}
            className="self-start text-xs text-content-secondary hover:text-content-primary underline underline-offset-2 transition-colors"
          >
            Use period {effectivePeriod} times
          </button>
        )}

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

        {/* Repeat rule (stored once on the event) */}
        <div className="rounded-xl border border-border bg-bg-elevated/40 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Repeat className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs font-semibold text-content-primary">Repeat</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {REPEAT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRecurrenceType(opt.value)}
                className={`min-h-[40px] rounded-lg border text-xs font-semibold transition-all ${
                  recurrenceType === opt.value
                    ? 'bg-accent-subtle border-accent/50 text-accent'
                    : 'bg-bg-surface border-border text-content-tertiary hover:border-border-strong'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {recurrenceType === 'weekly' && (
            <div>
              <span className="block text-xs text-content-secondary mb-1.5">On these days</span>
              <div className="grid grid-cols-7 gap-1.5">
                {DAY_CHIPS.map((d, index) => {
                  const active = daysOfWeek.includes(d.value);
                  return (
                    <button
                      key={`${d.value}-${index}`}
                      onClick={() =>
                        setDaysOfWeek((current) =>
                          current.includes(d.value)
                            ? current.filter((x) => x !== d.value)
                            : [...current, d.value].sort((a, b) => a - b)
                        )
                      }
                      className={`min-h-[40px] rounded-lg border text-xs font-bold transition-all ${
                        active
                          ? 'bg-accent text-white border-accent'
                          : 'bg-bg-surface border-border text-content-tertiary'
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {recurrenceType === 'custom' && (
            <label className="block">
              <span className="block text-xs text-content-secondary mb-1">Every N days</span>
              <input
                type="number"
                min={1}
                max={365}
                value={interval}
                onChange={(e) => setIntervalDays(Number(e.target.value))}
                className={inputCls}
              />
            </label>
          )}

          {recurrenceType !== 'none' && (
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: 'never', label: 'Never ends' },
                  { value: 'date', label: 'On date' },
                  { value: 'count', label: 'After N' },
                ] as { value: EndMode; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setEndMode(opt.value)}
                  className={`min-h-[40px] rounded-lg border text-xs font-semibold transition-all ${
                    endMode === opt.value
                      ? 'bg-accent-subtle border-accent/50 text-accent'
                      : 'bg-bg-surface border-border text-content-tertiary hover:border-border-strong'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {recurrenceType !== 'none' && endMode === 'date' && (
            <label className="block">
              <span className="block text-xs text-content-secondary mb-1">Repeat until</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputCls}
              />
            </label>
          )}

          {recurrenceType !== 'none' && endMode === 'count' && (
            <label className="block">
              <span className="block text-xs text-content-secondary mb-1">Occurrences</span>
              <input
                type="number"
                min={1}
                max={500}
                value={endCount}
                onChange={(e) => setEndCount(Number(e.target.value))}
                className={inputCls}
              />
            </label>
          )}
        </div>

        {/* Series scope — shown when editing/deleting a recurring event */}
        {editingRecurring && (
          <div className="rounded-xl border border-border bg-bg-elevated/40 p-3 space-y-2">
            <span className="block text-xs font-semibold text-content-primary">
              Apply changes to
            </span>
            <div className="grid grid-cols-1 gap-2">
              {(
                [
                  { value: 'this', label: 'This event only' },
                  { value: 'future', label: 'This and all future occurrences' },
                  { value: 'all', label: 'All occurrences' },
                ] as { value: SeriesScope; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setScope(opt.value)}
                  className={`min-h-[40px] px-3 rounded-lg border text-xs font-semibold text-left transition-all ${
                    scope === opt.value
                      ? 'bg-accent-subtle border-accent/50 text-accent'
                      : 'bg-bg-surface border-border text-content-tertiary hover:border-border-strong'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-content-tertiary">
              Occurrences are computed from the rule — nothing is pre-generated.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-4">
          {event ? (
            <button
              onClick={remove}
              disabled={saving}
              className={`flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl text-sm font-medium transition-colors ${
                confirmDelete ? 'bg-rose-600 text-white' : 'text-rose-500 hover:bg-rose-500/10'
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
