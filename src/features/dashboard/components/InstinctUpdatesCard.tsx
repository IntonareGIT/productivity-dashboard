import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Sparkles, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { db } from '../../../db/db';
import { newId } from '../../../utils/id';
import { Card } from '../../../components/ui/Card';
import type { InstinctUpdate } from '../../../types';

/**
 * The one place the site links out to Instinct: the WhatsApp chat. Generated
 * through Instinct's own link builder; do not hand-edit the encoding.
 */
const INSTINCT_WHATSAPP_URL =
  'https://wa.me/16506588328?text=Hi%2C+I%27m+on+my+dashboard+and+need+a+hand+with+something.';

/** WhatsApp glyph, matching the lucide icons around it. */
const WhatsAppIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
  </svg>
);

const stamp = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : format(d, 'EEE, MMM d · h:mm a');
};

const KindBadge: React.FC<{ kind: InstinctUpdate['kind'] }> = ({ kind }) => (
  <span
    className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
      kind === 'daily'
        ? 'bg-accent-subtle text-accent-text'
        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    }`}
  >
    {kind === 'daily' ? 'DAILY' : 'UPDATE'}
  </span>
);

const Entry: React.FC<{ update: InstinctUpdate; defaultOpen?: boolean }> = ({ update, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border bg-bg-elevated/40 px-3 py-2.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left"
        aria-expanded={open}
      >
        <KindBadge kind={update.kind} />
        <span className="flex-1 min-w-0">
          <span className="block text-xs font-semibold text-content-primary truncate">
            {update.title}
          </span>
          <span className="block text-[10px] text-content-tertiary">{stamp(update.createdAt)}</span>
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-content-tertiary shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-content-tertiary shrink-0" />
        )}
      </button>
      {open && (
        <p className="mt-2 text-xs text-content-secondary whitespace-pre-wrap leading-relaxed">
          {update.body}
        </p>
      )}
    </div>
  );
};

/**
 * The homepage feed Instinct writes to: the nightly summary (posted with the
 * daily plan) plus any important update or reminder in between. Newest first,
 * the latest entry open by default, older ones a tap away.
 *
 * Writes are data, not code: the row lives in the synced `instinctUpdates`
 * table, so posting a new summary never needs a deploy. The composer is also
 * how Instinct itself posts when it drives the site UI, and the same table is
 * reachable from the console via `window.__db`.
 */
export const InstinctUpdatesCard: React.FC = () => {
  const updates = useLiveQuery(
    () => db.instinctUpdates.orderBy('createdAt').reverse().toArray(),
    [],
  ) ?? [];

  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const save = async () => {
    const trimmedBody = body.trim();
    if (!trimmedBody) return;
    const trimmedTitle = title.trim();
    await db.instinctUpdates.add({
      id: newId(),
      createdAt: new Date().toISOString(),
      kind: 'update',
      title: trimmedTitle || format(new Date(), "'Update - 'EEE, MMM d"),
      body: trimmedBody,
    });
    setTitle('');
    setBody('');
    setComposerOpen(false);
  };

  const [latest, ...older] = updates;

  return (
    <Card
      title="From Instinct"
      subtitle="Daily summary and anything worth knowing, newest first"
      action={
        <div className="flex items-center gap-3">
          <a
            href={INSTINCT_WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] font-semibold text-accent hover:underline"
            title="Open the Instinct WhatsApp chat in a new tab"
          >
            <WhatsAppIcon className="w-3.5 h-3.5" /> WhatsApp chat
          </a>
          <button
            onClick={() => setComposerOpen((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
            aria-expanded={composerOpen}
          >
            <Plus className="w-3 h-3" /> Add update
          </button>
        </div>
      }
    >
      {composerOpen && (
        <div className="mb-3 rounded-xl border border-border bg-bg-elevated/40 p-3 space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-bg text-xs text-content-primary placeholder:text-content-tertiary"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What should Omar know?"
            rows={4}
            className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-bg text-xs text-content-primary placeholder:text-content-tertiary resize-y"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => void save()}
              disabled={!body.trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-50"
            >
              Post
            </button>
            <button
              onClick={() => { setComposerOpen(false); setTitle(''); setBody(''); }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-content-secondary hover:bg-bg-elevated transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {updates.length === 0 && !composerOpen ? (
        <div className="flex items-start gap-2.5 text-xs text-content-tertiary">
          <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-accent" />
          <p>
            Nothing here yet. Instinct posts the daily summary with the daily
            plan, plus important updates and reminders in between.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {latest && <Entry update={latest} defaultOpen />}
          {older.length > 0 && (
            <div className="space-y-2">
              {older.map((u) => (
                <Entry key={u.id} update={u} />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
