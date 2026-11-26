import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format, isBefore, parseISO } from 'date-fns';
import { Check, ListTodo, Pencil, Plus, Trash2, X } from 'lucide-react';
import { db } from '../../db/db';
import type { TodoItem } from '../../types';
import { addTodo, deleteTodo, setTodoDone, sortTodos, updateTodo } from './todosRepo';
import { TodoLinkPickers, TodoLinkBadge, emptyLink, type TodoLink } from './components/TodoLinkControls';

/**
 * The To-do tab: full control of the task list. The homepage card is the
 * read-mostly mirror; adding, editing and subject/topic/resource linking live
 * here.
 */
export const TodoPage: React.FC = () => {
  const todos = useLiveQuery(() => db.todos.toArray(), []) ?? [];
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  const topics = useLiveQuery(() => db.topics.toArray(), []) ?? [];
  const resources = useLiveQuery(() => db.resources.toArray(), []) ?? [];

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [link, setLink] = useState<TodoLink>(emptyLink);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDue, setEditDue] = useState('');
  const [editLink, setEditLink] = useState<TodoLink>(emptyLink);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const sorted = useMemo(() => sortTodos(todos), [todos]);
  const open = sorted.filter((t) => !t.done);
  const done = sorted.filter((t) => t.done);

  const lookups = useMemo(
    () => ({
      subjectName: (id?: string | null) => subjects.find((s) => s.id === id)?.name,
      topicTitle: (id?: string | null) => topics.find((t) => t.id === id)?.title,
      resourceTitle: (id?: string | null) => resources.find((r) => r.id === id)?.title,
    }),
    [subjects, topics, resources]
  );

  const submit = async () => {
    if (!title.trim()) return;
    await addTodo({
      title,
      dueDate: dueDate || null,
      subjectId: link.subjectId,
      topicId: link.topicId,
      resourceId: link.resourceId,
    });
    setTitle('');
    setDueDate('');
    setLink(emptyLink);
  };

  const startEdit = (t: TodoItem) => {
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditDue(t.dueDate ?? '');
    setEditLink({ subjectId: t.subjectId ?? null, topicId: t.topicId ?? null, resourceId: t.resourceId ?? null });
    setConfirmDeleteId(null);
  };

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim()) return;
    await updateTodo(editingId, {
      title: editTitle.trim(),
      dueDate: editDue || null,
      subjectId: editLink.subjectId,
      topicId: editLink.topicId,
      resourceId: editLink.resourceId,
    });
    setEditingId(null);
  };

  const dueLabel = (t: TodoItem) => {
    if (!t.dueDate) return null;
    const overdue = !t.done && isBefore(parseISO(t.dueDate), new Date(new Date().toDateString()));
    return (
      <span className={`text-[11px] font-semibold ${overdue ? 'text-rose-500' : 'text-content-tertiary'}`}>
        {overdue ? 'Overdue · ' : ''}{format(parseISO(t.dueDate), 'EEE, MMM d')}
      </span>
    );
  };

  const renderRow = (t: TodoItem) => {
    if (editingId === t.id) {
      return (
        <div key={t.id} className="rounded-xl border border-accent/40 bg-bg-elevated/40 p-3 space-y-2">
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2 text-sm text-content-primary outline-none focus:border-accent"
            aria-label="Task title"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={editDue}
              onChange={(e) => setEditDue(e.target.value)}
              className="bg-bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-content-primary outline-none focus:border-accent"
              aria-label="Due date"
            />
            <TodoLinkPickers link={editLink} onChange={setEditLink} subjects={subjects} topics={topics} resources={resources} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-content-secondary hover:bg-bg-elevated">Cancel</button>
            <button onClick={() => void saveEdit()} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white hover:opacity-90">Save</button>
          </div>
        </div>
      );
    }
    return (
      <div key={t.id} className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5 group">
        <button
          onClick={() => void setTodoDone(t.id, !t.done)}
          aria-label={t.done ? 'Reopen task' : 'Complete task'}
          className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
            t.done ? 'bg-accent border-accent text-white' : 'border-border hover:border-accent'
          }`}
        >
          {t.done && <Check className="w-3.5 h-3.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <p className={`text-sm truncate ${t.done ? 'line-through text-content-tertiary' : 'text-content-primary'}`}>{t.title}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {dueLabel(t)}
            <TodoLinkBadge todo={t} lookups={lookups} />
          </div>
        </div>
        {confirmDeleteId === t.id ? (
          <span className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => { void deleteTodo(t.id); setConfirmDeleteId(null); }}
              className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-rose-500/90 text-white"
            >
              Delete
            </button>
            <button onClick={() => setConfirmDeleteId(null)} className="p-1 rounded-lg text-content-tertiary hover:bg-bg-elevated" aria-label="Cancel delete">
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        ) : (
          <span className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button onClick={() => startEdit(t)} className="p-1.5 rounded-lg text-content-tertiary hover:bg-bg-elevated hover:text-content-primary" aria-label="Edit task">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setConfirmDeleteId(t.id)} className="p-1.5 rounded-lg text-content-tertiary hover:bg-rose-500/10 hover:text-rose-500" aria-label="Delete task">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2.5">
        <ListTodo className="w-6 h-6 text-accent" />
        <div>
          <h1 className="text-xl font-bold text-content-primary">To-do</h1>
          <p className="text-xs text-content-tertiary">
            Tasks can link to a subject, topic or resource, and open tasks can be picked as a Focus session target.
          </p>
        </div>
      </div>

      {/* Add form */}
      <div className="bg-bg-surface border border-border rounded-2xl p-4 space-y-2.5">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder="Add a task…"
            className="flex-1 bg-bg-elevated/50 border border-border rounded-xl px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent placeholder:text-content-tertiary"
          />
          <button
            onClick={() => void submit()}
            disabled={!title.trim()}
            className="px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="bg-bg-elevated/50 border border-border rounded-lg px-2 py-1.5 text-xs text-content-primary outline-none focus:border-accent"
            aria-label="Due date (optional)"
          />
          <TodoLinkPickers link={link} onChange={setLink} subjects={subjects} topics={topics} resources={resources} />
        </div>
      </div>

      {/* Open tasks */}
      <div className="space-y-2">
        {open.length === 0 && (
          <p className="text-sm text-content-tertiary text-center py-6">Nothing open. Add your first task above.</p>
        )}
        {open.map(renderRow)}
      </div>

      {/* Completed */}
      {done.length > 0 && (
        <div>
          <button
            onClick={() => setShowDone((v) => !v)}
            className="text-xs font-semibold text-content-tertiary hover:text-content-secondary"
          >
            {showDone ? 'Hide' : 'Show'} completed ({done.length})
          </button>
          {showDone && <div className="space-y-2 mt-2">{done.map(renderRow)}</div>}
        </div>
      )}
    </div>
  );
};
