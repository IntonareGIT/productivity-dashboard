/**
 * Notes → speech verification.
 *
 * The Listen control reads notes aloud, so the thing that must not go wrong is
 * WHAT gets spoken: formulas and code read out loud are worse than silence, and
 * a heading swallowed into the sentence under it stops framing anything. This
 * checks the real pure module (no re-implementation) against a note shaped like
 * the ones in the Library.
 */
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'notes-speech-'));
const root = process.cwd().replace(/\\/g, '/');
const entry = join(outDir, 'entry.ts');
const { writeFileSync } = await import('node:fs');
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

const { notesToSpeech } = await import(`file://${bundleFile.replace(/\\/g, '/')}`);

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

![Spring-mass system](/slides/vib-01.png)

| Quantity | Symbol | Unit |
| --- | --- | --- |
| Stiffness | k | N/m |

\`\`\`js
const k = 12;
\`\`\`

See [the lecture notes](https://example.com/vib-01.pdf) for the derivation.

k = 1.2 kN/m

ω_n = √(k/m)
`;

const chunks = notesToSpeech({ text: NOTE });
const spoken = chunks.map((c) => c.text).join('\n');

check('headings are their own chunks', chunks[0]?.heading === true && chunks[0]?.text === '1. Fundamentals of Vibration');
check('subheading kept as a heading', chunks.some((c) => c.heading && c.text === '1.1 Elements'));
check('prose is spoken', spoken.includes('Vibration is the motion of a body'));
check('inline maths dropped', !/frac|dot\{x\}/.test(spoken), spoken.slice(0, 80));
check('block maths dropped', !/omega|sqrt/.test(spoken));
check('image dropped', !/slides\/vib-01|Spring-mass system/.test(spoken));
check('table row reads as a list', spoken.includes('Quantity, Symbol, Unit') && spoken.includes('Stiffness, k, N/m'));
check('fenced code dropped', !/const k|```/.test(spoken));
check('link keeps its words', spoken.includes('the lecture notes'));
check('link URL dropped', !/example\.com/.test(spoken));
check('money survives', spoken.includes('$5 to replace'));
check('a value line survives', spoken.includes('k = 1.2 kN/m'));
check('a bare formula line is skipped', !/√/.test(spoken));
check('no markdown markers left', !/\*\*|##|\]\(/.test(spoken));
check('every chunk fits one utterance', chunks.every((c) => c.text.length <= 220), `longest ${Math.max(...chunks.map((c) => c.text.length))}`);
check('bullets are separate chunks', chunks.some((c) => c.text.startsWith('Mass or inertia')));

// A run-on with no punctuation still has to be cut into utterances.
const runOn = notesToSpeech({ text: 'word '.repeat(120) });
check('run-on text is split', runOn.length > 1 && runOn.every((c) => c.text.length <= 220), `${runOn.length} chunks`);

// Editor HTML: the maths span and the image are the two things that must never
// reach the reader, and headings must survive the tag stripping.
const HTML = `<h2>2. Free vibration</h2>
<p>Free vibration happens when a system is disturbed and then left alone.</p>
<p>With no damping <span class="note-math" data-latex="x = A cos(w t)">x = A cos(w t)</span> the amplitude stays constant.</p>
<p>Damping is measured by the damping ratio <strong>zeta</strong>.</p>
<img src="/slides/decay.png" alt="decay" />`;
const htmlChunks = notesToSpeech({ text: 'ignored when hasHtml is set', html: HTML, hasHtml: true });
const htmlSpoken = htmlChunks.map((c) => c.text).join('\n');
check('html heading marked', htmlChunks[0]?.heading === true && htmlChunks[0]?.text === '2. Free vibration');
check('html paragraph spoken', htmlSpoken.includes('disturbed and then left alone'));
check('html maths dropped', !/cos\(|note-math|data-latex/.test(htmlSpoken));
check('html image dropped', !/decay/.test(htmlSpoken));
check('html bold text kept', htmlSpoken.includes('damping ratio zeta'));
check('html note ignores the markdown body', !htmlSpoken.includes('ignored when hasHtml'));

check('empty note yields nothing', notesToSpeech({ text: '' }).length === 0);
check('formula-only note yields nothing', notesToSpeech({ text: '$$ x = y $$' }).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
