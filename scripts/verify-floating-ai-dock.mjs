/**
 * Verifies the docked bubble's geometry: clamping into the usable band, safe-area
 * handling, keep-out avoidance, edge selection and pixel output.
 *
 * Pure functions, so this is exhaustive and cheap. The DOM-rect collection and
 * the drag itself are exercised in the browser; what matters here is that the
 * arithmetic is right, because that is where an off-screen bubble comes from.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

async function load(file) {
  const source = readFileSync(path.join(root, file), 'utf8');
  // Type-only imports are elided by the compiler, so the emitted JS is
  // self-contained and safe to evaluate here.
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}

const D = await load('src/features/ai/floatingAiDock.ts');
const { usableBand, clampFraction, collides, snapY, edgeFromX, toPixels, relevantKeepOuts } = D;

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
}

/** Desktop, no notch, no insets. */
const DESK = {
  viewportW: 1440, viewportH: 900,
  safeTop: 0, safeRight: 0, safeBottom: 0, safeLeft: 0,
  size: 56, margin: 12,
};
/** Phone with a notch and a home indicator. */
const PHONE = { ...DESK, viewportW: 390, viewportH: 844, safeTop: 47, safeBottom: 34 };
/** Short viewport, where the band collapses entirely. */
const TINY = { ...DESK, viewportH: 60 };

/** A pane header across the top: 44px tall at y 0..44. */
const HEADER = { top: 0, bottom: 44, left: 0, right: 1440 };
/** A panel hugging the right edge, mid-screen. */
const RIGHT_PANEL = { top: 300, bottom: 700, left: 1040, right: 1440 };

const topOf = (fraction, g) => {
  const b = usableBand(g);
  return b.top + fraction * (b.bottom - b.top);
};

check('the usable band leaves the margin at each end', () => {
  const b = usableBand(DESK);
  assert.equal(b.top, 12);
  assert.equal(b.bottom, 832);
});

check('the usable band respects safe areas', () => {
  const p = usableBand(PHONE);
  assert.equal(p.top, 47 + 12);
  assert.equal(p.bottom, 844 - 34 - 12 - 56);
});

check('clampFraction maps the ends of the range exactly', () => {
  assert.equal(clampFraction(0, DESK), 0);
  assert.equal(clampFraction(1, DESK), 1);
});

check('clampFraction clamps values outside 0..1', () => {
  assert.equal(clampFraction(-5, DESK), 0);
  assert.equal(clampFraction(9, DESK), 1);
});

check('clampFraction refuses to emit NaN from a corrupt stored value', () => {
  // Any non-finite value is a corrupt stored value, and all of them collapse to
  // the same deterministic 0 (top of the band) rather than to whatever a NaN
  // comparison happens to produce.
  assert.equal(clampFraction(Number.NaN, DESK), 0);
  assert.equal(clampFraction(Number.POSITIVE_INFINITY, DESK), 0);
  assert.equal(clampFraction(Number.NEGATIVE_INFINITY, DESK), 0);
});

check('a collapsed band yields 0 rather than dividing by zero', () => {
  assert.equal(clampFraction(0.5, TINY), 0);
});

check('collides detects an overlapping rect and ignores a clear one', () => {
  assert.equal(collides(400, [{ top: 380, bottom: 460, left: 0, right: 100 }], DESK), true);
  assert.equal(collides(200, [{ top: 380, bottom: 460, left: 0, right: 100 }], DESK), false);
});

check('an empty viewport with no keep-outs leaves the position untouched', () => {
  assert.equal(snapY(0.5, DESK, [], 'right'), 0.5);
});

check('a bubble clear of every zone is left where it was dropped', () => {
  // 0.95 of the band is low on the screen, clear of both the header and the panel.
  assert.equal(snapY(0.95, DESK, [HEADER, RIGHT_PANEL], 'right'), 0.95);
});

check('a mid-height right-docked bubble DOES move off a right-edge panel', () => {
  // The inverse of the case above, and the reason keep-out snapping exists:
  // 0.5 is inside the panel's 300..700, so holding position would be wrong.
  assert.notEqual(snapY(0.5, DESK, [HEADER, RIGHT_PANEL], 'right'), 0.5);
});

check('a bubble dropped onto the pane header is pushed clear of it', () => {
  const out = snapY(0, DESK, [HEADER], 'right');
  assert.notEqual(out, 0, 'must not stay on the header');
  assert.ok(topOf(out, DESK) >= 44 + 12, 'should sit below the header plus margin');
});

