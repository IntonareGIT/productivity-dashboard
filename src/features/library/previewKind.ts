import type { Resource } from '../../types';

/**
 * How a resource should be previewed.
 *
 * - `image`  : jpeg/png render inline from the stored blob
 * - `pdf`    : rendered inline by the shared PdfViewer (pdf.js)
 * - `drive`  : Google Drive share link, shown via the standard preview iframe
 * - `opaque` : Word/PowerPoint and anything else we do NOT render; download only
 * - `link`   : a plain (non-Drive) link; open in a new tab
 * - `none`   : a link resource with no URL at all
 */
export type PreviewKind = 'image' | 'pdf' | 'drive' | 'opaque' | 'link' | 'none';

const IMAGE_EXT = /\.(jpe?g|png)$/i;
const PDF_EXT = /\.pdf$/i;
const DOC_EXT = /\.(docx?|pptx?|odt|odp|rtf|epub)$/i;

/**
 * Google's share-link patterns. Both the modern `/file/d/<id>/view` form and
 * the short `?id=<id>` form are accepted.
 */
const DRIVE_PATTERNS = [
  /^https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
  /^https?:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
  /^https?:\/\/drive\.google\.com\/uc\?id=([a-zA-Z0-9_-]+)/,
  /^https?:\/\/docs\.google\.com\/viewerng\/viewer\?url=([^&]+)/,
];

/** True when `url` is a Google Drive share link. */
export function isGoogleDriveUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return DRIVE_PATTERNS.some((re) => re.test(url.trim()));
}

/**
 * Google's documented embed endpoint for a Drive file id.
 *
 * Note this is a best-effort embed: Drive serves its own "you don't have
 * access" page inside the iframe for private or unshared files, which the
 * parent page cannot detect. The Open link fallback is therefore always shown
 * alongside the embed, so the user is never trapped.
 */
export function googleDriveEmbedUrl(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  for (const re of DRIVE_PATTERNS) {
    const m = trimmed.match(re);
    if (!m) continue;
    // The docs.google.com/viewerng form already carries an encoded url= param.
    if (re.source.includes('viewerng')) {
      return `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(m[1])}`;
    }
    return `https://drive.google.com/file/d/${m[1]}/preview`;
  }
  return null;
}

/** Guess the MIME type for a stored blob, preferring an explicit value. */
export function effectiveMime(resource: Pick<Resource, 'mimeType' | 'fileName' | 'urlOrPath'>): string {
  if (resource.mimeType) return resource.mimeType.toLowerCase();
  const name = (resource.fileName || resource.urlOrPath || '').toLowerCase();
  if (IMAGE_EXT.test(name)) return 'image/png';
  if (PDF_EXT.test(name)) return 'application/pdf';
  if (DOC_EXT.test(name)) return 'application/msword';
  return '';
}

/**
 * Decide how one resource should be previewed.
 *
 * File blobs are NOT synced (per the backup/sync decision), so a file resource
 * can legitimately have no blob on this device. That is reported as `none` for
 * uploads, so the viewer can say "not available on this device" instead of
 * showing a broken viewer.
 */
export function previewKindFor(resource: Resource): PreviewKind {
  if (resource.kind === 'link') {
    const url = (resource.urlOrPath ?? '').trim();
    if (!url) return 'none';
    return isGoogleDriveUrl(url) ? 'drive' : 'link';
  }

  // kind === 'file'
  if (!resource.blob) return 'none';
  const mime = effectiveMime(resource);
  if (mime === 'application/pdf' || PDF_EXT.test(resource.fileName ?? '')) return 'pdf';
  if (mime.startsWith('image/jpeg') || mime.startsWith('image/png')) return 'image';
  if (mime.startsWith('image/')) return 'opaque'; // gif/webp/svg: not required inline
  return 'opaque';
}

/** Human-readable file type label for the download fallback. */
export function fileTypeLabel(resource: Pick<Resource, 'mimeType' | 'fileName' | 'urlOrPath'>): string {
  const mime = effectiveMime(resource);
  if (mime === 'application/pdf') return 'PDF document';
  if (mime.includes('wordprocessingml') || mime === 'application/msword') return 'Word document';
  if (mime.includes('presentationml') || mime === 'application/vnd.ms-powerpoint') return 'PowerPoint presentation';
  if (mime === 'application/vnd.oasis.opendocument.text') return 'OpenDocument text';
  if (mime === 'application/vnd.oasis.opendocument.presentation') return 'OpenDocument presentation';
  if (mime === 'application/epub+zip') return 'EPUB book';
  if (mime === 'application/rtf' || mime === 'text/rtf') return 'Rich Text document';
  if (mime.startsWith('image/')) return `${mime.split('/')[1].toUpperCase()} image`;
  if (mime.startsWith('text/')) return 'Text file';
  const ext = (resource.fileName || '').split('.').pop();
  return ext && ext !== resource.fileName ? `${ext.toUpperCase()} file` : 'File';
}
