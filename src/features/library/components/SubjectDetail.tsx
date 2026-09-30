import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { endOfWeek, format, isBefore, isToday, isWithinInterval, parseISO, startOfWeek } from 'date-fns';
import { ArrowLeft, BookOpenCheck, CalendarClock, Check, ChevronRight, Columns2, Copy, Download, ExternalLink, Eye, FileText, FlaskConical, ListChecks, Pencil, Plus, Search, Timer, Trash2 } from 'lucide-react';
import { db } from '../../../db/db';
import { Card } from '../../../components/ui/Card';
import { toast } from '../../../stores/useToastStore';
import { MarkdownNotes, NoteTitleInput, NotesEditorBody } from './MarkdownNotes';
import { TopicModal } from './TopicModal';
import { ResourceModal } from './ResourceModal';
import { ResourceViewer } from './ResourceViewer';
import { ResourceFullScreen, useResourceFullScreen } from '../../split/useResourceFullScreen';
import { AssessmentModal } from './AssessmentModal';
import { MoveToGroupMenu } from './MoveToGroupMenu';
import { GroupNameEditor, NewGroupButton } from './ResourceGroups';
import { deleteAssessment, deleteResource, deleteResourceGroup, deleteTopicCascade, ensureDefaultTopic, renameResourceGroup, saveResourceGroup, setTopicStatus, toggleAssessmentStatus, toggleResourceCompleted, updateTopicNotes } from '../libraryRepo';
import type { Assessment, Resource, ResourceGroup, Subject, Topic, TopicStatus } from '../../../types';

interface SubjectDetailProps {
  subject: Subject;
  onBack: () => void;
  onEditSubject: () => void;
  onDeleteSubject: () => void;
  /** Open the split view with a PDF and its topic notes. */
  onSplitWithNotes?: (resourceId: string, topicId: string | null) => void;
}

const isUrl = (value: string | undefined) => /^https?:\/\//i.test(value ?? '');

