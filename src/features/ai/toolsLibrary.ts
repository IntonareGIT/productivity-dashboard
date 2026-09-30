/**
 * Library write and delete tools for the assistant.
 *
 * Split out from `toolsExtended.ts` only for size. The rules this file exists to
 * enforce:
 *
 *   1. Every delete is confirmation gated. The gate lives in
 *      `useAssistantStore`: a name in CONFIRMATION_TOOL_NAMES is never executed
 *      on the model's say-so. It is held as a pending action until the user
 *      presses Confirm. The model calling the tool again does NOT perform it.
 *   2. Ids resolve by id first, then by a unique case-insensitive name. On
 *      ambiguity nothing is changed and the candidates are returned WITH their
 *      ids, so the model can ask which one instead of guessing.
 *   3. Results are plain data. Subject, topic and note text is content to report
 *      on, never instructions to follow.
 */
import { db } from '../../db/db';
import type { Resource, Subject, Topic } from '../../types';
import {
  deleteResource, deleteResourceGroup, deleteSubjectCascade, deleteTopicCascade,
  ensureDefaultTopic, listResourceGroups, moveResourceToGroup, renameResourceGroup,
  saveResource, saveResourceGroup, saveSubject, saveTopic, setTopicTitle,
} from '../library/libraryRepo';
import { ToolError } from './toolRuntime';
import { resolveByIdOrName, resolutionMessage } from './toolResolve';
import type { ToolSpec } from './types';

const ok = (summary: string, data: Record<string, unknown> = {}) => ({ ok: true as const, summary, data });

/** Throws the resolver's own message when nothing matched or it was ambiguous. */
function need<T extends { id: string }>(rows: T[], arg: unknown, nameOf: (r: T) => string, label: string): T {
  const r = resolveByIdOrName(rows, arg, nameOf, label);
  if ('row' in r) return r.row;
  throw new ToolError(resolutionMessage(r, label));
}

const subjectRows = () => db.subjects.toArray();
const topicRows = () => db.topics.toArray();
const resourceRows = () => db.resources.toArray();
const groupRows = () => db.resourceGroups.toArray();

