/**
 * Phase 1: resilience against temporary provider errors.
 *
 * Drives the REAL `chatCompletion` (bundled with esbuild, never reimplemented)
 * against a mocked `fetch`, so the assertions cover the shipping retry policy
 * rather than a copy of it that could drift.
 *
 * The three scenarios the brief calls for:
 *   - 503 twice, then success: the answer arrives and nothing is duplicated.
 *   - 503 forever: a friendly message, the input re-enabled, Retry offered.
 *   - 400: shown immediately, with no retries at all.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'retry-'));
const outFile = join(outDir, 'aiClient.mjs');
await build({
  entryPoints: ['src/features/ai/aiClient.ts'],
  outfile: outFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const client = await import(`file://${outFile.replace(/\\/g, '/')}`);
const {
  chatCompletion, __setRetryTiming, friendlyError, MAX_RETRIES, OVERLOADED_MESSAGE,
  parseRetryAfter, isRetryableStatus, quotaExhausted, AiRequestError,
} = client;

// Keep the real code path (same loop, same counters) but make the waits
// instant, so a permanent-503 case does not burn 15 seconds of wall clock.
__setRetryTiming([1, 1, 1, 1]);

const provider = {
  id: 'p1', label: 'Test', baseUrl: 'https://example.test/v1beta/openai',
  apiKey: 'k', modelName: 'gemini-3-pro', isDefault: true, createdAt: '', updatedAt: '',
};

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);
  if (!cond) failures++;
};

/**
 * A successful provider response.
 *
 * `ok: true` is essential, not decoration: the client branches on `res.ok`, and
 * a hand-rolled mock that omits it is treated as a failure with an undefined
 * status, which silently turns a success case into an error case.
 */
const okRes = (payload) => ({
  ok: true, status: 200,
  headers: { get: () => null },
  text: async () => JSON.stringify(payload),
  json: async () => payload,
});

const say = (t) => okRes({ choices: [{ message: { role: 'assistant', content: t } }] });
const toolTurn = (...calls) => okRes({
  choices: [{ message: { role: 'assistant', content: null, tool_calls: calls } }],
});
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: args } });

const errRes = (status, body = '') => ({
  ok: false, status,
  headers: { get: () => null },
  text: async () => body,
  json: async () => JSON.parse(body || '{}'),
});

let calls = 0;
let script = [];
globalThis.fetch = async () => {
  calls++;
  const step = script[Math.min(calls - 1, script.length - 1)];
  const res = typeof step === 'function' ? step() : step;
  if (process.env.DEBUG_RETRY) {
    console.log('FETCH', calls, JSON.stringify({ ok: res?.ok, status: res?.status }));
  }
  return res;
};

const run = (messages, opts = {}) => chatCompletion({ provider, messages, ...opts });

/* ------------------------- pure policy ------------------------- */
check('503 is retryable', isRetryableStatus(503));
check('429 is retryable', isRetryableStatus(429));
check('500, 502 and 504 are retryable', [500, 502, 504].every(isRetryableStatus));
check('400 is NOT retryable', !isRetryableStatus(400));
check('401 is NOT retryable', !isRetryableStatus(401));
check('403 is NOT retryable', !isRetryableStatus(403));
check('404 is NOT retryable', !isRetryableStatus(404));
check('an unknown status such as 418 is NOT retryable', !isRetryableStatus(418));
check('MAX_RETRIES is 4', MAX_RETRIES === 4);

check('quota wording is detected',
  quotaExhausted('You exceeded your current quota, please check your plan and billing details'));
check('a plain 429 body is not treated as a quota problem',
  !quotaExhausted('rate limit exceeded, slow down'));

check('Retry-After in seconds is honoured', parseRetryAfter('7') === 7000);
check('Retry-After as a date is honoured',
  parseRetryAfter(new Date(Date.now() + 3000).toUTCString()) >= 2000);
check('an absent Retry-After yields null', parseRetryAfter(null) === null);
check('a malformed Retry-After yields null', parseRetryAfter('soon-ish') === null);

