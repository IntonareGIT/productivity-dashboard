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

const dbStub = `
  export var db = {
    chatMessages: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
  };
`;
await build({
  entryPoints: ['src/features/ai/chatRepo.ts'],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  plugins: [{
    name: 'stub-db',
    setup(b) {
      b.onResolve({ filter: /^\.\.\/\.\.\/db\/db$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: dbStub, loader: 'js' }));
    },
  }],
});

const P = await import(`file://${outFile.replace(/\\/g, '/')}`);

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
      const prev = body[i - 1];
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

const run = (rows, limit = 20) => P.buildTranscript(rows, limit);
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