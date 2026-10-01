import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Pencil, PlugZap, Plus, Star, Trash2, X } from 'lucide-react';
import { db } from '../../../db/db';
import { Card } from '../../../components/ui/Card';
import { Modal } from '../../../components/ui/Modal';
import type { AiProvider } from '../../../types';
import {
  deleteProvider,
  saveProvider,
  setDefaultProvider,
  testProviderConnection,
  type AiProviderInput,
  type ConnectionTestResult,
} from '../../ai/aiProviderRepo';

const inputCls =
  'w-full bg-bg-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent';

interface FormState {
  label: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  /** Optional second model tried once if the primary is overloaded. Blank = off. */
  fallbackModel: string;
}

const EMPTY_FORM: FormState = { label: '', baseUrl: '', apiKey: '', modelName: '', fallbackModel: '' };

function toForm(p?: AiProvider | null): FormState {
  return {
    label: p?.label ?? '',
    baseUrl: p?.baseUrl ?? '',
    apiKey: p?.apiKey ?? '',
    modelName: p?.modelName ?? '',
    fallbackModel: p?.fallbackModel ?? '',
  };
}

/**
 * Settings › AI Providers (schema v6): manage OpenAI-compatible endpoints,
 * pick the single default every AI feature reads, and test connections.
 */
