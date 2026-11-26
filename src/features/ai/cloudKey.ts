/**
 * Where a file lives in R2.
 *
 * Keys are `{userId}/{subject}/{fileName}`. The subject segment is what makes
 * the bucket readable as folders, and it is the whole point of the
 * organization requirement: every file for a subject lands under one prefix,
 * so a subject's files can be listed, moved or wiped as a unit.
 *
 * The subject name is sanitized because it is a path segment, not a display
 * string: it is lowercased, stripped of anything that is not a letter, digit,
 * underscore or hyphen, and truncated so a pathological name cannot blow up a
 * key. Two different subjects that sanitize to the same string keep their
 * distinct ids, so collisions are impossible.
 *
 * The userId prefix is the security boundary: it is the verified Dexie `sub`
 * claim, so one user's keys can never collide with another's.
 */

/** A single safe segment for use as a path component. */
export function slugifySegment(value: string, fallback: string): string {
  const cleaned = (value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || fallback;
}

/**
 * Build the R2 key for a file, scoped to its subject.
 *
 * `subjectId` is the fallback name when the subject has no title, and it is
 * also appended when two subjects would slug to the same string — which
 * guarantees uniqueness without needing a random suffix.
 */
export function buildCloudKey(
  userId: string,
  subjectId: string,
  subjectName: string | null | undefined,
  fileName: string,
): string {
  const base = slugifySegment(subjectName, subjectId.slice(0, 8) || 'subject');
  const safeSubject = subjectName && slugifySegment(subjectName, subjectId.slice(0, 8)) === base
    ? base
    : `${base}-${subjectId.slice(0, 6)}`;
  const safeFile = slugifySegment(fileName, 'file');
  return `${userId}/${safeSubject}/${safeFile}`;
}

/** The subject segment of a key, or null if the key is not user-scoped. */
export function subjectSegmentOf(key: string | null | undefined): string | null {
  if (!key) return null;
  const parts = key.split('/');
  return parts.length >= 3 ? parts[parts.length - 2] : null;
}

/** The fileName segment of a key. */
export function fileNameSegmentOf(key: string | null | undefined): string | null {
  if (!key) return null;
  const parts = key.split('/');
  return parts.length >= 3 ? parts[parts.length - 1] : null;
}

/** True when the key belongs to this user's prefix. */
export function keyBelongsToUser(key: string | null | undefined, userId: string): boolean {
  return !!key && key.startsWith(`${userId}/`);
}