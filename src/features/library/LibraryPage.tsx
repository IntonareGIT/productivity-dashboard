import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import { BookMarked, FileText, Plus, Search, X } from 'lucide-react';
import { db } from '../../db/db';
import type { Resource, Subject } from '../../types';
import { deleteSubjectCascade } from './libraryRepo';
import { SubjectModal } from './components/SubjectModal';
import { SubjectDetail } from './components/SubjectDetail';

export const LibraryPage: React.FC = () => {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subjectModal, setSubjectModal] = useState<{ open: boolean; subject: Subject | null }>({
    open: false,
    subject: null,
  });

  const subjects = useLiveQuery(() => db.subjects.toArray()) ?? [];
  const resources = useLiveQuery(() => db.resources.toArray()) ?? [];

  const selectedSubject = selectedId
    ? subjects.find((s) => s.id === selectedId) ?? null
    : null;
  const selectedResources = useMemo(
    () => (selectedId ? resources.filter((r) => r.subjectId === selectedId) : []),
    [resources, selectedId]
  );

  const trimmedQuery = query.trim().toLowerCase();

  const matchedSubjects = useMemo(() => {
    const sorted = [...subjects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!trimmedQuery) return sorted;
    return sorted.filter(
      (s) =>
        s.name.toLowerCase().includes(trimmedQuery) ||
        (s.description ?? '').toLowerCase().includes(trimmedQuery) ||
        s.notes.toLowerCase().includes(trimmedQuery)
    );
  }, [subjects, trimmedQuery]);

  // Cross-subject resource matches (search/filter across the whole library).
  const matchedResources = useMemo(() => {
    if (!trimmedQuery) return [];
    return resources.filter(
      (r) =>
        r.title.toLowerCase().includes(trimmedQuery) ||
        r.urlOrPath.toLowerCase().includes(trimmedQuery) ||
        r.tags.some((t) => t.toLowerCase().includes(trimmedQuery))
    );
  }, [resources, trimmedQuery]);

  const resourcesBySubject = useMemo(() => {
    const map: Record<string, Resource[]> = {};
    for (const r of resources) (map[r.subjectId] ??= []).push(r);
    return map;
  }, [resources]);

  const openSubject = (id: string) => {
    setSelectedId(id);
    setQuery('');
  };

  const handleDeleteSubject = async (id: string) => {
    await deleteSubjectCascade(id);
    setSelectedId(null);
  };

  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? 'Unknown';
  const subjectColor = (id: string) => subjects.find((s) => s.id === id)?.color ?? '#6366f1';

  return (
    <div className="space-y-4">
      {/* Header: title + search + new subject */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center space-x-2.5">
          <BookMarked className="w-6 h-6 text-accent shrink-0" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-content-primary">
              Study Library
            </h1>
            <p className="text-xs text-content-tertiary">
              {subjects.length} subjects · {resources.length} resources
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 lg:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search subjects and resources…"
              className="w-full bg-bg-surface border border-border rounded-xl pl-9 pr-9 py-2.5 text-sm text-content-primary outline-none focus:border-accent placeholder:text-content-tertiary"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-content-tertiary hover:text-content-primary"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => setSubjectModal({ open: true, subject: null })}
            className="flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Subject</span>
          </button>
        </div>
      </div>

      {selectedSubject ? (
        <SubjectDetail
          subject={selectedSubject}
          resources={selectedResources}
          onBack={() => setSelectedId(null)}
          onEditSubject={() => setSubjectModal({ open: true, subject: selectedSubject })}
          onDeleteSubject={() => handleDeleteSubject(selectedSubject.id)}
        />
      ) : (
        <>
          {/* Cross-subject resource matches */}
          {trimmedQuery && matchedResources.length > 0 && (
            <div className="rounded-2xl border border-border bg-bg-surface p-4">
              <h3 className="text-xs uppercase tracking-wider font-semibold text-content-secondary mb-2.5">
                Matching resources ({matchedResources.length})
              </h3>
              <div className="space-y-2">
                {matchedResources.slice(0, 8).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => openSubject(r.subjectId)}
                    className="w-full flex items-center gap-2.5 p-2.5 rounded-xl bg-bg-elevated/40 border border-border hover:border-border-strong transition-colors text-left min-h-[44px]"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: subjectColor(r.subjectId) }}
                    />
                    <FileText className="w-3.5 h-3.5 text-content-tertiary shrink-0" />
                    <span className="text-sm text-content-primary truncate flex-1">{r.title}</span>
                    <span className="text-xs text-content-tertiary truncate hidden sm:block">
                      {subjectName(r.subjectId)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Subject grid */}
          {matchedSubjects.length === 0 ? (
            <div className="py-16 text-center text-content-tertiary">
              <BookMarked className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">
                {trimmedQuery ? 'No subjects match your search.' : 'No subjects yet.'}
              </p>
              {!trimmedQuery && (
                <button
                  onClick={() => setSubjectModal({ open: true, subject: null })}
                  className="mt-3 px-4 py-2 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors"
                >
                  Create your first subject
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {matchedSubjects.map((subject) => {
                const subjectResources = resourcesBySubject[subject.id] ?? [];
                const pendingDue = subjectResources.filter(
                  (r) => r.dueDate && !r.completed
                ).length;
                return (
                  <button
                    key={subject.id}
                    onClick={() => openSubject(subject.id)}
                    className="text-left rounded-2xl border border-border bg-bg-surface overflow-hidden hover:border-border-strong hover:-translate-y-0.5 transition-all"
                  >
                    <div className="h-1.5" style={{ backgroundColor: subject.color }} />
                    <div className="p-4">
                      <div className="flex items-center gap-2.5 mb-1.5">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: subject.color }}
                        />
                        <span className="font-semibold text-sm text-content-primary truncate">
                          {subject.name}
                        </span>
                      </div>
                      {subject.description && (
                        <p className="text-xs text-content-tertiary mb-3">{subject.description}</p>
                      )}
                      <div className="flex items-center justify-between text-[11px] text-content-secondary mt-3">
                        <span>
                          {subjectResources.length} resource
                          {subjectResources.length === 1 ? '' : 's'}
                        </span>
                        {pendingDue > 0 && (
                          <span className="px-1.5 py-0.5 rounded font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400">
                            {pendingDue} due
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {subjectModal.open && (
        <SubjectModal
          subject={subjectModal.subject}
          onClose={() => setSubjectModal({ open: false, subject: null })}
        />
      )}
    </div>
  );
};