export const AiProvidersSettings: React.FC = () => {
  const providers = useLiveQuery(() => db.aiProviders.toArray()) ?? [];
  const sorted = [...providers].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ConnectionTestResult>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError('');
    setModalOpen(true);
  };

  const openEdit = (p: AiProvider) => {
    setForm(toForm(p));
    setEditingId(p.id);
    setError('');
    setModalOpen(true);
  };

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const input: AiProviderInput = {
        id: editingId ?? undefined,
        label: form.label,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        modelName: form.modelName,
        fallbackModel: form.fallbackModel,
      };
      await saveProvider(input);
      setModalOpen(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (p: AiProvider) => {
    setTesting(p.id);
    try {
      const result = await testProviderConnection(p);
      setResults((prev) => ({ ...prev, [p.id]: result }));
    } finally {
      setTesting(null);
    }
  };

  const mask = (key: string) => (key.length <= 8 ? '••••' : `${key.slice(0, 3)}…${key.slice(-4)}`);

  return (
    <Card
      title="AI Providers"
      subtitle="Pick any OpenAI-compatible endpoint. All AI features use the default."
      action={
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add model
        </button>
      }
    >
      <p className="text-xs text-content-tertiary mb-4 -mt-1">
        The assistant stays disabled until the default provider has an API key.
      </p>
      <p className="text-xs text-content-secondary bg-accent-subtle border border-border rounded-xl px-3 py-2.5 mb-4">
        Provider details, <strong>including the API key</strong>, now sync to your account and
        are available on every signed-in device. While you are signed out they stay on this
        device only. Keys are stripped from JSON backups.
      </p>

      {sorted.length === 0 ? (
        <p className="text-xs text-content-tertiary text-center py-4 border-t border-border/50">
          No providers yet — add your first model (e.g. Gemini or OpenRouter).
        </p>
      ) : (
        <div className="border-t border-border/50 divide-y divide-border/40">
          {sorted.map((p) => {
            const revealed = showKeys[p.id] ?? false;
            const result = results[p.id];
            const keyMissing = !p.apiKey.trim();
            return (
              <div key={p.id} className="py-3.5 flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-2">
                    {p.isDefault ? (
                      <Star className="w-4 h-4 text-amber-500 fill-current shrink-0" />
                    ) : (
                      <span className="w-4 h-4 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-content-primary truncate">
                        {p.label}
                        {p.isDefault && <span className="ml-2 text-[10px] font-bold uppercase text-amber-500">Default</span>}
                      </p>
                      <p className="text-[11px] font-mono text-content-tertiary truncate">
                        {p.modelName} · {p.baseUrl}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => openEdit(p)} aria-label="Edit provider" className="p-2.5 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => (deleteId === p.id ? (setDeleteId(null), void deleteProvider(p.id)) : setDeleteId(p.id))}
                      aria-label="Delete provider"
                      className={`p-2.5 rounded-lg transition-colors ${deleteId === p.id ? 'bg-rose-600 text-white' : 'text-content-tertiary hover:text-rose-500 hover:bg-rose-500/10'}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {deleteId === p.id && <p className="text-[11px] text-rose-500 font-semibold">Tap delete again to confirm.</p>}

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    onClick={() => setShowKeys((s) => ({ ...s, [p.id]: !revealed }))}
                    className="px-2.5 py-1.5 rounded-lg border border-border text-content-secondary hover:text-content-primary transition-colors font-mono"
                  >
                    {revealed ? p.apiKey || '(empty)' : keyMissing ? '(no key set)' : mask(p.apiKey)}
                  </button>
                  {!p.isDefault && (
                    <button
                      onClick={() => void setDefaultProvider(p.id)}
                      className="px-2.5 py-1.5 rounded-lg border border-border text-content-secondary hover:text-content-primary transition-colors font-semibold"
                    >
                      Make default
                    </button>
                  )}
                  <button
                    onClick={() => void runTest(p)}
                    disabled={testing === p.id}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-bg-elevated/60 border border-border text-content-primary font-semibold transition-colors disabled:opacity-50"
                  >
                    <PlugZap className="w-3.5 h-3.5" />
                    {testing === p.id ? 'Testing…' : 'Test Connection'}
                  </button>
                  {keyMissing && <span className="text-amber-500 font-semibold">API key needed — AI is disabled for this provider.</span>}
                </div>

                {result && (
                  <p className={`text-[11px] flex items-center gap-1.5 ${result.ok ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {result.ok ? <Check className="w-3.5 h-3.5 shrink-0" /> : <X className="w-3.5 h-3.5 shrink-0" />}
                    {result.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <Modal
          open
          onClose={() => setModalOpen(false)}
          title={editingId ? 'Edit Model' : 'Add Model'}
          subtitle="Any OpenAI-compatible endpoint (Gemini, OpenRouter, Ollama, …)"
        >
          <div className="space-y-3">
            <label className="block">
              <span className="block text-xs text-content-secondary mb-1">Label</span>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Gemini Flash" className={inputCls} />
            </label>
            <label className="block">
              <span className="block text-xs text-content-secondary mb-1">Base URL</span>
              <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://…/v1" spellCheck={false} className={`${inputCls} font-mono`} />
            </label>
            <label className="block">
              <span className="block text-xs text-content-secondary mb-1">API key</span>
              <input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="paste key here" type="password" autoComplete="off" spellCheck={false} className={`${inputCls} font-mono`} />
            </label>
            <label className="block">
              <span className="block text-xs text-content-secondary mb-1">Model name</span>
              <input value={form.modelName} onChange={(e) => setForm({ ...form, modelName: e.target.value })} placeholder="e.g. gemini-3.1-flash-lite" spellCheck={false} className={`${inputCls} font-mono`} />
            </label>
            {/* Optional, and off unless filled. Tried ONCE, after the primary
                model has exhausted its retries, so a busy model degrades to a
                slower answer instead of an error. */}
            <label className="block">
              <span className="block text-xs text-content-secondary mb-1">
                Fallback model <span className="text-content-tertiary">(optional)</span>
              </span>
              <input
                value={form.fallbackModel}
                onChange={(e) => setForm({ ...form, fallbackModel: e.target.value })}
                placeholder="Leave empty to turn this off"
                spellCheck={false}
                aria-label="Fallback model"
                className={`${inputCls} font-mono`}
              />
              <span className="block text-[11px] text-content-tertiary mt-1">
                Used once if the model above is overloaded and all its retries fail. The chat says when an answer came from it.
              </span>
            </label>
            {error && <p className="text-xs text-rose-500">{error}</p>}
            <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-4">
              <button onClick={() => setModalOpen(false)} className="px-4 min-h-[44px] rounded-xl text-sm text-content-secondary hover:text-content-primary transition-colors">
                Cancel
              </button>
              <button onClick={() => void submit()} disabled={saving} className="px-5 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors disabled:opacity-50">
                {editingId ? 'Save' : 'Add model'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
};

