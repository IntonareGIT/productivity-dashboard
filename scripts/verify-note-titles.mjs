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
const {
  deriveNoteTitle, needsTitleBackfill, DEFAULT_NOTE_TITLE, LEGACY_NOTE_TITLE,
  getDefaultNoteTitle, uniqueDefaultNoteTitle, generatedNoteTitleNumber,
  noteTitleForNumber,
} = m;

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

/* ============ v15: the default title is the subject's name ============ */

// The exact format is required, including the awkward possessive. "Fixing" it
// to "Thermodynamics Notes" would break the string the user was told to expect.
check('default title is "<Subject>\'s Notes", exactly',
  getDefaultNoteTitle({ name: 'Thermodynamics' }) === "Thermodynamics's Notes",
  getDefaultNoteTitle({ name: 'Thermodynamics' }));
check('a name with an apostrophe still formats the same way',
  getDefaultNoteTitle({ name: "Newton's Laws" }) === "Newton's Laws's Notes",
  getDefaultNoteTitle({ name: "Newton's Laws" }));
check('the subject name is trimmed rather than doubled-spaced',
  getDefaultNoteTitle({ name: '  Physics  ' }) === "Physics's Notes");
check('a missing subject falls back rather than producing "null\'s Notes"',
  getDefaultNoteTitle(null) === DEFAULT_NOTE_TITLE && getDefaultNoteTitle({ name: '  ' }) === DEFAULT_NOTE_TITLE);

// Numbering: two generated titles in one subject must be distinguishable,
// because a note list shows titles side by side with nothing else to tell them
// apart.
const base = getDefaultNoteTitle({ name: 'Thermodynamics' });
check('the first note in a subject takes the bare default',
  uniqueDefaultNoteTitle(base, []) === "Thermodynamics's Notes");
check('a second note gets " 2"',
  uniqueDefaultNoteTitle(base, ["Thermodynamics's Notes"]) === "Thermodynamics's Notes 2");
check('a third note gets " 3"',
  uniqueDefaultNoteTitle(base, ["Thermodynamics's Notes", "Thermodynamics's Notes 2"])
  === "Thermodynamics's Notes 3");
check('numbering fills the GAP rather than running past it',
  uniqueDefaultNoteTitle(base, ["Thermodynamics's Notes", "Thermodynamics's Notes 3"])
  === "Thermodynamics's Notes 2",
  uniqueDefaultNoteTitle(base, ["Thermodynamics's Notes", "Thermodynamics's Notes 3"]));
check('numbering ignores case, so "notes" cannot become a near-duplicate',
  uniqueDefaultNoteTitle(base, ["thermodynamics's notes"]) === "Thermodynamics's Notes 2");
check('a user title that happens to match is still respected',
  uniqueDefaultNoteTitle(base, ["Thermodynamics's Notes", "My lecture notes"])
  === "Thermodynamics's Notes 2");

// Which titles are "ours" and may follow a rename. This is what replaces a new
// `isGenerated` field: a purely textual test, so the schema stays unchanged.
check('the bare default is recognised as generated',
  generatedNoteTitleNumber("Thermodynamics's Notes", 'Thermodynamics') === 1);
check('a numbered default is recognised, and its number is returned',
  generatedNoteTitleNumber("Thermodynamics's Notes 3", 'Thermodynamics') === 3);
check('a title the user typed is NOT generated, so it is never rewritten',
  generatedNoteTitleNumber('Lecture 4 recap', 'Thermodynamics') === null);
check('a default for a DIFFERENT subject is not generated',
  generatedNoteTitleNumber("Physics's Notes", 'Thermodynamics') === null);
check('the rename carries the number across unchanged',
  noteTitleForNumber('Physics', 3) === "Physics's Notes 3");
check('number 1 renders as the bare default, with no " 1"',
  noteTitleForNumber('Physics', 1) === "Physics's Notes");

/* ============ the v15 upgrade body, mirrored from db.ts ============ */
const runV15 = (subjects, topics) => {
  const now = new Date().toISOString();
  const byId = new Map(subjects.map((s) => [s.id, s]));
  const needsBackfill = (t) => {
    const s = (t ?? '').trim();
    return s === '' || s === LEGACY_NOTE_TITLE || s === DEFAULT_NOTE_TITLE;
  };
  const bySubject = new Map();
  for (const t of topics) {
    const l = bySubject.get(t.subjectId) ?? [];
    l.push(t);
    bySubject.set(t.subjectId, l);
  }
  const out = topics.slice();
  for (const [subjectId, notes] of bySubject) {
    const b = getDefaultNoteTitle(byId.get(subjectId));
    const used = new Set();
    for (const t of notes) if (!needsBackfill(t.title)) used.add(t.title.trim().toLowerCase());
    for (const t of notes) {
      if (!needsBackfill(t.title)) continue;
      let next = b;
      let n = 2;
      while (used.has(next.trim().toLowerCase())) next = `${b} ${n++}`;
      used.add(next.trim().toLowerCase());
      out[topics.indexOf(t)] = { ...t, title: next, updatedAt: now };
    }
  }
  return out;
};

