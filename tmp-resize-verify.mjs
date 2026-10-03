/**
 * Acceptance test for the 8-point image resize.
 *
 * Every handle is exercised in BOTH directions, because the bug that motivated
 * this only showed up on shrink. Corners must preserve the aspect ratio; edges
 * must move exactly one axis.
 */
import { chromium } from 'playwright';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5173/editor-test.html', { waitUntil: 'networkidle' });
await p.waitForSelector('[contenteditable="true"]');

const b64 = await p.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 200;
  const x = c.getContext('2d'); x.fillStyle = '#36f'; x.fillRect(0, 0, 400, 200);
  return c.toDataURL('image/png').split(',')[1];
});
await p.evaluate((s) => {
  window.__noteEditor.commands.setContent(`<p><img src="data:image/png;base64,${s}"></p>`, { emitUpdate: false });
}, b64);
await p.waitForFunction(() => {
  const i = document.querySelector('.note-img-frame > img');
  return i && i.complete && i.clientWidth > 0;
});

const W = 400, H = 200;
const reset = async () => {
  await p.evaluate(() => {
    const ed = window.__noteEditor; let f = -1;
    ed.state.doc.descendants((n, pp) => { if (n.type.name === 'image' && f < 0) f = pp; });
    ed.chain().setNodeSelection(f).updateAttributes('image', { width: 400, height: 200 }).run();
  });
  await p.evaluate(() => {
    const ed = window.__noteEditor; let f = -1;
    ed.state.doc.descendants((n, pp) => { if (n.type.name === 'image' && f < 0) f = pp; });
    ed.commands.setNodeSelection(f);
  });
  await p.waitForTimeout(150);
};
const size = () => p.evaluate(() => {
  const i = document.querySelector('.note-img-frame > img');
  return { w: i.clientWidth, h: i.clientHeight };
});

// Grow vector and shrink vector per handle, as [dx, dy].
const HANDLES = {
  topLeft:     { grow: [-60, -30], shrink: [60, 30], corner: true },
  top:         { grow: [0, -30],  shrink: [0, 30],  corner: false },
  topRight:    { grow: [60, -30],  shrink: [-60, 30], corner: true },
  right:       { grow: [60, 0],   shrink: [-60, 0],  corner: false },
  bottomRight: { grow: [60, 30],  shrink: [-60, -30], corner: true },
  bottom:      { grow: [0, 30],   shrink: [0, -30], corner: false },
  bottomLeft:  { grow: [-60, 30],  shrink: [60, -30], corner: true },
  left:        { grow: [-60, 0],  shrink: [60, 0],  corner: false },
};

const drag = async (dir, [dx, dy]) => {
  await reset();
  const bx = await p.locator(`.note-img-handle-${dir}`).boundingBox();
  const cx = bx.x + bx.width / 2, cy = bx.y + bx.height / 2;
  await p.mouse.move(cx, cy);
  await p.mouse.down();
  await p.mouse.move(cx + dx, cy + dy, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(200);
  return size();
};

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); }
};

for (const [dir, v] of Object.entries(HANDLES)) {
  const r0 = W / H;

  // SHRINK — the case that was broken.
  const s = await drag(dir, v.shrink);
  const shrank = s.w < W && s.h < H;
  if (v.corner) {
    const kept = Math.abs((s.w / s.h) - r0) < 0.02;
    check(`${dir} shrink keeps ratio`, shrank && kept, `${s.w}x${s.h} ratio=${(s.w / s.h).toFixed(3)}`);
  } else {
    const oneAxis = (s.w < W) !== (s.h < H);
    check(`${dir} shrink is single-axis`, shrank && oneAxis, `${s.w}x${s.h}`);
  }

  // GROW
  const g = await drag(dir, v.grow);
  const grew = g.w > W && g.h > H;
  if (v.corner) {
    const kept = Math.abs((g.w / g.h) - r0) < 0.02;
    check(`${dir} grow keeps ratio`, grew && kept, `${g.w}x${g.h} ratio=${(g.w / g.h).toFixed(3)}`);
  } else {
    const oneAxis = (g.w > W) !== (g.h > H);
    check(`${dir} grow is single-axis`, grew && oneAxis, `${g.w}x${g.h}`);
  }
}

// The MIN_SIZE floor.
const floored = await drag('bottomRight', [-900, -900]);
check('MIN_SIZE floor clamps to 50', floored.w === 50 && floored.h === 50, `${floored.w}x${floored.h}`);

console.log(`\nresize: ${pass} passed, ${fail} failed`);
console.log('page errors:', errs.slice(0, 5));
await b.close();
process.exit(fail ? 1 : 0);