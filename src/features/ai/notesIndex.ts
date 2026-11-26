/**
 * In-memory, read-only keyword index over ready extracted notes.
 *
 * Nothing is written to Dexie. The index is rebuilt on every search from the
 * current contents of `db.notes`, so it always reflects saved, re-extracted or
 * finalized notes without a separate storage hook.
 *
 * Each note's markdown is joined from chunks as "## Pages X-Y\n\n<text>" (see
 * libraryRepo.finalizeNote). We split on those page headings, then further on
 * markdown headings inside a page, producing one index entry per section with
 * the file name, page range, heading text, section text and a needsReview flag.
 */

import { db } from '../../db/db';
import type { Resource } from '../../types';

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','by','for','from','has','he','in','is','it','its',
  'of','on','or','that','the','to','was','were','will','with','you','your','i','me','my',
  'we','us','our','this','that','these','those','am','been','being','have','had','having',
  'do','does','did','doing','but','if','then','than','so','such','no','nor','not','only',
  'own','same','some','such','can','could','should','would','may','might','must',
  // basic Arabic function words
  'ال','في','من','على','إلى','عن','مع','هذا','هذه','الذي','التي','كان','كانت','или','او',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u0600-\u06ff]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

interface Section {
  fileId: string;
  fileName: string;
  pageRange: string | null;
  heading: string | null;
  text: string;
  tokens: string[];
  needsReview: boolean;
}

interface IndexDoc {
  sections: Section[];
  totalTokens: number;
}

function splitSections(markdown: string): { pageRange: string | null; heading: string | null; text: string }[] {
  const out: { pageRange: string | null; heading: string | null; text: string }[] = [];
  const pageParts = markdown.split(/\n## Pages\s+(\d+)\u2013(\d+)\s*\n/);
  // pageParts[0] is text before the first page heading (ignore), then triples: [rangeStart, rangeEnd, body]
  for (let i = 1; i < pageParts.length; i += 3) {
    const pageStart = pageParts[i];
    const pageEnd = pageParts[i + 1];
    const body = pageParts[i + 2] ?? '';
    const pageRange = `${pageStart}–${pageEnd}`;
    // Split body by markdown headings.
    const chunks = body.split(/\n(?=#{1,6}\s)/);
    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      const m = trimmed.match(/^(#{1,6})\s+(.*)/);
      const heading = m ? m[2].trim() : null;
      const text = m ? trimmed.slice(m[0].length).trim() : trimmed;
      out.push({ pageRange, heading, text });
    }
  }
  return out;
}

function buildIndex(): Promise<IndexDoc> {
  return (async () => {
    const sections: Section[] = [];
    let totalTokens = 0;

    const resources: Resource[] = await db.resources.where('kind').equals('file').toArray();
    for (const resource of resources) {
      const note = await db.notes.get(resource.id);
      if (!note || note.status !== 'ready' || !note.markdown?.trim()) continue;
      const fileName = resource.fileName || resource.title || resource.id;
      const pageSections = splitSections(note.markdown);
      const needsReview = note.chunks?.some((c) => c.status !== 'ready') ?? false;
      for (const s of pageSections) {
        const tokens = tokenize(s.text);
        totalTokens += tokens.length;
        sections.push({
          fileId: resource.id,
          fileName,
          pageRange: s.pageRange,
          heading: s.heading,
          text: s.text,
          tokens,
          needsReview,
        });
      }
    }
    return { sections, totalTokens };
  })();
}

export interface SearchResult {
  fileId: string;
  fileName: string;
  pageRange: string | null;
  heading: string | null;
  snippet: string;
  score: number;
  needsReview: boolean;
}

function scoreSection(section: Section, queryTokens: string[], phrases: string[], avgDocLen: number): number {
  // BM25-ish: sum over query terms of IDF * TF/(TF + k*(1-b + b*len/avgLen)), plus heading boost.
  const k1 = 1.2, b = 0.75;
  const len = section.tokens.length || 1;
  const tf: Record<string, number> = {};
  for (const t of section.tokens) tf[t] = (tf[t] || 0) + 1;

  // IDF over the index would need all docs; approximate with a small constant so
  // ranking is driven by term frequency and the heading/phrase boosts.
  let score = 0;
  for (const q of queryTokens) {
    const f = tf[q] || 0;
    if (f === 0) continue;
    score += (f * (k1 + 1)) / (f + k1 * (1 - b + b * (len / Math.max(avgDocLen, 1))));
  }
  // Phrase bonus: reward sections containing every phrase word in order.
  for (const phrase of phrases) {
    const pt = tokenize(phrase);
    let joined = section.tokens.join(' ');
    let ok = true;
    let pos = 0;
    for (const t of pt) {
      const idx = joined.indexOf(t, pos);
      if (idx < 0) { ok = false; break; }
      pos = idx + t.length;
    }
    if (ok) score += 3;
  }
  // Heading boost.
  if (section.heading && queryTokens.some((q) => section.heading.toLowerCase().includes(q))) score += 2;
  return score;
}

export async function searchNotesIndex(query: string): Promise<SearchResult[]> {
  const index = await buildIndex();
  if (index.sections.length === 0) return [];

  const avgDocLen = index.totalTokens / index.sections.length;
  // Split phrases (quoted) from single terms.
  const phrases: string[] = [];
  let rest = query;
  for (const m of query.matchAll(/"([^"]+)"/g)) {
    phrases.push(m[1]);
    rest = rest.replace(m[0], ' ');
  }
  const queryTokens = tokenize(rest).filter((t) => phrases.every((p) => !tokenize(p).includes(t)));

  const scored = index.sections
    .map((s) => ({ s, score: scoreSection(s, queryTokens, phrases, avgDocLen) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const results: SearchResult[] = [];
  let budget = 4000;
  for (const { s, score } of scored) {
    if (budget <= 0) break;
    const snippet = s.text.slice(0, 1200);
    results.push({
      fileId: s.fileId,
      fileName: s.fileName,
      pageRange: s.pageRange,
      heading: s.heading,
      snippet,
      score,
      needsReview: s.needsReview,
    });
    budget -= snippet.length;
  }
  return results;
}

export function indexSizeKB(index: IndexDoc): number {
  return Math.round((JSON.stringify(index).length / 1024) * 10) / 10;
}
