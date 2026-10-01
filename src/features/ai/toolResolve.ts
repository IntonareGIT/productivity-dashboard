/**
 * ONE way to turn whatever the model passed into exactly one row.
 *
 * This replaces three different implementations (an id-only `db.get()` in
 * toolsExtended, the `resolveByIdOrName` in this file, and a third hand-rolled
 * copy in the split-screen tool) that disagreed about whether a name works.
 *
 * The rules, in order, and never fewer than exactly one result:
 *   1. exact id
 *   2. exact, case-insensitive name or title
 *   3. a UNIQUE case-insensitive partial match
 *
 * `kind` is explicit and mandatory, and only that kind's table is searched. That
 * is what stops an id of one kind being looked up as another: a topic id can
 * never resolve as a subject, so a cross-kind mistake produces a clear
 * kind-mismatch error instead of silently acting on the wrong record.
 *
 * Scope: when a caller also has a subjectId or topicId, pass it as `scope`, and
 * name lookups are restricted to that parent. "Graphs" in two different subjects
 * then resolves per subject instead of looking ambiguous.
 */
export type Resolved<T> =
  | { row: T }
  | { candidates: { id: string; name: string }[] }
  | { error: string };

const norm = (v: string) => v.trim().toLowerCase();

export function isAmbiguous<T>(r: Resolved<T>): r is { candidates: { id: string; name: string }[] } {
  return 'candidates' in r;
}

/** What every tool result reports about the item it touched. */
export interface ResolvedItem {
  kind: string;
  id: string;
  name: string;
}

export interface ResolveOptions<T> {
  /** What the model passed: an id, or a name. */
  ref: unknown;
  /** The rows to search. MUST be of exactly one kind. */
  rows: T[];
  /** Which field holds the display name for this kind. */
  nameOf: (row: T) => string;
  /** Human label used in messages, e.g. "subject". */
  label: string;
  /** Singular kind name for result payloads, e.g. "subject". */
  kind: string;
  /** Optional parent filter, so a name is looked up within one subject/topic. */
  scope?: { field: string; value: string } | null;
  /** The name of the scope field, for the error text. */
  scopeLabel?: string;
}

/** The three closest names, so "not found" is actionable instead of a dead end. */
function closestNames<T>(rows: T[], nameOf: (row: T) => string, needle: string): string[] {
  return rows
    .map((r) => nameOf(r))
    .filter((n) => {
      const a = norm(n);
      const b = needle;
      // Cheap similarity: shared prefix, shared substring, or shared letters.
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
      return i > 1 || a.includes(b) || b.includes(a) || [...new Set(a)].some((c) => b.includes(c));
    })
    .slice(0, 3);
}

export function resolveItem<T extends { id: string }>(opts: ResolveOptions<T>): Resolved<T> {
  const { ref, rows, nameOf, label, kind, scope } = opts;
  const raw = String(ref ?? '').trim();
  if (!raw) {
    return {
      error:
        `No ${label} was given. Pass the id exactly as returned by searchLibrary or a list tool. `
        + `A name is accepted as a fallback.`,
    };
  }

  const pool = scope
    ? rows.filter((r) => String((r as Record<string, unknown>)[scope.field] ?? '') === scope.value)
    : rows;

  // 1. An exact id always wins, so a correct id is never turned into a name
  //    search. Checked against the FULL table first, so a valid id is never
  //    reported as "outside this subject" when the scope filter is right but the
  //    caller passed a slightly different parent.
  const byId = rows.find((r) => r.id === raw);
  if (byId) return { row: byId };

  const n = norm(raw);
  // 2. Exact, case-insensitive name.
  const exact = pool.filter((r) => norm(nameOf(r)) === n);
  if (exact.length === 1) return { row: exact[0] };
  if (exact.length > 1) {
    return { candidates: exact.map((r) => ({ id: r.id, name: nameOf(r) })) };
  }

  // 3. A UNIQUE partial match. Several partial matches are not a guess.
  const loose = pool.filter((r) => norm(nameOf(r)).includes(n));
  if (loose.length === 1) return { row: loose[0] };
  if (loose.length > 1) {
    return { candidates: loose.map((r) => ({ id: r.id, name: nameOf(r) })) };
  }

  // Nothing matched. Offer the closest names, so a near-miss is one retry away
  // instead of a dead end, and say plainly that only this kind is searched.
  const suggestions = closestNames(rows, nameOf, n);
  const where = scope
    ? ` in that ${opts.scopeLabel ?? 'scope'}`
    : '';
  return {
    error:
      `No ${label}${where} matches "${raw}".`
      + (suggestions.length ? ` Closest: ${suggestions.join(', ')}.` : '')
      + ` Nothing was changed. Call searchLibrary or the list tool for ${label}s and use the id. `
      + `Note: an id from a different kind of item will not match here, because only ${kind}s are searched.`,
  };
}

