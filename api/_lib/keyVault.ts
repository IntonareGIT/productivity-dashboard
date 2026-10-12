/**
 * Per-user encrypted key vault using Upstash Redis REST API and Node's built-in crypto.
 *
 * Keys are stored as: keys:{userId}:{provider} -> { iv, tag, ciphertext }
 * All values are base64-encoded. AES-256-GCM with a random 12-byte IV.
 * The encryption secret comes from KEY_ENCRYPTION_SECRET (64 hex chars = 32 bytes).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const ENC_SECRET_HEX = process.env.KEY_ENCRYPTION_SECRET;

function assertEnv(): void {
  if (!KV_URL) throw new Error('KV_REST_API_URL is not set');
  if (!KV_TOKEN) throw new Error('KV_REST_API_TOKEN is not set');
  if (!ENC_SECRET_HEX) throw new Error('KEY_ENCRYPTION_SECRET is not set');
  if (ENC_SECRET_HEX.length !== 64) throw new Error('KEY_ENCRYPTION_SECRET must be 64 hex characters (32 bytes)');
}

function getKey(): Buffer {
  assertEnv();
  return Buffer.from(ENC_SECRET_HEX, 'hex');
}

function kvHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${KV_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

export interface EncryptedRecord {
  iv: string;
  tag: string;
  ciphertext: string;
}

export function encrypt(plaintext: string): EncryptedRecord {
  assertEnv();
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decrypt(record: EncryptedRecord): string {
  assertEnv();
  const key = getKey();
  const iv = Buffer.from(record.iv, 'base64');
  const tag = Buffer.from(record.tag, 'base64');
  const ciphertext = Buffer.from(record.ciphertext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

function keyPath(userId: string, provider: string): string {
  return `keys:${userId}:${provider}`;
}

export async function kvGet(userId: string, provider: string): Promise<EncryptedRecord | null> {
  assertEnv();
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(keyPath(userId, provider))}`, {
    headers: kvHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Upstash GET failed: ${res.status}`);
  const data = await res.json();
  return data?.result ? data.result : null;
}

export async function kvSet(userId: string, provider: string, record: EncryptedRecord): Promise<void> {
  assertEnv();
  const res = await fetch(`${KV_URL}/set/${encodeURIComponent(keyPath(userId, provider))}`, {
    method: 'POST',
    headers: kvHeaders(),
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(`Upstash SET failed: ${res.status}`);
}

export async function kvDelete(userId: string, provider: string): Promise<void> {
  assertEnv();
  const res = await fetch(`${KV_URL}/del/${encodeURIComponent(keyPath(userId, provider))}`, {
    method: 'POST',
    headers: kvHeaders(),
  });
  if (!res.ok) throw new Error(`Upstash DEL failed: ${res.status}`);
}