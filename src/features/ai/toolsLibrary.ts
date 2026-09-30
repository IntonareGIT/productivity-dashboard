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
  listResourceGroups, moveResourceToGroup, renameResourceGroup, saveResource,
  saveResourceGroup, saveSubject, saveTopic, setTopicTitle,
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

const HANDLERS: Record<string, (a: Args) => Promise<ReturnType<typeof ok>>> = {
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
]);

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