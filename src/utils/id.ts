// Shared unique-id helper (Dexie primary keys for all tables).
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older browsers / non-secure contexts
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
