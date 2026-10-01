/**
 * Provider-history turn-order verification (diagnostic + regression).
 *
 * A Gemini-style provider rejects a transcript whose function-call turns are not
 * in the sequence `user -> model call -> function response -> model answer` with
 * HTTP 400 INVALID_ARGUMENT, and it is STICKY: once a stored chat contains such
 * a sequence, every later message in that chat fails too. So the rule is not a
 * nicety, it is the difference between a chat that works and one that is dead.
 *
 * `isValidProviderHistory` is the oracle. Everything the request pipeline emits
 * must satisfy it.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outFile = join(process.cwd(), 'node_modules', '.cache-history.mjs');
const outFileNorm = join(process.cwd(), 'node_modules', '.cache-history-norm.mjs');

const dbStub = `
  export var db = {
    chatMessages: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
  };
`;
// Two separate bundles: esbuild refuses one outfile with several entries, and
// keeping them separate also proves the normalizer has no dependency on Dexie.
await build({
  entryPoints: ['src/features/ai/chatRepo.ts'],
  outfile: outFile,
  bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{
    name: 'stub-db',
    setup(b) {
      b.onResolve({ filter: /^\.\.\/\.\.\/db\/db$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: dbStub, loader: 'js' }));
    },
  }],
});
await build({
  entryPoints: ['src/features/ai/historyNormalizer.ts'],
  outfile: outFileNorm,
  bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});

const P = await import(`file://${outFile.replace(/\\/g, '/')}`);
const N = await import(`file://${outFileNorm.replace(/\\/g, '/')}`);

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

/* ---------- row fixtures ---------- */
let seq = 0;
const row = (role, over = {}) => {
  seq += 1;
  return {
    id: `m${seq}`, sessionId: 's1', role, content: over.content ?? 'ok',
    raw: over.raw ?? { role, content: over.content ?? 'x' },
    toolCallIds: over.toolCallIds, toolCallId: over.toolCallId ?? null, toolName: over.toolName ?? null,
    display: null, reasoning: null, error: false,
    createdAt: `2024-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
  };
};
const user = (c = 'hi') => row('user', { content: c });
const asst = (c = 'ok') => row('assistant', { content: c });
const call = (ids) => row('assistant', {
  content: '', toolCallIds: ids,
  raw: {
    role: 'assistant', content: null,
    tool_calls: ids.map((id) => ({ id, type: 'function', function: { name: `fn_${id}`, arguments: '{}' } })),
  },
});
const result = (id) => row('tool', { content: '{"ok":true}', toolCallId: id, toolName: `fn_${id}` });

/* ---------- the oracle ---------- */
/**
 * True when the messages satisfy every rule the provider enforces.
 * `problems` is filled with a human-readable list, so a failure says WHICH rule
 * broke instead of just "invalid".
 */
function isValidProviderHistory(messages) {
  const problems = [];
  const body = messages.filter((m) => m.role !== 'system');
  if (body.length === 0) return { ok: true, problems };
  const hasCalls = (m) => m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0;

  if (body[0].role !== 'user') problems.push(`starts with "${body[0].role}" instead of "user"`);
  for (let i = 0; i < body.length; i += 1) {
    const m = body[i];
    if (m.role === 'tool') {
      // Walk back over the WHOLE run of tool rows to the call that issued them.
      // Checking only the previous message is wrong: in `call(c1,c2)` answered by
      // `resp(c1), resp(c2)` the second response's immediate predecessor is the
      // first response, which carries no calls of its own.
      let k = i - 1;
      while (k >= 0 && body[k].role === 'tool') k -= 1;
      const prev = k >= 0 ? body[k] : undefined;
      const expected = prev && hasCalls(prev) ? prev.toolCalls.map((c) => c.id) : [];
      if (expected.length === 0) problems.push(`tool response at ${i} has no preceding call`);
      else if (!expected.includes(m.toolCallId)) {
        problems.push(`tool response at ${i} answers "${m.toolCallId}", not requested by the previous call`);
      }
    }
    if (hasCalls(m)) {
      const prev = body[i - 1];
      if (!(prev && (prev.role === 'user' || prev.role === 'tool'))) {
        problems.push(`function call at ${i} follows "${prev ? prev.role : 'nothing'}"`);
      }
      const answered = [];
      for (let j = i + 1; j < body.length && body[j].role === 'tool'; j += 1) answered.push(body[j].toolCallId);
      for (const c of m.toolCalls) {
        if (!answered.includes(c.id)) problems.push(`call "${c.id}" at ${i} has no response after it`);
      }
      const want = m.toolCalls.map((c) => c.id);
      if (JSON.stringify(answered) !== JSON.stringify(want)) {
        problems.push(`call order at ${i} is [${want}] but responses are [${answered}]`);
      }
    }
    if (i > 0 && body[i].role === body[i - 1].role && body[i].role !== 'tool') {
      problems.push(`two "${m.role}" turns in a row at ${i - 1}/${i}`);
    }
    if (m.role !== 'tool' && !m.content && !hasCalls(m)) problems.push(`empty ${m.role} turn at ${i}`);
  }
  const last = body[body.length - 1];
  if (last.role !== 'user' && last.role !== 'tool') problems.push(`ends with "${last.role}" instead of user or tool`);
  return { ok: problems.length === 0, problems };
}

/** The REAL pipeline: stored rows -> window -> normalizer. */
const run = (rows, limit = 20) =>
  N.normalizeHistoryForProvider(P.buildTranscript(rows, limit), 'gemini').messages;
/* ---------- the cases from the brief ---------- */
const cases = {
  '(a) window trimmed to start on a tool call': () => {
    // 22 rows with the call+result at the FRONT, so a naive last-20 window
    // starts on the call and strands its answer. Ends on a user turn so the
    // "ends with assistant" rule cannot mask the real problem.
    const rows = [call(['c1']), result('c1')];
    for (let i = 0; i < 9; i += 1) rows.push(user(`u${i}`), asst(`a${i}`));
    rows.push(user('newest'));
    return rows;
  },
  '(b) tool call with no result (stopped turn)': () => [user('hi'), call(['c1']), user('hi again')],
  '(c) tool result with no preceding call': () => [user('hi'), result('ghost'), user('hi again')],
  '(d) two assistant turns in a row': () => [user('hi'), asst('one'), asst('two')],
  '(e) empty assistant message': () => [user('hi'), asst('')],
  '(f) partial reply between a call and its result': () => [user('hi'), call(['c1']), asst('partial'), result('c1')],
  '(g) Confirm delete, result added later': () => [user('delete it'), call(['c1'])],
  '(h) retry saved a duplicate message': () => [user('hi'), user('hi'), asst('a'), user('hi')],
  '(i) parallel calls, second one stopped': () => [user('hi'), call(['c1', 'c2']), result('c1'), user('again')],
};

console.log('=== which cases produce an invalid sequence TODAY ===');
const broken = [];
for (const [name, make] of Object.entries(cases)) {
  const v = isValidProviderHistory(run(make()));
/* ---------- every case must come out valid ---------- */
for (const [name, make] of Object.entries(cases)) {
  const v = isValidProviderHistory(run(make()));
  check(`repaired: ${name}`, v.ok, v.ok ? '' : v.problems.join('; '));
}

/* ---------- the order that actually shipped the bug ---------- */
{
  // The exact shape that produced the reported 400. Asserting the ORDER and not
  // merely validity matters here: a normalizer that dropped the second call
  // entirely would also pass a loose check, but it would silently lose a tool
  // result the user already paid for.
  const out = run([user('hi'), call(['c1', 'c2']), result('c1'), user('again')]);
  const ids = out.filter((m) => m.role === 'tool').map((m) => m.toolCallId);
  check('a parallel call answered out of order is emitted IN CALL ORDER',
    JSON.stringify(ids) === '["c1","c2"]', JSON.stringify(ids));
  check('the missing sibling is answered synthetically, not dropped',
    out.filter((m) => m.role === 'tool').length === 2);
  check('the synthetic response says the action did not run',
    out.some((m) => m.role === 'tool' && String(m.content).includes('Not executed or interrupted')));
}

/* ---------- trimming at many cut positions ---------- */
{
  // A long chat trimmed at EVERY position. Each cut must land on a user turn and
  // keep every call with its responses.
  const rows = [];
  for (let i = 0; i < 30; i += 1) {
    if (i % 5 === 0) { rows.push(call([`c${i}`]), result(`c${i}`), user(`u${i}`)); }
    else rows.push(user(`u${i}`), asst(`a${i}`));
  }
  rows.push(user('newest'));
  let allValid = true;
  let badAt = -1;
  let badWhy = '';
  for (let cut = 1; cut < rows.length; cut += 1) {
    const v = isValidProviderHistory(run(rows.slice(cut), 20));
    if (!v.ok) { allValid = false; badAt = cut; badWhy = v.problems.join('; '); break; }
  }
  check('a long chat is valid at EVERY trim position', allValid, badAt >= 0 ? `first bad cut ${badAt}: ${badWhy}` : '');
  check('trimming never leaves a window longer than the limit plus one exchange',
    P.buildTranscript(rows, 20).length <= 20 + 6);
}

/* ---------- stopped turn followed by a plain "hi" ---------- */
{
  const out = run([user('do it'), call(['c1']), user('hi')]);
  const v = isValidProviderHistory(out);
  check('a stopped turn followed by "hi" is valid', v.ok, v.problems.join('; '));
  check('and the user message the user actually typed survives',
    out.some((m) => m.role === 'user' && m.content === 'hi'));
}

/* ---------- model switch in the middle of a chat ---------- */
{
  // The provider-specific payload on an old turn is preserved verbatim; the
  // normalizer must not rebuild it, or Gemini rejects the next request for
  // missing a thought_signature.
  const geminiTurn = call(['c1']);
  geminiTurn.raw = {
    role: 'assistant', content: null,
    extra_content: { google: { thought_signature: 'SIG' } },
    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fn_c1', arguments: '{}' } }],
  };
  const out = run([user('hi'), geminiTurn, result('c1'), user('next')]);
  check('a provider-specific field on an old turn survives normalization',
    JSON.stringify(out[1]).includes('thought_signature'), JSON.stringify(out[1]).slice(0, 90));
  check('a model switch mid-chat is still a valid history',
    isValidProviderHistory(out).ok);
}

/* ---------- the original array is never mutated ---------- */
{
  const original = [user('hi'), call(['c1']), user('again')];
  const snapshot = JSON.stringify(original);
  run(original);
  check('normalizing does not mutate the caller array', JSON.stringify(original) === snapshot);
}

console.log(`\nhistory-normalizer: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
  if (!v.ok) broken.push(name);
  console.log(`${v.ok ? 'ok  ' : 'BAD '} ${name}${v.ok ? '' : ` :: ${v.problems.join('; ')}`}`);
}
console.log('');

check('the oracle rejects a deliberately broken history',
  isValidProviderHistory([{ role: 'assistant', content: 'x' }]).ok === false);
// A request must END on a user turn, so a two-turn exchange is not a valid
// request either. The oracle is right to reject it.
check('the oracle accepts a well-formed request history',
  isValidProviderHistory(run([user('hi'), asst('hello'), user('and now?')])).ok === true);

console.log(`\nhistory-normalizer: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);