const subs = [{ id: 's1', name: 'Thermodynamics' }, { id: 's2', name: 'Physics' }];
const legacy15 = [
  { id: 'n1', subjectId: 's1', title: DEFAULT_NOTE_TITLE, notes: 'body one', contentHtml: '<p>one</p>', contentFormat: 'html' },
  { id: 'n2', subjectId: 's1', title: DEFAULT_NOTE_TITLE, notes: 'body two' },
  { id: 'n3', subjectId: 's1', title: LEGACY_NOTE_TITLE, notes: 'body three' },
  { id: 'n4', subjectId: 's1', title: 'Lecture 4 recap', notes: 'body four' },
  { id: 'n5', subjectId: 's2', title: DEFAULT_NOTE_TITLE, notes: 'body five' },
  { id: 'n6', subjectId: 's2', title: "Physics's Notes 2", notes: 'body six' },
];

const v15 = runV15(subs, legacy15);
const at = (id) => v15.find((t) => t.id === id);
check('v15: an old-default note is renamed after its subject',
  at('n1').title === "Thermodynamics's Notes", at('n1').title);
check('v15: a second old-default note in the same subject is numbered 2',
  at('n2').title === "Thermodynamics's Notes 2", at('n2').title);
check('v15: a third becomes 3, never colliding with a real title',
  at('n3').title === "Thermodynamics's Notes 3", at('n3').title);
check('v15: a title the user typed is NEVER changed',
  at('n4').title === 'Lecture 4 recap', at('n4').title);
check('v15: numbering is PER SUBJECT, so Physics restarts at its own base',
  at('n5').title === "Physics's Notes", at('n5').title);
check('v15: an already-converted note keeps its number',
  at('n6').title === "Physics's Notes 2", at('n6').title);
check('v15: every row survives, nothing is deleted', v15.length === legacy15.length);

// The safety property that matters most: the BODY is never touched.
check('v15: note CONTENT is byte-for-byte unchanged',
  legacy15.every((t) => at(t.id).notes === t.notes));
check('v15: a rich-text note keeps its contentHtml and contentFormat',
  at('n1').contentHtml === '<p>one</p>' && at('n1').contentFormat === 'html');
check('v15: no field other than title/updatedAt changed',
  legacy15.every((t) => Object.keys(t).every(
    (k) => k === 'title' || k === 'updatedAt' || at(t.id)[k] === t[k])));
check('v15: ids and subjectId preserved',
  legacy15.every((t) => t.id === at(t.id).id && t.subjectId === at(t.id).subjectId));

// Running it twice must change nothing, because Dexie Cloud can replay an
// upgrade on a synced device.
const v15again = runV15(subs, v15);
check('v15: running the migration TWICE changes nothing',
  JSON.stringify(v15again.map((t) => t.title)) === JSON.stringify(v15.map((t) => t.title)),
  v15again.map((t) => t.title).join(' | '));
check('v15: a second run does not churn updatedAt either',
  v15again.every((t, i) => t.updatedAt === v15[i].updatedAt));
check('v15: an empty notes table is a no-op, not an error', runV15(subs, []).length === 0);
check('v15: a note whose subject is gone falls back instead of throwing',
  runV15([], [{ id: 'z', subjectId: 'gone', title: DEFAULT_NOTE_TITLE, notes: 'x' }])[0].title
  === DEFAULT_NOTE_TITLE);

/* ============ a rename follows the subject ============ */
// The rename uses the same textual test, so it needs no database of its own.
const renameFollows = (title, oldName, newName) => {
  const num = generatedNoteTitleNumber(title, oldName);
  return num === null ? title : noteTitleForNumber(newName, num);
};
check('rename: an untouched default follows the subject',
  renameFollows("Thermodynamics's Notes", 'Thermodynamics', 'Physics') === "Physics's Notes");
check('rename: the number survives the rename',
  renameFollows("Thermodynamics's Notes 2", 'Thermodynamics', 'Physics') === "Physics's Notes 2");
