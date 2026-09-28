/**
 * FIX 1 verification: Gemini thought_signature round-trip.
 * Simulates a Gemini 3 OpenAI-compatible endpoint that REJECTS any request
 * whose assistant tool_calls message lacks
 * extra_content.google.thought_signature (HTTP 400), like the real API.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SIG = 'SIG_abc123_thought_signature';

const outDir = mkdtempSync(join(tmpdir(), 'fix1-'));
const outFile = join(outDir, 'aiClient.mjs');
await build({
  entryPoints: ['src/features/ai/aiClient.ts'],
  outfile: outFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { chatCompletion } = await import(`file://${outFile.replace(/\\/g, '/')}`);

const provider = {
  id: 'p1', label: 'Gemini 3', baseUrl: 'https://example.test/v1beta/openai',
  apiKey: 'k', modelName: 'gemini-3-pro', isDefault: true, createdAt: '', updatedAt: '',
};

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);
  if (!cond) failures++;
};

const sentBodies = [];
let script = [];
let current = 0;
// Gemini enforces thought_signature; other OpenAI-compatible providers neither
// send nor require it. Flip per flow.
let enforceSignature = true;

const bad = (msg) => ({ ok: false, status: 400, text: async () => msg, json: async () => ({}) });

globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  sentBodies.push(body);

  for (const m of body.messages) {
    if (enforceSignature && m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) {
        if (!tc.extra_content?.google?.thought_signature) {
          return bad('Function call is missing a thought_signature in functionCall parts');
        }
      }
    }
    if (m.role === 'tool') {
      const answered = body.messages.some(
        (a) => a.role === 'assistant' && Array.isArray(a.tool_calls) &&
          a.tool_calls.some((tc) => tc.id === m.tool_call_id)
      );
      if (!answered) return bad('tool_call_id does not match any functionCall');
    }
  }

  const step = script[current++];
  return { ok: true, status: 200, text: async () => JSON.stringify(step), json: async () => step };
};

const tc = (id, name, args, sig) => ({
  id, type: 'function', function: { name, arguments: args },
  extra_content: { google: { thought_signature: sig } },
});
const toolTurn = (...calls) => ({
  choices: [{ message: { role: 'assistant', content: null, tool_calls: calls } }],
});
const say = (t) => ({ choices: [{ message: { role: 'assistant', content: t } }] });
const TOOLS = [{ type: 'function', function: { name: 'x', description: '', parameters: {} } }];
const replay = (r, id, name) => [
  { role: 'assistant', content: r.content, toolCalls: r.toolCalls, raw: r.raw },
  { role: 'tool', content: '{"ok":true}', toolCallId: id, name },
];

// ---- Flow 1: startPomodoroSession ---------------------------------------
script = [toolTurn(tc('call_pomo', 'startPomodoroSession', '{"durationMinutes":25}', SIG)),
          say('Timer started for 25 minutes.')];
current = 0;
let r = await chatCompletion({ provider, messages: [{ role: 'user', content: 'start a 25 minute timer' }], tools: TOOLS });
check('1 startPomodoroSession: call parsed', r.toolCalls[0]?.name === 'startPomodoroSession');
check('1: raw keeps extra_content', !!r.raw?.tool_calls?.[0]?.extra_content?.google?.thought_signature);
r = await chatCompletion({ provider, messages: [{ role: 'user', content: 'start a 25 minute timer' }, ...replay(r, 'call_pomo', 'startPomodoroSession')], tools: [] });
check('1: follow-up after tool result, no 400', r.content.includes('25 minutes'), r.content);

// ---- Flow 2: getTodaysSchedule ------------------------------------------
script = [toolTurn(tc('call_sched', 'getTodaysSchedule', '{}', SIG)),
          say('You work 09:00-17:00 today.')];
current = 0;
r = await chatCompletion({ provider, messages: [{ role: 'user', content: 'my day?' }], tools: TOOLS });
r = await chatCompletion({ provider, messages: [{ role: 'user', content: 'my day?' }, ...replay(r, 'call_sched', 'getTodaysSchedule')], tools: [] });
check('2 getTodaysSchedule: follow-up, no 400', r.content.includes('09:00'), r.content);

// ---- Flow 3: two tool calls in ONE turn ---------------------------------
script = [toolTurn(tc('call_a', 'getTodaysSchedule', '{}', 'SIG_A'),
                   tc('call_b', 'searchLibrary', '{"query":"physics"}', 'SIG_B')),
          say('On shift, with 2 physics resources.')];
current = 0;
r = await chatCompletion({ provider, messages: [{ role: 'user', content: 'day + physics' }], tools: TOOLS });
check('3: both calls parsed', r.toolCalls.length === 2);
check('3: ids preserved', r.toolCalls[0].id === 'call_a' && r.toolCalls[1].id === 'call_b');
r = await chatCompletion({
  provider,
  messages: [
    { role: 'user', content: 'day + physics' },
    { role: 'assistant', content: r.content, toolCalls: r.toolCalls, raw: r.raw },
    { role: 'tool', content: '{"ok":true}', toolCallId: 'call_a', name: 'getTodaysSchedule' },
    { role: 'tool', content: '{"ok":true}', toolCallId: 'call_b', name: 'searchLibrary' },
  ],
  tools: [],
});
check('3: two-tool follow-up, no 400', r.content.includes('physics'), r.content);

// ---- Flow 4: CHAINED tool calls (tool -> tool -> final) -----------------
script = [toolTurn(tc('call_1', 'getTodaysSchedule', '{}', 'SIG_1')),
          toolTurn(tc('call_2', 'searchLibrary', '{"query":"x"}', 'SIG_2')),
          say('All done.')];
current = 0;
const t1 = [{ role: 'user', content: 'go' }];
const a1 = await chatCompletion({ provider, messages: t1, tools: TOOLS });
const t2 = [...t1, ...replay(a1, 'call_1', 'getTodaysSchedule')];
const a2 = await chatCompletion({ provider, messages: t2, tools: TOOLS });
const t3 = [...t2, ...replay(a2, 'call_2', 'searchLibrary')];
const a3 = await chatCompletion({ provider, messages: t3, tools: [] });
check('4: chained tool->tool->final, no 400', a3.content === 'All done.', a3.content);

// ---- Flow 5: provider that sends NO signature ---------------------------
enforceSignature = false; // e.g. OpenRouter / Groq / Ollama
script = [toolTurn({ id: 'call_ns', type: 'function', function: { name: 'getTodaysSchedule', arguments: '{}' } }),
          say('ok')];
current = 0;
const rNs = await chatCompletion({ provider, messages: [{ role: 'user', content: 'q' }], tools: TOOLS });
check('5: unsigned response parsed', rNs.toolCalls[0].id === 'call_ns');
check('5: no placeholder invented', rNs.raw?.tool_calls?.[0]?.extra_content === undefined);
const rNs2 = await chatCompletion({ provider, messages: [{ role: 'user', content: 'q' }, ...replay(rNs, 'call_ns', 'getTodaysSchedule')], tools: [] });
check('5: unsigned provider follow-up works', rNs2.content === 'ok');

// ---- Flow 6: legacy history lacking raw still serializes ----------------
sentBodies.length = 0;
script = [say('done')];
current = 0;
await chatCompletion({
  provider,
  messages: [
    { role: 'user', content: 'u' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'old_1', name: 'getTodaysSchedule', arguments: '{}' }] },
    { role: 'tool', content: '{"ok":true}', toolCallId: 'old_1', name: 'getTodaysSchedule' },
  ],
  tools: [],
});
const legacy = sentBodies[0].messages.find((m) => m.role === 'assistant' && m.tool_calls);
check('6: legacy rebuilt correctly', !!legacy && legacy.tool_calls[0].id === 'old_1');

// ---- Flow 7: confirmed gated call keeps its tool_call_id ----------------
script = [say('Schedule saved.')];
current = 0;
const rConf = await chatCompletion({
  provider,
  messages: [
    { role: 'user', content: 'set my week' },
    { role: 'assistant', content: null, toolCalls: [{ id: 'call_conf', name: 'addOrUpdateWeeklySchedule', arguments: '{}' }],
      raw: { role: 'assistant', content: null, tool_calls: [tc('call_conf', 'addOrUpdateWeeklySchedule', '{}', 'SIG_CONF')] } },
    { role: 'tool', content: '{"ok":true}', toolCallId: 'call_conf', name: 'addOrUpdateWeeklySchedule' },
    { role: 'user', content: 'The user confirmed. saved. Confirm the outcome.' },
  ],
  tools: [],
});
check('7: confirmation follow-up, no 400', rConf.content === 'Schedule saved.', rConf.content);

rmSync(outDir, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