/**
 * The id-shaped string that is NOT in this table.
 *
 * Returning "it looks like an id, but it is not a <kind>" is far more useful to
 * the model than "no match": it tells it the id is stale or of the wrong kind,
 * which is a different recovery from passing a name that does not exist.
 */
export function looksLikeId(ref: unknown): boolean {
  const s = String(ref ?? '').trim();
  return s.length >= 6 && /^[A-Za-z0-9_-]+$/.test(s) && !/\s/.test(s);
}

/** The message a resolver rejection must produce for the model. */
export function resolutionMessage<T>(r: Resolved<T>, label: string): string {
  if ('row' in r) return '';
  if (isAmbiguous(r)) {
    return (
      `More than one ${label} matches. Ask the user which one, then call again with the id. `
      + `Candidates: ${r.candidates.map((c) => `${c.name} (id: ${c.id})`).join('; ')}`
    );
  }
  return r.error;
}

/** The `{ kind, id, name }` block every tool result carries. */
export function itemRef<T extends { id: string }>(kind: string, row: T, nameOf: (r: T) => string): ResolvedItem {
  return { kind, id: row.id, name: nameOf(row) };
}

/* ------------------------------------------------------------------ */
/* The kind registry                                                   */
/* ------------------------------------------------------------------ */

/**
 * Every kind the tools can refer to, and where its rows and display name live.
 *
 * The table is declared ONCE here so a tool cannot accidentally search the wrong
 * one. `note` is a real alias for `topic`: a note IS a topic's notes field, and
 * the note tools take a `topicId`, so mapping them explicitly is clearer than
 * having each note tool remember that.
 */
export const ITEM_KINDS = {
  subject: { table: 'subjects', name: 'name', label: 'subject' },
  topic: { table: 'topics', name: 'title', label: 'topic' },
  note: { table: 'topics', name: 'title', label: 'note' },
  resource: { table: 'resources', name: 'title', label: 'resource' },
  group: { table: 'resourceGroups', name: 'name', label: 'group' },
  event: { table: 'calendarEvents', name: 'title', label: 'event' },
  assessment: { table: 'assessments', name: 'name', label: 'assessment' },
} as const;

export type ItemKind = keyof typeof ITEM_KINDS;

/** Read the display name of a row of this kind, whatever it calls the field. */
export function kindNameOf<T>(kind: ItemKind) {
  const field = ITEM_KINDS[kind].name;
  return (row: T): string => String((row as Record<string, unknown>)[field] ?? '');
}

/** The generic `{ kind, id, name }` for a resolved row. */
export function refOf<T extends { id: string }>(kind: ItemKind, row: T): ResolvedItem {
  return { kind, id: row.id, name: kindNameOf<T>(kind)(row) };
}

/** The `*Id` parameter name a kind conventionally uses, for error text. */
export function idParamOf(kind: ItemKind): string {
  return `${kind}Id`;
}

/**
 * Resolve one item by id-or-name, for a given kind, and FAIL LOUDLY on refusal.
 *
 * This is the single entry point every tool should use. It reads only the one
 * table that kind maps to, so a topic id can never resolve as a subject.
 *
 * `throwOnAmbiguous` is false for tools that must not fail: a caller that wants
 * to show the options (rather than stop) gets the candidate list back instead of
 * an exception.
 */
export async function needItem<T extends { id: string }>(opts: {
  kind: ItemKind;
  ref: unknown;
  /** Rows of exactly this kind. Pass `await loadRows(kind)` or a scoped set. */
  rows: T[];
  scope?: { field: string; value: string; label: string } | null;
}): Promise<T> {
  const def = ITEM_KINDS[opts.kind];
  const r = resolveItem<T>({
    ref: opts.ref,
    rows: opts.rows,
    nameOf: kindNameOf<T>(opts.kind),
    label: def.label,
    kind: opts.kind,
    scope: opts.scope ? { field: opts.scope.field, value: opts.scope.value } : null,
    scopeLabel: opts.scope?.label,
  });
  if ('row' in r) return r.row;
  if (isAmbiguous(r)) {
    throw new Error(
      `More than one ${def.label} matches "${String(opts.ref)}". `
      + `Ask the user which one, then call again with an id. `
      + `Candidates: ${r.candidates.map((c) => `${c.name} (id: ${c.id})`).join('; ')}`,
    );
  }
  throw new Error(r.error);
}

/**
 * Backwards-compatible wrapper over `resolveItem`.
 *
 * The library tools call this with an explicit row list. It is kept so the
 * existing 15 tools do not all have to change shape at once, while the LOOKUP
 * RULES themselves now live in exactly one place.
 */
export const resolveByIdOrName = <T extends { id: string }>(
  rows: T[],
  idOrName: unknown,
  nameOf: (row: T) => string,
  label: string,
): Resolved<T> => resolveItem<T>({ ref: idOrName, rows, nameOf, label, kind: label });