const STATUS_META: Record<TopicStatus, { label: string; classes: string }> = {
  not_started: { label: 'Not started', classes: 'bg-bg-elevated text-content-secondary' },
  studying: { label: 'Studying', classes: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  confident: { label: 'Confident', classes: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
};

function dueMeta(resource: Resource): { label: string; classes: string } {
  if (resource.completed) return { label: 'Done', classes: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' };
  if (!resource.dueDate) return { label: '', classes: '' };
  const due = parseISO(resource.dueDate);
  if (isBefore(due, parseISO(format(new Date(), 'yyyy-MM-dd')))) return { label: `Overdue ${resource.dueDate}`, classes: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' };
  if (isToday(due)) return { label: 'Due today', classes: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' };
  return { label: `Due ${resource.dueDate}`, classes: 'bg-bg-elevated text-content-secondary' };
}

function fmtBytes(bytes?: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


interface ResourceRowProps {
  resource: Resource; copied: boolean; confirmDelete: boolean;
  onToggle: () => void; onEdit: () => void; onDelete: () => void;
  onCopy: () => void; onPreview: () => void; onDownload: () => void;
  /** Opens the split with this resource and its topic notes. */
  onSplitWithNotes?: (resourceId: string, topicId: string | null) => void;
  /** The topic currently selected in the detail view, for the notes fallback. */
  fallbackTopicId?: string | null;
  /** Groups of this subject, for the "Move to group" menu. */
  groups?: ResourceGroup[];
}

function ResourceRow({ resource, copied, confirmDelete, onToggle, onEdit, onDelete, onCopy, onPreview, onDownload, onSplitWithNotes, fallbackTopicId, groups }: ResourceRowProps) {
  const meta = dueMeta(resource);
  const isFile = resource.kind === 'file';
  return (
    <div className={`rounded-xl border p-3 ${resource.completed ? 'border-border bg-bg-elevated/30 opacity-70' : 'border-border bg-bg-elevated/40'}`}>
      <div className="flex items-start gap-2.5">
        <button onClick={onToggle} aria-label="Toggle complete" className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${resource.completed ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-border-strong text-transparent hover:border-emerald-500'}`}>
          <Check className="w-3.5 h-3.5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold ${resource.completed ? 'line-through text-content-tertiary' : 'text-content-primary'}`}>{resource.title}</span>
            {isFile && <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-sky-500/15 text-sky-600 dark:text-sky-400">FILE</span>}
            {meta.label && <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${meta.classes}`}>{meta.label}</span>}
          </div>
          <div className="mt-1.5">
            {isFile ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1 text-xs text-content-secondary min-w-0">
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="font-mono truncate">{resource.fileName || resource.title}</span>
                  {resource.fileSize != null && <span className="text-content-tertiary">({fmtBytes(resource.fileSize)})</span>}
                </span>
                <button onClick={onPreview} className="flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"><Eye className="w-3 h-3" /> Preview</button>
                {onSplitWithNotes && (
                  <button
                    onClick={() => onSplitWithNotes(resource.id, resource.topicId ?? fallbackTopicId ?? null)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-content-secondary hover:text-accent hover:underline"
                    title="Open side by side with this resource's topic notes"
                  >
                    <Columns2 className="w-3 h-3" /> Split with notes
                  </button>
                )}
                {resource.blob && <button onClick={onDownload} className="flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"><Download className="w-3 h-3" /> Download</button>}
              </div>
            ) : resource.urlOrPath ? (
              isUrl(resource.urlOrPath) ? (
                <a href={resource.urlOrPath} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-accent hover:underline min-w-0">
                  <ExternalLink className="w-3 h-3 shrink-0" /><span className="truncate">{resource.urlOrPath}</span>
                </a>
              ) : (
                <button onClick={onCopy} title="Copy path" className="flex items-center gap-1 text-xs text-content-secondary hover:text-accent min-w-0">
                  <FileText className="w-3 h-3 shrink-0" /><span className="font-mono truncate">{resource.urlOrPath}</span><Copy className="w-3 h-3 shrink-0" />
                  {copied && <span className="text-emerald-500">copied</span>}
                </button>
              )
            ) : (
              // A link row with no URL (e.g. an imported record). Show a
              // placeholder rather than an empty, dead "copy path" button.
              <span className="text-[11px] text-content-tertiary">No URL</span>
            )}
          </div>

          {resource.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {resource.tags.map((tag, i) => (<span key={`${tag}-${i}`} className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-accent-subtle text-accent-text">{tag}</span>))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {groups && <MoveToGroupMenu
            resourceId={resource.id}
            subjectId={resource.subjectId}
            currentGroupId={resource.groupId ?? null}
            groups={groups}
          />}
          <button onClick={onEdit} aria-label="Edit resource" className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
          <button onClick={onDelete} aria-label="Delete resource" className={`p-2 rounded-lg ${confirmDelete ? 'bg-rose-600 text-white' : 'text-content-tertiary hover:text-rose-500 hover:bg-rose-500/10'}`}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Subject detail: progress + topics grid + two-pane topic view + assessments + focus stats. */
export const SubjectDetail: React.FC<SubjectDetailProps> = ({ subject, onBack, onEditSubject, onDeleteSubject, onSplitWithNotes }) => {
  const topics = useLiveQuery(() => db.topics.where('subjectId').equals(subject.id).toArray(), [subject.id]) ?? [];
  const resources = useLiveQuery(() => db.resources.where('subjectId').equals(subject.id).toArray(), [subject.id]) ?? [];
  const groups = useLiveQuery(
    () => db.resourceGroups.where('subjectId').equals(subject.id).toArray(),
    [subject.id],
  ) ?? [];
  const assessments = useLiveQuery(() => db.assessments.where('subjectId').equals(subject.id).toArray(), [subject.id]) ?? [];
  const sessions = useLiveQuery(() => db.pomodoroSessions.where('subjectId').equals(subject.id).toArray(), [subject.id]) ?? [];

  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);
  const [filter, setFilter] = useState('');
  const [addingTopic, setAddingTopic] = useState(false);
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  const [addingResource, setAddingResource] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  // The resource currently open in the preview modal, if any.
  const [previewingResource, setPreviewingResource] = useState<Resource | null>(null);
  // Real-browser full screen for the preview, wired through the SAME shared
  // hook the split view uses.
  const { fullScreenResource, openFullScreen, closeFullScreen } = useResourceFullScreen();
  const [addingAssessment, setAddingAssessment] = useState(false);
  const [editingAssessment, setEditingAssessment] = useState<Assessment | null>(null);
  const [confirmDeleteSubject, setConfirmDeleteSubject] = useState(false);
  const [deleteResourceId, setDeleteResourceId] = useState<string | null>(null);
  const [deleteTopicId, setDeleteTopicId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  /** Collapsed group ids. A Set keyed by id so expanding one is a single change. */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  /** Which group is showing its inline rename box, and which awaits delete confirmation. */
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);

  /**
   * Run a group write and REPORT the failure.
   *
   * These used to be `void saveResourceGroup(...)` with no error handling, so a
   * rejected Dexie write (or a validation throw) vanished and the UI looked
   * unresponsive. Every group action now awaits and surfaces the reason as a
   * toast, so "nothing happened" is never a silent state.
   */
  const runGroupAction = useCallback(async (
    what: string,
    work: () => Promise<unknown>,
  ): Promise<boolean> => {
    try {
      await work();
      return true;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      toast('error', `Could not ${what}`, reason);
      return false;
    }
  }, []);

  const createGroup = useCallback(async (name: string) => {
    const ok = await runGroupAction('create group', () => saveResourceGroup({ subjectId: subject.id, name }));
    if (ok) toast('success', 'Group created', name);
  }, [runGroupAction, subject.id]);

  const renameGroup = useCallback(async (groupId: string, name: string) => {
    const ok = await runGroupAction('rename group', () => renameResourceGroup(groupId, name));
    if (ok) toast('success', 'Group renamed', name);
  }, [runGroupAction]);

  const removeGroup = useCallback(async (groupId: string, name: string) => {
    // Deleting a group UNGROUPS its resources; it never deletes them.
    const ok = await runGroupAction('delete group', () => deleteResourceGroup(groupId));
    if (ok) toast('success', 'Group deleted', `${name} was removed. Its resources were kept.`);
  }, [runGroupAction]);

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt)),
    [groups],
  );
  const toggleGroupCollapsed = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (topics.length === 0) void ensureDefaultTopic(subject.id);
  }, [topics.length, subject.id, subject.notes]);

  const sortedTopics = useMemo(
    () => [...topics].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)),
    [topics]
  );
  const selectedTopic: Topic | null = useMemo(() => {
    if (sortedTopics.length === 0) return null;
    return sortedTopics.find((t) => t.id === selectedTopicId) ?? sortedTopics[0];
  }, [sortedTopics, selectedTopicId]);

  useEffect(() => {
    setSelectedTopicId(null); setEditingNotes(false); setNotesDraft(''); setFilter('');
    setDeleteResourceId(null); setDeleteTopicId(null); setConfirmDeleteSubject(false);
  }, [subject.id]);

  useEffect(() => {
    setNotesDraft(selectedTopic?.notes ?? ''); setEditingNotes(false); setNotesSaved(false);
  }, [selectedTopic?.id, selectedTopic?.notes]);

  const confidentCount = topics.filter((t) => t.status === 'confident').length;
  const progressPct = topics.length > 0 ? Math.round((confidentCount / topics.length) * 100) : 0;

  const topicResources = useMemo(() => {
    if (!selectedTopic) return [];
    const q = filter.trim().toLowerCase();
    const list = resources.filter((r) => r.topicId === selectedTopic.id || (r.topicId == null && topics.length <= 1));
    const sorted = [...list].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return a.title.localeCompare(b.title);
    });
    if (!q) return sorted;
    return sorted.filter((r) => r.title.toLowerCase().includes(q) || (r.urlOrPath ?? '').toLowerCase().includes(q) || (r.fileName ?? '').toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q)));
  }, [resources, selectedTopic, filter, topics.length]);

  /** The resources with no group, shown after the grouped sections. */
  const ungroupedResources = useMemo(
    () => topicResources.filter((r) => !r.groupId),
    [topicResources],
  );

  const sortedAssessments = useMemo(() => [...assessments].sort((a, b) => a.date.localeCompare(b.date)), [assessments]);



  const focusStats = useMemo(() => {
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    const monthKey = format(now, 'yyyy-MM');
    const focus = sessions.filter((s) => s.sessionType === 'focus');
    const weekMin = focus.filter((s) => { try { return isWithinInterval(new Date(s.completedAt), { start: weekStart, end: weekEnd }); } catch { return false; } }).reduce((sum, s) => sum + s.durationMinutes, 0);
    const monthMin = focus.filter((s) => s.date.startsWith(monthKey)).reduce((sum, s) => sum + s.durationMinutes, 0);
    return { weekMin, monthMin, sessions: focus.length };
  }, [sessions]);

  const saveNotes = async () => {
    if (!selectedTopic) return;
    await updateTopicNotes(selectedTopic.id, notesDraft);
    setEditingNotes(false);
    setNotesSaved(true);
    window.setTimeout(() => setNotesSaved(false), 1500);
  };

  const copyPath = async (resource: Resource) => {
    // A file row has no path; there is nothing to copy.
    if (!resource.urlOrPath) return;
    try {
      await navigator.clipboard.writeText(resource.urlOrPath);
      setCopiedId(resource.id);
      window.setTimeout(() => setCopiedId((id) => (id === resource.id ? null : id)), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const downloadFile = (resource: Resource) => {
    if (!resource.blob) return;
    const url = URL.createObjectURL(resource.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = resource.fileName || resource.title;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const notesDirty = notesDraft !== (selectedTopic?.notes ?? '');

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onBack} aria-label="Back to subjects" className="p-2.5 -m-1 rounded-xl text-content-secondary hover:text-content-primary hover:bg-bg-elevated transition-colors shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: subject.color }} />
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-content-primary truncate">{subject.name}</h1>
            {subject.description && <p className="text-xs text-content-tertiary truncate">{subject.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onEditSubject} className="flex items-center gap-1.5 px-4 min-h-[44px] rounded-xl border border-border text-xs font-semibold text-content-secondary hover:text-content-primary hover:border-border-strong transition-colors">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          <button
            onClick={() => (confirmDeleteSubject ? onDeleteSubject() : setConfirmDeleteSubject(true))}
            onBlur={() => window.setTimeout(() => setConfirmDeleteSubject(false), 200)}
            className={`flex items-center gap-1.5 px-4 min-h-[44px] rounded-xl border text-xs font-semibold transition-colors ${confirmDeleteSubject ? 'bg-rose-600 border-rose-600 text-white' : 'border-border text-content-secondary hover:text-rose-500 hover:border-rose-500/40'}`}
          >
            <Trash2 className="w-3.5 h-3.5" /> {confirmDeleteSubject ? 'Confirm?' : 'Delete'}
          </button>
        </div>
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-content-primary">
            <BookOpenCheck className="w-4 h-4 text-accent" />
            {confidentCount} of {topics.length} topics Confident
          </span>
          <span className="text-xs font-mono text-content-secondary">{progressPct}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-bg-elevated overflow-hidden">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-content-secondary">
          <span className="flex items-center gap-1.5"><Timer className="w-3.5 h-3.5 text-accent" />{focusStats.weekMin} min focused this week</span>
          <span>{focusStats.monthMin} min this month</span>
          <span>{focusStats.sessions} linked sessions</span>
        </div>
      </Card>

      <Card
        title="Topics"
        subtitle="Select a topic to see its notes + resources"
        action={
          <button onClick={() => setAddingTopic(true)} className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold transition-colors">
            <Plus className="w-3.5 h-3.5" /> Topic
          </button>
        }
      >
        {sortedTopics.length === 0 ? (
          <p className="text-xs text-content-tertiary py-4 text-center">Creating the first topic…</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {sortedTopics.map((topic) => {
              const meta = STATUS_META[topic.status];
              const count = resources.filter((r) => r.topicId === topic.id).length;
              const active = selectedTopic?.id === topic.id;
              return (
                <div key={topic.id} className={`rounded-xl border p-3 transition-colors ${active ? 'border-accent bg-accent-subtle/40' : 'border-border bg-bg-elevated/40 hover:border-border-strong'}`}>
                  <button onClick={() => setSelectedTopicId(topic.id)} className="w-full text-left">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-semibold text-content-primary truncate">{topic.title}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${meta.classes}`}>{meta.label}</span>
                    </div>
                    <p className="text-[11px] text-content-tertiary">{count} resource{count === 1 ? '' : 's'}</p>
                  </button>
                  <div className="flex items-center gap-1 mt-2">
                    <button onClick={() => setEditingTopic(topic)} aria-label="Edit topic" className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                    <button
                      onClick={() => (deleteTopicId === topic.id ? void deleteTopicCascade(topic.id).then(() => setDeleteTopicId(null)) : setDeleteTopicId(topic.id))}
                      aria-label="Delete topic"
                      className={`p-2 rounded-lg transition-colors ${deleteTopicId === topic.id ? 'bg-rose-600 text-white' : 'text-content-tertiary hover:text-rose-500 hover:bg-rose-500/10'}`}
                    ><Trash2 className="w-3.5 h-3.5" /></button>
                    {deleteTopicId === topic.id && <span className="text-[10px] text-rose-500 font-semibold">tap again</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>


      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <Card
          title={selectedTopic ? `Notes — ${selectedTopic.title}` : 'Notes'}
          subtitle="Markdown, LaTeX and code supported"
          action={selectedTopic ? (
            <select value={selectedTopic.status} onChange={(e) => void setTopicStatus(selectedTopic.id, e.target.value as TopicStatus)} className="text-xs bg-bg-elevated border border-border rounded-lg px-2 py-1.5 text-content-primary outline-none focus:border-accent" aria-label="Topic status">
              <option value="not_started">Not started</option>
              <option value="studying">Studying</option>
              <option value="confident">Confident</option>
            </select>
          ) : undefined}
        >
          {!selectedTopic ? (
            <p className="text-xs text-content-tertiary">No topic selected.</p>
          ) : editingNotes ? (
            <div>
              <NoteTitleInput
                topic={selectedTopic}
                className="w-full bg-transparent border-none outline-none text-base font-semibold text-content-primary placeholder:text-content-tertiary/60 mb-1"
              />
              <NotesEditorBody
                value={notesDraft}
                onChange={setNotesDraft}
                minHeight="min-h-[280px]"
                textareaClassName="resize-y"
              />
              <div className="flex items-center justify-end gap-2 mt-2">
                <button onClick={() => { setNotesDraft(selectedTopic.notes); setEditingNotes(false); }} className="px-4 min-h-[40px] rounded-xl text-xs text-content-secondary hover:text-content-primary transition-colors">Cancel</button>
                <button onClick={saveNotes} disabled={!notesDirty} className="px-4 min-h-[40px] rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-xs font-semibold transition-colors">Save notes</button>
              </div>
            </div>
          ) : (
            <div>
              {/* Same title input as the split pane, above the body. */}
              <NoteTitleInput
                topic={selectedTopic}
                className="w-full bg-transparent border-none outline-none text-base font-semibold text-content-primary placeholder:text-content-tertiary/60 mb-1"
              />
              <MarkdownNotes text={selectedTopic.notes} />
              <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-border/50">
                {notesSaved && <span className="text-xs text-emerald-500 font-medium">Saved</span>}
                <button onClick={() => setEditingNotes(true)} className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl border border-border text-xs font-semibold text-content-secondary hover:text-content-primary hover:border-border-strong transition-colors">
                  <Pencil className="w-3.5 h-3.5" /> Edit notes
                </button>
              </div>
            </div>
          )}
        </Card>

        <Card
          title={selectedTopic ? `Resources — ${selectedTopic.title}` : 'Resources'}
          subtitle={`${topicResources.length} items`}
          action={selectedTopic ? (
            <button onClick={() => setAddingResource(true)} className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold transition-colors">
              <Plus className="w-3.5 h-3.5" /> Resource
            </button>
          ) : undefined}
        >
          <div className="relative mb-3">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter resources…" className="w-full bg-bg-elevated border border-border rounded-xl pl-9 pr-3 py-2.5 text-xs text-content-primary outline-none focus:border-accent placeholder:text-content-tertiary" />
          </div>
          {/* The group controls sit OUTSIDE the "no resources" branch on purpose.
              Previously they only existed when the topic already had resources,
              so a new empty topic could not host a group at all. */}
          <div className="mb-3">
            <NewGroupButton onCreate={createGroup} />
          </div>
          {topicResources.length === 0 ? (
            <p className="text-xs text-content-tertiary py-6 text-center">{filter ? 'No resources match.' : 'No resources for this topic yet.'}</p>
          ) : (
            <>
              <div className="space-y-2.5">
                {/*
                  Resources are bucketed by their group. A group is ALWAYS
                  rendered, including when it has no resources in this topic:
                  hiding empty groups is what made "New group" look broken,
                  because the row was written to Dexie and then never drawn.
                */}
                {sortedGroups.map((group) => {
                  const members = topicResources.filter((r) => r.groupId === group.id);
                  const collapsed = collapsedGroups.has(group.id);
                  return (
                    <div key={group.id} className="rounded-xl border border-border/70 bg-bg-elevated/20 p-2.5">
                      {/* Siblings, not a button inside a button: the collapse
                          toggle and the two actions are independent controls, and
                          nesting interactive elements is invalid HTML. */}
                      <div className="flex items-center gap-1 min-h-[40px]">
                        <button
                          onClick={() => toggleGroupCollapsed(group.id)}
                          aria-expanded={!collapsed}
                          aria-label={`${collapsed ? 'Expand' : 'Collapse'} group ${group.name}`}
                          className="flex items-center gap-2 min-h-[40px] min-w-0 flex-1 text-left"
                        >
                          <ChevronRight className={`w-3.5 h-3.5 shrink-0 text-content-tertiary transition-transform ${collapsed ? '' : 'rotate-90'}`} />
                          <span className="text-xs font-semibold text-content-primary truncate">{group.name}</span>
                          <span className="text-[10px] font-semibold text-content-tertiary shrink-0">{members.length}</span>
                        </button>
                        <button
                          onClick={() => setRenamingGroupId(group.id)}
                          aria-label={`Rename group ${group.name}`}
                          className="p-2 rounded-lg shrink-0 text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => (deleteGroupId === group.id
                            ? void removeGroup(group.id, group.name).then(() => setDeleteGroupId(null))
                            : setDeleteGroupId(group.id))}
                          aria-label={`Delete group ${group.name}`}
                          className={`p-2 rounded-lg shrink-0 ${deleteGroupId === group.id ? 'bg-rose-600 text-white' : 'text-content-tertiary hover:text-rose-500 hover:bg-rose-500/10'}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {renamingGroupId === group.id ? (
                        <div className="mt-2">
                          <GroupNameEditor
                            initialName={group.name}
                            placeholder="Group name"
                            submitLabel="Save"
                            onSubmit={(name) => { void renameGroup(group.id, name); setRenamingGroupId(null); }}
                            onCancel={() => setRenamingGroupId(null)}
                          />
                        </div>
                      ) : collapsed ? null : (
                        <div className="space-y-2.5 mt-2">
                          {members.length === 0 ? (
                            <p className="text-[11px] text-content-tertiary italic">No resources in this group yet. Use “Move to group” on a resource to add one.</p>
                          ) : members.map((resource) => (
                            <ResourceRow
                              key={resource.id}
                              resource={resource}
                              copied={copiedId === resource.id}
                              confirmDelete={deleteResourceId === resource.id}
                              onToggle={() => toggleResourceCompleted(resource)}
                              onEdit={() => setEditingResource(resource)}
                              onDelete={() => (deleteResourceId === resource.id ? void deleteResource(resource.id).then(() => setDeleteResourceId(null)) : setDeleteResourceId(resource.id))}
                              onCopy={() => copyPath(resource)}
                              onPreview={() => setPreviewingResource(resource)}
                              onDownload={() => downloadFile(resource)}
                              onSplitWithNotes={onSplitWithNotes}
                              fallbackTopicId={selectedTopic?.id ?? null}
                              groups={sortedGroups}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {ungroupedResources.length > 0 && (
                  <div className="space-y-2.5">
                    {ungroupedResources.map((resource) => (
                      <ResourceRow
                        key={resource.id}
                        resource={resource}
                        copied={copiedId === resource.id}
                        confirmDelete={deleteResourceId === resource.id}
                        onToggle={() => toggleResourceCompleted(resource)}
                        onEdit={() => setEditingResource(resource)}
                        onDelete={() => (deleteResourceId === resource.id ? void deleteResource(resource.id).then(() => setDeleteResourceId(null)) : setDeleteResourceId(resource.id))}
                        onCopy={() => copyPath(resource)}
                        onPreview={() => setPreviewingResource(resource)}
                        onDownload={() => downloadFile(resource)}
                        onSplitWithNotes={onSplitWithNotes}
                        fallbackTopicId={selectedTopic?.id ?? null}
                        groups={sortedGroups}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <Card
          title="Assessments"
          subtitle="Exams, quizzes, assignments and projects"
          action={
            <button onClick={() => setAddingAssessment(true)} className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold transition-colors">
              <Plus className="w-3.5 h-3.5" /> Assessment
            </button>
          }
        >
          {sortedAssessments.length === 0 ? (
            <p className="text-xs text-content-tertiary py-4 text-center">No assessments yet.</p>
          ) : (
            <div className="space-y-2.5">
              {sortedAssessments.map((a) => (
                <div key={a.id} className="rounded-xl border border-border bg-bg-elevated/40 p-3">
                  <div className="flex items-start gap-2.5">
                    <button onClick={() => toggleAssessmentStatus(a)} aria-label="Toggle done" className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${a.status === 'done' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-border-strong text-transparent hover:border-emerald-500'}`}>
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold ${a.status === 'done' ? 'line-through text-content-tertiary' : 'text-content-primary'}`}>{a.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-accent-subtle text-accent-text uppercase">{a.type}</span>
                        {a.weight != null && <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-bg-elevated text-content-secondary">{a.weight}%</span>}
                      </div>
                      <p className="text-[11px] text-content-secondary mt-1 flex items-center gap-1"><CalendarClock className="w-3 h-3" /> {a.date}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setEditingAssessment(a)} aria-label="Edit assessment" className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => void deleteAssessment(a.id)} aria-label="Delete assessment" className="p-2 rounded-lg text-content-tertiary hover:text-rose-500 hover:bg-rose-500/10 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Focus" subtitle="Linked pomodoro sessions for this subject">
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-xl bg-accent-subtle text-accent-text"><FlaskConical className="w-4 h-4" /></span>
            <div className="text-xs text-content-secondary">
              <p><span className="font-semibold text-content-primary">{focusStats.weekMin} min</span> this week</p>
              <p><span className="font-semibold text-content-primary">{focusStats.monthMin} min</span> this month · {focusStats.sessions} sessions</p>
            </div>
          </div>
          <p className="text-[11px] text-content-tertiary mt-3 flex items-center gap-1.5"><ListChecks className="w-3 h-3" /> Pick a subject and topic on the Focus page to link sessions here.</p>
        </Card>
      </div>

      {(addingTopic || editingTopic) && (
        <TopicModal subjectId={subject.id} topic={editingTopic} onClose={() => { setEditingTopic(null); setAddingTopic(false); }} />
      )}
      {(addingResource || editingResource) && (
        <ResourceModal subjectId={subject.id} topicId={selectedTopic?.id ?? null} resource={editingResource} onClose={() => { setEditingResource(null); setAddingResource(false); }} />
      )}
      {(addingAssessment || editingAssessment) && (
        <AssessmentModal subjectId={subject.id} assessment={editingAssessment} onClose={() => { setEditingAssessment(null); setAddingAssessment(false); }} />
      )}
      {previewingResource && (
        <ResourceViewer
          resource={previewingResource}
          onClose={() => setPreviewingResource(null)}
        />
      )}
      {/* The same shared full-screen preview the split view uses. */}
      <ResourceFullScreen resource={fullScreenResource} onClose={closeFullScreen} />
    </div>
  );
};

