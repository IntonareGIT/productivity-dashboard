import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, addMonths, format, startOfMonth, startOfWeek } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { db } from '../../db/db';
import type { Assessment, CalendarEvent, Subject } from '../../types';
import { buildShiftContext, resolveDay, type DayKind } from '../shifts/shiftLogic';
import { occurrencesInRange, isRecurring, type Occurrence } from './recurrence';
import { deleteEvent, deleteEventWithScope } from './eventsRepo';
import { CATEGORIES } from './categories';
import { MonthView } from './components/MonthView';
import { WeekView } from './components/WeekView';
import { EventModal } from './components/EventModal';
import { DayPanel, type DayItem } from './components/DayPanel';
import { useOpenSubjectStore } from '../../stores/useOpenSubjectStore';

type ViewMode = 'month' | 'week';

interface CalendarPageProps {
  /** Bumped by the command palette's "New event" to open today's modal. */
  quickAddNonce?: number;
  /** Ask the Library to open a subject (used by the day panel). */
  onOpenSubject?: (subjectId: string) => void;
}

export const CalendarPage: React.FC<CalendarPageProps> = ({
  quickAddNonce = 0,
  onOpenSubject,
}) => {
  const requestSubject = useOpenSubjectStore((s) => s.request);
  const [view, setView] = useState<ViewMode>('month');
  const [anchor, setAnchor] = useState(new Date());
  const [newDate, setNewDate] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  /** The day whose full list is shown in the panel. Null = closed. */
  const [openDay, setOpenDay] = useState<string | null>(null);

  // Visible range: 42 cells for the month grid, 7 days for the week view.
  const [rangeStart, rangeEnd] = useMemo(() => {
    const start =
      view === 'month'
        ? startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 })
        : startOfWeek(anchor, { weekStartsOn: 1 });
    const count = view === 'month' ? 42 : 7;
    return [start, addDays(start, count - 1)] as const;
  }, [anchor, view]);

  // KEY STRING for the range. The live queries below close over this string
  // rather than two Date objects, so a query re-runs only when the visible
  // window actually moves. Formatting dates as a dependency would create a new
  // string identity on every render and defeat the caching entirely.
  const rangeKey = `${format(rangeStart, 'yyyy-MM-dd')}_${format(rangeEnd, 'yyyy-MM-dd')}`;
  const rangeStartKey = format(rangeStart, 'yyyy-MM-dd');
  const rangeEndKey = format(rangeEnd, 'yyyy-MM-dd');

  /**
   * Fetch ONLY what the visible range can show.
   *
   * `date` is indexed, so `between` walks the index instead of the whole table.
   * Two groups are needed:
   *
   *  - events whose anchor is INSIDE the range (indexed `between`): the
   *    overwhelming majority, and usually all of them;
   *  - every RECURRING series regardless of anchor, because a weekly lecture
   *    anchored in January still occurs in October. Those are found with one
   *    extra filtered read, and a series table is tiny next to one-off events.
   *
   * Non-recurring events anchored outside the range are never fetched: they
   * cannot occur in it, so loading them was pure waste. With several hundred
   * events this is the difference between reading the table and reading a
   * month of it.
   */
  const rangeEvents = useLiveQuery(
    async () => {
      const inside = await db.calendarEvents
        .where('date')
        .between(rangeStartKey, rangeEndKey, true, true)
        .toArray();
      const recurring = (await db.calendarEvents.toArray()).filter(
        (e) => (e.recurrenceType ?? 'none') !== 'none' && e.date < rangeStartKey
      );
      // Deduplicate: a recurring event inside the range is in both lists.
      const seen = new Set(inside.map((e) => e.id));
      return [...inside, ...recurring.filter((e) => !seen.has(e.id))];
    },
    [rangeKey]
  ) ?? [];

  const subjects = useLiveQuery(() => db.subjects.toArray()) ?? [];
  const schedules = useLiveQuery(() => db.weeklySchedules.toArray()) ?? [];
  const overrides = useLiveQuery(() => db.shiftOverrides.toArray()) ?? [];
  const assessments = useLiveQuery(() => db.assessments.toArray()) ?? [];

  const subjectsById = useMemo(() => {
    const map: Record<string, Subject> = {};
    for (const s of subjects) map[s.id] = s;
    return map;
  }, [subjects]);

  /**
   * Assessments WITH a date, grouped by that date.
   *
   * Derived LIVE from the assessments table and never copied into
   * `calendarEvents`. That is the whole point: changing or deleting an
   * assessment date updates the calendar immediately, and nothing is
   * duplicated or synced twice.
   */
  const assessmentsByDate = useMemo(() => {
    const map: Record<string, Assessment[]> = {};
    for (const a of assessments) {
      const d = (a.date ?? '').trim();
      if (!d) continue; // no chosen date => does not appear on the calendar
      (map[d] ??= []).push(a);
    }
    return map;
  }, [assessments]);

  // Date of the clicked occurrence (needed for series-scope edits/deletes).
  const [occurrenceDate, setOccurrenceDate] = useState<string | null>(null);

  // Command palette quick-add: jump to today and open the new-event modal.
  useEffect(() => {
    if (quickAddNonce > 0) {
      setEditingEvent(null);
      setNewDate(format(new Date(), 'yyyy-MM-dd'));
    }
  }, [quickAddNonce]);

  // Recurring series are expanded dynamically — no occurrence rows exist.
  // Memoised on the exact inputs, so unrelated state changes (opening a panel,
  // typing in a form) do not re-expand every series.
  const occurrencesByDate = useMemo(
    () => occurrencesInRange(rangeEvents, rangeStart, rangeEnd),
    [rangeEvents, rangeKey]
  );

  // Shift tint for every cell of the visible range (background only).
  // Uses each date's OWN week record; unassigned weeks stay untinted.
  const shiftKindByDate = useMemo(() => {
    const map: Record<string, DayKind> = {};
    const ctx = buildShiftContext(overrides, schedules);
    const count = view === 'month' ? 42 : 7;
    for (let i = 0; i < count; i++) {
      const d = addDays(rangeStart, i);
      map[format(d, 'yyyy-MM-dd')] = resolveDay(ctx, d).kind;
    }
    return map;
  }, [overrides, schedules, rangeStart, view]);

  /** Send the user to the subject that owns an assessment tapped on the calendar. */
  const handleOpenAssessment = (a: Assessment) => {
    setOpenDay(null);
    onOpenSubject?.(a.subjectId);
    requestSubject(a.subjectId);
  };

  const handleOccurrenceClick = (occurrence: Occurrence) => {
    setNewDate(null);
    setOccurrenceDate(occurrence.dateKey);
    setEditingEvent(occurrence.event);
  };

  /** Delete one occurrence, asking about scope first for a recurring series. */
  const confirmDelete = async (occurrence: Occurrence) => {
    const evt = occurrence.event;
    if (isRecurring(evt)) {
      const scope = window.confirm(
        `"${evt.title}" repeats.\n\nOK = this and future events\nCancel = this event only`,
      );
      await deleteEventWithScope(evt, occurrence.dateKey, scope ? 'future' : 'this');
    } else {
      if (!window.confirm(`Delete "${evt.title}"?`)) return;
      await deleteEvent(evt.id);
    }
  };

  /** The day's items for the panel: every event in time order, plus assessments. */
  const dayItems = useMemo<DayItem[]>(() => {
    if (!openDay) return [];
    const events = (occurrencesByDate[openDay] ?? []).map<DayItem>((occ) => {
      const subject = occ.event.subjectId ? subjectsById[occ.event.subjectId] : undefined;
      return {
        key: `${occ.event.id}-${occ.dateKey}`,
        kind: 'event',
        title: occ.event.title,
        startTime: occ.event.startTime ?? null,
        endTime: occ.event.endTime ?? null,
        subjectName: subject?.name ?? null,
        subjectColor: subject?.color ?? null,
        eventKind: occ.event.eventKind ?? null,
        period: occ.event.period ?? null,
        category: occ.event.category,
        occurrence: occ,
      };
    });
    // Assessments with a chosen date on this day, never copied into events.
    const items: DayItem[] = (assessmentsByDate[openDay] ?? []).map<DayItem>((a) => {
      const subject = subjectsById[a.subjectId];
      return {
        key: `a-${a.id}`,
        kind: 'assessment',
        title: a.name,
        startTime: null,
        endTime: null,
        subjectName: subject?.name ?? null,
        subjectColor: subject?.color ?? null,
        assessment: a,
      };
    });
    return [...events, ...items];
  }, [openDay, occurrencesByDate, assessmentsByDate, subjectsById]);

  const rangeLabel =
    view === 'month'
      ? format(anchor, 'MMMM yyyy')
      : `${format(startOfWeek(anchor, { weekStartsOn: 1 }), 'MMM d')} – ${format(
          addDays(startOfWeek(anchor, { weekStartsOn: 1 }), 6),
          'MMM d, yyyy'
        )}`;

  const step = (dir: 1 | -1) =>
    setAnchor((a) => (view === 'month' ? addMonths(a, dir) : addDays(a, dir * 7)));

  return (
    <div className="space-y-4">
      {/* Header: title, view switch, navigation, new event */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center space-x-2.5">
          <CalendarDays className="w-6 h-6 text-accent shrink-0" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-content-primary">
              Calendar
            </h1>
            <p className="text-xs text-content-tertiary">{rangeLabel}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View switch */}
          <div className="flex rounded-xl border border-border bg-bg-surface p-1">
            {(['month', 'week'] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3.5 py-1.5 min-h-[36px] rounded-lg text-xs font-semibold transition-colors capitalize ${
                  view === v
                    ? 'bg-accent text-white'
                    : 'text-content-secondary hover:text-content-primary'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => step(-1)}
              aria-label={view === 'month' ? 'Previous month' : 'Previous week'}
              className="p-2.5 min-w-[44px] rounded-xl border border-border bg-bg-surface hover:bg-bg-elevated text-content-secondary hover:text-content-primary transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setAnchor(new Date())}
              className="px-4 py-2.5 min-h-[44px] rounded-xl border border-border bg-bg-surface hover:bg-bg-elevated text-sm font-medium text-content-primary transition-colors"
            >
              Today
            </button>
            <button
              onClick={() => step(1)}
              aria-label={view === 'month' ? 'Next month' : 'Next week'}
              className="p-2.5 min-w-[44px] rounded-xl border border-border bg-bg-surface hover:bg-bg-elevated text-content-secondary hover:text-content-primary transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setNewDate(format(new Date(), 'yyyy-MM-dd'))}
            className="flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" />
            New event
          </button>
        </div>
      </div>

      {/* Calendar body (occurrences expanded for this range only) */}
      {view === 'month' ? (
        <MonthView
          anchor={anchor}
          occurrencesByDate={occurrencesByDate}
          subjectsById={subjectsById}
          shiftKindByDate={shiftKindByDate}
          assessmentsByDate={assessmentsByDate}
          today={new Date()}
          onDayClick={(dateKey) => setNewDate(dateKey)}
          onEventClick={handleOccurrenceClick}
          onOpenDay={setOpenDay}
          onOpenAssessment={handleOpenAssessment}
        />
      ) : (
        <WeekView
          anchor={anchor}
          occurrencesByDate={occurrencesByDate}
          subjectsById={subjectsById}
          shiftKindByDate={shiftKindByDate}
          assessmentsByDate={assessmentsByDate}
          today={new Date()}
          onDayClick={(dateKey) => setNewDate(dateKey)}
          onEventClick={handleOccurrenceClick}
          onOpenDay={setOpenDay}
          onOpenAssessment={handleOpenAssessment}
        />
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-content-tertiary">
        {CATEGORIES.map((c) => (
          <span key={c.value} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} /> {c.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-accent-subtle border border-accent/30" />
          Scheduled shift (background tint)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-0.5 h-3 rounded-sm bg-indigo-500" />
          Event linked to a subject (subject color)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm border border-dashed border-rose-500/60" />
          Assessment
        </span>
        <span>Tap a day to see everything on it</span>
      </div>

      {/* Full day panel: every event and assessment on the open day. */}
      {openDay && (
        <DayPanel
          dateKey={openDay}
          items={dayItems}
          onClose={() => setOpenDay(null)}
          onEditEvent={handleOccurrenceClick}
          // Delete really deletes. For a recurring series the modal is NOT used:
          // `confirmDelete` asks whether to remove this occurrence, this and
          // future, or the whole series, exactly as the grid always did.
          onDeleteEvent={(occ) => { void confirmDelete(occ); }}
          onAddEvent={() => {
            setNewDate(openDay);
            setOpenDay(null);
          }}
          onOpenAssessment={handleOpenAssessment}
        />
      )}

      {/* Event add/edit modal (occurrenceDate drives the series-scope prompt) */}
      <EventModal
        event={editingEvent}
        newDate={editingEvent ? null : newDate}
        occurrenceDate={occurrenceDate}
        subjectName={
          editingEvent?.subjectId ? subjectsById[editingEvent.subjectId]?.name : undefined
        }
        onClose={() => {
          setEditingEvent(null);
          setNewDate(null);
          setOccurrenceDate(null);
        }}
      />
    </div>
  );
};
