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

import { deriveNoteTitle, needsTitleBackfill } from './noteTitle';

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