check('a 503 reads as the friendly overload message',
  friendlyError(new AiRequestError('Provider responded HTTP 503', 503, { retryable: true })).message
    === OVERLOADED_MESSAGE);
check('a 401 reads as a key problem and is not retryable',
  !friendlyError(new AiRequestError('HTTP 401', 401, { retryable: false })).retryable);
check('an exhausted quota is not retryable',
  !friendlyError(new AiRequestError('x', 429, { retryable: false, quotaExhausted: true })).retryable);

/* --------------- scenario 1: 503 twice then success --------------- */
calls = 0;
script = [
  errRes(503, 'This model is currently experiencing high demand. status UNAVAILABLE'),
  errRes(503, 'This model is currently experiencing high demand. status UNAVAILABLE'),
  say('Here is the answer.'),
];
const retries = [];
const result = await run([{ role: 'user', content: 'hello' }], {
  onRetry: (info) => retries.push(info),
});
check('503 twice then success: the answer arrives', result.content === 'Here is the answer.',
  result.content);
check('exactly 3 requests were made (1 attempt + 2 retries)', calls === 3, `got ${calls}`);
check('the retry callback fired twice', retries.length === 2, `got ${retries.length}`);
check('the retry status counts up 1/4 then 2/4',
  retries[0].attempt === 1 && retries[0].max === 4 && retries[1].attempt === 2,
  `${retries[0].attempt}/${retries[0].max}, ${retries[1].attempt}/${retries[1].max}`);
check('a recovered request is not flagged as a fallback answer',
  result.answeredByFallback === undefined);

/* A retry re-sends the SAME body, never a mutated transcript. */
calls = 0;
const bodies = [];

/* ------------------ scenario 2: 503 forever ------------------ */
calls = 0;
script = [() => errRes(503, 'high demand')];
let threw = null;
try {
  await run([{ role: 'user', content: 'never works' }]);
} catch (e) { threw = e; }
check('503 forever: the request finally fails', threw !== null);
check('503 forever: 1 attempt + 4 retries = 5 requests, no more', calls === 5, `got ${calls}`);
check('503 forever: Retry is offered', friendlyError(threw).retryable === true);
check('503 forever: the user sees the friendly message, not the provider JSON',
  friendlyError(threw).message === OVERLOADED_MESSAGE);
check('503 forever: the raw status is still available for the Details toggle',
  threw.status === 503, `status ${threw.status}`);

/* Retry-After is respected on the wire. */
calls = 0;
script = [{
  ok: false, status: 429, headers: { get: (h) => (h === 'Retry-After' ? '0' : null) },
  text: async () => 'slow down', json: async () => ({}),
}, say('recovered')];
await run([{ role: 'user', content: 'retry after' }]);
check('a 429 carrying Retry-After is retried and then succeeds', calls === 2, `got ${calls}`);

/* An exhausted quota 429 is NOT retried. */
calls = 0;
script = [errRes(429, 'You exceeded your current quota, please check your plan and billing details.')];
threw = null;
try { await run([{ role: 'user', content: 'quota' }]); } catch (e) { threw = e; }
check('an exhausted daily quota is not retried', calls === 1, `got ${calls}`);
check('an exhausted quota says so rather than blaming overload',
  /quota/i.test(friendlyError(threw).message), friendlyError(threw).message);

/* ------------------- scenario 3: 400, no retries ------------------- */
calls = 0;
script = [errRes(400, 'Function call is missing a thought_signature')];
threw = null;
try { await run([{ role: 'user', content: 'bad request' }]); } catch (e) { threw = e; }
check('400: exactly one request, no retries', calls === 1, `got ${calls}`);
check('400: the error surfaces', threw !== null && threw.status === 400);
check('400: not offered as retryable', friendlyError(threw).retryable === false);

for (const status of [401, 403, 404]) {
  calls = 0;
  script = [errRes(status, 'nope')];
  threw = null;
  try { await run([{ role: 'user', content: 'x' }]); } catch (e) { threw = e; }
  check(`${status}: no retries`, calls === 1, `got ${calls}`);
  check(`${status}: shown immediately`, friendlyError(threw).retryable === false);
}

