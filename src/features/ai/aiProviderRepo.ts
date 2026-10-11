import { db } from '../../db/db';
import type { AiProvider } from '../../types';
import { newId } from '../../utils/id';
import { cloudAuthRequired, getCloudAccessToken } from './cloudAuth';

/**
 * Configurable AI provider storage (schema v6).
 *
 * IMPORTANT: provider rows describe WHICH MODEL the assistant should use —
 * they never carry credentials. Every request goes to the `/api/ai` gateway
 * (see `api/ai.ts`), which verifies the user's Dexie Cloud sign-in and adds a
 * server-side key. No AI feature calls a vendor directly.
 */

export interface AiProviderInput {
  id?: string; // present = update
  label: string;
  baseUrl: string;
  modelName: string;
  /** Optional second model tried once if the primary is overloaded. Off if blank. */
  fallbackModel?: string;
}

function normalize(input: AiProviderInput) {
  return {
    label: input.label.trim(),
    baseUrl: stripChatCompletionsSuffix(input.baseUrl.trim()),
    // The client must never hold a provider key: rows synced or restored from
    // older builds are wiped to '' on the next save.
    apiKey: '',
    modelName: input.modelName.trim(),
    // Stored as '' rather than undefined when cleared, so "off" and "never
    // configured" cannot drift apart across saves.
    fallbackModel: (input.fallbackModel ?? '').trim(),
  };
}

/** Accept whatever the user pastes: "…/v1", "…/v1/", or the full path. */
export function stripChatCompletionsSuffix(baseUrl: string): string {
  return baseUrl
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '');
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  return `${stripChatCompletionsSuffix(baseUrl)}/chat/completions`;
}

export function providerIsReady(provider: AiProvider | null | undefined): boolean {
  // Ready = a model is chosen. Credentials live server-side (see api/ai.ts),
  // and sign-in state is enforced separately where the cloud addon is live.
  return Boolean(provider && provider.baseUrl.trim() && provider.modelName.trim());
}

/**
 * Which gateway upstream a provider row points at. Gemini by default; a base
 * URL on groq.com selects Groq. The gateway strips this hint before forward.
 */
export function gatewayProviderFor(baseUrl: string): 'gemini' | 'groq' {
  return /groq\.com/i.test(baseUrl) ? 'groq' : 'gemini';
}

export async function listProviders(): Promise<AiProvider[]> {
  const rows = await db.aiProviders.toArray();
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The single provider used by every AI feature (null when none configured). */
export async function getDefaultProvider(): Promise<AiProvider | null> {
  const flagged = await db.aiProviders.filter((p) => p.isDefault).first();
  if (flagged) return flagged;
  const any = await db.aiProviders.orderBy('createdAt').first();
  return any ?? null;
}

export async function saveProvider(input: AiProviderInput): Promise<string> {
  const clean = normalize(input);
  if (!clean.label) throw new Error('Label is required.');
  if (!clean.baseUrl) throw new Error('Base URL is required.');
  if (!clean.modelName) throw new Error('Model name is required.');
  const now = new Date().toISOString();

  if (input.id) {
    const existing = await db.aiProviders.get(input.id);
    if (existing) {
      await db.aiProviders.put({ ...existing, ...clean, updatedAt: now });
      return existing.id;
    }
  }

  const count = await db.aiProviders.count();
  const record: AiProvider = {
    id: newId(),
    ...clean,
    isDefault: count === 0, // first provider becomes the default
    createdAt: now,
    updatedAt: now,
  };
  await db.aiProviders.put(record);
  return record.id;
}

/** Exactly one provider is default: flip the flag inside a transaction. */
export async function setDefaultProvider(id: string): Promise<void> {
  await db.transaction('rw', db.aiProviders, async () => {
    const all = await db.aiProviders.toArray();
    for (const p of all) {
      const shouldBeDefault = p.id === id;
      if (p.isDefault !== shouldBeDefault) {
        await db.aiProviders.put({ ...p, isDefault: shouldBeDefault, updatedAt: new Date().toISOString() });
      }
    }
  });
}

/** Delete a provider; if it was the default, promote the next remaining one. */
export async function deleteProvider(id: string): Promise<void> {
  await db.transaction('rw', db.aiProviders, async () => {
    const target = await db.aiProviders.get(id);
    await db.aiProviders.delete(id);
    if (!target?.isDefault) return;
    const remaining = await db.aiProviders.orderBy('createdAt').first();
    if (remaining) {
      await db.aiProviders.put({ ...remaining, isDefault: true, updatedAt: new Date().toISOString() });
    }
  });
}


export interface ConnectionTestResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  message: string;
}

/**
 * "Test Connection" for a provider: one tiny chat request through the same
 * `/api/ai` gateway the assistant uses, so the verdict covers the real path —
 * cloud sign-in, token verification and the upstream model. Never throws —
 * returns a human-readable verdict for the Settings UI.
 */
export async function testProviderConnection(provider: AiProvider): Promise<ConnectionTestResult> {
  const started = Date.now();
  if (!provider.baseUrl.trim()) {
    return { ok: false, latencyMs: 0, message: 'Base URL is empty.' };
  }
  if (!provider.modelName.trim()) {
    return { ok: false, latencyMs: 0, message: 'Model name is empty.' };
  }
  const token = getCloudAccessToken();
  if (cloudAuthRequired() && !token) {
    return { ok: false, latencyMs: 0, message: 'Not signed in to Dexie Cloud — sign in from Settings → Sync first.' };
  }
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        provider: gatewayProviderFor(provider.baseUrl),
        model: provider.modelName,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        max_tokens: 8,
        temperature: 0,
      }),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        // ignore body read failures
      }
      return {
        ok: false,
        status: res.status,
        latencyMs,
        message: `HTTP ${res.status}${detail ? ` — ${detail}` : ''}`,
      };
    }
    return { ok: true, status: res.status, latencyMs, message: `Connected in ${latencyMs} ms.` };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: e instanceof Error ? e.message : 'Network request failed.',
    };
  }
}
