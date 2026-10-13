import React, { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileUp, AlertTriangle, Link as LinkIcon, Clock, Check } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { saveResource, saveNote, initNoteForExtraction } from '../libraryRepo';
import { LARGE_BLOB_WARNING_BYTES } from '../../../db/cloudConfig';
import { db } from '../../../db/db';
import { fetchUserModels, getPdfCapableModels } from '../../../features/ai/modelsClient';
import type { Resource, ResourceKind, UserModel } from '../../../types';

interface ResourceModalProps {
  subjectId: string;
  subjectName?: string | null;
  topicId?: string | null;
  resource?: Resource | null;
  /**
   * When set, the modal opens in "re-add a cloud copy" mode: the row is saved
   * with this r2Key and no upload, because the bytes are already in R2 (and
   * cached locally). The label is pre-filled from the key's filename.
   */
  cloudKey?: string | null;
  /** Open the file picker on mount, for the re-upload affordance. */
  forceFile?: boolean;
  onClose: () => void;
}

const inputCls = 'w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A single 0..1 gauge that moves with the bytes actually uploaded. */
const UploadGauge: React.FC<{ loaded: number; total: number }> = ({ loaded, total }) => {
  const pct = total > 0 ? Math.min(1, loaded / total) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-content-tertiary">
        <span>Uploading…</span>
        <span>
          {formatBytes(loaded)} / {formatBytes(total)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
        <div
          className="h-full rounded-full bg-accent/70 transition-all"
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
    </div>
  );
};

function isPdfFile(mime: string | null | undefined, name: string | null | undefined): boolean {
  if (mime === 'application/pdf') return true;
  if (name?.toLowerCase().endsWith('.pdf')) return true;
  return false;
}

