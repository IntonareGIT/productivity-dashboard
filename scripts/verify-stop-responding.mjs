/**
 * Phase 2: the Stop responding button.
 *
 * Drives the REAL `useAssistantStore` (bundled with esbuild against a Dexie stub
 * and a mocked fetch), because what is under test is the store's turn loop:
 * which requests are issued, when, and what reaches the transcript. A copy of
 * that loop would prove nothing about the shipping one.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'stop-'));
const root = process.cwd().replace(/\\/g, '/');
const entry = join(outDir, 'entry.ts');
writeFileSync(entry, `export * from '${root}/src/stores/useAssistantStore';`);

/* ------------------------- Dexie stub ------------------------- */
const dbStub = `
// Read __S LAZILY on every access. Capturing it in a module-level const would
// freeze the value at import time, and each scenario replaces the whole store,
// which would leave the stub pointing at a dead (or missing) object.
//
// Declared with 'var', not 'const', on purpose: the bundler emits a
// top-level const AFTER its first textual use, so every db.aiProviders
// reference compiled to void 0.aiProviders and every scenario failed with
// "cannot read properties of undefined". 'var' is hoisted, so all references
// resolve to the same proxy.
export var db = new Proxy({}, {
  get(_t, name) {
    if (name === 'transaction') return async (...a) => a[a.length - 1]();
    if (name === 'cloud') return undefined;
    var S = globalThis.__S;
    if (!S) throw new Error('stub has no __S: create the tables BEFORE importing the store');
    var col = function (n) {
      var m = () => Array.from((S[n] ?? new Map()).values());
      return {
        async toArray() { return m(); },
        async get(id) { return (S[n] ?? new Map()).get(id); },
        async put(v) { S[n].set(v.id, v); return v.id; },
        async add(v) { S[n].set(v.id, v); return v.id; },
        async update(id, patch) { if (S[n].has(id)) S[n].set(id, Object.assign({}, S[n].get(id), patch)); },
        async count() { return (S[n] ?? new Map()).size; },
        async clear() { if (S[n]) S[n].clear(); },
        async delete(id) { if (S[n]) S[n].delete(id); },
        async bulkPut(rows) { for (const r of rows) S[n].set(r.id, r); return rows.map(r => r.id); },
        orderBy: () => ({ first: async () => m()[0], toArray: async () => m() }),
        where: () => ({ equals: () => ({ toArray: async () => m(), first: async () => m()[0], delete: async () => {} }) }),
        filter: () => ({ first: async () => m()[0], toArray: async () => m() }),
      };
    };
    return col(String(name));
  },
});
`;

const bundleFile = join(process.cwd(), 'node_modules', '.cache-store-stop.mjs');
await build({
  entryPoints: [entry],
  outfile: bundleFile,
  bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{
    name: 'stub',
    setup(b) {
      // Intercept at LOAD time, by resolved file path. An `onResolve` filter is
      // applied to the import SPECIFIER, which is fragile across the many
      // relative spellings of the database import ('../../db/db', '../db/db'),
      // and a filter that misses silently bundles the real ProductivityDB plus
      // real Dexie, leaving every scenario talking to an empty real database.
      // `onLoad` sees the resolved path, so a suffix test there is reliable.
      b.onLoad({ filter: /.*/ }, (args) => {
        const p = args.path.replace(/\\/g, '/');
        if (p.endsWith('/src/db/db.ts')) return { contents: dbStub, loader: 'js' };
        if (p.includes('/dexie-cloud-addon/')) {
          return { contents: 'export default () => ({});', loader: 'js' };
        }
        return undefined;
      });
      // Fail loudly if the real database ever slips back in, rather than
      // letting the suite pass against a real, empty IndexedDB.
      b.onEnd((r) => {
        if (r.errors.length) throw new Error(r.errors.map((e) => e.text).join('\n'));
      });
    },
  }],
});

const built = readFileSync(bundleFile, 'utf8');
if (built.includes('class extends') && built.includes('ProductivityDB')) {
  console.error('FATAL: the real db.ts was bundled, so the stub is not in effect.');
  process.exit(1);
}
rmSync(outDir, { recursive: true, force: true });

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

