/**
 * Server-side PDF chunk extraction.
 * Uses pdf-lib to slice a page range, then sends it to the model via the adapter.
 * No secrets or provider responses leave this module.
 */
import { PDFDocument } from 'pdf-lib';
import { getModelKey } from './models';
import type { UserModel } from './models';

export interface ExtractChunkResult {
  markdown: string;
  pageStart: number;
  pageEnd: number;
}

export interface ExtractChunkError {
  error: string;
  status: number;
}

/**
 * Extract a page range from a PDF stored in R2 and send it to the model.
 * Returns { markdown, pageStart, pageEnd } on success.
 * Throws an ExtractChunkError with status on failure.
 */
export async function extractChunk(
  pdfBytes: Uint8Array,
  model: UserModel,
  pageStart: number,
  pageEnd: number
): Promise<ExtractChunkResult> {
  // 1. Slice the PDF to the requested page range (1-based, inclusive)
  let slicedPdf: Uint8Array;
  try {
    const doc = await PDFDocument.load(pdfBytes);
    const totalPages = doc.getPageCount();
    if (pageStart < 1 || pageEnd > totalPages || pageStart > pageEnd) {
      throw new Error('Invalid page range');
    }
    const newDoc = await PDFDocument.create();
    const indices = Array.from({ length: pageEnd - pageStart + 1 }, (_, i) => pageStart - 1 + i);
    const copied = await newDoc.copyPages(doc, indices);
    copied.forEach((p) => newDoc.addPage(p));
    slicedPdf = await newDoc.save();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'PDF slice failed';
    throw { error: msg, status: 500 };
  }

  // 2. Get the API key for this model
  const apiKey = await getModelKey(model.id);
  if (!apiKey) {
    throw { error: 'no_key', status: 403 };
  }

  // 3. Send to the model via its adapter
  let response: Response;
  if (model.adapter === 'gemini') {
    const normalizedModelId = model.modelId.trim().replace(/^models\//, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${normalizedModelId}:generateContent`;
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `You are given a PDF segment (pages ${pageStart}–${pageEnd}). Extract its content as clean Markdown.

Rules:
- Preserve all headings (#, ##, ###) exactly as they appear.
- Keep equations in LaTeX format (inline $...$, display $$...$$).
- Render tables as proper Markdown tables with header rows and alignment.
- For images/diagrams/figures, write a single line: [Figure: short description of what it shows]
- For any text that is unreadable, smudged, or illegible, write: [unreadable]
- Do not add commentary, summaries, or extra text beyond the extracted content.
- Output only the Markdown for this page range.` },
              {
                inline_data: {
                  mime_type: 'application/pdf',
                  data: Buffer.from(slicedPdf).toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 8192 },
      }),
    });
  } else {
    // openai-compatible
    const baseUrl = model.baseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/chat/completions`;
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model.modelId,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are given a PDF segment (pages ${pageStart}–${pageEnd}). Extract its content as clean Markdown.

Rules:
- Preserve all headings (#, ##, ###) exactly as they appear.
- Keep equations in LaTeX format (inline $...$, display $$...$$).
- Render tables as proper Markdown tables with header rows and alignment.
- For images/diagrams/figures, write a single line: [Figure: short description of what it shows]
- For any text that is unreadable, smudged, or illegible, write: [unreadable]
- Do not add commentary, summaries, or extra text beyond the extracted content.
- Output only the Markdown for this page range.`,
              },
              {
                type: 'file',
                file: {
                  filename: 'chunk.pdf',
                  file_data: Buffer.from(slicedPdf).toString('base64'),
                },
              },
            ],
          },
        ],
        max_tokens: 8192,
      }),
    });
  }

  // 4. Handle response
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      throw { error: 'no_key', status: 403 };
    }
    if (response.status === 404) {
      throw { error: 'Model not found at provider', status: 400 };
    }
    throw { error: `Provider error (status ${response.status})`, status: 502 };
  }

  let markdown = '';
  if (model.adapter === 'gemini') {
    const data = await response.json().catch(() => ({}));
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    markdown = text.trim();
  } else {
    const data = await response.json().catch(() => ({}));
    markdown = data.choices?.[0]?.message?.content?.trim() ?? '';
  }

  if (!markdown) {
    throw { error: 'empty_output', status: 502 };
  }

  return { markdown, pageStart, pageEnd };
}