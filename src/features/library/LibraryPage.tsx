import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookMarked, FileText, FlaskConical, ListChecks, Plus, Search, X } from 'lucide-react';
import { db } from '../../db/db';
import type { Assessment, Resource, Subject, Topic } from '../../types';
import { deleteSubjectCascade } from './libraryRepo';
import { SubjectModal } from './components/SubjectModal';
import { SubjectDetail } from './components/SubjectDetail';

const STATUS_LABEL: Record<Topic['status'], string> = {
  not_started: 'Not started', studying: 'Studying', confident: 'Confident',
};

interface SubjectHits { subject: Subject; topics: Topic[]; resources: Resource[]; assessments: Assessment[]; }

interface LibraryPageProps {
  /** Open the split view with a PDF in one pane and its topic notes in the other. */
  onSplitWithNotes?: (resourceId: string, topicId: string | null) => void;
}

export const LibraryPage: React.FC<LibraryPageProps> = ({ onSplitWithNotes }) => {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subjectModal, setSubjectModal] = useState<{ open: boolean; subject: Subject | null }>({ open: false, subject: null });

  const subjects = useLiveQuery(() => db.subjects.toArray()) ?? [];
  const topics = useLiveQuery(() => db.topics.toArray()) ?? [];
  const resources = useLiveQuery(() => db.resources.toArray()) ?? [];
  const assessments = useLiveQuery(() => db.assessments.toArray()) ?? [];

  const selectedSubject = selectedId ? subjects.find((s) => s.id === selectedId) ?? null : null;
  const trimmedQuery = query.trim().toLowerCase();

  const topicsBySubject = useMemo(() => {
    const map: Record<string, Topic[]> = {};
    for (const t of topics) (map[t.subjectId] ??= []).push(t);
    return map;
  }, [topics]);
  const resourcesBySubject = useMemo(() => {
    const map: Record<string, Resource[]> = {};
    for (const r of resources) (map[r.subjectId] ??= []).push(r);
    return map;
  }, [resources]);
  const assessmentsBySubject = useMemo(() => {
    const map: Record<string, Assessment[]> = {};
    for (const a of assessments) (map[a.subjectId] ??= []).push(a);
    return map;
  }, [assessments]);
  const topicById = useMemo(() => {
    const map: Record<string, Topic> = {};
    for (const t of topics) map[t.id] = t;
    return map;
  }, [topics]);

  // Global search: topic titles/notes, resource titles, assessment names — grouped by subject.
  const searchHits: SubjectHits[] | null = useMemo(() => {
    if (!trimmedQuery) return null;
    const q = trimmedQuery;
    const out: SubjectHits[] = [];
    for (const s of subjects) {
      const sMatch = s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q);
      const tHits = (topicsBySubject[s.id] ?? []).filter((t) => t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q));
      const rHits = (resourcesBySubject[s.id] ?? []).filter((r) => r.title.toLowerCase().includes(q) || (r.fileName ?? '').toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q)));
      const aHits = (assessmentsBySubject[s.id] ?? []).filter((a) => a.name.toLowerCase().includes(q));
      if (sMatch || tHits.length > 0 || rHits.length > 0 || aHits.length > 0) out.push({ subject: s, topics: tHits, resources: rHits, assessments: aHits });
    }
    return out;
  }, [trimmedQuery, subjects, topicsBySubject, resourcesBySubject, assessmentsBySubject]);

  const matchedSubjects = useMemo(() => {
    const sorted = [...subjects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!trimmedQuery) return sorted;
    return (searchHits ?? []).map((h) => h.subject);
  }, [subjects, trimmedQuery, searchHits]);

  const openSubject = (id: string) => { setSelectedId(id); setQuery(''); };
  const handleDeleteSubject = async (id: string) => { await deleteSubjectCascade(id); setSelectedId(null); };
  const pendingDueCount = (subjectId: string): number =>
    (resourcesBySubject[subjectId] ?? []).filter((r) => r.dueDate && !r.completed).length +
    (assessmentsBySubject[subjectId] ?? []).filter((a) => a.status === 'upcoming').length;
  const confidentOf = (subjectId: string) => {
    const list = topicsBySubject[subjectId] ?? [];
    return { confident: list.filter((t) => t.status === 'confident').length, total: list.length };
  };

  // The subject dialog is rendered AFTER the view branch, not inside it.
  //
  // It used to sit at the bottom of the list view only, while the early
  // `return <SubjectDetail .../>` above skipped it entirely. So "Edit subject"
  // from inside a subject set `subjectModal.open`, re-rendered, and showed
  // nothing: the dialog existed only in the view you had to navigate BACK to.
  // Rendering it once, after the branch, makes it reachable from both.
  const subjectDialog = subjectModal.open ? (
    <SubjectModal
      subject={subjectModal.subject}
      onClose={() => setSubjectModal({ open: false, subject: null })}
    />
  ) : null;

  if (selectedSubject) {
    return (
      <>
        <SubjectDetail subject={selectedSubject} onBack={() => setSelectedId(null)} onSplitWithNotes={onSplitWithNotes} onEditSubject={() => setSubjectModal({ open: true, subject: selectedSubject })} onDeleteSubject={() => handleDeleteSubject(selectedSubject.id)} />
        {subjectDialog}
      </>
    );
  }


  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center space-x-2.5">
          <BookMarked className="w-6 h-6 text-accent shrink-0" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-content-primary">Study Library</h1>
            <p className="text-xs text-content-tertiary">{subjects.length} subjects · {topics.length} topics · {resources.length} resources</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 lg:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search topics, notes, resources, assessments…" className="w-full bg-bg-surface border border-border rounded-xl pl-9 pr-8 py-2.5 text-sm text-content-primary outline-none focus:border-accent placeholder:text-content-tertiary" />
            {query && <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-content-tertiary hover:text-content-primary"><X className="w-4 h-4" /></button>}
          </div>
          <button onClick={() => setSubjectModal({ open: true, subject: null })} className="flex items-center gap-1.5 px-4 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold shrink-0">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Subject</span>
          </button>
        </div>
      </div>

      {trimmedQuery && searchHits && (
        <div className="rounded-2xl border border-border bg-bg-surface p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-content-tertiary mb-3">{searchHits.length} matches</h2>
          {searchHits.length === 0 ? (
            <p className="text-sm text-content-tertiary">No matches in topics, notes, resources or assessments.</p>
          ) : (
            <div className="space-y-3">
              {searchHits.map((hit) => (
                <button key={hit.subject.id} onClick={() => openSubject(hit.subject.id)} className="w-full text-left rounded-xl border border-border bg-bg-elevated/40 hover:border-border-strong p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hit.subject.color }} />
                    <span className="text-sm font-semibold text-content-primary">{hit.subject.name}</span>
                  </div>
                  <div className="space-y-1">
                    {hit.topics.slice(0, 3).map((t) => (
                      <p key={t.id} className="text-xs text-content-secondary flex items-center gap-1.5 truncate"><ListChecks className="w-3 h-3 shrink-0 text-accent" /><span className="truncate">{t.title}</span><span className="text-content-tertiary shrink-0">· {STATUS_LABEL[t.status]}</span></p>
                    ))}
                    {hit.resources.slice(0, 3).map((r) => (
                      <p key={r.id} className="text-xs text-content-secondary flex items-center gap-1.5 truncate"><FileText className="w-3 h-3 shrink-0" /><span className="truncate">{r.title}</span>{r.topicId && topicById[r.topicId] && <span className="text-content-tertiary shrink-0">· {topicById[r.topicId].title}</span>}</p>
                    ))}
                    {hit.assessments.slice(0, 3).map((a) => (
                      <p key={a.id} className="text-xs text-content-secondary flex items-center gap-1.5 truncate"><FlaskConical className="w-3 h-3 shrink-0" /><span className="truncate">{a.name}</span><span className="text-content-tertiary shrink-0">· {a.type} · {a.date}</span></p>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {matchedSubjects.length === 0 ? (
        <div className="py-16 text-center text-content-tertiary">
          <BookMarked className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">{trimmedQuery ? 'No subjects match your search.' : 'No subjects yet.'}</p>
          {!trimmedQuery && (
            <button onClick={() => setSubjectModal({ open: true, subject: null })} className="mt-3 px-4 py-2 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold">Create your first subject</button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {matchedSubjects.map((subject) => {
            const pending = pendingDueCount(subject.id);
            const prog = confidentOf(subject.id);
            const pct = prog.total > 0 ? Math.round((prog.confident / prog.total) * 100) : 0;
            return (
              <button key={subject.id} onClick={() => openSubject(subject.id)} className="text-left rounded-2xl border border-border bg-bg-surface overflow-hidden hover:border-border-strong hover:-translate-y-0.5 transition-all">
                <div className="h-1.5" style={{ backgroundColor: subject.color }} />
                <div className="p-4">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: subject.color }} />
                    <span className="font-semibold text-sm text-content-primary truncate">{subject.name}</span>
                  </div>
                  {subject.description && <p className="text-xs text-content-tertiary mb-2 truncate">{subject.description}</p>}
                  <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden mb-2"><div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} /></div>
                  <div className="flex items-center justify-between text-[11px] text-content-secondary">
                    <span>{prog.total} topics · {prog.confident} confident</span>
                    {pending > 0 && <span className="px-1.5 py-0.5 rounded font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400">{pending} due</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {subjectDialog}
    </div>
  );
};
