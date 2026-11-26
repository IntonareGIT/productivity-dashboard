/**
 * FIX 2 verification: persistent chat history.
 * Exercises the real buildTranscript()/toViewMessages()/appendMessage() from
 * src/features/ai/chatRepo.ts, with the Dexie module stubbed in-memory.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'fix2-'));
const outFile = join(outDir, 'chatRepo.mjs');

const dbStub = `
const rows = (m) => Array.from(m.values());
export const db = {
  chatSessions: {
    put: async (v) => { S.chatSessions.set(v.id, v); return v.id; },
    get: async (id) => S.chatSessions.get(id),
    update: async (id, patch) => { const r = S.chatSessions.get(id); if (r) S.chatSessions.set(id, { ...r, ...patch }); },
    delete: async (id) => { S.chatSessions.delete(id); },
    toArray: async () => rows(S.chatSessions),
    where: () => ({ equals: () => ({ delete: async () => {} }) }),
  },
  chatMessages: {
    put: async (v) => { S.chatMessages.set(v.id, v); return v.id; },
    toArray: async () => rows(S.chatMessages),
    where: () => ({ equals: (sid) => ({ toArray: async () => rows(S.chatMessages).filter((m) => m.sessionId === sid) }) }),
  },
  transaction: async () => {},
};
`;

await build({
  entryPoints: ['src/features/ai/chatRepo.ts'],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  define: { 'import.meta.url': '"file:///stub"' },
  plugins: [
    {
      name: 'stub-db',
      setup(b) {
        b.onResolve({ filter: /db\/db$/ }, () => ({ path: 'db-stub', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: dbStub, loader: 'js' }));
        b.onLoad({ filter: /chatRepo\.ts$/ }, async (args) => {
          const fs = await import('node:fs/promises');
          const code = await fs.readFile(args.path, 'utf8');
          return { contents: code + `\nconst S = globalThis.__S;\n`, loader: 'ts' };
        });
      },
    },
  ],
});

globalThis.__S = { chatSessions: new Map(), chatMessages: new Map() };
const repo = await import(`file://${outFile.replace(/\\/g, '/')}`);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);
  if (!cond) failures++;
};

const row = (o) => ({ error: false, toolCallId: null, toolName: null, display: null, toolCallIds: undefined, ...o });

const signed = {
  id: 'm1', sessionId: 's1', role: 'assistant', content: '',
  raw: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'getTodaysSchedule', arguments: '{}' }, extra_content: { google: { thought_signature: 'SIG_X' } } }] },
  toolCallIds: ['c1'], createdAt: '1',
};

// ---- 1. Verbatim replay of an assistant tool_calls message ---------------
let t = repo.buildTranscript([row(signed)], 20);
check('1: signature survives storage round-trip', t[0].raw.tool_calls[0].extra_content.google.thought_signature === 'SIG_X');
check('1: tool call name preserved', t[0].toolCalls[0].name === 'getTodaysSchedule');

// ---- 2. Context window keeps a tool sequence together -------------------
// A naive last-3 window here would be [a1, t1, t2] — starting on the
// tool_calls turn and cutting off the user message that prompted it.
const rows = [
  row({ id: 'u1', role: 'user', content: 'q1', raw: { role: 'user', content: 'q1' }, createdAt: '1' }),
  row({ id: 'u2', role: 'user', content: 'q2', raw: { role: 'user', content: 'q2' }, createdAt: '2' }),
  row({ ...signed, id: 'a1', createdAt: '3' }),
  row({ id: 't1', role: 'tool', content: '{"ok":true}', raw: { role: 'tool', content: '{"ok":true}', tool_call_id: 'c1' }, toolCallId: 'c1', toolName: 'getTodaysSchedule', display: 'On shift', createdAt: '4' }),
  row({ id: 'u3', role: 'user', content: 'q3', raw: { role: 'user', content: 'q3' }, createdAt: '5' }),
];
t = repo.buildTranscript(rows, 3);
check('2: tool call kept with its result', t.some((m) => m.role === 'assistant' && m.toolCalls) && t.some((m) => m.role === 'tool'));
check('2: no orphan tool result', t.every((m) => m.role !== 'tool' || t.some((a) => a.role === 'assistant' && a.toolCalls?.some((c) => c.id === m.toolCallId))));
check('2: window respects the limit', t.length <= 3, `got ${t.length}`);

// A window that would begin on a tool result must be widened to its parent.
const split = [
  row({ id: 'uA', role: 'user', content: 'q', raw: { role: 'user', content: 'q' }, createdAt: '1' }),
  row({ ...signed, id: 'aA', createdAt: '2' }),
  row({ id: 'tA', role: 'tool', content: '{}', raw: { role: 'tool', content: '{}', tool_call_id: 'c1' }, toolCallId: 'c1', toolName: 'getTodaysSchedule', display: 'On shift', createdAt: '3' }),
  row({ id: 'uB', role: 'user', content: 'next', raw: { role: 'user', content: 'next' }, createdAt: '4' }),
  row({ id: 'tB', role: 'tool', content: '{}', raw: { role: 'tool', content: '{}', tool_call_id: 'c1' }, toolCallId: 'c1', toolName: 'getTodaysSchedule', display: 'again', createdAt: '5' }),
];
t = repo.buildTranscript(split, 2);
check('2b: split window widened to include parent', t.some((m) => m.role === 'assistant' && m.toolCalls), JSON.stringify(t.map((m) => m.role)));

// ---- 3. Orphaned tool result is dropped, not sent -----------------------
// 'nobody' was never requested by any assistant turn.
const orphan = [
  row({ id: 'uY', role: 'user', content: 'next', raw: { role: 'user', content: 'next' }, createdAt: '1' }),
  row({ id: 'tY', role: 'tool', content: '{}', raw: { role: 'tool', content: '{}', tool_call_id: 'nobody' }, toolCallId: 'nobody', toolName: 'x', createdAt: '2' }),
  row({ id: 'aY', role: 'assistant', content: 'ok', raw: { role: 'assistant', content: 'ok' }, createdAt: '3' }),
];
t = repo.buildTranscript(orphan, 20);
check('3: orphan tool result dropped', !t.some((m) => m.role === 'tool'));
check('3: rest of conversation still sent', t.some((m) => m.role === 'user') && t.some((m) => m.role === 'assistant'));

// ---- 4. Only the most recent N messages ---------------------------------
const many = Array.from({ length: 50 }, (_, i) =>
  row({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `msg${i}`, raw: { role: i % 2 ? 'assistant' : 'user', content: `msg${i}` }, createdAt: String(i).padStart(3, '0') })
);
t = repo.buildTranscript(many, 20);
check('4: limited to 20 messages', t.length === 20, `got ${t.length}`);
check('4: keeps the newest', t[t.length - 1].content === 'msg49');

// ---- 5. View shows prose only; tools become action chips -----------------
const view = repo.toViewMessages([
  row({ id: 'u1', role: 'user', content: 'start a timer', raw: {}, createdAt: '1' }),
  { ...signed, id: 'a1', createdAt: '2' },
  row({ id: 't1', role: 'tool', content: '{"ok":true,"result":{"secret":1}}', raw: {}, toolCallId: 'c1', toolName: 'startPomodoroSession', display: 'Timer started', createdAt: '3' }),
  row({ id: 'a2', role: 'assistant', content: 'Done, 25 minutes.', raw: {}, createdAt: '4' }),
]);
check('5: user text shown', view.some((m) => m.role === 'user' && m.text === 'start a timer'));
check('5: assistant text shown', view.some((m) => m.role === 'assistant' && m.text === 'Done, 25 minutes.'));
const chip = view.find((m) => m.role === 'tool');
check('5: tool shown as action chip', !!chip && chip.text === 'Timer started' && chip.toolName === 'startPomodoroSession');
check('5: raw JSON never shown', !JSON.stringify(view).includes('secret'));
check('5: silent tool-call turn not rendered', !view.some((m) => m.id === 'a1'));

// ---- 6. No API key ever lands in a stored message ----------------------
const created = await repo.appendMessage('s1', { role: 'user', content: 'hi' });
const rawStr = JSON.stringify(created.raw);
check('6: raw holds only the message', rawStr.includes('"role"') && rawStr.includes('"content"'));
check('6: no apiKey/authorization in message', !/apikey|authorization|bearer/i.test(rawStr));

// ---- 7. Reasoning survives persistence and splits at view time ---------
const r7 = await repo.appendMessage('s1', {
  role: 'assistant',
  content: '<think>Let me check the roster.</think>Your shift is 9 to 5.',
  reasoning: 'Also verified the exceptions list.',
});
check('7: reasoning is persisted on the row', !!r7.reasoning && /exceptions/.test(r7.reasoning));
const vm = repo.toViewMessages([r7]).find((m) => m.id === r7.id);
check('7: the view shows the answer without the tags', !!vm && vm.text === 'Your shift is 9 to 5.' && !/[<>]/.test(vm.text), vm && vm.text);
check('7: the view carries both reasoning sources', !!vm && !!vm.thought && /roster/.test(vm.thought) && /exceptions/.test(vm.thought), vm && vm.thought);

// A plain assistant turn still bypasses the thought block.
const r8 = await repo.appendMessage('s1', { role: 'assistant', content: 'Plain answer.' });
const vm8 = repo.toViewMessages([r8]).find((m) => m.id === r8.id);
check('7: a thoughtless turn has no thought', !!vm8 && vm8.text === 'Plain answer.' && vm8.thought === undefined);

// ---- 8. Sequence integrity: a tool_calls turn is always answered ---------
// A dangling call is the one shape that makes EVERY later request in a session
// fail with HTTP 400, so it is repaired in the outgoing payload.
const dangling = [
  row({ id: 'u1', role: 'user', content: 'move my shift', raw: { role: 'user', content: 'move my shift' }, createdAt: '1' }),
  // The assistant asked for a gated call; the user typed a new message instead
  // of confirming, so no tool turn was ever stored.
  row({ ...signed, id: 'a1', createdAt: '2' }),
  row({ id: 'u2', role: 'user', content: 'never mind', raw: { role: 'user', content: 'never mind' }, createdAt: '3' }),
];
t = repo.buildTranscript(dangling, 20);
const aIdx = t.findIndex((m) => m.role === 'assistant' && m.toolCalls);
check('8: the next turn after a call is a tool turn, never a user turn',
  aIdx >= 0 && t[aIdx + 1].role === 'tool', JSON.stringify(t.map((m) => m.role)));
check('8: the synthetic response carries the call id it answers',
  aIdx >= 0 && t[aIdx + 1].toolCallId === 'c1', aIdx >= 0 && t[aIdx + 1].toolCallId);
check('8: the synthetic response says the action did not run',
  aIdx >= 0 && /did not run/.test(t[aIdx + 1].content), aIdx >= 0 && t[aIdx + 1].content);
check('8: the user message still survives, just after the answer',
  t.some((m) => m.role === 'user' && m.content === 'never mind'));

// An already-answered call must NOT get a second, fabricated response.
const answered = [
  row({ id: 'u1', role: 'user', content: 'q', raw: { role: 'user', content: 'q' }, createdAt: '1' }),
  row({ ...signed, id: 'a1', createdAt: '2' }),
  row({ id: 't1', role: 'tool', content: '{"ok":true}', raw: { role: 'tool', content: '{"ok":true}', tool_call_id: 'c1' }, toolCallId: 'c1', toolName: 'getTodaysSchedule', display: 'On shift', createdAt: '3' }),
  row({ id: 'a2', role: 'assistant', content: 'done', raw: { role: 'assistant', content: 'done' }, createdAt: '4' }),
];
t = repo.buildTranscript(answered, 20);
check('8: an answered call gains no extra turn', t.filter((m) => m.role === 'tool').length === 1, `got ${t.filter((m) => m.role === 'tool').length}`);
check('8: the real result is the one kept', t.some((m) => m.role === 'tool' && m.content === '{"ok":true}'));

// A multi-call turn gets one answer per unanswered id, and a partial answer is
// completed rather than duplicated.
const partial = [
  row({
    id: 'u1', role: 'user', content: 'do two things', raw: { role: 'user', content: 'do two things' }, createdAt: '1',
  }),
  row({
    ...signed, id: 'a1', createdAt: '2',
    toolCallIds: ['c1', 'c2'],
    raw: {
      role: 'assistant', content: null,
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'getTodaysSchedule', arguments: '{}' } },
        { id: 'c2', type: 'function', function: { name: 'addPTO', arguments: '{"date":"2026-11-10"}' } },
      ],
    },
  }),
  row({ id: 't1', role: 'tool', content: '{"ok":true}', raw: { role: 'tool', content: '{"ok":true}', tool_call_id: 'c1' }, toolCallId: 'c1', toolName: 'getTodaysSchedule', display: 'On shift', createdAt: '3' }),
  // c2 is still waiting on confirmation -> the user sent a new message.
  row({ id: 'u2', role: 'user', content: 'never mind', raw: { role: 'user', content: 'never mind' }, createdAt: '4' }),
];
t = repo.buildTranscript(partial, 20);
const pIdx = t.findIndex((m) => m.role === 'assistant' && m.toolCalls);
check('8: a partially answered turn is completed', pIdx >= 0 && t[pIdx + 1].role === 'tool' && t[pIdx + 1].toolCallId === 'c2', pIdx >= 0 && t[pIdx + 1] && t[pIdx + 1].toolCallId);
check('8: both answers are present exactly once',
  t.filter((m) => m.role === 'tool').length === 2, `got ${t.filter((m) => m.role === 'tool').length}`);

// Repair is payload-only: it must not write to the database.
const before = globalThis.__S.chatMessages.size;
repo.buildTranscript(dangling, 20);
check('8: the repair persists nothing', globalThis.__S.chatMessages.size === before, `before ${before} after ${globalThis.__S.chatMessages.size}`);

rmSync(outDir, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