check('a bubble dropped onto a right-edge panel escapes it', () => {
  const out = snapY(0.5, DESK, [RIGHT_PANEL], 'right');
  const top = topOf(out, DESK);
  assert.ok(top + 56 <= 300 - 12 || top >= 700 + 12, `top ${top} should clear the panel`);
});

check('a right-edge panel does not constrain a LEFT-docked bubble', () => {
  // This is the check that fails if the edge is ignored: the panel no longer
  // overlaps the bubble horizontally, so the bubble must be left alone.
  assert.equal(snapY(0.5, DESK, [RIGHT_PANEL], 'left'), 0.5);
});

check('relevantKeepOuts filters by horizontal overlap', () => {
  assert.equal(relevantKeepOuts([RIGHT_PANEL], DESK, 'right').length, 1);
  assert.equal(relevantKeepOuts([RIGHT_PANEL], DESK, 'left').length, 0);
});

check('a zero-height rect is not treated as an obstruction', () => {
  // Hidden elements report a zero rect; treating one as a blocker would make the
  // bubble jump every time a keep-out zone is not rendered.
  const zero = [{ top: 100, bottom: 100, left: 0, right: 1440 }];
  assert.equal(relevantKeepOuts(zero, DESK, 'right').length, 0);
});

check('fully blocked: the bubble stays put rather than vanishing', () => {
  // If there is genuinely nowhere free, holding position is better than jumping
  // the bubble somewhere arbitrary or hiding it.
  const blocker = { top: 0, bottom: 900, left: 1040, right: 1440 };
  assert.equal(snapY(0.5, DESK, [blocker], 'right'), 0.5);
});

check('edgeFromX picks the half the pointer is in', () => {
  assert.equal(edgeFromX(100, 1440), 'left');
  assert.equal(edgeFromX(1340, 1440), 'right');
  assert.equal(edgeFromX(720, 1440), 'right', 'the exact midpoint resolves right');
});

check('toPixels puts the bubble inside the viewport on both edges', () => {
  const right = toPixels({ yFraction: 0, edge: 'right' }, DESK);
  assert.equal(right.left, 1440 - 12 - 56);
  assert.equal(right.top, 12);
  const left = toPixels({ yFraction: 1, edge: 'left' }, DESK);
  assert.equal(left.left, 12);
  assert.equal(left.top, 832);
});

check('toPixels never places the bubble under a notch or home indicator', () => {
  const top = toPixels({ yFraction: 0, edge: 'right' }, PHONE);
  const bottom = toPixels({ yFraction: 1, edge: 'right' }, PHONE);
  assert.ok(top.top >= PHONE.safeTop, `top ${top.top} must clear ${PHONE.safeTop}`);
  assert.ok(
    bottom.top + PHONE.size <= PHONE.viewportH - PHONE.safeBottom,
    `bottom ${bottom.top + PHONE.size} must clear the home indicator`,
  );
});

check('toPixels is monotonic in yFraction', () => {
  const a = toPixels({ yFraction: 0.2, edge: 'right' }, DESK).top;
  const b = toPixels({ yFraction: 0.8, edge: 'right' }, DESK).top;
  assert.ok(b > a, 'a larger fraction must be lower on screen');
});

check('snapping out of an obstruction still lands inside the band', () => {
  const out = snapY(0, DESK, [HEADER], 'right');
  const px = toPixels({ yFraction: out, edge: 'right' }, DESK);
  const b = usableBand(DESK);
  assert.ok(px.top >= b.top, 'must not be above the band');
  assert.ok(px.top + DESK.size <= b.bottom + 0.001, 'must not be below the band');
});

check('a remembered desktop position re-clamps onto a small phone viewport', () => {
  // Same remembered fraction, phone geometry: the result must be renderable.
  const px = toPixels({ yFraction: 0.82, edge: 'right' }, PHONE);
  assert.ok(px.top >= PHONE.safeTop);
  assert.ok(px.top + PHONE.size <= PHONE.viewportH - PHONE.safeBottom);
  assert.ok(px.left >= 0 && px.left + PHONE.size <= PHONE.viewportW);
});

if (failures > 0) {
  console.error(`\nFloating AI dock geometry: ${failures} failing check(s)`);
  process.exit(1);
}
console.log('\nFloating AI dock geometry: all checks passed');