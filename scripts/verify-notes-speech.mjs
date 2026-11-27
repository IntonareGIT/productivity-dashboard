/**
 * Notes → speech verification.
 *
 * The Listen control reads notes aloud, so what must not go wrong is WHAT gets
 * spoken. Omar's rule: simple formulas are read in words ("x equals m times a",
 * simple fractions, powers, subscripts, Greek names); anything complex or
 * uncertain is never guessed at, it says "formula here, look at the screen" and
 * pauses. An image is read by its alt text when it has one, otherwise it says
 * "image here, look at the picture".
 *
 * This checks the real pure module (no re-implementation) against a note shaped
 * like the ones in the Library.
 */
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'notes-speech-'));
const root = process.cwd().replace(/\\/g, '/');
const entry = join(outDir, 'entry.ts');
writeFileSync(entry, `export * from '${root}/src/features/library/components/notesSpeech';\n`);

const bundleFile = join(process.cwd(), 'node_modules', '.cache-notes-speech.mjs');
await build({
  entryPoints: [entry],
  outfile: bundleFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});

const {
  notesToSpeech, formulaToWords, FORMULA_CUE, IMAGE_CUE, CUE_PAUSE_MS,
} = await import(`file://${bundleFile.replace(/\\/g, '/')}`);

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

const NOTE = `# 1. Fundamentals of Vibration

Vibration is the motion of a body about a reference position. It is described by displacement and velocity.

## 1.1 Elements

- **Mass or inertia**: stores kinetic energy, $T = \\frac{1}{2} m \\dot{x}^2$
- **Spring**: stores potential energy
- **Damper**: removes energy

$$ \\omega_n = \\sqrt{\\frac{k}{m}} $$

The natural frequency depends only on stiffness and mass. A spring costs $5 to replace.

![Spring-mass system from the lecture slides](/slides/vib-01.png)

![vib-02.png](/slides/vib-02.png)

| Quantity | Symbol | Unit |
| --- | --- | --- |
| Stiffness | k | N/m |

\`\`\`js
const k = 12;
\`\`\`

See [the lecture notes](https://example.com/vib-01.pdf) for the derivation.

k = 1.2 kN/m

ω_n = √(k/m)

$$ \\int_0^t F(\\tau)\\,d\\tau = m\\dot{v} $$
`;

const chunks = notesToSpeech({ text: NOTE });
const spoken = chunks.map((c) => c.text).join('\n');