/* ------------------------- fixtures ------------------------- */
function freshState() {
  globalThis.__S = {
    aiProviders: new Map([['p1', {
      id: 'p1', label: 'Test', baseUrl: 'https://example.test/v1beta/openai', apiKey: 'k',
      modelName: 'gemini-3-pro', isDefault: true, createdAt: 'x', updatedAt: 'x',
    }]]),
    chatSessions: new Map(), chatMessages: new Map(),
    subjects: new Map(), topics: new Map(), resources: new Map(), resourceGroups: new Map(),
    assessments: new Map(), calendarEvents: new Map(), pomodoroSessions: new Map(),
    weeklySchedules: new Map(), shiftOverrides: new Map(), themeStatusMap: new Map(),
    appSettings: new Map(), uiState: new Map(),
  };
}

const okRes = (payload) => ({
  ok: true, status: 200, headers: { get: () => null },
  text: async () => JSON.stringify(payload), json: async () => payload,
});
const say = (t) => okRes({ choices: [{ message: { role: 'assistant', content: t } }] });
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: args } });
const toolTurn = (...cs) => okRes({
  choices: [{ message: { role: 'assistant', content: null, tool_calls: cs } }],
});

/**
 * The rejection value a real aborted `fetch` produces.
 *
 * It must be an Error NAMED 'AbortError', because the client distinguishes
 * "the user pressed Stop" from "the network dropped" by exactly that, and a
 * plain rejection would be misread as a transient network fault and retried.
 */
const abortError = () => {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
};

/** A fetch that never resolves until aborted: "waiting for the model". */
const pendingUntilAbort = (init) => new Promise((_resolve, reject) => {
  const sig = init?.signal;
  const onAbort = () => reject(abortError());
  if (!sig) return;
  if (sig.aborted) onAbort();
  else sig.addEventListener('abort', onAbort, { once: true });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = () => globalThis.__S;
const messages = (sid) => Array.from(S().chatMessages.values())
  .filter((m) => m.sessionId === sid).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
const userTurns = (sid) => messages(sid).filter((m) => m.role === 'user');
/**
 * A fresh module instance per scenario, so the module-level turn state resets.
 *
 * `freshState()` must run BEFORE the import: the store's provider resolution
 * touches `db.aiProviders` during setup, and the Dexie stub reads the global
 * lazily, so the tables have to exist by the time the first turn is sent.
 */
let epoch = 0;
const freshStore = async () => {
  freshState();
  epoch += 1;
  return import(`file://${bundleFile.replace(/\\/g, '/')}?e=${epoch}`);
};

/* =================== 1. stop before the first byte =================== */
{
  const { useAssistantStore } = await freshStore();
  let calls = 0;
  globalThis.fetch = async (_u, init) => {
    calls++;
    return pendingUntilAbort(init);
  };

  void useAssistantStore.getState().send('hello there');
  await sleep(150);
  check('a turn in flight is marked busy', useAssistantStore.getState().busy === true);
  useAssistantStore.getState().stop();
  await sleep(200);
  check('stop ends the turn: busy is cleared', useAssistantStore.getState().busy === false);
  check('stop issued no further requests', calls === 1, `${calls} calls`);
  check('stop is not reported as an error',
    useAssistantStore.getState().failure === null,
    JSON.stringify(useAssistantStore.getState().failure));
  const sid1 = useAssistantStore.getState().sessionId;
  check('the user message is stored exactly once', userTurns(sid1).length === 1,
    `${userTurns(sid1).length}`);
  check('no stray error text was written into the transcript',
    messages(sid1).every((m) => !/HTTP \d|Network error/.test(m.content || '')), 'clean');
}

/* =================== 2. stop during retry backoff =================== */
{
  const { useAssistantStore } = await freshStore();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: false, status: 503, headers: { get: () => null },
      text: async () => 'busy', json: async () => ({}) };
  };
  void useAssistantStore.getState().send('overloaded');
  await sleep(250);
  const during = calls;
  check('a 503 schedules a retry', during >= 1, `${during} calls`);
  check('a retry line is shown while retrying',
    /retrying \(\d\/4\)/.test(String(useAssistantStore.getState().retryStatus)),
    String(useAssistantStore.getState().retryStatus));
  useAssistantStore.getState().stop();
  await sleep(500);
  check('stop during backoff issues NO further request', calls === during,
    `${during} -> ${calls}`);
  check('the retry line is cleared on stop', useAssistantStore.getState().retryStatus === null,
    String(useAssistantStore.getState().retryStatus));
  check('stop during backoff is not a failure',
    useAssistantStore.getState().failure === null);
  check('the input is usable again', useAssistantStore.getState().busy === false);
}

