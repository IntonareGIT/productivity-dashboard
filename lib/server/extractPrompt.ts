/**
 * Prompt used for each PDF chunk extraction.
 * Sent as the user message alongside the PDF pages.
 */
export const EXTRACT_PROMPT = `You are given a PDF segment (pages {pageStart}–{pageEnd}). Extract its content as clean Markdown.

Rules:
- Preserve all headings (#, ##, ###) exactly as they appear.
- Keep equations in LaTeX format (inline $...$, display $$...$$).
- Render tables as proper Markdown tables with header rows and alignment.
- For images/diagrams/figures, write a single line: [Figure: short description of what it shows]
- For any text that is unreadable, smudged, or illegible, write: [unreadable]
- Do not add commentary, summaries, or extra text beyond the extracted content.
- Output only the Markdown for this page range.`;

export function formatExtractPrompt(pageStart: number, pageEnd: number): string {
  return EXTRACT_PROMPT.replace('{pageStart}', String(pageStart)).replace('{pageEnd}', String(pageEnd));
}