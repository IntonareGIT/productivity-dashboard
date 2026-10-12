import React, { useEffect, useState } from 'react';
import { Check, Key, Save, Trash2, X, ExternalLink, TestTube2, Pencil, Plus } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Modal } from '../../../components/ui/Modal';
import { useAssistantStore } from '../../../stores/useAssistantStore';
import { getCloudAccessToken } from '../../../features/ai/cloudAuth';
import { toast } from '../../../stores/useToastStore';
import type { UserModel, UserModelInput } from '../../../types';

const inputCls =
  'w-full bg-bg-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent';

const CAPABILITY_OPTIONS: { key: string; label: string; desc: string }[] = [
  { key: 'chat', label: 'Chat', desc: 'Can be used for chat conversations' },
  { key: 'acceptsPdf', label: 'PDF', desc: 'Can accept PDF files' },
  { key: 'acceptsImages', label: 'Images', desc: 'Can accept images' },
];

const ADAPTER_INFO: Record<string, { label: string; url: string; defaultBaseUrl: string }> = {
  gemini: { label: 'Google Gemini', url: 'https://ai.google.dev/docs', defaultBaseUrl: '' },
  'openai-compatible': { label: 'OpenAI-compatible', url: 'https://platform.openai.com/docs', defaultBaseUrl: 'https://api.openai.com/v1' },
};

interface FormState {
  id?: string;
  displayName: string;
  adapter: 'gemini' | 'openai-compatible';
  baseUrl: string;
  modelId: string;
  capabilities: { chat: boolean; acceptsPdf: boolean; acceptsImages: boolean };
  apiKey: string;
}

const EMPTY_FORM: FormState = {
  displayName: '',
  adapter: 'gemini',
  baseUrl: '',
  modelId: '',
  capabilities: { chat: true, acceptsPdf: false, acceptsImages: false },
  apiKey: '',
};

function toForm(m?: UserModel | null): FormState {
  return {
    id: m?.id,
    displayName: m?.displayName ?? '',
    adapter: m?.adapter ?? 'gemini',
    baseUrl: m?.baseUrl ?? '',
    modelId: m?.modelId ?? '',
    capabilities: m?.capabilities ?? { chat: true, acceptsPdf: false, acceptsImages: false },
    apiKey: '',
  };
}

