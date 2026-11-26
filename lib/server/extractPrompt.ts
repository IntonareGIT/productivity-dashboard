/**
 * Prompt used for each PDF chunk extraction.
 * Sent as the user message alongside the PDF pages.
 */
export const EXTRACT_PROMPT = `You are given scanned PDF pages {pageStart}–{pageEnd}. Your job is transcription, not description or summary.

Rules:
- Copy every line of text in reading order: headers, footers, page numbers, labels, numbers, units, table cells, and handwriting.
- Keep equations in LaTeX (inline $...$, display $$...$$).
- Render tables as proper Markdown tables with header rows and alignment.
- For each figure: first transcribe every label, number, unit, and caption exactly, then add one short line "[Figure: ...]" after that text. The figure note never replaces the transcribed text.
- For unreadable text, write "[unreadable: location on the page]" and continue.
- Do not add any preface or commentary: no "Here is", "Attached is", "This image shows", "The page contains", and no headings the page does not have.
- Output only the page content.`;

export function formatExtractPrompt(pageStart: number, pageEnd: number): string {
  return EXTRACT_PROMPT.replace('{pageStart}', String(pageStart)).replace('{pageEnd}', String(pageEnd));
}
