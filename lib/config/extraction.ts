/**
 * Extraction configuration — single source for chunk size, limits, and model IDs.
 * Do NOT read chunk size from anywhere else.
 */
export const EXTRACTION_CONFIG = {
  /** Number of pages per chunk sent to the model. */
  chunkPages: 20,

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