import React, { useEffect, useState } from 'react';
import { Check, Key, Save, Trash2, X, ExternalLink } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { useAssistantStore } from '../../../stores/useAssistantStore';
import { getCloudAccessToken } from '../../../features/ai/cloudAuth';
import { toast } from '../../../stores/useToastStore';

const inputCls =
  'w-full bg-bg-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent';

/**
 * Settings \u2192 AI Keys: each user saves their own Gemini/Groq key.
 * Keys are encrypted on the server and never touch the browser or synced data.
 */
export const AiKeysSettings: React.FC = () => {
  const configured = useAssistantStore((s) => s.providerReady);
  const [keys, setKeys] = useState<{ gemini: boolean; groq: boolean }>({ gemini: false, groq: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [inputs, setInputs] = useState({ gemini: '', groq: '' });
  const [showKey, setShowKey] = useState({ gemini: false, groq: false });

  const fetchKeys = async () => {
    const token = getCloudAccessToken();
    if (!token) {
      setKeys({ gemini: false, groq: false });
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/keys', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setKeys({ gemini: !!data.gemini, groq: !!data.groq });
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const saveKey = async (provider: 'gemini' | 'groq') => {
    const apiKey = inputs[provider].trim();
    if (!apiKey) return;
    setSaving(provider);
    const token = getCloudAccessToken();
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ provider, apiKey }),
      });
      if (res.ok) {
        setKeys((k) => ({ ...k, [provider]: true }));
        setInputs((i) => ({ ...i, [provider]: '' }));
        toast('success', 'Key saved', `${provider} API key stored securely.`);
      } else {
        const err = await res.json().catch(() => ({}));
        toast('error', 'Save failed', err.message ?? 'Could not save key.');
      }
    } catch {
      toast('error', 'Save failed', 'Network error.');
    } finally {
      setSaving(null);
    }
  };

  const deleteKey = async (provider: 'gemini' | 'groq') => {
    setDeleting(provider);
    const token = getCloudAccessToken();
    try {
      const res = await fetch(`/api/keys?provider=${provider}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        setKeys((k) => ({ ...k, [provider]: false }));
        toast('success', 'Key removed', `${provider} API key deleted.`);
      } else {
        toast('error', 'Delete failed', 'Could not remove key.');
      }
    } catch {
      toast('error', 'Delete failed', 'Network error.');
    } finally {
      setDeleting(null);
    }
  };

  const providerInfo: Record<'gemini' | 'groq', { label: string; url: string; desc: string }> = {
    gemini: {
      label: 'Gemini',
      url: 'https://aistudio.google.com/apikey',
      desc: 'Get a free key from Google AI Studio',
    },
    groq: {
      label: 'Groq',
      url: 'https://console.groq.com/keys',
      desc: 'Get a free key from the Groq Console',
    },
  };

  if (loading) {
    return (
      <Card title="AI Keys" subtitle="Your encrypted API keys for each provider">
        <div className="flex items-center gap-2 text-xs text-content-tertiary py-4">
          <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          Loading key status\u2026
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="AI Keys"
      subtitle="Keys are encrypted on the server and never stored in your browser or synced data."
    >
      <div className="space-y-4">
        {(['gemini', 'groq'] as const).map((provider) => {
          const info = providerInfo[provider];
          const saved = keys[provider];
          const busy = saving === provider || deleting === provider;
          return (
            <div key={provider} className="border-t border-border/50 pt-4 first:pt-0 first:border-0">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-accent" />
                  <span className="font-semibold text-content-primary">{info.label}</span>
                  {saved && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-semibold">
                      <Check className="w-2.5 h-2.5" /> Saved
                    </span>
                  )}
                  {!saved && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 text-[10px] font-semibold">
                      Not set
                    </span>
                  )}
                </div>
                <a
                  href={info.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-xs text-content-secondary hover:text-content-primary hover:bg-bg-elevated transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Get key
                </a>
              </div>

              <p className="text-[11px] text-content-tertiary mb-3">{info.desc}</p>

              {!saved ? (
                <div className="flex flex-col gap-2">
                  <label className="block">
                    <span className="block text-xs text-content-secondary mb-1">API Key</span>
                    <div className="relative">
                      <input
                        type={showKey[provider] ? 'text' : 'password'}
                        value={inputs[provider]}
                        onChange={(e) => setInputs((i) => ({ ...i, [provider]: e.target.value }))}
                        placeholder={`Paste your ${info.label} API key here`}
                        disabled={busy}
                        className={`${inputCls} pr-10`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey((s) => ({ ...s, [provider]: !s[provider] }))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-content-tertiary hover:text-content-primary"
                        aria-label={showKey[provider] ? 'Hide key' : 'Show key'}
                      >
                        {showKey[provider] ? (
                          <X className="w-4 h-4" />
                        ) : (
                          <Key className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </label>
                  <button
                    onClick={() => saveKey(provider)}
                    disabled={busy || !inputs[provider].trim()}
                    className="inline-flex items-center justify-center gap-1.5 px-4 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {busy ? 'Saving\u2026' : 'Save key'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => deleteKey(provider)}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-1.5 px-4 min-h-[44px] rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {busy ? 'Removing\u2026' : 'Remove key'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
};