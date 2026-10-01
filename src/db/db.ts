import Dexie, { type Table } from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import type {
  AiProvider,
  Assessment,
  Subject,
  Topic,
  Resource,
  ResourceGroup,
  CalendarEvent,
  WeeklySchedule,
  ShiftOverride,
  PomodoroSession,
  ThemeStatusMapping,
  PomodoroSettingsRow,
  ChatSession,
  ChatMessageRow,
  UiState
} from '../types';
import { newId } from '../utils/id';
import { BLOB_MODE, DEXIE_CLOUD_URL, UNSYNCED_TABLES } from './cloudConfig';

import {
  DEFAULT_NOTE_TITLE,
  deriveNoteTitle,
  getDefaultNoteTitle,
  LEGACY_NOTE_TITLE,
  needsTitleBackfill,
} from './noteTitle';

/**
 * The v15 rule: a title the app generated, not one the user typed.
 *
 * Kept SEPARATE from `needsTitleBackfill` (the v9 rule) on purpose. v9 asked
 * "does this note need a title at all?", which included the legacy 'General'
 * placeholder. v15 asks the narrower, safer question: "is this one of the
 * defaults the app itself produced?". Sharing one predicate would mean v15 also
 * touched notes v9 had deliberately left alone.
 *
 * Note that `'Untitled note'` is in BOTH lists: it was v9's fallback for an
 * empty note, so a note can legitimately carry it, and it is exactly the old
 * default v15 replaces.
 */
const needsTitleBackfillV15 = (title: string | undefined | null): boolean => {
  const t = (title ?? '').trim();
  return t === '' || t === LEGACY_NOTE_TITLE || t === DEFAULT_NOTE_TITLE;
};

export class ProductivityDB extends Dexie {
  subjects!: Table<Subject, string>;
  topics!: Table<Topic, string>;
  resources!: Table<Resource, string>;
  resourceGroups!: Table<ResourceGroup, string>;
  assessments!: Table<Assessment, string>;
  calendarEvents!: Table<CalendarEvent, string>;
  weeklySchedules!: Table<WeeklySchedule, string>;
  shiftOverrides!: Table<ShiftOverride, string>;
  pomodoroSessions!: Table<PomodoroSession, string>;
  themeStatusMap!: Table<ThemeStatusMapping, string>;
  appSettings!: Table<PomodoroSettingsRow, string>;
  aiProviders!: Table<AiProvider, string>;
  chatSessions!: Table<ChatSession, string>;
  chatMessages!: Table<ChatMessageRow, string>;
  uiState!: Table<UiState, string>;

