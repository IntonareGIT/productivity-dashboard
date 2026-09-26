import React, { useEffect, useMemo, useState } from 'react';
import { format, isToday, isBefore, parseISO } from 'date-fns';
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { ResourceModal } from './ResourceModal';
import { deleteResource, toggleResourceCompleted, updateSubjectNotes } from '../libraryRepo';
import type { Resource, Subject } from '../../../types';

interface SubjectDetailProps {
  subject: Subject;
  resources: Resource[]; // resources belonging to this subject
  onBack: () => void;
  onEditSubject: () => void;
  onDeleteSubject: () => void;
}

const isUrl = (value: string) => /^https?:\/\//i.test(value);

function dueMeta(resource: Resource): { label: string; classes: string } {
  if (resource.completed) return { label: 'Done', classes: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' };
  if (!resource.dueDate) return { label: '', classes: '' };
  const due = parseISO(resource.dueDate);
  if (isBefore(due, parseISO(format(new Date(), 'yyyy-MM-dd')))) {
    return { label: `Overdue ${resource.dueDate}`, classes: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' };
  }
  if (isToday(due)) {
    return { label: 'Due today', classes: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' };
  }
  return { label: `Due ${resource.dueDate}`, classes: 'bg-bg-elevated text-content-secondary' };
}

/**
 * Two-pane subject detail: notes on the left, linked resources (with tags
 * and due dates) on the right. Stacks to a single column below md.
 */
export const SubjectDetail: React.FC<SubjectDetailProps> = ({
  subject,
  resources,
  onBack,
  onEditSubject,
  onDeleteSubject,
}) => {
  const [notesDraft, setNotesDraft] = useState(subject.notes);
  const [notesSaved, setNotesSaved] = useState(false);
  const [filter, setFilter] = useState('');
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [addingResource, setAddingResource] = useState(false);
  const [confirmDeleteSubject, setConfirmDeleteSubject] = useState(false);
  const [deleteResourceId, setDeleteResourceId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Reset drafts when a different subject opens.
  useEffect(() => {
    setNotesDraft(subject.notes);
    setNotesSaved(false);
    setFilter('');
    setDeleteResourceId(null);
    setConfirmDeleteSubject(false);
  }, [subject.id, subject.notes]);

  const notesDirty = notesDraft !== subject.notes;

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const sorted = [...resources].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return a.title.localeCompare(b.title);
    });
    if (!q) return sorted;
    return sorted.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.urlOrPath.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [resources, filter]);

  const saveNotes = async () => {
    await updateSubjectNotes(subject.id, notesDraft);
    setNotesSaved(true);
    window.setTimeout(() => setNotesSaved(false), 1500);
  };

  const copyPath = async (resource: Resource) => {
    try {
      await navigator.clipboard.writeText(resource.urlOrPath);
      setCopiedId(resource.id);
      window.setTimeout(() => setCopiedId(null), 1200);
    } catch {
      // Clipboard unavailable (non-secure context) — ignore silently.
    }
  };

  return (
    <div className="space-y-4">
      {/* Detail header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            aria-label="Back to subjects"
            className="p-2.5 rounded-xl border border-border bg-bg-surface hover:bg-bg-elevated text-content-secondary hover:text-content-primary transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span
            className="w-4 h-4 rounded-full shrink-0"
            style={{ backgroundColor: subject.color }}
          />
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-content-primary truncate">
              {subject.name}
            </h1>
            {subject.description && (
              <p className="text-xs text-content-tertiary truncate">{subject.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={onEditSubject}
            className="flex items-center gap-1.5 px-3.5 min-h-[44px] rounded-xl border border-border bg-bg-surface hover:bg-bg-elevated text-sm font-medium text-content-primary transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
          <button
            onClick={() => (confirmDeleteSubject ? onDeleteSubject() : setConfirmDeleteSubject(true))}
            className={`flex items-center gap-1.5 px-3.5 min-h-[44px] rounded-xl text-sm font-medium transition-colors ${
              confirmDeleteSubject ? 'bg-rose-600 text-white' : 'text-rose-500 hover:bg-rose-500/10 border border-rose-500/30'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {confirmDeleteSubject ? 'Confirm?' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Two panes: notes | resources (stacked below md) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {/* Notes pane */}
        <Card
          title="Notes"
          action={
            <button
              onClick={saveNotes}
              disabled={!notesDirty}
              className={`px-3.5 py-1.5 min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
                notesSaved
                  ? 'bg-emerald-600 text-white'
                  : notesDirty
                  ? 'bg-accent hover:bg-accent-hover text-white'
                  : 'bg-bg-elevated text-content-tertiary cursor-not-allowed'
              }`}
            >
              {notesSaved ? 'Saved ✓' : 'Save'}
            </button>
          }
        >
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            placeholder={`Write your ${subject.name} notes here…`}
            rows={14}
            className="w-full bg-bg-elevated/50 border border-border rounded-xl px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent resize-y placeholder:text-content-tertiary"
          />
        </Card>

        {/* Resources pane */}
        <Card
          title="Resources"
          subtitle={`${resources.length} linked · ${resources.filter((r) => r.completed).length} done`}
          action={
            <button
              onClick={() => setAddingResource(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-semibold bg-accent hover:bg-accent-hover text-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          }
        >
          <div className="space-y-3">
            {resources.length > 3 && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by title, URL or tag…"
                  className="w-full bg-bg-elevated/50 border border-border rounded-lg pl-9 pr-3 py-2.5 text-xs text-content-primary outline-none focus:border-accent placeholder:text-content-tertiary"
                />
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="py-8 text-center text-content-tertiary">
                <FileText className="w-6 h-6 mx-auto mb-1.5 opacity-50" />
                <p className="text-xs">
                  {resources.length === 0
                    ? 'No resources yet — add a link or file reference.'
                    : 'No resources match your filter.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((resource) => {
                  const due = dueMeta(resource);
                  const url = isUrl(resource.urlOrPath);
                  return (
                    <div
                      key={resource.id}
                      className="rounded-xl border border-border bg-bg-elevated/40 p-3"
                    >
                      <div className="flex items-start gap-2.5">
                        <button
                          onClick={() => toggleResourceCompleted(resource)}
                          aria-label={resource.completed ? 'Mark as not done' : 'Mark as done'}
                          className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                            resource.completed
                              ? 'bg-emerald-500 border-emerald-500 text-white'
                              : 'border-border-strong hover:border-accent'
                          }`}
                        >
                          {resource.completed && <Check className="w-3 h-3" />}
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-sm font-medium truncate ${
                                resource.completed
                                  ? 'text-content-tertiary line-through'
                                  : 'text-content-primary'
                              }`}
                            >
                              {resource.title}
                            </span>
                            {due.label && (
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${due.classes}`}>
                                {due.label}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 mt-1 min-w-0">
                            {url ? (
                              <a
                                href={resource.urlOrPath}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 text-xs text-accent hover:underline truncate"
                              >
                                <ExternalLink className="w-3 h-3 shrink-0" />
                                <span className="truncate">{resource.urlOrPath}</span>
                              </a>
                            ) : (
                              <button
                                onClick={() => copyPath(resource)}
                                title="Copy path"
                                className="flex items-center gap-1 text-xs text-content-secondary hover:text-accent transition-colors min-w-0"
                              >
                                <FileText className="w-3 h-3 shrink-0" />
                                <span className="font-mono truncate">{resource.urlOrPath}</span>
                                <Copy className="w-3 h-3 shrink-0" />
                                {copiedId === resource.id && (
                                  <span className="text-emerald-500">copied</span>
                                )}
                              </button>
                            )}
                          </div>

                          {resource.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {resource.tags.map((tag, i) => (
                                <span
                                  key={`${tag}-${i}`}
                                  className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-accent-subtle text-accent-text"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => setEditingResource(resource)}
                            aria-label="Edit resource"
                            className="p-3 md:p-2 -m-0.5 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
                          >
                            <Pencil className="w-4 h-4 md:w-3.5 md:h-3.5" />
                          </button>
                          <button
                            onClick={() =>
                              deleteResourceId === resource.id
                                ? deleteResource(resource.id)
                                : setDeleteResourceId(resource.id)
                            }
                            aria-label="Delete resource"
                            className={`p-3 md:p-2 -m-0.5 rounded-lg transition-colors ${
                              deleteResourceId === resource.id
                                ? 'bg-rose-600 text-white'
                                : 'text-content-tertiary hover:text-rose-500 hover:bg-rose-500/10'
                            }`}
                          >
                            <Trash2 className="w-4 h-4 md:w-3.5 md:h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      </div>

      {(addingResource || editingResource) && (
        <ResourceModal
          subjectId={subject.id}
          resource={editingResource}
          onClose={() => {
            setEditingResource(null);
            setAddingResource(false);
          }}
        />
      )}
    </div>
  );
};

