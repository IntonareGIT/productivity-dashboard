/**
 * No JSX text node may contain comment syntax.
 *
 * The bug this catches: a bare `//` line placed DIRECTLY AMONG JSX children.
 * That is not a comment. JSX treats anything between tags that is not inside
 * `{}` as literal text, so the comment renders on screen. It shipped once in
 * the calendar month grid, where a four-line comment about the "+x" chip
 * appeared inside every day cell on a phone.
 *
 * This uses the real TypeScript parser rather than a regular expression,
 * because the question "is this line JSX text or JavaScript?" cannot be decided
 * by looking at characters. A hand-rolled scan gets it wrong in both
 * directions: it flags indented `//` comments that are legitimately inside a
 * component body, and it misses a comment that sits between two tags on the
 * same line. Walking the AST and looking at `JsxText` nodes answers it exactly.
 *
 * A braced JSX comment is fine: that is a real comment expression in an
 * expression container, not text. Only BARE comment syntax between tags is the
 * bug.
 */
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

/** Every .tsx file under src, so a new component cannot skip the check. */
function tsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const files = tsxFiles('src');
check('the scan actually found .tsx files to check', files.length > 10, `${files.length} files`);

/** Collect every JsxText node's raw text and position. */
function jsxTexts(source, fileName) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      found.push({ text: node.text, line: line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// The exact failure signature: comment syntax sitting in rendered text.
const BAD = /\/\/|\/\*/;
const offenders = [];
for (const file of files) {
  for (const { text, line } of jsxTexts(readFileSync(file, 'utf8'), file)) {
    if (BAD.test(text)) offenders.push(`${file}:${line}  ${JSON.stringify(text.trim().slice(0, 60))}`);
  }
}
check(
  'no JSX text node contains comment syntax',
  offenders.length === 0,
  offenders.length === 0 ? `${files.length} files scanned` : offenders.join(' | '),
);

// A whitespace-only JsxText is just indentation and is expected everywhere.
const sample = jsxTexts(readFileSync(files[0], 'utf8'), files[0]);
check('the parser really is finding JSX text nodes',
  sample.length > 0 && sample.every((s) => typeof s.text === 'string'),
  `${sample.length} JsxText nodes in ${files[0]}`);

// The specific regression, pinned by content so it cannot be reintroduced.
const month = readFileSync('src/features/calendar/components/MonthView.tsx', 'utf8');
check('the calendar month grid no longer renders the "+x" comment as text',
  !/^\s*\/\/ The mobile row shows fewer dots/m.test(month));
check('the explanation is kept as a real JSX comment instead',
  /\{\/\* The mobile row shows fewer dots/.test(month));
check('the "+x" chip is still rendered after the comment',
  month.indexOf('{\/* The mobile row shows fewer dots')
    < month.indexOf('occurrences.length > MOBILE_DOTS && ('));

/* ---- the behaviour around that comment, stated accurately ----
 * Two DISTINCT taps exist and they are not the same target:
 *   - the day CELL calls onDayClick, which CalendarPage wires to setNewDate,
 *     i.e. the quick-add event form;
 *   - the "+x" chip calls onOpenDay, which is setOpenDay, i.e. the day panel.
 * So the day PANEL is reachable only through the chip, and on mobile the chip
 * only renders above the dot budget. This section pins both facts so the gap
 * below cannot be lost, and so a future change that moves either one is caught. */
check('the day cell taps open the quick-add form, not the day panel',
  /onClick=\{\(\) => onDayClick\(dateKey\)\}/.test(month)
  && /onClick=\{\(e\) => \{ e\.stopPropagation\(\); onOpenDay\(dateKey\); \}\}/.test(month));
check('CalendarPage wires the cell to setNewDate and the chip to setOpenDay',
  /onDayClick=\{\(dateKey\) => setNewDate\(dateKey\)\}/.test(
    readFileSync('src/features/calendar/CalendarPage.tsx', 'utf8'))
  && /onOpenDay=\{setOpenDay\}/.test(
    readFileSync('src/features/calendar/CalendarPage.tsx', 'utf8')));
check('the day cell is announced and reachable by keyboard, not click-only',
  /role="button"/.test(month)
  && /tabIndex=\{0\}/.test(month)
  && /e\.key === 'Enter'\) onDayClick\(dateKey\)/.test(month));
check('the mobile "+x" chip is a real button that opens the day panel',
  /data-month-more=\{dateKey\}/.test(month)
  && /onOpenDay\(dateKey\)/.test(month));
check('the mobile chip renders ONLY above the dot budget',
  /occurrences\.length > MOBILE_DOTS && \(/.test(month));
/* THE GAP, recorded rather than silently fixed. A day with 1, 2 or 3 events
 * fits inside MOBILE_DOTS, so on mobile it shows dots and NO chip, and the only
 * tap target left is the cell, which opens the quick-add form. The day panel is
 * therefore unreachable for such a day on a phone. This check documents that it
 * is still true; if it ever becomes false, the behaviour improved and this
 * assertion must be updated rather than left lying. */
check('KNOWN GAP, documented: on mobile a day at or below the dot budget has no chip',
  /occurrences\.length > MOBILE_DOTS && \(/.test(month)
  && !/occurrences\.length > 0 && \(/.test(month));


console.log(`\njsx-comments: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