export const LIBRARY_TOOL_SPECS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'setNoteTitle',
      description: "Set a note's title. Useful when the auto-derived title does not say what the note is about.",
      parameters: {
        type: 'object',
        properties: {
          topicId: { type: 'string', description: 'Topic id or exact title.' },
          title: { type: 'string', description: 'New note title. A blank title falls back to the default.' },
        },
        required: ['topicId', 'title'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createNote',
      description:
        'Create a new note in a subject (optionally inside a topic) and write markdown text into it.',
      parameters: {
        type: 'object',
        properties: {
          subjectId: { type: 'string', description: 'Subject id or exact name.' },
          topicId: { type: 'string', description: 'Optional topic id to put the note in.' },
          title: { type: 'string', description: 'Note title.' },
          content: { type: 'string', description: 'Markdown text for the note body.' },
        },
        required: ['subjectId', 'title'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'renameNote',
      description: "Rename an existing note.",
      parameters: {
        type: 'object',
        properties: {
          topicId: { type: 'string', description: 'Topic id or exact title.' },
          title: { type: 'string', description: 'New note title.' },
        },
        required: ['topicId', 'title'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteNote',
      description:
        'Permanently delete one note. The user must confirm before this runs, and the Confirm card names the note first.',
      parameters: {
        type: 'object',
        properties: { topicId: { type: 'string', description: 'Topic id or exact title.' } },
        required: ['topicId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listGroups',
      description: 'List the resource groups of one subject, with ids, names and how many resources each holds.',
      parameters: {
        type: 'object',
        properties: { subjectId: { type: 'string', description: 'Subject id or exact name.' } },
        required: ['subjectId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createGroup',
      description: 'Create an empty resource group in a subject.',
      parameters: {
        type: 'object',
        properties: {
          subjectId: { type: 'string', description: 'Subject id or exact name.' },
          name: { type: 'string', description: 'Group name.' },
        },
        required: ['subjectId', 'name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'renameGroup',
      description: 'Rename a resource group. The group id and its resources are unchanged.',
      parameters: {
        type: 'object',
        properties: {
          groupId: { type: 'string', description: 'Group id or exact current name.' },
          name: { type: 'string', description: 'New group name.' },
        },
        required: ['groupId', 'name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteGroup',
      description:
        'Delete a resource group. This UNGROUPS its resources; the resources themselves are kept and never deleted. The user must confirm before this runs.',
      parameters: {
        type: 'object',
        properties: { groupId: { type: 'string', description: 'Group id or exact name.' } },
        required: ['groupId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'moveResourceToGroup',
      description:
        'Put one resource into a group, or remove it from its group. Pass null for "No group". The group must belong to the same subject as the resource.',
      parameters: {
        type: 'object',
        properties: {
          resourceId: { type: 'string', description: 'Resource id or exact title.' },
          groupId: {
            type: 'string',
            description: 'Group id or exact name. Pass null or the string "null" to remove the group.',
          },
        },
        required: ['resourceId', 'groupId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'renameSubject',
      description: 'Rename an existing subject.',
      parameters: {
        type: 'object',
        properties: {
          subjectId: { type: 'string', description: 'Subject id or exact name.' },
          name: { type: 'string', description: 'New subject name.' },
        },
        required: ['subjectId', 'name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteSubject',
      description:
        'Permanently delete a subject and EVERYTHING under it: topics, resources including uploaded files, notes, resource groups and extracted PDF text. The user must confirm before this runs, and a Confirm card shows the counts first.',
      parameters: {
        type: 'object',
        properties: { subjectId: { type: 'string', description: 'Subject id or exact name.' } },
        required: ['subjectId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'renameTopic',
      description: 'Rename an existing topic.',
      parameters: {
        type: 'object',
        properties: {
          topicId: { type: 'string', description: 'Topic id or exact title.' },
          title: { type: 'string', description: 'New topic title.' },
        },
        required: ['topicId', 'title'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteTopic',
      description:
        'Permanently delete a topic and everything under it, including its resources and uploaded files. The user must confirm before this runs, and a Confirm card shows the counts first.',
      parameters: {
        type: 'object',
        properties: { topicId: { type: 'string', description: 'Topic id or exact title.' } },
        required: ['topicId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'renameResource',
      description: 'Rename a resource. Useful after uploading a file with a poor filename.',
      parameters: {
        type: 'object',
        properties: {
          resourceId: { type: 'string', description: 'Resource id or exact title.' },
          title: { type: 'string', description: 'New title.' },
        },
        required: ['resourceId', 'title'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'moveResource',
      description: 'Move a resource to a different topic. Any resource group assignment is cleared, because a group belongs to one subject.',
      parameters: {
        type: 'object',
        properties: {
          resourceId: { type: 'string', description: 'Resource id or exact title.' },
          topicId: { type: 'string', description: 'Destination topic id or exact title.' },
        },
        required: ['resourceId', 'topicId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteResource',
      description:
        'Permanently delete one resource and its uploaded file. The user must confirm before this runs, and a Confirm card names the resource first.',
      parameters: {
        type: 'object',
        properties: { resourceId: { type: 'string', description: 'Resource id or exact title.' } },
        required: ['resourceId'],
        additionalProperties: false,
      },
    },
  },
];

/* ---------------- Implementations ---------------- */

type Args = Record<string, unknown>;

/**
 * Counts of everything a cascade delete would remove, for the Confirm card.
 *
 * The brief requires the card to show WHAT will be lost, not just that
 * something will be. Counts are read live from the database at the moment the
 * card is built, so they cannot drift from the data the delete will act on.
 */
export interface DeleteCounts {
  topics: number;
  resources: number;
  files: number;
  notes: number;
  groups: number;
}

export async function subjectDeleteCounts(subjectId: string): Promise<DeleteCounts> {
  const topics = await db.topics.where('subjectId').equals(subjectId).toArray();
  const resources = await db.resources.where('subjectId').equals(subjectId).toArray();
  const groups = await db.resourceGroups.where('subjectId').equals(subjectId).toArray();
  return {
    topics: topics.length,
    resources: resources.length,
    // "files" counts uploads only, which are the things with bytes behind them.
    files: resources.filter((r) => r.kind === 'file').length,
    // A topic's note IS its body, so one note per topic with content.
    notes: topics.filter((t) => (t.notes ?? '').trim() || t.contentHtml).length,
    groups: groups.length,
  };
}

export async function topicDeleteCounts(topicId: string): Promise<DeleteCounts> {
  const resources = await db.resources.where('topicId').equals(topicId).toArray();
  const topic = await db.topics.get(topicId);
  return {
    topics: 1,
    resources: resources.length,
    files: resources.filter((r) => r.kind === 'file').length,
    notes: topic && ((topic.notes ?? '').trim() || topic.contentHtml) ? 1 : 0,
    groups: 0,
  };
}

/** Render counts as a short human sentence, omitting empty categories. */
export function formatDeleteCounts(c: DeleteCounts): string {
  const bits: string[] = [];
  if (c.topics) bits.push(`${c.topics} topic${c.topics === 1 ? '' : 's'}`);
  if (c.resources) bits.push(`${c.resources} resource${c.resources === 1 ? '' : 's'}`);
  if (c.files) bits.push(`${c.files} uploaded file${c.files === 1 ? '' : 's'}`);
  if (c.notes) bits.push(`${c.notes} note${c.notes === 1 ? '' : 's'}`);
  if (c.groups) bits.push(`${c.groups} group${c.groups === 1 ? '' : 's'}`);
  return bits.length ? bits.join(', ') : 'nothing else';
}

const HANDLERS: Record<string, (a: Args) => Promise<ReturnType<typeof ok>>> = {
  async setNoteTitle(a) {
    const title = String(a.title ?? '').trim();
    if (!title) throw new ToolError('A note needs a title. Nothing was changed.');
    const topic = need(await topicRows(), a.topicId, (t: Topic) => t.title, 'note');
    await setTopicTitle(topic.id, title);
    return ok(`Renamed the note "${topic.title}" to "${title}".`, { topicId: topic.id, title });
  },

  async createNote(a) {
    const title = String(a.title ?? '').trim();
    if (!title) throw new ToolError('A note needs a title. Nothing was changed.');
    const subject = need(await subjectRows(), a.subjectId, (s: Subject) => s.name, 'subject');
    let subjectId = subject.id;
    if (a.topicId) {
      // A note inside a named topic means writing into that topic's own note,
      // which is what `topicId` identifies in this app (notes ARE topics).
      const topic = need(await topicRows(), a.topicId, (t: Topic) => t.title, 'note');
      if (topic.subjectId !== subject.id) {
        throw new ToolError(`"${topic.title}" belongs to a different subject than "${subject.name}". Nothing was changed.`);
      }
      subjectId = topic.subjectId;
    } else {
      // No topic named, so put it in the subject's default topic rather than
      // inventing a topic the user did not ask for.
      await ensureDefaultTopic(subject.id);
    }
    const content = String(a.content ?? '');
    // `saveTopic` returns the new row's id.
    const id = await saveTopic({
      subjectId,
      title,
      notes: content,
      status: 'not_started',
    });
    return ok(`Created note "${title}" in "${subject.name}".`, { topicId: id, subjectId, title });
  },

  async renameNote(a) {
    const title = String(a.title ?? '').trim();
    if (!title) throw new ToolError('A note needs a title. Nothing was changed.');
    const topic = need(await topicRows(), a.topicId, (t: Topic) => t.title, 'note');
    await setTopicTitle(topic.id, title);
    return ok(`Renamed the note "${topic.title}" to "${title}".`, { topicId: topic.id, title });
  },

  async deleteNote(a) {
    const topic = need(await topicRows(), a.topicId, (t: Topic) => t.title, 'note');
    await deleteTopicCascade(topic.id);
    return ok(`Deleted the note "${topic.title}".`, { topicId: topic.id, title: topic.title });
  },

  async listGroups(a) {
    const subject = need(await subjectRows(), a.subjectId, (s: Subject) => s.name, 'subject');
    const groups = await listResourceGroups(subject.id);
    const resources = await db.resources.where('subjectId').equals(subject.id).toArray();
    return ok(
      `Subject "${subject.name}" has ${groups.length} group(s).`,
      {
        subjectId: subject.id,
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          resourceCount: resources.filter((r) => r.groupId === g.id).length,
        })),
      },
    );
  },

  async createGroup(a) {
    const name = String(a.name ?? '').trim();
    if (!name) throw new ToolError('A group needs a name. Nothing was changed.');
    const subject = need(await subjectRows(), a.subjectId, (s: Subject) => s.name, 'subject');
    const id = await saveResourceGroup({ subjectId: subject.id, name });
    return ok(`Created group "${name}" in "${subject.name}".`, { groupId: id, subjectId: subject.id, name });
  },

  async renameGroup(a) {
    const name = String(a.name ?? '').trim();
    if (!name) throw new ToolError('A group needs a name. Nothing was changed.');
    const groups = await groupRows();
    const group = need(groups, a.groupId, (g) => g.name, 'group');
    await renameResourceGroup(group.id, name);
    return ok(`Renamed group "${group.name}" to "${name}".`, { groupId: group.id, name });
  },

  async deleteGroup(a) {
    const group = need(await groupRows(), a.groupId, (g) => g.name, 'group');
    const members = (await db.resources.toArray()).filter((r) => r.groupId === group.id);
    // The delete ungroups; it never removes resources. The summary says so, so
    // the transcript can never imply that files were lost.
    await deleteResourceGroup(group.id);
    return ok(
      `Deleted group "${group.name}". ${members.length} resource(s) were kept and are now ungrouped.`,
      { groupId: group.id, ungrouped: members.length, deletedResources: 0 },
    );
  },

  async moveResourceToGroup(a) {
    const resources = await resourceRows();
    const resource = need(resources, a.resourceId, (r: Resource) => r.title, 'resource');
    const raw = a.groupId;
    const isNone = raw === null || raw === undefined
      || String(raw).toLowerCase() === 'null' || String(raw).trim() === '';
    if (isNone) {
      await moveResourceToGroup(resource.id, null);
      return ok(`Removed "${resource.title}" from its group.`, { resourceId: resource.id, groupId: null });
    }
    const group = need(await groupRows(), raw, (g) => g.name, 'group');
    if (group.subjectId !== resource.subjectId) {
      throw new ToolError(
        `"${group.name}" belongs to a different subject than "${resource.title}". Nothing was changed.`,
      );
    }
    await moveResourceToGroup(resource.id, group.id);
    return ok(`Moved "${resource.title}" into group "${group.name}".`, { resourceId: resource.id, groupId: group.id });
  },

  async renameSubject(a) {
    const name = String(a.name ?? '').trim();
    if (!name) throw new ToolError('A subject needs a name. Nothing was changed.');
    const subject = need(await subjectRows(), a.subjectId, (s: Subject) => s.name, 'subject');
    // saveSubject upserts, so reusing the id renames in place and keeps the
    // subject's topics, resources and notes.
    await saveSubject({ ...subject, name });
    return ok(`Renamed subject "${subject.name}" to "${name}".`, { subjectId: subject.id, name });
  },

  async deleteSubject(a) {
    const subject = need(await subjectRows(), a.subjectId, (s: Subject) => s.name, 'subject');
    await deleteSubjectCascade(subject.id);
    return ok(
      `Deleted subject "${subject.name}" and everything under it.`,
      { subjectId: subject.id, name: subject.name },
    );
  },

  async renameTopic(a) {
    const title = String(a.title ?? '').trim();
    if (!title) throw new ToolError('A topic needs a title. Nothing was changed.');
    const topic = need(await topicRows(), a.topicId, (t: Topic) => t.title, 'topic');
    await setTopicTitle(topic.id, title);
    return ok(`Renamed topic "${topic.title}" to "${title}".`, { topicId: topic.id, title });
  },

  async deleteTopic(a) {
    const topic = need(await topicRows(), a.topicId, (t: Topic) => t.title, 'topic');
    await deleteTopicCascade(topic.id);
    return ok(`Deleted topic "${topic.title}" and everything under it.`, { topicId: topic.id, title: topic.title });
  },

  async renameResource(a) {
    const title = String(a.title ?? '').trim();
    if (!title) throw new ToolError('A resource needs a title. Nothing was changed.');
    const resource = need(await resourceRows(), a.resourceId, (r: Resource) => r.title, 'resource');
    await saveResource({ ...resource, title });
    return ok(`Renamed resource "${resource.title}" to "${title}".`, { resourceId: resource.id, title });
  },

  async moveResource(a) {
    const resource = need(await resourceRows(), a.resourceId, (r: Resource) => r.title, 'resource');
    const topic = need(await topicRows(), a.topicId, (t: Topic) => t.title, 'topic');
    if (topic.subjectId !== resource.subjectId) {
      throw new ToolError(
        `"${topic.title}" is in a different subject than "${resource.title}". Move the resource to a topic in its own subject. Nothing was changed.`,
      );
    }
    // saveResource clears groupId when the subject changes; clearing it on a
    // cross-topic move as well keeps "a group belongs to one subject" honest.
    await saveResource({ ...resource, topicId: topic.id, groupId: null });
    return ok(
      `Moved "${resource.title}" to topic "${topic.title}".`,
      { resourceId: resource.id, topicId: topic.id, groupId: null },
    );
  },

  async deleteResource(a) {
    const resource = need(await resourceRows(), a.resourceId, (r: Resource) => r.title, 'resource');
    await deleteResource(resource.id);
    return ok(`Deleted resource "${resource.title}".`, { resourceId: resource.id, title: resource.title });
  },
};

/** Every name this module owns, so the store can wire them up in one place. */
export const LIBRARY_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(HANDLERS));

/** Names that must never run without an explicit UI Confirm. */
export const LIBRARY_CONFIRM_TOOL_NAMES: ReadonlySet<string> = new Set([
  'deleteSubject',
  'deleteTopic',
  'deleteResource',
  'deleteGroup',
  'deleteNote',
]);

/**
 * Counts for a gated delete, or null when the tool has nothing to cascade.
 *
 * The store calls this while BUILDING the Confirm card so the user sees what they
 * are about to lose, not merely that something will be deleted. It is read-only:
 * the counts describe the current data and the delete itself only runs later,
 * after Confirm.
 */
export async function describeDeleteCounts(name: string, args: Args): Promise<string | null> {
  // Resolve the target without importing the handlers' own guard, so a preview
  // can never throw: an unresolvable id simply yields no counts and the card
  // falls back to its plain description.
  const idOf = async (arg: unknown, subjects: Subject[] | Topic[] | null, label: string) => {
    if (!subjects) return null;
    const nameOf = (row: Subject | Topic): string => ('name' in row ? row.name : row.title);
    const r = resolveByIdOrName(
      subjects as (Subject | Topic)[],
      arg,
      nameOf,
      label,
    );
    return 'row' in r ? r.row.id : null;
  };

  if (name === 'deleteSubject') {
    const id = await idOf(args.subjectId, await subjectRows(), 'subject');
    if (!id) return null;
    return formatDeleteCounts(await subjectDeleteCounts(id));
  }
  if (name === 'deleteTopic' || name === 'deleteNote') {
    const id = await idOf(args.topicId, await topicRows(), 'note');
    if (!id) return null;
    return formatDeleteCounts(await topicDeleteCounts(id));
  }
  return null;
}

export async function executeLibraryTool(
  name: string,
  args: Args,
): Promise<ReturnType<typeof ok> | null> {
  const handler = HANDLERS[name];
  return handler ? handler(args) : null;
}

/** Wording for the Confirm card and the transcript. */
export function describeLibraryToolCall(name: string, args: Args): string {
  const s = (k: string) => String(args[k] ?? 'not given');
  switch (name) {
    case 'listGroups': return `List the resource groups of ${s('subjectId')}.`;
    case 'createGroup': return `Create a group “${s('name')}” in ${s('subjectId')}.`;
    case 'renameGroup': return `Rename group ${s('groupId')} to “${s('name')}”.`;
    case 'renameNote': return `Rename the note ${s('topicId')} to “${s('title')}”.`;
    case 'setNoteTitle': return `Set the title of note ${s('topicId')} to “${s('title')}”.`;
    case 'createNote':
      return `Create a note “${s('title')}” in ${s('subjectId')}`
        + `${args.topicId ? ` using topic ${s('topicId')}` : ' in its default topic'}.`;
    case 'deleteNote': return `PERMANENTLY DELETE the note ${s('topicId')}.`;
    case 'deleteGroup':
      return `Delete group ${s('groupId')}. Its resources are KEPT and become ungrouped.`;
    case 'moveResourceToGroup':
      return String(args.groupId) === 'null' || args.groupId === null || args.groupId === undefined
        ? `Remove ${s('resourceId')} from its group.`
        : `Move ${s('resourceId')} into group ${s('groupId')}.`;
    case 'renameSubject': return `Rename subject ${s('subjectId')} to “${s('name')}”.`;
    case 'deleteSubject':
      return `PERMANENTLY DELETE subject ${s('subjectId')} with all of its topics, resources, uploaded files, notes and groups.`;
    case 'renameTopic': return `Rename topic ${s('topicId')} to “${s('title')}”.`;
    case 'deleteTopic': return `PERMANENTLY DELETE topic ${s('topicId')} with its resources and uploaded files.`;
    case 'renameResource': return `Rename resource ${s('resourceId')} to “${s('title')}”.`;
    case 'moveResource': return `Move resource ${s('resourceId')} to topic ${s('topicId')}.`;
    case 'deleteResource': return `PERMANENTLY DELETE resource ${s('resourceId')} and its file.`;
    default: return `Run ${name}.`;
  }
}