check('headings are their own chunks', chunks[0]?.heading === true && chunks[0]?.text === '1. Fundamentals of Vibration');
check('subheading kept as a heading', chunks.some((c) => c.heading && c.text === '1.1 Elements'));
check('prose is spoken', spoken.includes('Vibration is the motion of a body'));
check('link keeps its words', spoken.includes('the lecture notes'));
check('link URL dropped', !/example\.com/.test(spoken));
check('fenced code dropped', !/const k|```/.test(spoken));
check('table row reads as a list', spoken.includes('Quantity, Symbol, Unit') && spoken.includes('Stiffness, k, N/m'));
check('money survives', spoken.includes('$5 to replace'));
check('no markdown markers left', !/\*\*|##|\]\(/.test(spoken));
check('every chunk fits one utterance', chunks.every((c) => c.text.length <= 220), `longest ${Math.max(...chunks.map((c) => c.text.length))}`);
check('bullets are separate chunks', chunks.some((c) => c.text.startsWith('Mass or inertia')));

/* ---------------------------------------------------------- formulas in words */
check('a simple fraction is spoken', spoken.includes('T equals one half m x dot squared'), spoken.split('\n').find((l) => l.includes('Mass or inertia')));
check('a display formula is spoken', spoken.includes('omega sub n equals square root of k over m'));
check('a bare unicode formula is spoken', spoken.includes('omega sub n equals square root of k over m'));
check('a value line is spoken', spoken.includes('k equals 1 point 2 kN over m'));
check('x equals m a', formulaToWords('x = m a') === 'x equals m a');
// A run of letters stays one token, so a unit like "kN" or "rad" is not spelled
// out letter by letter; "ma" therefore reads as one word, not "m times a".
check('F = ma', formulaToWords('F = ma') === 'F equals ma');
check('powers', formulaToWords('v^2') === 'v squared' && formulaToWords('x^{3}') === 'x cubed');
check('subscripts', formulaToWords('\\omega_n') === 'omega sub n');
check('greek names', formulaToWords('\\zeta = 0.1') === 'zeta equals 0 point 1');
check('sine and brackets', formulaToWords('x = A \\cos(\\omega_n t)') === 'x equals A cosine open bracket omega sub n t close bracket');
check('square root of a group', formulaToWords('\\sqrt{m/k}') === 'square root of m over k');

/* ---------------------------------------------------- never read it wrongly */
const complex = [
  '\\int_0^t F(\\tau)\\,d\\tau = m\\dot{v}',
  '\\sum_{i=1}^{n} F_i = 0',
  '\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}',
  '\\mathcal{L}\\{f(t)\\}',
  'x^{\\prime} + y',
  "x' + y",
  '\\sqrt[3]{x}',
  '\\lim_{x \\to 0} \\frac{\\sin x}{x}',
];
for (const latex of complex) {
  check(`complex formula is cued, not guessed: ${latex.slice(0, 28)}`, formulaToWords(latex) === null);
}
check('a complex formula in the note is cued', spoken.includes(FORMULA_CUE));
check('the cue is followed by a pause', chunks.some((c) => c.text === FORMULA_CUE && c.pauseAfter === CUE_PAUSE_MS));
check('no backslash reaches the reader', !/\\[a-zA-Z]/.test(spoken));
check('no raw formula characters reach the reader', !/[√^_{}]/.test(spoken));

/* -------------------------------------------------------------- images */
check('an image reads its alt text', spoken.includes('Image: Spring-mass system from the lecture slides.'));
check('a filename alt is not read', spoken.includes(IMAGE_CUE) && !spoken.includes('vib-02.png'));

/* --------------------------------------------------------------- structure */
const runOn = notesToSpeech({ text: 'word '.repeat(120) });
check('run-on text is split', runOn.length > 1 && runOn.every((c) => c.text.length <= 220), `${runOn.length} chunks`);
check('empty note yields nothing', notesToSpeech({ text: '' }).length === 0);
check('a formula-only note is spoken, not dropped', notesToSpeech({ text: '$$ x = y $$' })[0]?.text === 'x equals y');

/* ------------------------------------------------------- editor HTML path */
const HTML = `<h2>2. Free vibration</h2>
<p>Free vibration happens when a system is disturbed and then left alone.</p>
<p>With no damping <span class="note-math" data-latex="x = A \\cos(\\omega_n t)">x = A cos(w t)</span> the amplitude stays constant.</p>
<p>Stiffness is <span class="note-math" data-latex="k = \\frac{F}{\\delta}">k = F / d</span> and damping is <strong>zeta</strong>.</p>
<img src="/slides/decay.png" alt="decay curve of a damped system" />
<img src="/slides/blank.png" />`;
const htmlChunks = notesToSpeech({ text: 'ignored when hasHtml is set', html: HTML, hasHtml: true });
const htmlSpoken = htmlChunks.map((c) => c.text).join('\n');
check('html heading marked', htmlChunks[0]?.heading === true && htmlChunks[0]?.text === '2. Free vibration');
check('html paragraph spoken', htmlSpoken.includes('disturbed and then left alone'));
check('html maths read from data-latex', htmlSpoken.includes('x equals A cosine open bracket omega sub n t close bracket'));
check('html fraction read', htmlSpoken.includes('k equals F over delta'));
check('html bold text kept', htmlSpoken.includes('damping is zeta'));
check('html image reads its alt', htmlSpoken.includes('Image: decay curve of a damped system.'));
check('html image without alt is cued', htmlSpoken.includes(IMAGE_CUE));
check('html note ignores the markdown body', !htmlSpoken.includes('ignored when hasHtml'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
