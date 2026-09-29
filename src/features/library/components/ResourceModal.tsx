import React, { useEffect, useState } from 'react';
import { FileUp } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { saveResource } from '../libraryRepo';
import { LARGE_BLOB_WARNING_BYTES } from '../../../db/cloudConfig';
import type { Resource, ResourceKind } from '../../../types';

interface ResourceModalProps {
  subjectId: string;
  topicId: string | null;
  resource: Resource | null;
  onClose: () => void;
}

const inputCls = 'w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ResourceModal: React.FC<ResourceModalProps> = ({ subjectId, topicId, resource, onClose }) => {
  const [kind, setKind] = useState<ResourceKind>(resource?.kind ?? 'link');
  const [title, setTitle] = useState('');
  const [urlOrPath, setUrlOrPath] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setKind(resource?.kind ?? 'link');
    setTitle(resource?.title ?? '');
    setUrlOrPath(resource?.urlOrPath ?? '');
    setTagsInput((resource?.tags ?? []).join(', '));
    setDueDate(resource?.dueDate ?? '');
    setFile(null);
    setError('');
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
    if (kind === 'file' && !file && !resource?.blob) {
      setError('Choose a file to upload.');
      return;
    }
    setSaving(true);
    try {
      const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
      // `kind` MUST be passed: saveResource defaults it to 'link', which would
      // require a URL and reject every upload.
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
        });
      } else {
        await saveResource({
          id: resource?.id,
          subjectId,
          topicId,
          kind,
          title,
          // Uploads carry no URL. Only keep a previous value when editing.
          urlOrPath: resource?.urlOrPath ?? '',
          blob: file ?? undefined,
          fileName: file?.name,
          mimeType: file?.type,
          fileSize: file?.size,
          tags,
          dueDate: dueDate || null,
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
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
          </label>
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
        </div>

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-4">
          <button onClick={onClose} className="px-4 min-h-[44px] rounded-xl text-sm text-content-secondary hover:text-content-primary transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-5 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors">
            {resource ? 'Save' : 'Add resource'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