  constructor() {
    // The Dexie Cloud addon is attached here; without it db.cloud is undefined.
    // With no dexie-cloud.key present (fresh clone / CI) the addon stays in
    // anonymous mode and the app works entirely locally.
    super('ProductivityDashboardDB', { addons: [dexieCloud] });
    this.version(1).stores({
      subjects: 'id, name, color, createdAt',
      resources: 'id, subjectId, title, dueDate, createdAt',
      calendarEvents: 'id, date, category, startTime, endTime',
      shiftConfig: 'id',
      shiftOverrides: 'id, date, type',
      pomodoroSessions: 'id, date, durationMinutes, completedAt',
      themeStatusMap: 'status'
    });
    // v2 (Phase 5): singleton app settings rows (pomodoro durations).
    this.version(2).stores({
      appSettings: 'id'
    });
    // v3: per-week roster records replace the singleton shiftConfig.
    this.version(3).stores({
      weeklySchedules: 'id, weekStartDate',
      shiftConfig: null // table dropped
    });
    // v4: index subjectId so a Library subject can list its linked lectures.
    this.version(4).stores({
      calendarEvents: 'id, date, category, startTime, endTime, subjectId'
    });
    // v5: topic-based library — subjects -> topics -> resources,
    // assessments per subject, subject/topic links on pomodoroSessions.
    this.version(5)
      .stores({
        topics: 'id, subjectId, status, createdAt',
        assessments: 'id, subjectId, date, status',
        resources: 'id, subjectId, topicId, title, dueDate, createdAt',
        pomodoroSessions: 'id, date, durationMinutes, completedAt, subjectId, topicId',
      })
      .upgrade(async (tx) => {
        const subjects = await tx.table('subjects').toArray();
        const now = new Date().toISOString();
        for (const s of subjects as Subject[]) {
          const topicId = newId();
          await tx.table('topics').put({
            id: topicId,
            subjectId: s.id,
            title: 'General',
            notes: s.notes ?? '',
            status: 'not_started',
            order: 0,
            createdAt: s.createdAt ?? now,
            updatedAt: now,
          } satisfies Topic);
          // Attach legacy subject-level resources to the default topic,
          // keeping subjectId denormalized. Detect legacy rows by missing topicId.
          const legacy = (await tx
            .table('resources')
            .where('subjectId')
            .equals(s.id)
            .toArray()) as Resource[];
          for (const r of legacy) {
            if (r.topicId === undefined || r.topicId === null) {
              await tx.table('resources').put({
                ...r,
                topicId: topicId,
                kind: (r as Resource).kind ?? 'link',
              } satisfies Resource);
            }
          }
        }
      });
    // v6: configurable AI providers for the global assistant (Part 1 of the
    // AI feature — PDF-based subject Q&A is a later phase, out of scope here).
    this.version(6).stores({
      aiProviders: 'id, label, isDefault',
    });
    // v7: persistent assistant chat history. Messages are stored with their
    // raw provider payload so Gemini thought_signatures survive a reload.
    this.version(7).stores({
      chatSessions: 'id, updatedAt, providerId',
      chatMessages: 'id, sessionId, createdAt',
    });
    // v8: synced UI state (single row, key 'current') holding the current
    // status and any theme override. Schema addition only — no primary key is
    // changed and no .upgrade() is used on a synced table.
    this.version(8).stores({
      uiState: 'id',
    });
    // v9: notes get a real, editable title. `title` is now indexed so the
    // assistant can find a note BY TITLE, and the upgrade backfills every topic
    // still carrying the generic 'General' placeholder from the first line of
    // its own content.
    //
    // A "note" is a Topic: `notes` holds the markdown body and `title` is its
    // label. The field already existed and was simply never surfaced, so this is
    // additive — an index plus a value backfill. NOTE CONTENT IS NEVER TOUCHED.
    this.version(9)
      .stores({
        topics: 'id, subjectId, status, createdAt, title',
      })
      .upgrade(async (tx) => {
        const topics = (await tx.table('topics').toArray()) as Topic[];
        const now = new Date().toISOString();
        for (const t of topics) {
          if (!needsTitleBackfill(t.title)) continue;
          const title = deriveNoteTitle(t.notes);
          if (title === t.title) continue;
          // `{ ...t }` preserves `notes` byte-for-byte: only the label changes.
          await tx.table('topics').put({ ...t, title, updatedAt: now });
        }
      });
    // v10: named groups (folders) for resources within a subject.
    //
    // Two changes, both additive:
    //   1. a new `resourceGroups` table (id, subjectId, name, order, createdAt)
    //   2. an indexed, optional `groupId` on `resources`
    //
    // `groupId` is indexed so "all resources in this group" is a single indexed
    // read rather than a full table scan on every render.
    //
    // The upgrade exists to NORMALISE, not to create: existing rows simply have
    // no `groupId`, and the loop below normalises the three ways that can be
    // untrue (a dangling group, a group from another subject, a non-null
    // non-string). Every existing resource therefore stays ungrouped, and no
    // resource is deleted or rewritten beyond clearing a groupId that could not
    // have been valid.
    this.version(10)
      .stores({
        resourceGroups: 'id, subjectId, order, createdAt',
        resources: 'id, subjectId, topicId, title, dueDate, createdAt, groupId',
      })
      .upgrade(async (tx) => {
        const groups = (await tx.table('resourceGroups').toArray()) as ResourceGroup[];
        const byId = new Map(groups.map((g) => [g.id, g]));
        const resources = (await tx.table('resources').toArray()) as Resource[];

        // Drop groups that lost their subject (e.g. a partial sync) rather than
        // leaving rows nothing can reach.
        for (const g of groups) {
          if (!(await tx.table('subjects').get(g.subjectId))) {
            await tx.table('resourceGroups').delete(g.id);
            byId.delete(g.id);
          }
        }

        for (const r of resources) {
          if (r.groupId === undefined || r.groupId === null) continue; // already ungrouped
          const group = byId.get(r.groupId);
          const valid = group && group.subjectId === r.subjectId;
          if (valid) continue;
          // Clear an impossible groupId so the invariant "grouped resource is
          // in a group of its own subject" holds for every row.
          await tx.table('resources').put({ ...r, groupId: null });
        }
      });

    /**
     * v11: the rich-text note fields.
     *
     * ADDITIVE ONLY, and the upgrade is deliberately empty of content work:
     *
     * - `contentHtml`    the WYSIWYG editor's HTML, absent on every existing row
     * - `contentFormat`  a marker, absent on every existing row
     *
     * Neither field is indexed, because nothing queries notes by their body.
     *
     * The upgrade touches NO row. `Topic.notes` (the markdown) stays byte-for-byte
     * as the permanent backup, and no note is converted here: conversion happens
     * lazily, on first open, and the result is persisted only once the user edits
     * it. That is the whole safety argument, and it means a note nobody opens is
     * byte-identical to before this version.
     */
    this.version(11)
      .stores({
        topics: 'id, subjectId, status, createdAt, title',
      });

    /**
     * v12: event kind and period.
     *
     * ADDITIVE ONLY. `eventKind` and `period` are plain, UNINDEXED fields, and
     * both are optional, so they are simply absent on every existing row and
     * `undefined` means "no kind" / "no period". Nothing is renamed, no index is
     * added, and no table key changes.
     *
     * The upgrade DOES NOT rewrite rows. The brief forbids overwriting user data,
     * and there is nothing to rewrite: backfilling `eventKind` would be a guess
     * about whether an event with a subject was a lecture or a lab, and a wrong
     * guess is worse than "no kind". Every pre-v12 event therefore keeps looking
     * exactly as it did.
     *
     * `period` is deliberately NOT indexed. Overlap warnings compare it in
     * memory against the handful of events on one day, which the `date` index
     * already narrows for us; a separate index would only add write cost.
     */
    this.version(12)
      .stores({
        // Same string `id` primary key and same index set as v7. Only an
        // additional index would appear here, and there is none to add.
        calendarEvents: 'id, date, category, startTime, endTime, subjectId',
      })
      .upgrade(async (tx) => {
        // Explicitly a no-op, and asserted as such so a future edit that starts
        // writing here has to remove this comment deliberately.
        void tx;
      });

    /**
     * v13: optional fallback model, and a shared series id for events.
     *
     * ADDITIVE ONLY, and following the v12 precedent exactly: both are plain,
     * UNINDEXED, optional fields, absent on every existing row.
     *
     *  - `aiProviders.fallbackModel`: a second model id to try once, if the
     *    primary model is overloaded. Empty string means off, which is the
     *    default, so nothing changes for anyone who has not opted in.
     *  - `calendarEvents.seriesId`: groups the events created together by one
     *    `createRecurringEvents` call, so a whole series can be listed and
     *    deleted as a unit later.
     *
     * The upgrade does NOT rewrite rows. `undefined` already means "no fallback"
     * and "not part of a series", so there is nothing to backfill, and guessing
     * a series for an existing event would be wrong.
     */
    this.version(13)
      .stores({
        // Unchanged primary key and index set for both tables, exactly as they
        // were declared: these are new UNINDEXED fields, so no index changes
        // and no key changes. Re-declaring a different index set here would
        // silently DROP the `label` index on aiProviders.
        aiProviders: 'id, label, isDefault',
        calendarEvents: 'id, date, category, startTime, endTime, subjectId',
      })
      .upgrade(async (tx) => {
        // No-op on purpose, exactly as v12: absent means off, and a wrong
        // backfilled series id would group unrelated events together.
        void tx;
      });

    /**
     * v14: groups can nest inside groups.
     *
     * ADDITIVE ONLY. `parentGroupId` is a plain, UNINDEXED, optional field:
     * absent or null means "a top-level group in the subject", which is exactly
     * what every existing group already is. No index is added because groups are
     * read per SUBJECT (`subjectId` is already indexed) and a subject has only a
     * handful of them, so the parent filter is a cheap in-memory pass rather than
     * an index walk. `order` keeps its existing meaning, now scoped to siblings.
     *
     * The upgrade NORMALISES rather than creating: it only clears a
     * `parentGroupId` that could not be valid, and it never deletes a row. The
     * four impossible states it repairs are a parent that no longer exists, a
     * parent in another subject, a self-parent, and a cycle already in the data.
     * Every repaired group becomes top-level, so it stays visible and reachable
     * instead of disappearing into a branch nothing can render.
     *
     * This mirrors the v10 upgrade, which normalised `resources.groupId` the same
     * way for the same reason.
     */
    this.version(14)
      .stores({
        // Unchanged string `id` primary key and an unchanged index set: this is a
        // new UNINDEXED field, so no key change and no index change. Re-declaring
        // a different set here would silently drop `subjectId`/`order`.
        resourceGroups: 'id, subjectId, order, createdAt',
      })
      .upgrade(async (tx) => {
        const groups = (await tx.table('resourceGroups').toArray()) as ResourceGroup[];
        if (groups.length === 0) return;
        const byId = new Map(groups.map((g) => [g.id, g]));
        const parentOf = (g: ResourceGroup): string | null => {
          const p = g.parentGroupId;
          return p == null || p === '' ? null : String(p);
        };

        for (const g of groups) {
          const parentId = parentOf(g);
          if (parentId === null) {
            // Already top-level. Normalise an explicit `undefined` to null so
            // every row has the same shape, without rewriting anything else.
            if (g.parentGroupId === undefined) {
              await tx.table('resourceGroups').put({ ...g, parentGroupId: null });
            }
            continue;
          }

          const parent = byId.get(parentId);
          const wrongSubject = parent != null && parent.subjectId !== g.subjectId;
          // Walk up from the proposed parent; if we reach this group, the link
          // is a cycle and cannot be kept.
          let cycle = false;
          const seen = new Set<string>([g.id]);
          let cursor: string | null = parentId;
          while (cursor != null) {
            if (seen.has(cursor)) { cycle = true; break; }
            seen.add(cursor);
            const next = byId.get(cursor);
            if (!next) break;
            cursor = parentOf(next);
          }

          if (!parent || wrongSubject || parentId === g.id || cycle) {
            await tx.table('resourceGroups').put({ ...g, parentGroupId: null });
          }
        }
      });

    /**
     * v15: a note with no title of its own is named after its subject.
     *
     * ADDITIVE ONLY, and in fact not even that: **no schema change at all.** No
     * table is added, no field is added, no index is added and nothing is
     * removed. `.stores()` re-declares the existing `topics` schema verbatim,
     * which is required so Dexie knows the version exists; changing it would
     * drop an index.
     *
     * The upgrade only RE-LABELS notes whose title the app generated rather than
     * the user typed, namely an empty title, the legacy `'General'` placeholder,
     * or the old generic default `'Untitled note'`. Those become
     * "<Subject>'s Notes", numbered per subject so two never collide.
     *
     * **The note body is never touched.** Each write is `{ ...topic, title }`, so
     * `notes`, `contentHtml`, `contentFormat` and every other field are carried
     * across byte-for-byte.
     *
     * Safe to run more than once: after the first pass no title matches the old
     * defaults, so a second pass writes nothing. That matters because Dexie Cloud
     * can replay a schema upgrade on a synced device.
     */
    this.version(15)
      .stores({
        // Verbatim from v9: same primary key, same index set, nothing new.
        topics: 'id, subjectId, status, createdAt, title',
      })
      .upgrade(async (tx) => {
        const subjects = (await tx.table('subjects').toArray()) as Subject[];
        const topics = (await tx.table('topics').toArray()) as Topic[];
        const subjectById = new Map(subjects.map((s) => [s.id, s]));
        const now = new Date().toISOString();

        // Group by subject so the numbering counter is per subject, not global.
        const bySubject = new Map<string, Topic[]>();
        for (const t of topics) {
          const list = bySubject.get(t.subjectId) ?? [];
          list.push(t);
          bySubject.set(t.subjectId, list);
        }

        for (const [subjectId, notes] of bySubject) {
          const subject = subjectById.get(subjectId);
          const base = getDefaultNoteTitle(subject);
          // Titles already in use, EXCLUDING the ones we are about to replace,
          // so a real user title is never overwritten and is respected when
          // choosing a number.
          const claimed = new Set<string>();
          for (const t of notes) {
            if (!needsTitleBackfillV15(t.title)) claimed.add(t.title.trim().toLowerCase());
          }
          const used = new Set(claimed);
          for (const t of notes) {
            if (!needsTitleBackfillV15(t.title)) continue;
            let next = base;
            let n = 2;
            while (used.has(next.trim().toLowerCase())) next = `${base} ${n++}`;
            used.add(next.trim().toLowerCase());
            // Only the label changes; `notes` and `contentHtml` ride along
            // untouched because the whole row is spread first.
            await tx.table('topics').put({ ...t, title: next, updatedAt: now });
          }
        }
      });
  }
}

export const db = new ProductivityDB();

/**
 * Enable cross-device sync.
 *
 * The URL comes from the committed `cloudConfig.ts` (NOT from the gitignored
 * `dexie-cloud.json`, which does not exist on the build server). Every table
 * syncs, `aiProviders` included, so a provider (and its key) is available on
 * every signed-in device; `UNSYNCED_TABLES` is currently empty. Blobs in
 * `resources` (uploaded files) use lazy offloading, so their bytes are uploaded
 * on first sync.
 */
db.cloud?.configure({
  databaseUrl: DEXIE_CLOUD_URL,
  unsyncedTables: [...UNSYNCED_TABLES],
  blobMode: BLOB_MODE,
  // This app ships its own service worker (vite-plugin-pwa generateSW) for
  // offline precaching. The addon's service-worker transport expects a
  // Dexie-Cloud-specific worker, so opt out and use plain fetch/WebSocket.
  tryUseServiceWorker: false,
});