export const ResourceModal: React.FC<ResourceModalProps> = ({ subjectId, topicId, resource, cloudKey, forceFile, subjectName, onClose }) => {
  const [kind, setKind] = useState<ResourceKind>(resource?.kind ?? (cloudKey ? 'file' : 'link'));
  const [title, setTitle] = useState(resource?.title ?? (cloudKey ? (cloudKey.split('/').pop() ?? '').replace(/\.[^.]+$/, '') : ''));
  const [urlOrPath, setUrlOrPath] = useState(resource?.urlOrPath ?? '');
  const [fileName, setFileName] = useState(resource?.fileName ?? (cloudKey ? (cloudKey.split('/').pop() ?? null) : null));
  const [mimeType, setMimeType] = useState(resource?.mimeType ?? null);
  const [fileSize, setFileSize] = useState(resource?.fileSize ?? null);
  const [tagsInput, setTagsInput] = useState((resource?.tags ?? []).join(', '));
  const [dueDate, setDueDate] = useState(resource?.dueDate ?? '');
  const [groupId, setGroupId] = useState(resource?.groupId ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  /** Bytes uploaded during the current file upload, so the user can see it move. */
  const [uploadProgress, setUploadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Extraction state
  const [extractMode, setExtractMode] = useState<'later' | 'now'>('later');
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [models, setModels] = useState<UserModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  // Determine if the current file is a PDF
  const currentFileName = file?.name ?? fileName;
  const currentMimeType = file?.type ?? mimeType;
  const isPdf = kind === 'file' && isPdfFile(currentMimeType, currentFileName);

  // Fetch models that can handle PDFs and have a key
  const fetchModels = async () => {
    setModelsLoading(true);
    setModelsError(null);
    const result = await fetchUserModels();
    if (result.error) {
      setModelsError(result.error.message);
      setModels([]);
    } else {
      const pdfModels = getPdfCapableModels(result.models);
      setModels(pdfModels);
      if (pdfModels.length > 0 && !selectedModelId) {
        setSelectedModelId(pdfModels[0].id);
      }
    }
    setModelsLoading(false);
  };

  useEffect(() => {
    if (isPdf) fetchModels();
  }, [isPdf]);

  // A cloud key can arrive after this modal mounts (the Settings page stashes
  // it and the library opens the modal later), so re-sync the label from it
  // rather than trusting the value captured at mount time.
  useEffect(() => {
    if (cloudKey && !resource) {
      const name = cloudKey.split('/').pop() ?? '';
      setTitle(name.replace(/\.[^.]+$/, ''));
      setFileName(name);
      setKind('file');
      setMimeType('application/pdf');
    }
  }, [cloudKey, resource]);

  useEffect(() => {
    if (forceFile) fileInputRef.current?.click();
  }, [forceFile]);

  /** Groups of this subject, for the picker. */
  const groups = useLiveQuery(
    () => db.resourceGroups.where('subjectId').equals(subjectId).toArray(),
    [subjectId],
  ) ?? [];

  useEffect(() => {
    setKind(resource?.kind ?? 'link');
    setTitle(resource?.title ?? '');
    setUrlOrPath(resource?.urlOrPath ?? '');
    setTagsInput((resource?.tags ?? []).join(', '));
    setDueDate(resource?.dueDate ?? '');
    setFile(null);
    setError('');
    setGroupId(resource?.groupId ?? '');
    setUploadProgress(null);
    setExtractMode('later');
    setSelectedModelId('');
    setModels([]);
    setModelsError(null);
  }, [resource]);

  const submit = async () => {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (kind === 'link' && !urlOrPath.trim()) {
      setError('A URL or file path is required.');
      return;
    }
    if (kind === 'file' && !file && !resource?.r2Key && !resource?.blob && !cloudKey) {
      setError('Choose a file to upload.');
      return;
    }
    setSaving(true);
    setUploadProgress(null);
    try {
      const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
      if (kind === 'link') {
        await saveResource({
          id: resource?.id,
          subjectId,
          topicId,
          kind,
          title,
          urlOrPath,
          tags,
          dueDate: dueDate || null,
          groupId: groupId || null,
        });
      } else {
        // Three paths share this branch:
        //   - a brand new file upload
        //   - re-uploading a file whose bytes were offloaded (file picked, row exists)
        //   - re-adding an orphaned cloud copy (no file, cloudKey set) — the bytes
        //     are already in R2 and cached locally, so nothing is uploaded.
        if (file) {
          const { uploadToR2, currentUserId, deleteCloudObject } = await import('../../../features/ai/cloudClient');
          const { buildCloudKey } = await import('../../../features/ai/cloudKey');
          const userId = currentUserId();
          if (!userId) throw new Error('Sign in to Dexie Cloud to upload files.');

          // The subject folder is the organizing unit: every file for a subject
          // lands under `{userId}/{subject}/`. Re-uploading replaces the old
          // object rather than leaving a second copy, so the old key is deleted
          // first — but only after the new one exists, so a failed re-upload
          // never loses the file.
          const key = buildCloudKey(userId, subjectId, subjectName, file.name);
          setUploadProgress({ loaded: 0, total: file.size });
          await uploadToR2(key, file, file.type || undefined, (loaded) => {
            setUploadProgress({ loaded, total: file.size });
          });
          if (resource?.r2Key && resource.r2Key !== key) {
            await deleteCloudObject(resource.r2Key).catch(() => {});
          }
          const resourceId = await saveResource({
            id: resource?.id,
            subjectId,
            topicId,
            kind,
            title,
            // Uploads carry no URL. Only keep a previous value when editing.
            urlOrPath: resource?.urlOrPath ?? '',
            blob: null,
            r2Key: key,
            fileName: file.name,
            mimeType: file.type || null,
            fileSize: file.size,
            tags,
            dueDate: dueDate || null,
            groupId: groupId || null,
          });
          // Create note row for PDF extraction
          if (isPdf) {
            const { saveNote, initNoteForExtraction } = await import('../libraryRepo');
            await saveNote({
              fileId: resourceId,
              status: extractMode === 'now' ? 'queued' : 'none',
              modelId: extractMode === 'now' ? selectedModelId : undefined,
            });
            if (extractMode === 'now') {
              await initNoteForExtraction(resourceId, selectedModelId);
            }
          }
        } else {
          // Re-adding an orphaned cloud copy: the bytes are already in R2 and
          // cached locally, so the only thing to do is write the row pointing
          // at the existing key. No upload, no file, no progress bar.
          const resourceId = await saveResource({
            id: resource?.id,
            subjectId,
            topicId,
            kind,
            title,
            urlOrPath: resource?.urlOrPath ?? '',
            blob: null,
            r2Key: cloudKey!,
            fileName: cloudKey!.split('/').pop() ?? null,
            mimeType: null,
            fileSize: null,
            tags,
            dueDate: dueDate || null,
            groupId: groupId || null,
          });
          // Create note row for PDF extraction (cloud copy re-add)
          if (isPdf) {
            const { saveNote, initNoteForExtraction } = await import('../libraryRepo');
            await saveNote({
              fileId: resourceId,
              status: extractMode === 'now' ? 'queued' : 'none',
              modelId: extractMode === 'now' ? selectedModelId : undefined,
            });
            if (extractMode === 'now') {
              await initNoteForExtraction(resourceId, selectedModelId);
            }
          }
        }
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
      setUploadProgress(null);
    }
  };

  return (
    <Modal open onClose={onClose} title={resource ? 'Edit Resource' : 'New Resource'} subtitle="Link or uploaded file (PDF, image, doc)">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-bg-elevated/50 border border-border">
          {(['link', 'file'] as ResourceKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`py-2 rounded-lg text-xs font-semibold transition-colors ${kind === k ? 'bg-accent text-white' : 'text-content-secondary hover:text-content-primary'}`}
            >
              {k === 'link' ? 'Link' : 'Upload file'}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="block text-xs text-content-secondary mb-1">Title</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lecture slides" className={inputCls} />
        </label>

        {kind === 'link' ? (
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">URL or file path</span>
            <input value={urlOrPath} onChange={(e) => setUrlOrPath(e.target.value)} placeholder="https://… or C:\notes\file.pdf" className={inputCls} />
          </label>
        ) : (
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">File (PDF, image, doc)</span>
            <span className={`${inputCls} flex items-center gap-2 cursor-pointer`}>
              <FileUp className="w-4 h-4 text-content-tertiary shrink-0" />
              <span className="text-xs truncate">{file ? `${file.name} (${formatBytes(file.size)})` : resource?.fileName ? `Current: ${resource.fileName}` : 'Choose a file…'}</span>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt,.md,image/*"
                className="hidden"
                onChange={(e) => {
                  const picked = e.target.files?.[0] ?? null;
                  setFile(picked);
                  // Warn on large uploads: Dexie Cloud offloads blobs on first
                  // sync, so a very large file makes that sync slow.
                  setError(
                    picked && picked.size > LARGE_BLOB_WARNING_BYTES
                      ? `This file is ${formatBytes(picked.size)}. Files over ${formatBytes(
                          LARGE_BLOB_WARNING_BYTES
                        )} are allowed, but the first sync will be slow and it counts against your sync quota.`
                      : ''
                  );
                }}
              />
            </span>
            {file && file.size > LARGE_BLOB_WARNING_BYTES && (
              <p className="mt-1.5 text-[11px] text-amber-500">
                Large file ({formatBytes(file.size)}) — the first sync may take a while.
              </p>
            )}
            {uploadProgress && <div className="mt-2"><UploadGauge loaded={uploadProgress.loaded} total={uploadProgress.total} /></div>}
          </label>
        )}

        {/* Markdown extraction section — only for PDF files */}
        {isPdf && (
          <fieldset className="space-y-3 p-3 rounded-xl bg-bg-elevated/50 border border-border">
            <legend className="text-xs font-semibold text-content-secondary px-2">Markdown extraction</legend>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="extractMode"
                  value="later"
                  checked={extractMode === 'later'}
                  onChange={() => setExtractMode('later')}
                  className="w-4 h-4 accent-accent"
                />
                <span className="text-sm text-content-primary">Extract later</span>
              </label>
              <label className={`flex items-center gap-2 cursor-pointer ${models.length === 0 ? 'opacity-50' : ''}`}>
                <input
                  type="radio"
                  name="extractMode"
                  value="now"
                  checked={extractMode === 'now'}
                  onChange={() => {
                    if (models.length > 0) setExtractMode('now');
                  }}
                  disabled={models.length === 0 || modelsLoading}
                  className="w-4 h-4 accent-accent"
                />
                <span className="text-sm text-content-primary">Extract now</span>
              </label>
            </div>

            {modelsLoading && (
              <div className="flex items-center gap-2 text-xs text-content-tertiary">
                <div className="w-3 h-3 border-2 border-accent/50 border-t-accent rounded-full animate-spin" />
                Loading models…
              </div>
            )}

            {modelsError && (
              <p className="text-xs text-rose-500 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {modelsError}
              </p>
            )}

            {models.length === 0 && !modelsLoading && (
              <p className="text-xs text-amber-500 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Extract now is disabled.{' '}
                <a href="/settings?section=ai" className="font-semibold underline" onClick={(e) => e.stopPropagation()}>
                  Add a PDF-capable model in Settings → AI Models
                </a>
              </p>
            )}

            {models.length > 0 && extractMode === 'now' && (
              <div className="space-y-2">
                <label className="block">
                  <span className="block text-xs text-content-secondary mb-1">Model</span>
                  <select
                    value={selectedModelId}
                    onChange={(e) => setSelectedModelId(e.target.value)}
                    className={inputCls}
                    disabled={modelsLoading}
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName} ({m.modelId})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </fieldset>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">Tags (comma separated)</span>
            <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="slides, week-3" className={inputCls} />
          </label>
          <label className="block">
            <span className="block text-xs text-content-secondary mb-1">Due date (optional)</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
          </label>

          {/* A plain select: one tap on a phone, and the group list is short.
              The row menu stays the richer path (it also offers "New group…"). */}
          <div>
            <span className="block text-xs text-content-secondary mb-1">Group (optional)</span>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={inputCls}>
              <option value="">No group</option>
              {[...groups].sort((a, b) => a.name.localeCompare(b.name)).map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-4">
          <button onClick={onClose} className="px-4 min-h-[44px] rounded-xl text-sm text-content-secondary hover:text-content-primary transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-5 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors">
            {saving ? (uploadProgress ? 'Uploading…' : 'Saving…') : (resource ? 'Save' : 'Add resource')}
          </button>
        </div>
      </div>
    </Modal>
  );
};