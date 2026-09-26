import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, addMonths, format, startOfMonth, startOfWeek } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { db } from '../../db/db';
import type { CalendarEvent, Subject } from '../../types';
import { buildShiftContext, resolveDay, type DayKind } from '../shifts/shiftLogic';
import { occurrencesInRange, type Occurrence } from './recurrence';
import { CATEGORIES } from './categories';
import { MonthView } from './components/MonthView';
import { WeekView } from './components/WeekView';
import { EventModal } from './components/EventModal';

type ViewMode = 'month' | 'week';

interface CalendarPageProps {
  /** Bumped by the command palette's "New event" to open today's modal. */
  quickAddNonce?: number;
}

export const CalendarPage: React.FC<CalendarPageProps> = ({ quickAddNonce = 0 }) => {
  const [view, setView] = useState<ViewMode>('month');
  const [anchor, setAnchor] = useState(new Date());
  const [newDate, setNewDate] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  // Command palette quick-add: jump to today and open the new-event modal.
  useEffect(() => {
    if (quickAddNonce > 0) {
      setEditingEvent(null);
      setNewDate(format(new Date(), 'yyyy-MM-dd'));
    }
  }, [quickAddNonce]);

  const events = useLiveQuery(() => db.calendarEvents.toArray()) ?? [];
  const schedules = useLiveQuery(() => db.weeklySchedules.toArray()) ?? [];
  const overrides = useLiveQuery(() => db.shiftOverrides.toArray()) ?? [];
  const subjects = useLiveQuery(() => db.subjects.toArray()) ?? [];

  const subjectsById = useMemo(() => {
    const map: Record<string, Subject> = {};
    for (const s of subjects) map[s.id] = s;
    return map;
  }, [subjects]);

  // Date of the clicked occurrence (needed for series-scope edits/deletes).
  const [occurrenceDate, setOccurrenceDate] = useState<string | null>(null);

  // Visible range: 42 cells for the month grid, 7 days for the week view.
  const [rangeStart, rangeEnd] = useMemo(() => {
    const start =
      view === 'month'
        ? startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 })
        : startOfWeek(anchor, { weekStartsOn: 1 });
    const count = view === 'month' ? 42 : 7;
    return [start, addDays(start, count - 1)] as const;
  }, [anchor, view]);

  // Recurring series are expanded dynamically — no occurrence rows exist.
  const occurrencesByDate = useMemo(
    () => occurrencesInRange(events, rangeStart, rangeEnd),
    [events, rangeStart, rangeEnd]
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

  const handleOccurrenceClick = (occurrence: Occurrence) => {
    setNewDate(null);
    setOccurrenceDate(occurrence.dateKey);
    setEditingEvent(occurrence.event);
  };

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
          today={new Date()}
          onDayClick={(dateKey) => setNewDate(dateKey)}
          onEventClick={handleOccurrenceClick}
        />
      ) : (
        <WeekView
          anchor={anchor}
          occurrencesByDate={occurrencesByDate}
          subjectsById={subjectsById}
          shiftKindByDate={shiftKindByDate}
          today={new Date()}
          onDayClick={(dateKey) => setNewDate(dateKey)}
          onEventClick={handleOccurrenceClick}
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
          Lecture linked to a subject (subject color)
        </span>
        <span>Tap a day to add an event</span>
      </div>

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
