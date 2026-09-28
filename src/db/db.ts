import Dexie, { type Table } from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import type {
  AiProvider,
  Assessment,
  Subject,
  Topic,
  Resource,
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

export class ProductivityDB extends Dexie {
  subjects!: Table<Subject, string>;
  topics!: Table<Topic, string>;
  resources!: Table<Resource, string>;
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
  }
}

export const db = new ProductivityDB();

/**
 * Enable cross-device sync.
 *
 * The URL comes from the committed `cloudConfig.ts` (NOT from the gitignored
 * `dexie-cloud.json`, which does not exist on the build server). `aiProviders`
 * is excluded so API keys never leave the device. Blobs in `resources` (uploaded
 * files) use lazy offloading, so their bytes are uploaded on first sync.
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
