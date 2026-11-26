/**
 * Extraction configuration — single source for chunk size, limits, and model IDs.
 * Do NOT read chunk size from anywhere else.
 */
export const EXTRACTION_CONFIG = {
  /** Number of pages per chunk sent to the model for text PDFs. */
  chunkPages: 20,

  /** Number of pages per chunk for scanned or photo-heavy PDFs. */
  scannedChunkPages: 5,

  /** Maximum number of chunks per PDF (prevents runaway jobs). */
  maxChunks: 40,

  /** PDF-capable model IDs that the runner may use. */
  pdfCapableModelIds: [
    'gemini-3.1-flash-lite',
    'gemini-3.1-flash',
    'gemini-3.1-pro',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
  ] as const,
} as const;

export type ExtractionConfig = typeof EXTRACTION_CONFIG;

/** Choose chunk size: scanned/photo PDFs use 5 pages, text PDFs keep 20. */
export function chunkPagesFor(isScanned: boolean): number {
  return isScanned ? EXTRACTION_CONFIG.scannedChunkPages : EXTRACTION_CONFIG.chunkPages;
}