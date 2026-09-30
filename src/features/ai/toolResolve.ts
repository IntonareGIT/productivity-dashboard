/**
 * Resolve an id-or-name argument to exactly one row.
 *
 * Reliability rule for the AI tools: a name the model typed from conversation
 * ("the graphs topic") should work, but a WRONG match must never be guessed.
 * So this returns:
 *   - the row            when the id is exact, or the name is unique
 *   - a candidate list   when a name matches more than one row, so the model can
 *                        show the options instead of acting on the wrong record
 */
export type Resolved<T> =
  | { row: T }
  | { candidates: { id: string; name: string }[] }
  | { error: string };

const norm = (v: string) => v.trim().toLowerCase();

export function isAmbiguous<T>(r: Resolved<T>): r is { candidates: { id: string; name: string }[] } {
  return 'candidates' in r;
}

export const resolveByIdOrName = <T extends { id: string }>(
  rows: T[],
  idOrName: unknown,
  nameOf: (row: T) => string,
  label: string,
): Resolved<T> => {
  const raw = String(idOrName ?? '').trim();
  if (!raw) return { error: `${label} is required. Pass the id from searchLibrary, or an exact name.` };

  // An exact id always wins, so a correct id is never turned into a name search.
  const byId = rows.find((r) => r.id === raw);
  if (byId) return { row: byId };

  const n = norm(raw);
  const exact = rows.filter((r) => norm(nameOf(r)) === n);
  if (exact.length === 1) return { row: exact[0] };
  if (exact.length > 1) {
    return { candidates: exact.map((r) => ({ id: r.id, name: nameOf(r) })) };
  }

  // Substring fallback, still refusing to guess between several matches.
  const loose = rows.filter((r) => norm(nameOf(r)).includes(n));
  if (loose.length === 1) return { row: loose[0] };
  if (loose.length > 1) {
    return { candidates: loose.map((r) => ({ id: r.id, name: nameOf(r) })) };
  }

  return {
    error: `No ${label} matches "${raw}". Nothing was changed. Call searchLibrary or the list tool to get the correct id, then retry.`,
  };
};

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