export const AiModelsSettings: React.FC = () => {
  const { fetchModels } = useAssistantStore();
  const [models, setModels] = useState<UserModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  const fetchModelsFromServer = async () => {
    const token = getCloudAccessToken();
    if (!token) {
      setModels([]);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/models', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setModels(data.models ?? []);
        fetchModels(); // Refresh the assistant store
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModelsFromServer();
  }, []);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setModalOpen(true);
  };

  const openEdit = (m: UserModel) => {
    setForm(toForm(m));
    setEditingId(m.id);
    setModalOpen(true);
  };

  const handleAdapterChange = (adapter: 'gemini' | 'openai-compatible') => {
    const info = ADAPTER_INFO[adapter] ?? ADAPTER_INFO['openai-compatible'];
    setForm((f) => ({
      ...f,
      adapter,
      baseUrl: info.defaultBaseUrl,
      modelId: '',
    }));
  };

  const submit = async () => {
    if (!form.displayName.trim() || !form.modelId.trim()) {
      toast('error', 'Validation error', 'Display name and model ID are required.');
      return;
    }
    if (!form.apiKey.trim() && !editingId) {
      toast('error', 'Validation error', 'API key is required for new models.');
      return;
    }

    setSaving(true);
    const token = getCloudAccessToken();
    try {
      const input: UserModelInput = {
        displayName: form.displayName.trim(),
        adapter: form.adapter,
        baseUrl: form.baseUrl.trim() || '',
        modelId: form.modelId.trim(),
        capabilities: form.capabilities,
        apiKey: form.apiKey.trim() || undefined,
      };

      const url = editingId ? `/api/models?id=${encodeURIComponent(editingId)}` : '/api/models';
      const res = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(input),
      });

      if (res.ok) {
        toast('success', editingId ? 'Model updated' : 'Model added', `${form.displayName} saved.`);
        setModalOpen(false);
        fetchModelsFromServer();
      } else {
        const err = await res.json().catch(() => ({}));
        toast('error', 'Save failed', err.message ?? 'Could not save model.');
      }
    } catch {
      toast('error', 'Save failed', 'Network error.');
    } finally {
      setSaving(false);
    }
  };

  const testModel = async () => {
    if (!form.displayName.trim() || !form.modelId.trim() || !form.apiKey.trim()) {
      toast('error', 'Test failed', 'Fill in display name, model ID, and API key first.');
      return;
    }
    setTesting(form.id ?? 'new');
    const token = getCloudAccessToken();
    try {
      const input = {
        adapter: form.adapter,
        baseUrl: form.baseUrl.trim() || '',
        modelId: form.modelId.trim(),
        apiKey: form.apiKey.trim(),
      };

      const res = await fetch('/api/models/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(input),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        toast('success', 'Test passed', data.message ?? 'Key valid');
      } else {
        toast('error', 'Test failed', data.message ?? 'Model did not respond correctly.');
      }
    } catch {
      toast('error', 'Test failed', 'Network error.');
    } finally {
      setTesting(null);
    }
  };

  const deleteModel = async (id: string) => {
    setDeleteId(id);
    const token = getCloudAccessToken();
    try {
      const res = await fetch(`/api/models?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        toast('success', 'Model removed', 'Model deleted from your account.');
        fetchModelsFromServer();
      } else {
        toast('error', 'Delete failed', 'Could not remove model.');
      }
    } catch {
      toast('error', 'Delete failed', 'Network error.');
    } finally {
      setDeleteId(null);
    }
  };

  const confirmDelete = (id: string) => setDeleteId(id);
  const cancelDelete = () => setDeleteId(null);

  if (loading) {
    return (
      <Card title="AI Models" subtitle="Add and manage your own AI models with encrypted API keys">
        <div className="flex items-center justify-center py-8 text-content-tertiary">Loading…</div>
      </Card>
    );
  }

  return (
    <Card title="AI Models" subtitle="Add and manage your own AI models with encrypted API keys">
      <div className="space-y-4">
        {/* Add Model Button */}
        <button
          onClick={openAdd}
          className="w-full sm:w-auto flex items-center gap-2 px-4 py-2.5 bg-accent text-white rounded-xl hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          Add Model
        </button>

        {/* Models List */}
        {models.length === 0 ? (
          <div className="text-center py-8 text-content-tertiary">
            <p className="mb-2">No models configured yet.</p>
            <p className="text-sm">Add a model to start using the assistant.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {models.map((m) => (
              <div key={m.id} className="flex items-center gap-3 p-3 bg-bg-elevated/50 rounded-xl border border-border/40">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-content-primary truncate">{m.displayName}</span>
                    <span className="text-[10px] px-2 py-0.5 bg-accent/10 text-accent rounded-full">{m.adapter.toUpperCase()}</span>
                    {m.hasKey ? (
                      <span className="text-[10px] px-2 py-0.5 bg-green-500/10 text-green-500 rounded-full">Key saved</span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-500 rounded-full">No key</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-sm text-content-tertiary">
                    <span className="font-mono text-[11px]">{m.modelId}</span>
                    {m.baseUrl && <span className="text-[11px] truncate max-w-[200px]">{m.baseUrl}</span>}
                    <span className="text-[11px]">
                      {Object.entries(m.capabilities)
                        .filter(([, v]) => v)
                        .map(([k]) => k)
                        .join(', ')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(m)}
                    className="p-1.5 rounded-lg hover:bg-accent/10 text-content-secondary transition-colors"
                    aria-label="Edit model"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  {deleteId === m.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => deleteModel(m.id)}
                        className="p-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                        aria-label="Confirm delete"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={cancelDelete}
                        className="p-1.5 rounded-lg hover:bg-bg-elevated text-content-secondary transition-colors"
                        aria-label="Cancel delete"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => confirmDelete(m.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-500 transition-colors"
                      aria-label="Delete model"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Encryption Note */}
        <div className="mt-4 p-3 rounded-xl bg-accent/5 border border-accent/20">
          <div className="flex items-start gap-2">
            <Key className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            <div className="text-sm text-content-secondary">
              <p className="font-medium text-accent">Your API keys are encrypted end-to-end.</p>
              <p className="mt-1">
                Keys are encrypted with AES-256-GCM on the server before being stored in Redis. They are never
                logged, never synced to Dexie Cloud, and never exposed to the browser. The assistant gateway
                decrypts them only at request time.
              </p>
            </div>
          </div>
        </div>

        {/* Add/Edit Modal */}
        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit Model' : 'Add Model'}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-content-primary mb-1">Display Name</label>
              <input
                type="text"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                placeholder="e.g. My Gemini 3.1 Flash"
                className={inputCls}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-content-primary mb-1">Adapter</label>
              <select
                value={form.adapter}
                onChange={(e) => handleAdapterChange(e.target.value as 'gemini' | 'openai-compatible')}
                className={inputCls}
              >
                <option value="gemini">Google Gemini</option>
                <option value="openai-compatible">OpenAI-compatible (Groq, OpenRouter, etc.)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-content-primary mb-1">Base URL (optional for Gemini)</label>
              <input
                type="text"
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="https://api.example.com/v1"
                className={inputCls}
              />
              <p className="mt-1 text-[11px] text-content-tertiary">
                Required for OpenAI-compatible adapters. Leave blank for Gemini (uses default endpoint).
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-content-primary mb-1">Model ID</label>
              <input
                type="text"
                value={form.modelId}
                onChange={(e) => setForm({ ...form, modelId: e.target.value })}
                placeholder="e.g. gemini-3.1-flash, gpt-4o, llama-3.3-70b-versatile"
                className={inputCls}
              />
              <p className="mt-1 text-[11px] text-content-tertiary">
                The exact model identifier the provider expects.
                <ExternalLink className="w-3 h-3 inline ml-1" />
                <a
                  href={ADAPTER_INFO[form.adapter]?.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  View models
                </a>
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-content-primary mb-1">Capabilities</label>
              <div className="grid grid-cols-3 gap-2">
                {CAPABILITY_OPTIONS.map((cap) => (
                  <label key={cap.key} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-bg-elevated cursor-pointer hover:border-accent/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={form.capabilities[cap.key as keyof typeof form.capabilities]}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          capabilities: {
                            ...form.capabilities,
                            [cap.key]: e.target.checked,
                          },
                        })
                      }
                      className="w-4 h-4 accent-accent rounded"
                    />
                    <div>
                      <span className="text-sm font-medium text-content-primary">{cap.label}</span>
                      <p className="text-[10px] text-content-tertiary">{cap.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-content-primary mb-1 flex items-center gap-2">
                API Key
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="text-[11px] text-accent hover:underline"
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </label>
              <input
                type={showKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder={editingId ? 'Leave blank to keep current key' : 'Enter your API key'}
                className={inputCls}
                autoComplete="off"
              />
              <p className="mt-1 text-[11px] text-content-tertiary">
                {editingId ? 'Enter a new key to replace the stored one, or leave blank to keep it.' : 'This key will be encrypted and stored securely on the server.'}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-content-secondary rounded-xl hover:bg-bg-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={testModel}
                disabled={saving || !!testing}
                className="px-4 py-2 text-sm font-medium text-accent rounded-xl border border-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
              >
                {testing ? 'Testing…' : 'Test Connection'}
              </button>
              <button
                onClick={submit}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-accent rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Model'}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </Card>
  );
};