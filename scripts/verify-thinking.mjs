/**
 * Thinking-block parser verification.
 *
 * Exercises the real `thinking.ts` against every response shape the app has to
 * cope with: tagged reasoning, the provider-native field, both at once, a
 * still-streaming unclosed tag, and — most importantly — a standard model that
 * produces NO reasoning, which must bypass the thought block entirely.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'think-'));
const outFile = join(outDir, 'thinking.mjs');

await build({
  entryPoints: ['src/features/ai/thinking.ts'],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});

const { extractThinking, thoughtPreview } = await import(`file://${outFile.replace(/\\/g, '/')}`);

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

// ---- 1. No reasoning at all: the standard-model path -------------------
{
  const plain = 'Your shift today is 9 to 5.';
  const r = extractThinking(plain);
  check('1 a plain reply yields no thought', r.thought === null);
  check('1 the body is the message unchanged', r.body === plain);
  check('1 absent reasoning stays absent', extractThinking(plain, undefined).thought === null);
  check('1 an empty reasoning field is not a thought', extractThinking(plain, '').thought === null);
  check('1 a whitespace-only reasoning field is not a thought', extractThinking(plain, '   \n  ').thought === null);
}

// ---- 2. <think> tags ---------------------------------------------------
{
  const r = extractThinking('<think>Let me check the roster.</think>Your shift is 9 to 5.');
  check('2 <think> is extracted', r.thought === 'Let me check the roster.');
  check('2 <think> is stripped from the body', r.body === 'Your shift is 9 to 5.');
  check('2 the body keeps no tags', !r.body.includes('<think>'));
}

// ---- 3. Tags are model-agnostic ---------------------------------------
{
  const a = extractThinking('<thinking>step one</thinking>Done.');
  check('3 <thinking> is supported', a.thought === 'step one' && a.body === 'Done.');
  const b = extractThinking('<reasoning>why</reasoning>Answer.');
  check('3 <reasoning> is supported', b.thought === 'why' && b.body === 'Answer.');
  const c = extractThinking('<THINK>SHOUTY</THINK>Answer.');
  check('3 tags are case-insensitive', c.thought === 'SHOUTY' && c.body === 'Answer.');
  const d = extractThinking('<think type="x">attributed</think>Answer.');
  check('3 an attributed tag is still a think block', d.thought === 'attributed' && d.body === 'Answer.');
}

// ---- 4. The provider-native field -------------------------------------
{
  const r = extractThinking('Your shift is 9 to 5.', 'Checked the weekly roster first.');
  check('4 reasoning_content becomes the thought', r.thought === 'Checked the weekly roster first.');
  check('4 the visible body is untouched', r.body === 'Your shift is 9 to 5.');
}

// ---- 5. Both sources at once ------------------------------------------
{
  const r = extractThinking('<think>tagged</think>Answer.', 'native');
  check('5 both sources are kept', r.thought.includes('tagged') && r.thought.includes('native'));
  check('5 the body holds only the answer', r.body === 'Answer.');
}

// ---- 6. Several blocks, and text between them -------------------------
{
  const r = extractThinking('<think>one</think>Middle<think>two</think>End.');
  check('6 every block is collected', r.thought.includes('one') && r.thought.includes('two'));
  check('6 surrounding prose survives', r.body.includes('Middle') && r.body.includes('End.'));
  check('6 no tag leaks into the body', !/[<>]/.test(r.body));
}

// ---- 7. A still-streaming (unclosed) block ----------------------------
{
  const r = extractThinking('<think>half a thought');
  check('7 an unclosed block is still reasoning', r.thought === 'half a thought');
  check('7 an unclosed block leaves an empty body', r.body === '');
  const r2 = extractThinking('Intro.<think>still going');
  check('7 text before an unclosed block is the body', r2.body === 'Intro.');
}

// ---- 8. Whitespace and formatting hygiene ------------------------------
{
  const r = extractThinking('<think>a</think>\n\n\n\nAnswer.');
  check('8 blank-line runs are collapsed', !/\n{3,}/.test(r.body));
  check('8 the body is trimmed', r.body === 'Answer.');
  // Indentation inside reasoning (e.g. a code block) must survive.
  const code = extractThinking('<think>if (x) {\n  return 1;\n}</think>Done.');
  check('8 indentation inside reasoning is preserved', code.thought.includes('  return 1;'));
}

// ---- 9. Malformed / hostile input never throws -------------------------
{
  let threw = false;
  try {
    extractThinking('<think>unclosed', undefined);
    extractThinking('</think>only a close');
    extractThinking('<think></think>');
    extractThinking('<<>>', null);
    extractThinking('');
  } catch { threw = true; }
  check('9 malformed input never throws', threw === false);
  check('9 an empty block is not a thought', extractThinking('<think></think>Done.').thought === null);
  check('9 a lone closing tag is left alone', extractThinking('</think>Done.').body.includes('Done.'));
}

// ---- 10. thoughtPreview ------------------------------------------------
{
  check('10 the preview is the first non-empty line', thoughtPreview('\n\nfirst real line\nsecond') === 'first real line');
  check('10 a long line is truncated with an ellipsis', thoughtPreview('x'.repeat(200)).endsWith('…'));
  check('10 the preview respects the max length', thoughtPreview('y'.repeat(200), 20).length <= 20);
  check('10 blank reasoning gives an empty preview', thoughtPreview('   \n\n  ') === '');
}

// ---- 11. Purity: the parser must not reach for React/Dexie/the network --
{
  const src = readFileSync('src/features/ai/thinking.ts', 'utf8');
  check('11 the parser does not import React', !/from 'react'/.test(src));
  check('11 the parser does not touch Dexie', !/indexedDB|\bdb\./.test(src));
  check('11 the parser does not fetch', !/\bfetch\(/.test(src));
  check('11 the parser is exported for reuse', /export function extractThinking/.test(src));
}

// ---- 12. The UI contract: the block must actually be reachable ----------
// The parser was correct while the block stayed invisible, because Gemini
// sends reasoning as `"thought": true` content parts rather than <think> tags.
// These assert the whole capture -> store -> render path, so that cannot recur.
{
  const aiClient = readFileSync('src/features/ai/aiClient.ts', 'utf8');
  const chat = readFileSync('src/features/ai/components/AssistantChat.tsx', 'utf8');
  const block = readFileSync('src/features/ai/components/ThoughtBlock.tsx', 'utf8');
  const store = readFileSync('src/stores/useAssistantStore.ts', 'utf8');
  const repo = readFileSync('src/features/ai/chatRepo.ts', 'utf8');

  // Capture: Gemini flags thinking parts rather than wrapping them in tags.
  check('12 Gemini thought parts are split out of the answer',
    /thought === true/.test(aiClient) && /readThoughtsArray/.test(aiClient));
  check('12 the answer is returned without the reasoning parts',
    /readContent\(message\.content\)/.test(aiClient));
  check('12 the request leaves room for a thinking model',
    /maxTokens = 4096/.test(aiClient));

  // Store: the reasoning has to reach the row for the view to ever see it.
  check('12 the final answer turn is stored with its reasoning',
    /persist\(sessionId, \{ role: 'assistant', content: raw, reasoning: result\.reasoning \}\)/.test(store));
  check('12 the row keeps reasoning in its own column', /reasoning: msg\.reasoning \?\? null/.test(repo));
  check('12 the view projects reasoning into thought',
    /extractThinking\(row\.content, row\.reasoning\)/.test(repo) && /thought: thought \?\? undefined/.test(repo));

  // Render: a small collapsed line ABOVE the reply.
  check('12 the chat mounts the thought block', /<ThoughtBlock/.test(chat));
  check('12 it is guarded so a thoughtless reply renders nothing',
    /msg\.thought && <ThoughtBlock/.test(chat));
  // The block sits above the reply text. Note the JSX expression closes with
  // `}` after `/>`, so the separator has to allow for it.
  check('12 the block sits above the reply text',
    /<ThoughtBlock[^>]*\/>\}\s*\{msg\.text\}/.test(chat));
  check('12 the disclosure starts collapsed', /useState\(streaming\)/.test(block));
  check('12 it is labelled and exposes its state',
    /Thought process/.test(block) && /aria-expanded=\{open\}/.test(block));
  check('12 the collapsed line previews the reasoning',
    /!open && preview/.test(block) && /thoughtPreview\(text\)/.test(block));
  check('12 the reasoning is muted and smaller than the answer',
    /text-xs/.test(block) && /text-content-tertiary/.test(block));
  check('12 empty reasoning renders nothing', /if \(!text\.trim\(\)\) return null/.test(block));
}

rmSync(outDir, { recursive: true, force: true });

console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

