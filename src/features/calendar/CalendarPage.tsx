import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, addMonths, format, startOfMonth, startOfWeek } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { db } from '../../db/db';
import { defaultShiftConfig } from '../../db/defaultData';
import type { CalendarEvent } from '../../types';
import { resolveDay } from '../shifts/shiftLogic';
import { indexOverridesByDate } from '../shifts/shiftsRepo';
import { CATEGORIES } from './categories';
import { groupEventsByDate } from './eventsRepo';
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
  const config = useLiveQuery(() => db.shiftConfig.get('default')) ?? defaultShiftConfig;
  const overrides = useLiveQuery(() => db.shiftOverrides.toArray()) ?? [];

  const eventsByDate = useMemo(() => groupEventsByDate(events), [events]);

  // Shift tint for every cell of the visible range (background only).
  const shiftKindByDate = useMemo(() => {
    const map: Record<string, 'work' | 'off' | 'pto'> = {};
    const overridesByDate = indexOverridesByDate(overrides);
    const rangeStart =
      view === 'month'
        ? startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 })
        : startOfWeek(anchor, { weekStartsOn: 1 });
    const count = view === 'month' ? 42 : 7;
    for (let i = 0; i < count; i++) {
      const d = addDays(rangeStart, i);
      map[format(d, 'yyyy-MM-dd')] = resolveDay(config, overridesByDate, d).kind;
    }
    return map;
  }, [config, overrides, anchor, view]);

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

      {/* Calendar body */}
      {view === 'month' ? (
        <MonthView
          anchor={anchor}
          eventsByDate={eventsByDate}
          shiftKindByDate={shiftKindByDate}
          today={new Date()}
          onDayClick={(dateKey) => setNewDate(dateKey)}
          onEventClick={(evt) => setEditingEvent(evt)}
        />
      ) : (
        <WeekView
          anchor={anchor}
          eventsByDate={eventsByDate}
          shiftKindByDate={shiftKindByDate}
          today={new Date()}
          onDayClick={(dateKey) => setNewDate(dateKey)}
          onEventClick={(evt) => setEditingEvent(evt)}
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
        <span>Tap a day to add an event</span>
      </div>

      {/* Event add/edit modal */}
      <EventModal
        event={editingEvent}
        newDate={editingEvent ? null : newDate}
        onClose={() => {
          setEditingEvent(null);
          setNewDate(null);
        }}
      />
    </div>
  );
};