check('rename: a user title is left exactly as typed',
  renameFollows('Lecture 4 recap', 'Thermodynamics', 'Physics') === 'Lecture 4 recap');
check('rename: a title that merely CONTAINS the default is not generated',
  renameFollows("About Thermodynamics's Notes", 'Thermodynamics', 'Physics')
  === "About Thermodynamics's Notes");
check('rename: a numbered title belonging to another subject is left alone',
  renameFollows("Physics's Notes 2", 'Thermodynamics', 'Chemistry') === "Physics's Notes 2");

// ------------------------------------------------------- schema declarations
const src = readFileSync('src/db/db.ts', 'utf8');
// v14 (resourceGroups.parentGroupId, for nested groups) is additive: one
// unindexed optional field whose upgrade only ever clears an impossible parent.
// v15 (default note titles) adds NO schema at all and only re-labels rows the app
// generated. The "latest version" guard moves forward rather than being deleted.
check('schema: v9 is present and v15 (note default titles) is the latest version',
  /\.version\(9\)/.test(src) && /\.version\(10\)/.test(src)
  && /\.version\(11\)/.test(src) && /\.version\(12\)/.test(src)
  && /\.version\(13\)/.test(src) && /\.version\(14\)/.test(src)
  && /\.version\(15\)/.test(src)
  && !/\.version\(1[6-9]\)/.test(src));
check('schema: v15 adds no new index and re-declares topics verbatim',
  /this\.version\(15\)[\s\S]{0,200}?topics: 'id, subjectId, status, createdAt, title'/.test(src)
  && !/this\.version\(15\)[\s\S]{0,200}?topics: '[^']*isDefaultTitle/.test(src));
check('schema: v15 has an upgrade() and deletes nothing',
  /this\.version\(15\)[\s\S]*?\.upgrade\(async/.test(src)
  && !/this\.version\(15\)[\s\S]{0,1400}?\.delete\(/.test(src));
check('schema: v14 adds no new index on resourceGroups',
  /this\.version\(14\)[\s\S]{0,300}?resourceGroups: 'id, subjectId, order, createdAt'/.test(src)
  && !/this\.version\(14\)[\s\S]{0,300}?resourceGroups: '[^']*parentGroupId/.test(src));
check('schema: v9 stores topics (additive only)', /this\.version\(9\)[\s\S]{0,220}?topics: 'id, subjectId, status, createdAt, title'/.test(src));
check('schema: primary key is still `id` (not rewritten)', /topics: 'id,/.test(src));
check('schema: title is indexed for by-title lookup', /topics: '[^']*\btitle\b[^']*'/.test(src));
check('schema: v9 has an upgrade() function', /this\.version\(9\)[\s\S]*?\.upgrade\(async/.test(src));
// New notes are named after their SUBJECT, not by a hard-coded string. The
// shared helper is the single source of that rule.
const repo = readFileSync('src/features/library/libraryRepo.ts', 'utf8');
check('repo: new notes default to the subject name, via the shared helper',
  /title: uniqueDefaultNoteTitle\(\s*getDefaultNoteTitle\(subject\)/.test(repo));
check('repo: new notes no longer use the generic constant directly',
  !/title: DEFAULT_NOTE_TITLE/.test(repo));
check('repo: no hard-coded "General" left for new notes', !/title: 'General'/.test(repo));
check('repo: one shared function defines the rule, used by repo, UI, AI and migration',
  /export const getDefaultNoteTitle/.test(readFileSync('src/db/noteTitle.ts', 'utf8')));
check('repo: a subject rename updates only untouched generated titles',
  /renameGeneratedNoteTitles/.test(repo) && /generatedNoteTitleNumber/.test(repo));
check('repo: the rename and the title update share one transaction',
  /db\.transaction\('rw', \[db\.subjects, db\.topics\]/.test(repo));
check('UI: a blank title in the Topic dialog falls back to the same helper',
  /uniqueDefaultNoteTitle\(\s*getDefaultNoteTitle\(subject\)/.test(
    readFileSync('src/features/library/components/TopicModal.tsx', 'utf8')));
check('AI: createNote falls back to the same helper when no title is given',
  /uniqueDefaultNoteTitle\(\s*getDefaultNoteTitle\(subject\)/.test(
    readFileSync('src/features/ai/toolsLibrary.ts', 'utf8')));
check('AI: createNote no longer REQUIRES a title',
  /name: 'createNote'[\s\S]{0,700}?required: \['subjectId'\]/.test(
    readFileSync('src/features/ai/toolsLibrary.ts', 'utf8')));

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