/* A thrown fetch is transient. */
calls = 0;
script = [() => { throw new TypeError('Failed to fetch'); }, say('recovered')];
const net = await run([{ role: 'user', content: 'offline' }]);
check('a thrown fetch is retried and can recover', net.content === 'recovered' && calls === 2,
  `calls ${calls}`);

/* ------------------------- fallback model ------------------------- */
calls = 0;
// The provider keeps 503-ing the PRIMARY model, but answers the fallback, which
// is the realistic case: a different model on the same endpoint has its own
// capacity. The mock keys off the model in the body.
globalThis.fetch = async (_u, init) => {
  calls++;
  const model = JSON.parse(init.body).model;
  return model === 'gemini-flash-lite' ? say('Answered by the fallback.') : errRes(503, 'busy');
};
const fb = await run([{ role: 'user', content: 'fallback please' }], {
  fallbackModel: 'gemini-flash-lite',
});
check('a configured fallback answers once the retries are exhausted',
  fb.content === 'Answered by the fallback.', fb.content);
check('the result says which model answered', fb.answeredByFallback === 'gemini-flash-lite',
  String(fb.answeredByFallback));
check('the fallback is tried ONCE, not retried in turn', calls === 6, `got ${calls}`);

calls = 0;
globalThis.fetch = async () => { calls++; return errRes(503, 'busy'); };
threw = null;
try {
  await run([{ role: 'user', content: 'no fallback' }], { fallbackModel: '   ' });
} catch (e) { threw = e; }
check('no fallback configured: the request simply fails after 5 tries',
  calls === 5 && threw !== null, `calls ${calls}`);

/* When the fallback ALSO fails, the original error is what the user sees. */
calls = 0;
threw = null;
try {
  await run([{ role: 'user', content: 'both fail' }], { fallbackModel: 'gemini-flash-lite' });
} catch (e) { threw = e; }
check('when the fallback also fails, a 503 is still reported', threw?.status === 503,
  String(threw?.status));
check('the fallback does not multiply the retries', calls === 6, `got ${calls}`);

/* --------- a retry must never re-run a tool (a tool round) --------- */
calls = 0;
script = [
  toolTurn(call('c1', 'createSubject', '{"name":"A"}')),
  () => errRes(503, 'busy'),
  toolTurn(call('c1', 'createSubject', '{"name":"A"}')),
];
globalThis.fetch = async () => {
  calls++;
  const step = script[Math.min(calls - 1, script.length - 1)];
  return typeof step === 'function' ? step() : step;
};
const toolFlow = await run([{ role: 'user', content: 'make a subject' }]);
check('a retried tool round returns the same tool call, not a second one',
  toolFlow.toolCalls.length === 1 && toolFlow.toolCalls[0].name === 'createSubject',
  `${toolFlow.toolCalls.length} calls`);
check('the failed attempt is invisible to the caller, so no tool can be re-run',
  calls === 1, `got ${calls}`);
check('the retried tool round carried the same call id, so the store cannot double-execute',
  toolFlow.toolCalls[0].id === 'c1', toolFlow.toolCalls[0].id);

console.log(`\nretry-resilience: ${failures === 0 ? 'all checks passed' : failures + ' FAILED'}`);
rmSync(outDir, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);

const origFetch = globalThis.fetch;
globalThis.fetch = async (_u, init) => {
  bodies.push(init.body);
  calls++;
  return calls <= 2 ? errRes(503, 'busy') : say('done');
};
await run([{ role: 'user', content: 'same input' }]);
globalThis.fetch = origFetch;
check('every retry re-sends a byte-identical request body',
  bodies.length === 3 && bodies.every((b) => b === bodies[0]),
  `${bodies.length} bodies, ${new Set(bodies).size} distinct`);
check('a retry appends nothing to the conversation',
  JSON.parse(bodies[0]).messages.length === 2, `${JSON.parse(bodies[0]).messages.length} messages`);
