/**
 * Note-title migration verification.
 *
 * A "note" is a Topic: `notes` is the markdown body, `title` is its label. The
 * field always existed but was hard-coded to the placeholder 'General' and never
 * surfaced in the UI, so every note looked identical. v9 indexes `title` and
 * backfills the placeholder from the note's own first line.
 *
 * This exercises the REAL `deriveNoteTitle` / `needsTitleBackfill` helpers and
 * replays the EXACT upgrade body from db.ts over realistic legacy rows, checking
 * the three things that matter: a real title is derived, markdown syntax is
 * stripped, and `notes` is never modified.
 *
 * Not covered here: IndexedDB itself. `fake-indexeddb` is not a dependency, so the
 * Dexie v8 -> v9 upgrade transaction is not executed. Verify in a browser that an
 * existing database opens and the titles backfill.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'note-title-'));
const outFile = join(outDir, 'db.mjs');

await build({
  entryPoints: ['src/db/noteTitle.ts'],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  define: { 'import.meta.url': '"file:///stub"' },
  // Dexie and the Dexie Cloud addon both touch `window`/`indexedDB` at import
  // time, and Dexie is used as a base class. Stub them with a chainable no-op so
  // the pure helpers declared in db.ts can be imported in Node.
  plugins: [{
    name: 'stub-cloud',
    setup(b) {
      b.onResolve({ filter: /dexie-cloud-addon|^dexie$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /dexie-cloud-addon/, namespace: 'stub' }, () => ({ contents: 'export default { };', loader: 'js' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
        class DexieStub {
          constructor() {}
          version() { return this; }
          stores() { return this; }
          upgrade() { return this; }
          table() { return this; }
        }
        export default DexieStub;
        export const Table = class {};
      `, loader: 'js' }));
    },
  }],
});

const m = await import(`file://${outFile.replace(/\\/g, '/')}`);
const { deriveNoteTitle, needsTitleBackfill, DEFAULT_NOTE_TITLE, LEGACY_NOTE_TITLE } = m;

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

// ---------------------------------------------------------------- derivation
check('heading: markdown hashes stripped', deriveNoteTitle('# Graph Theory\n\nbody') === 'Graph Theory');
check('skips leading blank lines', deriveNoteTitle('\n\n\nSecond line\nmore') === 'Second line');
check('empty note -> default', deriveNoteTitle('') === DEFAULT_NOTE_TITLE);
check('whitespace-only note -> default', deriveNoteTitle('   \n\n\t\n') === DEFAULT_NOTE_TITLE);
check('null/undefined -> default', deriveNoteTitle(null) === DEFAULT_NOTE_TITLE && deriveNoteTitle(undefined) === DEFAULT_NOTE_TITLE);
check('bullet stripped', deriveNoteTitle('- Intro to matrices') === 'Intro to matrices');
check('ordered-list marker stripped', deriveNoteTitle('1. First derivation') === 'First derivation');
check('blockquote stripped', deriveNoteTitle('> quoted thesis') === 'quoted thesis');
check('emphasis stripped', deriveNoteTitle('**Important** and _notes_') === 'Important and notes');
check('inline code ticks stripped', deriveNoteTitle('Use `useState` here') === 'Use useState here');
check('link keeps its text', deriveNoteTitle('[Dijkstra](https://x.io) notes') === 'Dijkstra notes');
check('image removed', deriveNoteTitle('![](a.png) diagram') === 'diagram');
check('fence line -> default', deriveNoteTitle('```js\nconst a = 1;\n```') === DEFAULT_NOTE_TITLE);
check('whitespace collapsed', deriveNoteTitle('  spaced   out   text  ') === 'spaced out text');

// A first line longer than the cap must be cut, not returned whole.
const long = deriveNoteTitle(`${'alpha bravo charlie delta echo foxtrot golf hotel india juliet '.repeat(2)}tail`);
check('long line truncated to ~60', long.length <= 61, `${long.length} chars: "${long}"`);
check('truncation is marked', long.endsWith('…'));

// -------------------------------------------------------- backfill predicate
check('"General" needs backfill', needsTitleBackfill(LEGACY_NOTE_TITLE) === true);
check('empty needs backfill', needsTitleBackfill('') === true);
check('real title kept', needsTitleBackfill('Graph Theory') === false);
check('"General Studies" is NOT treated as legacy', needsTitleBackfill('General Studies') === false);

// ------------------------------------------------- replay the real upgrade
// Mirrors the .upgrade() body in db.ts v9. `notes` must round-trip
// byte-for-byte: the migration only ever writes `title` and `updatedAt`.
const runUpgrade = (topics) => {
  const now = new Date().toISOString();
  const out = [];
  for (const t of topics) {
    if (!needsTitleBackfill(t.title)) { out.push(t); continue; }
    const title = deriveNoteTitle(t.notes);
    if (title === t.title) { out.push(t); continue; }
    out.push({ ...t, title, updatedAt: now });
  }
  return out;
};

const legacy = [
  { id: 'a', title: 'General', notes: '# Photosynthesis\n\nLight, water.', subjectId: 's1', status: 'not_started', order: 0, createdAt: 'x', updatedAt: 'x' },
  { id: 'b', title: 'General', notes: '', subjectId: 's1', status: 'not_started', order: 1, createdAt: 'x', updatedAt: 'x' },
  { id: 'c', title: 'General', notes: '\n\n- Linear algebra **basics**\n- Eigenvalues', subjectId: 's2', status: 'studying', order: 0, createdAt: 'x', updatedAt: 'x' },
  { id: 'd', title: 'Already Named', notes: 'other text', subjectId: 's2', status: 'studying', order: 1, createdAt: 'x', updatedAt: 'x' },
  { id: 'e', title: 'General Studies', notes: '# x', subjectId: 's3', status: 'studying', order: 0, createdAt: 'x', updatedAt: 'x' },
];

const migrated = runUpgrade(legacy);
check('migration: all rows survive', migrated.length === legacy.length, `${migrated.length}/${legacy.length}`);
check('migration: heading note titled from content', migrated[0].title === 'Photosynthesis', migrated[0].title);
check('migration: empty note -> default', migrated[1].title === DEFAULT_NOTE_TITLE, migrated[1].title);
check('migration: bullet + emphasis stripped', migrated[2].title === 'Linear algebra basics', migrated[2].title);
check('migration: user title untouched', migrated[3].title === 'Already Named', migrated[3].title);
check('migration: "General Studies" untouched', migrated[4].title === 'General Studies', migrated[4].title);
check(
  'migration: note CONTENT is byte-for-byte unchanged',
  legacy.every((t, i) => t.notes === migrated[i].notes),
);
check(
  'migration: no field other than title/updatedAt changed',
  legacy.every((t, i) => Object.keys(t).every((k) => k === 'title' || k === 'updatedAt' || migrated[i][k] === t[k])),
);

// Existing data still loads: ids, FKs and status survive the upgrade.
check(
  'migration: ids / subjectId / status / order preserved',
  legacy.every((t, i) => ['id', 'subjectId', 'status', 'order', 'createdAt'].every((k) => migrated[i][k] === t[k])),
);

// Idempotent: re-running must not keep re-deriving or churning updatedAt.
const again = runUpgrade(migrated);
check('migration: idempotent', JSON.stringify(again.map((t) => t.title)) === JSON.stringify(migrated.map((t) => t.title)));
check('migration: no duplicate ids', new Set(migrated.map((t) => t.id)).size === migrated.length);

// ------------------------------------------------------- schema declarations
const src = readFileSync('src/db/db.ts', 'utf8');
check('schema: v9 is present and v11 (rich-text notes) is the latest version',
  /\.version\(9\)/.test(src) && /\.version\(10\)/.test(src)
  && /\.version\(11\)/.test(src) && !/\.version\(1[2-9]\)/.test(src));
check('schema: v9 stores topics (additive only)', /this\.version\(9\)[\s\S]{0,220}?topics: 'id, subjectId, status, createdAt, title'/.test(src));
check('schema: primary key is still `id` (not rewritten)', /topics: 'id,/.test(src));
check('schema: title is indexed for by-title lookup', /topics: '[^']*\btitle\b[^']*'/.test(src));
check('schema: v9 has an upgrade() function', /this\.version\(9\)[\s\S]*?\.upgrade\(async/.test(src));
check('repo: new notes default to "Untitled note"', /title: DEFAULT_NOTE_TITLE/.test(readFileSync('src/features/library/libraryRepo.ts', 'utf8')));
check('repo: no hard-coded "General" left for new notes', !/title: 'General'/.test(readFileSync('src/features/library/libraryRepo.ts', 'utf8')));

// The title must be editable in BOTH note views.
const pane = readFileSync('src/features/split/NotesPane.tsx', 'utf8');
const detail = readFileSync('src/features/library/components/SubjectDetail.tsx', 'utf8');
check('UI: split pane renders the title input', (pane.match(/<NoteTitleInput/g) ?? []).length === 2, 'edit + read states');
check('UI: standalone Library editor renders the title input', (detail.match(/<NoteTitleInput/g) ?? []).length === 2, 'edit + read states');
check(
  'UI: title input is rendered inside the notes card (both states)',
  /title=\{selectedTopic \? `Notes[\s\S]*?editingNotes \? \([\s\S]*?<NoteTitleInput[\s\S]*?\) : \([\s\S]*?<NoteTitleInput/.test(detail),
);

console.log(`\nnote-title-migration: ${pass} passed, ${fail} failed`);
rmSync(outDir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);