/* =================== 3. stop three times is harmless =================== */
{
  const { useAssistantStore } = await freshStore();
  let calls = 0;
  globalThis.fetch = async (_u, init) => {
    calls++;
    return pendingUntilAbort(init);
  };
  void useAssistantStore.getState().send('double stop');
  await sleep(150);
  useAssistantStore.getState().stop();
  useAssistantStore.getState().stop();
  useAssistantStore.getState().stop();
  await sleep(200);
  check('pressing Stop three times does not throw and ends the turn',
    useAssistantStore.getState().busy === false);
  check('pressing Stop three times issues no extra requests', calls === 1, `${calls} calls`);
}

/* ==== 4. stop right after a tool call: no dangling call ==== */

/* ==== 5. the next turn after a stop is a valid request ==== */
{
  const { useAssistantStore } = await freshStore();
  const sent = [];
  let phase = 0;
  globalThis.fetch = async (_u, init) => {
    sent.push(JSON.parse(init.body));
    if (phase === 0) { phase = 1; return toolTurn(call('c1', 'listSubjects', '{}')); }
    return say('Here are your subjects.');
  };
  void useAssistantStore.getState().send('what subjects?');
  await sleep(80);
  useAssistantStore.getState().stop();
  await sleep(250);
  // A fresh message. This is the request that would 400 on Gemini if a
  // tool_call had been left unanswered by the stop.
  void useAssistantStore.getState().send('and tomorrow?');
  await sleep(350);

  const last = sent[sent.length - 1];
  const msgs = last.messages;
  const dangling = [];
  for (let i = 0; i < msgs.length; i += 1) {
    const m = msgs[i];
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const next = msgs.slice(i + 1);
      for (const tc of m.tool_calls) {
        if (!next.some((n) => n.role === 'tool' && n.tool_call_id === tc.id)) {
          dangling.push(tc.id);
        }
      }
    }
  }
  check('a later turn was actually sent', sent.length >= 2, `${sent.length} requests`);
  check('every tool call in the final request has a tool response',
    dangling.length === 0, `dangling: ${dangling.join(',') || 'none'}`);
  const sid5 = useAssistantStore.getState().sessionId;
  check('the user message is not duplicated by the follow-up turn',
    userTurns(sid5).length === 2, `${userTurns(sid5).length} user rows`);
}

/* ================== 6. stop while a Confirm card is open ================== */
{
  const { useAssistantStore } = await freshStore();
  globalThis.fetch = async () => toolTurn(call('c1', 'deleteSubject', '{"subjectId":"s1"}'));
  void useAssistantStore.getState().send('delete Algorithms');
  await sleep(300);
  check('a delete raises a Confirm card rather than deleting',
    useAssistantStore.getState().pending !== null,
    String(useAssistantStore.getState().pending?.name));
  check('nothing was deleted before Confirm', S().subjects.size === 0,
    `${S().subjects.size} subjects`);
  useAssistantStore.getState().stop();
  await sleep(250);
  const st = useAssistantStore.getState();
  check('stopping while a Confirm is open clears the card', st.pending === null,
    String(st.pending?.name));
  check('the cancelled delete wrote nothing', S().subjects.size === 0,
    `${S().subjects.size} subjects`);
  const cancelRow = messages(st.sessionId)
    .find((m) => m.role === 'tool' && /declin|not executed|cancel|moved on/i.test(m.content || ''));
  check('the transcript records the cancellation honestly', !!cancelRow,
    cancelRow?.display ?? 'no row');
}

