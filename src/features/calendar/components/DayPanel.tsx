import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { Clock, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Assessment } from '../../../types';
import { Z } from '../../../components/ui/zIndex';
import type { Occurrence } from '../recurrence';
import { CATEGORY_MAP, EVENT_KIND_LABEL, PERIODS } from '../categories';

/**
 * One day's events, in full.
 *
 * Replaces "first two events and +x more". The month grid stays a summary, and
 * this panel is the place to actually work with a day: every occurrence, in time
 * order, with add / edit / delete reachable without leaving the calendar.
 *
 * Desktop renders as a right-hand side panel; on mobile the same DOM is a bottom
 * sheet. One component, so the two layouts cannot drift apart.
 */

export interface DayItem {
  /** Stable key: distinguishes two occurrences of one recurring series. */
  key: string;
  kind: 'event' | 'assessment';
  title: string;
  /** HH:mm, or null for an all-day item. */
  startTime?: string | null;
  endTime?: string | null;
  subjectName?: string | null;
  subjectColor?: string | null;
  /** 'studying' | 'lecture' | 'section' | 'lab', when the event has one. */
  eventKind?: string | null;
  period?: number | null;
  category?: string;
  /** Present when kind === 'event'. */
  occurrence?: Occurrence;
  /** Present when kind === 'assessment'. */
  assessment?: Assessment;
}

interface DayPanelProps {
  dateKey: string;
  items: DayItem[];
  onClose: () => void;
  onEditEvent: (occurrence: Occurrence) => void;
  onDeleteEvent: (occurrence: Occurrence) => void;
  onAddEvent: () => void;
  /** Opens the assessment in its subject. */
  onOpenAssessment: (assessment: Assessment) => void;
}

function timeRange(item: DayItem): string {
  if (!item.startTime) return 'All day';
  return item.endTime ? `${item.startTime} to ${item.endTime}` : item.startTime;
}

/** "Period 3 (12:10 to 13:50)" — times come from the shared PERIODS list. */
function periodLabel(period: number | null | undefined): string | null {
  const p = PERIODS.find((x) => x.n === period);
  return p ? `Period ${p.n} (${p.start} to ${p.end})` : null;
}

export const DayPanel: React.FC<DayPanelProps> = ({
  dateKey, items, onClose, onEditEvent, onDeleteEvent, onAddEvent, onOpenAssessment,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const heading = useMemo(() => {
    const [y, m, d] = dateKey.split('-').map(Number);
    return format(new Date(y, m - 1, d), 'EEEE d MMMM yyyy');
  }, [dateKey]);

  const body = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Events on ${heading}`}
      data-day-panel
      className={`pointer-events-auto flex flex-col bg-bg-surface border-border shadow-2xl overflow-hidden fixed ${Z.modal} inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t md:inset-y-0 md:left-auto md:right-0 md:w-[420px] md:max-h-none md:rounded-none md:border-y-0 md:border-r-0`}
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border/60 bg-bg-elevated/50">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-content-tertiary font-semibold">Day</p>
          <h2 className="text-sm font-semibold text-content-primary truncate">{heading}</h2>
        </div>
        <button
          onClick={onClose}
          aria-label="Close day panel"
          className="p-2 -m-1 rounded-lg text-content-secondary hover:text-content-primary hover:bg-bg-elevated transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-content-tertiary py-6 text-center">Nothing on this day yet.</p>
        ) : (
          items.map((item) => {
            const accent = item.subjectColor ?? undefined;
            const per = periodLabel(item.period);
            const kindLabel = item.eventKind
              ? EVENT_KIND_LABEL[item.eventKind as keyof typeof EVENT_KIND_LABEL]
              : null;
            const badge = item.category
              ? CATEGORY_MAP[item.category as keyof typeof CATEGORY_MAP]?.badge
              : '';

            return (
              <div
                key={item.key}
                data-day-item={item.kind}
                className={`rounded-xl border border-border/70 bg-bg-elevated/40 p-2.5 ${item.kind === 'assessment' ? 'border-dashed' : ''}`}
                style={accent ? { borderLeftColor: accent, borderLeftWidth: '3px' } : undefined}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-content-primary break-words">{item.title}</p>
                    <p className="text-[11px] text-content-secondary flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {timeRange(item)}
                      </span>
                      {item.subjectName && (
                        <span className="inline-flex items-center gap-1" style={accent ? { color: accent } : undefined}>
                          {accent && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />}
                          {item.subjectName}
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-content-tertiary mt-0.5 flex flex-wrap gap-1.5">
                      {kindLabel && (
                        <span className={`px-1.5 py-0.5 rounded ${badge || 'bg-bg-elevated'}`}>{kindLabel}</span>
                      )}
                      {per && <span>{per}</span>}
                      {item.kind === 'assessment' && <span>Assessment</span>}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {item.kind === 'event' && item.occurrence ? (
                      <>
                        <button
                          onClick={() => onEditEvent(item.occurrence as Occurrence)}
                          aria-label={`Edit ${item.title}`}
                          className="p-2 rounded-lg text-content-secondary hover:text-content-primary hover:bg-bg-surface transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteEvent(item.occurrence as Occurrence)}
                          aria-label={`Delete ${item.title}`}
                          className="p-2 rounded-lg text-content-secondary hover:text-rose-500 hover:bg-bg-surface transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : item.assessment ? (
                      <button
                        onClick={() => onOpenAssessment(item.assessment as Assessment)}
                        aria-label={`Open ${item.title}`}
                        className="px-2 py-1.5 rounded-lg text-[11px] font-semibold border border-border text-content-secondary hover:text-content-primary transition-colors"
                      >
                        Open
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="p-3 border-t border-border/60">
        <button
          onClick={onAddEvent}
          aria-label="Add event to this day"
          className="w-full flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors"
        >
          <Plus className="w-4 h-4" /> Add event
        </button>
      </div>
    </div>
  );

  // Portalled so the grid's own overflow cannot clip it, and so it always sits
  // above the calendar chrome.
  const sheet = (
    <>
      <div className={`fixed inset-0 ${Z.backdrop} bg-black/40`} onClick={onClose} aria-hidden="true" />
      {body}
    </>
  );

  return typeof document === 'undefined' ? sheet : createPortal(sheet, document.body);
};