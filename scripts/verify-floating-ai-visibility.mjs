/**
 * Verifies the single floating-AI visibility rule across every combination the
 * brief names: standalone, split, assistant pane, full assistant, fullscreen,
 * and the setting being off.
 *
 * This exists as a script rather than a unit test because the rule is a pure
 * function with no React or DOM dependency, and `npm run verify` is already the
 * project's gate. It is also deliberately exhaustive rather than a couple of
 * happy paths: the whole reason this rule exists is that the four copies of
 * `hidden={splitOpen}` disagreed with each other.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const srcPath = path.join(root, 'src', 'features', 'ai', 'floatingAiVisibility.ts');
const source = readFileSync(srcPath, 'utf8');

// Transpile with the project's own TypeScript rather than hand-stripping types
// with regexes. The module is otherwise dependency-free at runtime: its only
// import is type-only, so the emitted JavaScript is self-contained and safe to
// evaluate in isolation. Using the real compiler means the verify script tests
// the shipped source, not a hand-massaged approximation of it.
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const { shouldShowFloatingAi, anyPaneIsAssistant } = mod;

const pane = (kind, extra = {}) => ({ id: kind + Math.random(), kind, resourceId: 'r1', zoom: 1, ...extra });

const CASES = [
  {
    name: 'standalone, no assistant anywhere: shown',
    input: { splitOpen: false, panes: [pane('library')] },
    expected: true,
  },
  {
    name: 'split, two ordinary panes: shown',
    input: { splitOpen: true, panes: [pane('library'), pane('pdf')] },
    expected: true,
  },
  {
    name: 'split with assistant as the LEFT pane: hidden',
    input: { splitOpen: true, panes: [pane('assistant'), pane('pdf')] },
    expected: false,
  },
  {
    name: 'split with assistant as the RIGHT pane: hidden',
    input: { splitOpen: true, panes: [pane('library'), pane('assistant')] },
    expected: false,
  },
  {
    name: 'split with assistant in BOTH panes: hidden',
    input: { splitOpen: true, panes: [pane('assistant'), pane('assistant')] },
    expected: false,
  },
  {
    name: 'standalone expanded assistant (single assistant pane): hidden',
    input: { splitOpen: false, panes: [pane('assistant')] },
    expected: false,
  },
  {
    name: 'the full /assistant view: hidden',
    input: { splitOpen: false, panes: [pane('library')], assistantPage: true },
    expected: false,
  },
  {
    name: 'a pane is in true fullscreen: hidden',
    input: { splitOpen: true, panes: [pane('library'), pane('pdf')], fullscreenActive: true },
    expected: false,
  },
  {
    name: 'setting OFF in standalone: hidden',
    input: { splitOpen: false, panes: [pane('library')], settingEnabled: false },
    expected: false,
  },
  {
    name: 'setting OFF in split: hidden',
    input: { splitOpen: true, panes: [pane('library'), pane('pdf')], settingEnabled: false },
    expected: false,
  },
  {
    name: 'setting ON in split: shown',
    input: { splitOpen: true, panes: [pane('library'), pane('pdf')], settingEnabled: true },
    expected: true,
  },
  {
    name: 'setting omitted (settings not loaded yet): shown, not hidden',
    input: { splitOpen: false, panes: [pane('library')] },
    expected: true,
  },
  {
    name: 'setting OFF beats an assistant pane already being open',
    input: { splitOpen: true, panes: [pane('assistant'), pane('pdf')], settingEnabled: false },
    expected: false,
  },
  {
    name: 'fullscreen beats an otherwise-showing split view',
    input: { splitOpen: true, panes: [pane('library'), pane('pdf')], fullscreenActive: true, settingEnabled: true },
    expected: false,
  },
];

let failures = 0;
for (const c of CASES) {
  let actual;
  try {
    actual = shouldShowFloatingAi(c.input);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${c.name}\n        threw ${err.message}`);
    continue;
  }
  if (actual !== c.expected) {
    failures += 1;
    console.error(`  FAIL  ${c.name}\n        expected ${c.expected}, got ${actual}`);
  } else {
    console.log(`  ok    ${c.name}`);
  }
}

// The helper the rule is built on, checked directly.
assert.equal(anyPaneIsAssistant([pane('library'), pane('note')]), false);
assert.equal(anyPaneIsAssistant([pane('library'), pane('assistant')]), true);
assert.equal(anyPaneIsAssistant([]), false);
console.log('  ok    anyPaneIsAssistant helper');

// Guard the invariant that makes this a single rule rather than two: the answer
// must NOT depend on splitOpen when everything else is equal.
const base = { panes: [pane('library'), pane('pdf')] };
assert.equal(
  shouldShowFloatingAi({ ...base, splitOpen: true }),
  shouldShowFloatingAi({ ...base, splitOpen: false }),
  'the rule must give the same answer in both modes',
);
console.log('  ok    the rule is mode-independent by construction');

if (failures > 0) {
  console.error(`\nFloating AI visibility rule: ${failures} failing check(s)`);
  process.exit(1);
}
console.log('\nFloating AI visibility rule: all checks passed');