/* ===================== 7. Stop wiring in the UI ===================== */
{
  const chatSrc = readFileSync('src/features/ai/components/AssistantChat.tsx', 'utf8');
  check('the Stop button has the required accessible label',
    /aria-label="Stop responding"/.test(chatSrc));
  check('Stop renders a square icon', /<Square\b/.test(chatSrc));
  check('the button is Stop while busy and Send when idle',
    /\{busy \?/.test(chatSrc) && /Stop responding/.test(chatSrc) && /Send message/.test(chatSrc));
  check('the composer stays enabled while busy (typing is not blocked)',
    /disabled=\{!configured\}/.test(chatSrc));
  check('Enter does not send while a turn is running', /if \(busy\) return;/.test(chatSrc));
  check('Escape stops the turn', /e\.key === 'Escape'/.test(chatSrc));
  check('the retry status line has a stable hook', /data-retry-status/.test(chatSrc));
  check('the failure block has a stable hook', /data-failure/.test(chatSrc));
  check('the failure block offers Retry', /retryLast\(\)/.test(chatSrc));
  check('the failure block offers a Details toggle', /showDetails/.test(chatSrc));
  // The notice is COMPOSED in the store and RENDERED in the chat, so both
  // halves are checked: the store must say which model answered, and the chat
  // must actually show that value.
  const storeSrc = readFileSync('src/stores/useAssistantStore.ts', 'utf8');
  check('the store composes the fallback notice naming the model',
    /Answered by fallback model/.test(storeSrc));
  check('the chat renders the fallback notice',
    /\{fallbackNotice &&/.test(chatSrc) && /\{fallbackNotice\}/.test(chatSrc));
  const newCopy = chatSrc.split('\n')
    .filter((l) => /retry|Stop responding|fallback|Details|overloaded/i.test(l));
  check('no em dash or emoji in the new UI copy',
    !newCopy.some((l) => /[\u2014\u2013]/.test(l)
      || /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(l)),
    'clean');
}

/* ---- 7b. request accounting: before vs after the tool-result cap ---- */
{
  const { capToolResult, MAX_TOOL_RESULT_CHARS } = await freshStore();
  // A realistic multi-tool result: 200 resources with long titles.
  const big = JSON.stringify({
    ok: true,
    result: Array.from({ length: 200 }, (_, i) => ({
      id: `res_${i}`, title: `Lecture slide deck number ${i} for week ${i % 12}`,
      subject: 'Advanced Algorithms', topic: 'Graph Theory',
    })),
  });
  const capped = capToolResult(big);
  check('an oversized tool result is truncated', capped.length < big.length,
    `${big.length} -> ${capped.length}`);
  check('the truncation is marked so the model knows',
    /\[truncated\]/.test(capped));
  check('the marker states how much was dropped',
    new RegExp(`${big.length - MAX_TOOL_RESULT_CHARS} more characters`).test(capped));
  check('a small tool result is passed through untouched',
    capToolResult('{"ok":true}') === '{"ok":true}');
  check('the cap keeps the payload near 4000 chars',
    capped.length <= MAX_TOOL_RESULT_CHARS + 200, `${capped.length}`);

  // Requests per user message is the other half of "reduce load".
  const storeSrc2 = readFileSync('src/stores/useAssistantStore.ts', 'utf8');
  const rounds = storeSrc2.match(/await request\(/g) || [];
  check('every provider request in a turn goes through the one wrapper',
    rounds.length >= 2, `${rounds.length} call sites`);
  check('the tool loop requests once per round, not once per tool',
    /for \(let round = 0; round <= MAX_TOOL_ROUNDS/.test(storeSrc2)
    && /await request\(provider, \[/.test(storeSrc2));
  check('tool results are capped on the wire', /capToolResult\(JSON.stringify/.test(storeSrc2));
}

console.log(`\nstop-responding: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

{
  const { useAssistantStore } = await freshStore();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return toolTurn(call('c1', 'listSubjects', '{}'));
  };
  void useAssistantStore.getState().send('what subjects?');
  await sleep(80);
  useAssistantStore.getState().stop();
  await sleep(300);
  const sid = useAssistantStore.getState().sessionId;
  const rows = messages(sid);
  const withCalls = rows.find((m) => m.role === 'assistant' && m.toolCallIds && m.toolCallIds.length);
  const answered = rows.filter((m) => m.role === 'tool');
  check('the assistant tool-call turn was stored', !!withCalls, `${rows.length} rows`);
  check('the tool call is answered by a tool turn',
    answered.some((m) => m.toolCallId === 'c1'),
    answered.map((m) => m.toolCallId).join(',') || 'none');
  check('the turn ended', useAssistantStore.getState().busy === false);
}

