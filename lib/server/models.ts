/**
 * Server-side model storage using Upstash Redis.
 *
 * Models are stored as:
 *   models:{userId}:{id} -> { displayName, adapter, baseUrl, modelId, capabilities, keyRecord, createdAt, updatedAt }
 *   models:{userId}:index -> [id1, id2, ...]
 *
 * The keyRecord is an EncryptedRecord (iv, tag, ciphertext) stored inside the model JSON.
 * Non-secret fields are plain. The API key is encrypted using the existing keyVault.
 */
import { randomUUID } from 'crypto';
import {
  encrypt,
  decrypt,
  kvGet as kvGetKey,
  kvSet as kvSetKey,
  kvDelete as kvDeleteKey,
  type EncryptedRecord,
} from './keyVault.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

function assertEnv(): void {
  if (!KV_URL) throw new Error('KV_REST_API_URL is not set');
  if (!KV_TOKEN) throw new Error('KV_REST_API_TOKEN is not set');
}

function kvHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${KV_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function modelKey(userId: string, id: string): string {
  return `models:${userId}:${id}`;
}

function indexKey(userId: string): string {
  return `models:${userId}:index`;
}

export interface StoredModel {
  id: string;
  displayName: string;
  adapter: 'gemini' | 'openai-compatible';
  baseUrl: string;
  modelId: string;
  capabilities: {
    chat: boolean;
    acceptsPdf: boolean;
    acceptsImages: boolean;
  };
  keyRecord: EncryptedRecord | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicModel {
  id: string;
  displayName: string;
  adapter: 'gemini' | 'openai-compatible';
  baseUrl: string;
  modelId: string;
  capabilities: {
    chat: boolean;
    acceptsPdf: boolean;
    acceptsImages: boolean;
  };
  hasKey: boolean;
  createdAt: string;
  updatedAt: string;
}

function toPublic(model: StoredModel): PublicModel {
  return {
    id: model.id,
    displayName: model.displayName,
    adapter: model.adapter,
    baseUrl: model.baseUrl,
    modelId: model.modelId,
    capabilities: model.capabilities,
    hasKey: model.keyRecord !== null,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

async function kvGetRaw(key: string): Promise<string | null> {
  assertEnv();
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: kvHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Upstash GET failed: ${res.status}`);
  const data = await res.json();
  return data?.result ?? null;
}

async function kvSetRaw(key: string, value: string): Promise<void> {
  assertEnv();
  const res = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: kvHeaders(),
    body: value,
  });
  if (!res.ok) throw new Error(`Upstash SET failed: ${res.status}`);
}

async function kvDelRaw(key: string): Promise<void> {
  assertEnv();
  const res = await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: kvHeaders(),
  });
  if (!res.ok) throw new Error(`Upstash DEL failed: ${res.status}`);
}

export async function listModels(userId: string): Promise<PublicModel[]> {
  const indexRaw = await kvGetRaw(indexKey(userId));
  if (!indexRaw) return [];
  let ids: string[];
  try {
    ids = JSON.parse(indexRaw);
  } catch {
    return [];
  }
  const models: PublicModel[] = [];
  for (const id of ids) {
    const modelRaw = await kvGetRaw(modelKey(userId, id));
    if (!modelRaw) continue;
    try {
      const stored: StoredModel = JSON.parse(modelRaw);
      models.push(toPublic(stored));
    } catch {
      // Skip corrupted entries
    }
  }
  // Sort by createdAt descending (newest first)
  models.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return models;
}

export async function getModel(userId: string, id: string): Promise<StoredModel | null> {
  const modelRaw = await kvGetRaw(modelKey(userId, id));
  if (!modelRaw) return null;
  try {
    return JSON.parse(modelRaw) as StoredModel;
  } catch {
    return null;
  }
}

export interface CreateModelInput {
  displayName: string;
  adapter: 'gemini' | 'openai-compatible';
  baseUrl: string;
  modelId: string;
  capabilities: {
    chat: boolean;
    acceptsPdf: boolean;
    acceptsImages: boolean;
  };
  apiKey: string;
}

export async function createModel(userId: string, input: CreateModelInput): Promise<PublicModel> {
  const now = new Date().toISOString();
  const id = randomUUID();
  
  const keyRecord = encrypt(input.apiKey);
  
  const stored: StoredModel = {
    id,
    displayName: input.displayName,
    adapter: input.adapter,
    baseUrl: input.baseUrl,
    modelId: input.modelId,
    capabilities: input.capabilities,
    keyRecord,
    createdAt: now,
    updatedAt: now,
  };
  
  await kvSetRaw(modelKey(userId, id), JSON.stringify(stored));
  
  // Update index
  const indexRaw = await kvGetRaw(indexKey(userId));
  let ids: string[] = [];
  if (indexRaw) {
    try {
      ids = JSON.parse(indexRaw);
    } catch {
      ids = [];
    }
  }
  ids.push(id);
  await kvSetRaw(indexKey(userId), JSON.stringify(ids));
  
  return toPublic(stored);
}

export interface UpdateModelInput {
  displayName?: string;
  baseUrl?: string;
  modelId?: string;
  capabilities?: {
    chat: boolean;
    acceptsPdf: boolean;
    acceptsImages: boolean;
  };
  apiKey?: string; // Optional - if provided, replaces the key
}

export async function updateModel(userId: string, id: string, input: UpdateModelInput): Promise<PublicModel | null> {
  const existing = await getModel(userId, id);
  if (!existing) return null;
  
  const now = new Date().toISOString();
  let keyRecord = existing.keyRecord;
  
  if (input.apiKey !== undefined && input.apiKey !== '') {
    keyRecord = encrypt(input.apiKey);
  }
  
  const stored: StoredModel = {
    ...existing,
    displayName: input.displayName ?? existing.displayName,
    baseUrl: input.baseUrl ?? existing.baseUrl,
    modelId: input.modelId ?? existing.modelId,
    capabilities: input.capabilities ?? existing.capabilities,
    keyRecord,
    updatedAt: now,
  };
  
  await kvSetRaw(modelKey(userId, id), JSON.stringify(stored));
  
  return toPublic(stored);
}

export async function deleteModel(userId: string, id: string): Promise<boolean> {
  const existing = await getModel(userId, id);
  if (!existing) return false;
  
  // Delete the model
  await kvDelRaw(modelKey(userId, id));
  
  // Update index
  const indexRaw = await kvGetRaw(indexKey(userId));
  if (indexRaw) {
    try {
      const ids: string[] = JSON.parse(indexRaw);
      const filtered = ids.filter((i) => i !== id);
      await kvSetRaw(indexKey(userId), JSON.stringify(filtered));
    } catch {
      // Index corrupted, ignore
    }
  }
  
  return true;
}

export async function getModelKey(userId: string, id: string): Promise<string | null> {
  const model = await getModel(userId, id);
  if (!model || !model.keyRecord) return null;
  try {
    return decrypt(model.keyRecord);
  } catch {
    return null;
  }
}