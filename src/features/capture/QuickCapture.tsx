import React, { useState } from 'react';
import { Inbox, Link2, ListTodo, NotebookPen, Zap } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { newId } from '../../utils/id';
import { Modal } from '../../components/ui/Modal';
import type { QuickCapture } from '../../types';

type CaptureKind = 'task' | 'note' | 'link';

/**
 * Quick capture: one button in the top bar, everywhere. Dump a task, note or
 * link with zero decisions. Tasks land on the to-do list directly; notes and
 * links wait in the inbox for the assistant (fileCapture) or Instinct to sort
 * into the right subject.
 */
export const QuickCaptureButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const inboxCount =
    useLiveQuery(() => db.quickCaptures.where('status').equals('inbox').count(), []) ?? 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Quick capture"
        title="Quick capture: task, note or link"
        className="relative p-2 rounded-full text-content-secondary hover:bg-bg-elevated hover:text-accent transition-colors"
      >
        <Zap className="w-5 h-5" />
        {inboxCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center">
            {inboxCount}
          </span>
        )}
      </button>
      {open && <QuickCaptureModal open={open} onClose={() => setOpen(false)} />}
    </>
  );
};

const KINDS: { id: CaptureKind; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { id: 'task', label: 'Task', icon: ListTodo, hint: 'Goes straight to your to-do list.' },
  { id: 'note', label: 'Note', icon: NotebookPen, hint: 'Lands in the inbox; the assistant files it into a subject.' },
  { id: 'link', label: 'Link', icon: Link2, hint: 'Lands in the inbox; the assistant files it as a resource.' },
];

const QuickCaptureModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [kind, setKind] = useState<CaptureKind>('task');
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);

  const inbox = useLiveQuery(
    () => db.quickCaptures.where('status').equals('inbox').reverse().sortBy('createdAt'),
    []
  ) ?? [];

  const save = async () => {
    const value = text.trim();
    if (!value) return;
    if (kind === 'task') {
      await db.todos.add({
        id: newId(),
        title: value,
        done: false,
        createdAt: new Date().toISOString(),
      });
    } else {
      const capture: QuickCapture = {
        id: newId(),
        createdAt: new Date().toISOString(),
        kind,
        text: value,
        status: 'inbox',
      };
      await db.quickCaptures.add(capture);
    }
    setText('');
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <Modal open={open} onClose={onClose} title="Quick capture">
      <div className="space-y-3">
        <div className="flex gap-2">
          {KINDS.map((k) => {
            const Icon = k.icon;
            return (
              <button
                key={k.id}
                onClick={() => setKind(k.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                  kind === k.id
                    ? 'border-accent bg-accent-subtle text-accent'
                    : 'border-border text-content-secondary hover:bg-bg-elevated'
                }`}
              >
                <Icon className="w-4 h-4" /> {k.label}
              </button>
            );
          })}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save(); }}
          autoFocus
          rows={3}
          placeholder={kind === 'link' ? 'Paste the link…' : kind === 'note' ? 'Dump the thought…' : 'What needs doing?'}
          className="w-full bg-bg-elevated/50 border border-border rounded-xl px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent placeholder:text-content-tertiary resize-none"
        />
        <p className="text-[11px] text-content-tertiary">{KINDS.find((k) => k.id === kind)?.hint}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-xl text-xs font-semibold text-content-secondary hover:bg-bg-elevated">
            Close
          </button>
          <button
            onClick={() => void save()}
            disabled={!text.trim()}
            className="px-4 py-2 rounded-xl bg-accent text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40"
          >
            {saved ? 'Saved' : 'Capture'}
          </button>
        </div>

        {inbox.length > 0 && (
          <div className="border-t border-border pt-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-content-tertiary mb-1.5">
              <Inbox className="w-3.5 h-3.5" /> Inbox, waiting to be filed ({inbox.length})
            </p>
            <ul className="space-y-1 max-h-32 overflow-y-auto">
              {inbox.map((c) => (
                <li key={c.id} className="text-xs text-content-secondary truncate">
                  <span className="text-content-tertiary uppercase text-[10px] font-bold mr-1.5">{c.kind}</span>
                  {c.text}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
};

