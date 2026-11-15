import type { MoveOutcome } from '@/feed/feedState';
import { authorName, messages } from '@/narration/buildNarration';
import type { Post, PostRef, RecordRef, ReplyParent, SocialAccount, SocialProvider } from '@/social/types';

import { agentMessages } from './agentMessages';
import { memoryRejection, type MemoryClient } from './memoryClient';
import { narrateForFeed, narratePost, type ReadMode } from './narrationAdapter';
import { describeFocus } from './postContext';
import { Publisher, type ConfirmOutcome, type Draft, type DraftOutcome, type UndoOutcome } from './publisher';
import { MAX_RATE, MIN_RATE, RATE_STEP, type NarrationSettings, type SettingsStore } from './settings';
import type { ToolName } from './tools';

export type ToolOutcome = {
  // Sent back to the model as a system message: "Result of <tool>: <result>".
  result: string;
  // Spoken word for word in the agent's voice, so posts and drafts are never reworded by the model.
  speak?: string;
  // Whether the model should answer the result; false when the app already said what was needed.
  respond: boolean;
  after?: 'end' | 'signIn' | 'countdown';
};

export type Conversation = {
  turn(): number;
  lastUtterance(): string;
  recentUtterances(): string[];
};

export type AgentDeps = {
  provider: SocialProvider;
  account(): SocialAccount | null;
  focused(): Post | null;
  move(direction: 'next' | 'previous'): { outcome: MoveOutcome; post: Post | null };
  description(post: Post): Promise<string | null>;
  settings: SettingsStore;
  memory: MemoryClient | null;
  conversation: Conversation;
  // Tells the model something happened outside a tool call, e.g. a post finished sending. With speak, the app
  // says those words itself and the model is told not to answer.
  notify(text: string, speak?: string): void;
  schedule(run: () => void, ms: number): () => void;
  newId(): string;
  now(): Date;
};

type UndoEntry = { label: string; undo(): Promise<string> };

// Kept on top of the history once the user's last confirmed action was stopped or removed, so another undo
// never reaches back to an earlier action.
const ALREADY_REMOVED: UndoEntry = { label: 'removed', undo: async () => 'NOTHING_TO_UNDO: The last action was already stopped or removed. Tell the user.' };

const NOT_SIGNED_IN =
  "NOT_SIGNED_IN: The user isn't signed in, so this can't be done. Tell them they need to sign in for that, and ask if they want to open the sign-in screen.";
const NO_FOCUS = 'NO_POST: No post is in focus. Tell the user there is no post to act on right now.';
const ACCOUNT_TOOLS = new Set<ToolName>(['like_post', 'unlike_post', 'draft_post', 'draft_reply', 'draft_repost', 'draft_delete_my_last_post', 'publish_draft']);

const normalized = (text: string) =>
  text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9#@\s]/g, ' ')
    .replace(/[#@]/g, '')
    .split(/\s+/)
    .filter(Boolean);

// The draft must be made of the user's own words: every word in it was said by the user recently.
export function usesOwnWords(text: string, utterances: string[]): boolean {
  const said = new Map<string, number>();
  for (const word of utterances.flatMap(normalized)) said.set(word, (said.get(word) ?? 0) + 1);
  return normalized(text).every((word) => {
    const left = said.get(word) ?? 0;
    if (!left) return false;
    said.set(word, left - 1);
    return true;
  });
}

const UNDO_WHILE_SENDING =
  'UNDO_WHILE_SENDING: It was already being sent. The app will remove it as soon as the send finishes and tell the user what happened. Say nothing.';

const REWORDED =
  "REWORDED: The draft must use the user's own words, with only punctuation and capitalization fixed. Call the draft tool again with exactly what they said, or ask them to say it again.";

function refusal(outcome: Extract<ConfirmOutcome, { ok: false }>, utterance: string): string {
  switch (outcome.reason) {
    case 'noDraft':
    case 'notReadBack':
      return 'REFUSED: There is no draft that was read back. Call a draft tool first.';
    case 'staleDraft':
      return 'REFUSED: That draft id is out of date. Use the draft id from the most recent draft result.';
    case 'sameTurn':
      return "REFUSED: The user hasn't answered the read-back yet. Wait for their answer.";
    case 'notAffirmative':
      return `REFUSED: The user's reply to the read-back was not a plain yes ("${utterance}"), so nothing was published and the draft is unchanged. If they asked for a change, make it with edit_draft, which reads the new draft back. Otherwise ask whether to go ahead.`;
    case 'expired':
      return "REREAD: The user's yes did not come right after the read-back, so the app read the draft aloud again and asked for a yes. Say nothing now. If the user's next reply is yes, call publish_draft again with the same draftId.";
    case 'alreadyPending':
      return 'REFUSED: Something is already about to be sent. Wait five seconds or let the user say undo.';
  }
}

export function createToolHandlers(deps: AgentDeps) {
  const history: UndoEntry[] = [];
  let lastUndoneAt = -Infinity;

  // An undo said while this send was in flight: the app removes what went out and says which happened.
  const undoneWhileSending = (speak: string) => {
    history.push(ALREADY_REMOVED);
    deps.notify(`Result of undo: ${speak} The app told the user. Say nothing.`, speak);
  };

  async function send(draft: Draft, undoRequested: () => boolean) {
    const { provider } = deps;
    try {
      if (draft.kind === 'repost' && draft.target) {
        const target = draft.target;
        const record = await provider.repost(target);
        if (undoRequested()) {
          await provider.unrepost(target, record);
          return undoneWhileSending(agentMessages.removedRepostAfterSend);
        }
        history.push({ label: 'repost', undo: async () => ((await provider.unrepost(target, record)) ? 'UNDONE: Removed the repost.' : 'NOTHING_TO_UNDO: It was not reposted.') });
        return deps.notify(`Result of publish_draft: SENT. Reposted ${authorName(target)}'s post. Confirm in a few words.`);
      }
      if (draft.kind === 'delete' && draft.target) {
        await provider.deletePost(draft.target);
        history.push({ label: 'delete', undo: async () => "CANNOT_UNDO: A deleted post can't be brought back. Tell the user." });
        if (undoRequested()) return deps.notify(`Result of undo: ${agentMessages.deletedBeforeUndo} The app told the user. Say nothing.`, agentMessages.deletedBeforeUndo);
        return deps.notify('Result of publish_draft: SENT. The post was deleted. Confirm in a few words.');
      }
      const refs: PostRef[] = [];
      let parent: ReplyParent | null = draft.kind === 'reply' && draft.target ? draft.target : null;
      const root = parent ? (parent.replyRoot ?? { uri: parent.uri, cid: parent.cid }) : null;
      for (const text of draft.parts) {
        if (undoRequested()) break;
        const ref = parent ? await provider.reply(parent, { text }) : await provider.createPost({ text });
        refs.push(ref);
        parent = { ...ref, replyRoot: root ?? refs[0] };
      }
      if (undoRequested()) {
        for (const ref of [...refs].reverse()) await provider.deletePost(ref);
        return undoneWhileSending(refs.length ? agentMessages.deletedAfterSend : agentMessages.stoppedBeforeSend);
      }
      history.push({
        label: draft.kind,
        undo: async () => {
          for (const ref of [...refs].reverse()) await provider.deletePost(ref);
          return `UNDONE: Deleted the ${draft.kind === 'reply' ? 'reply' : 'post'} that was just sent.`;
        },
      });
      deps.notify(`Result of publish_draft: SENT. The ${draft.kind === 'reply' ? 'reply was sent' : refs.length > 1 ? 'thread was posted' : 'post was published'}. Confirm in a few words.`);
    } catch (error) {
      history.push({ label: 'failed', undo: async () => "NOTHING_TO_UNDO: The last post didn't go out, so there is nothing to undo. Tell the user." });
      if (undoRequested()) return undoneWhileSending(agentMessages.failedBeforeUndo);
      deps.notify(`Result of publish_draft: FAILED. Nothing was published (${error instanceof Error ? error.message : 'unknown error'}). Tell the user it didn't work and they can try again.`);
    }
  }

  const publisher = new Publisher({ send, schedule: deps.schedule, newId: deps.newId, now: deps.now });

  function draftResult(outcome: DraftOutcome): ToolOutcome {
    if (outcome.ok) {
      return {
        speak: outcome.readBack,
        respond: false,
        result: `DRAFT_READ_BACK draftId="${outcome.draft.id}": The app read the draft aloud and asked for a yes. Say nothing now. If the user's next reply is yes, call publish_draft with this draftId. If they want changes, use edit_draft or discard_draft.`,
      };
    }
    switch (outcome.reason) {
      case 'tooLong':
        return {
          respond: true,
          result: `TOO_LONG: The draft is ${outcome.graphemes} characters and Bluesky allows 300. Split up, it would be a thread of ${outcome.parts} posts. Tell the user and offer two choices: say a shorter version, or split it into a thread. Nothing was read back or published.`,
        };
      case 'empty':
        return { respond: true, result: 'EMPTY: There are no words to post. Ask the user what they want to say.' };
      case 'notFound':
        return { respond: true, result: "NOT_FOUND: Those words aren't in the draft. Ask the user which words to change." };
      case 'notSplittable':
        return { respond: true, result: 'NOT_SPLITTABLE: Only a post or reply can be split.' };
      case 'noDraft':
        return { respond: true, result: 'NO_DRAFT: There is no draft right now.' };
    }
  }

  const settingsSummary = (settings: NarrationSettings) =>
    `speed ${settings.rate} times normal, ${settings.mode} reading, hashtags ${settings.skipHashtags ? 'skipped' : 'read'}, ${settings.pictureDetail} picture descriptions`;

  async function run(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
    const tool = name as ToolName;
    if (ACCOUNT_TOOLS.has(tool) && !deps.account()) return { respond: true, result: NOT_SIGNED_IN };
    const focus = deps.focused();
    const turn = deps.conversation.turn();
    const text = typeof args.text === 'string' ? args.text : '';
    if (tool !== 'publish_draft') publisher.interrupt();

    switch (tool) {
      case 'read_post': {
        if (!focus) return { respond: true, result: NO_FOCUS };
        const mode = (['full', 'brief', 'exact', 'hashtags', 'picture'] as const).includes(args.mode as ReadMode) ? (args.mode as ReadMode) : 'full';
        const speak = narratePost(focus, mode, deps.settings.get(), { now: deps.now(), description: await deps.description(focus) });
        return { speak, respond: false, result: "READ_ALOUD: The app read the post aloud. Don't repeat or reword it." };
      }
      case 'go_to_post': {
        const direction = args.direction === 'previous' ? 'previous' : 'next';
        const { outcome, post } = deps.move(direction);
        if (outcome !== 'moved' || !post) {
          const speak = outcome === 'atStart' ? messages.atStart : outcome === 'atEnd' ? messages.atEnd : messages.loading;
          return { speak, respond: false, result: `NOT_MOVED (${outcome}): The app told the user. Focus did not change.` };
        }
        return {
          speak: narrateForFeed(post, deps.settings.get(), await deps.description(post), deps.now()),
          respond: false,
          result: `MOVED: The app read the new post aloud. Don't repeat it. The post in focus is now: ${describeFocus(post, null, deps.now())}`,
        };
      }
      case 'like_post': {
        if (!focus) return { respond: true, result: NO_FOCUS };
        const record: RecordRef = await deps.provider.like(focus);
        history.push({ label: 'like', undo: async () => ((await deps.provider.unlike(focus, record)) ? 'UNDONE: Removed the like.' : 'NOTHING_TO_UNDO: It was not liked.') });
        return { respond: true, result: `LIKED: Liked ${authorName(focus)}'s post. Confirm in a word or two.` };
      }
      case 'unlike_post': {
        if (!focus) return { respond: true, result: NO_FOCUS };
        const removed = await deps.provider.unlike(focus);
        return { respond: true, result: removed ? 'UNLIKED: Removed the like. Confirm in a few words.' : "NOT_LIKED: This post wasn't liked. Tell the user." };
      }
      case 'draft_post':
      case 'draft_reply': {
        if (tool === 'draft_reply' && !focus) return { respond: true, result: NO_FOCUS };
        if (!usesOwnWords(text, deps.conversation.recentUtterances())) return { respond: true, result: REWORDED };
        return draftResult(publisher.draftText(tool === 'draft_post' ? 'post' : 'reply', text, tool === 'draft_reply' ? focus : null, turn));
      }
      case 'draft_repost':
        if (!focus) return { respond: true, result: NO_FOCUS };
        return draftResult(publisher.draftAction('repost', focus, turn));
      case 'draft_delete_my_last_post': {
        const mine = await deps.provider.getMyLatestPost();
        if (!mine) return { respond: true, result: "NO_POSTS: The user hasn't posted anything yet. Tell them." };
        return draftResult(publisher.draftAction('delete', mine, turn));
      }
      case 'edit_draft': {
        const replace = typeof args.replace === 'string' ? args.replace : '';
        if (!usesOwnWords(replace, deps.conversation.recentUtterances())) return { respond: true, result: REWORDED };
        return draftResult(publisher.edit(typeof args.find === 'string' ? args.find : '', replace, turn));
      }
      case 'split_draft':
        return draftResult(publisher.split(turn));
      case 'discard_draft':
        return { respond: true, result: publisher.discard() ? 'DISCARDED: The draft is gone and nothing was published. Confirm briefly.' : 'NO_DRAFT: There was no draft.' };
      case 'publish_draft': {
        const utterance = deps.conversation.lastUtterance();
        const outcome = publisher.confirm(typeof args.draftId === 'string' ? args.draftId : '', turn, utterance);
        if (!outcome.ok && outcome.reason === 'expired') return { speak: outcome.readBack, respond: false, result: refusal(outcome, utterance) };
        if (!outcome.ok) return { respond: true, result: refusal(outcome, utterance) };
        return {
          speak: outcome.announcement,
          respond: false,
          after: 'countdown',
          result: 'WAITING: The app told the user it sends in five seconds. Say nothing. If they say undo or stop, call undo. The app will tell you when it is sent.',
        };
      }
      case 'undo': {
        if (deps.now().getTime() - lastUndoneAt < 10_000) return { respond: false, result: 'ALREADY_UNDONE: The app already handled that undo and tells the user what happened. Say nothing.' };
        const undone = publisher.undo();
        if (undone?.state === 'stopped') {
          history.push(ALREADY_REMOVED);
          return { speak: agentMessages.undone, respond: false, result: 'UNDONE_BEFORE_SENDING: Nothing was sent. The app told the user.' };
        }
        if (undone?.state === 'sending') return { speak: agentMessages.undoWhileSending, respond: false, result: UNDO_WHILE_SENDING };
        if (publisher.discard()) return { respond: true, result: 'DISCARDED: The draft was thrown away; nothing was published. Confirm briefly.' };
        const entry = history.pop();
        if (!entry) return { respond: true, result: 'NOTHING_TO_UNDO: There is nothing to undo. Tell the user.' };
        return { respond: true, result: `${await entry.undo()} Confirm in a few words.` };
      }
      case 'change_narration': {
        const current = deps.settings.get();
        const patch: Partial<NarrationSettings> = {};
        if (typeof args.speed === 'number') patch.rate = args.speed;
        if (args.speedChange === 'faster') patch.rate = current.rate + RATE_STEP;
        if (args.speedChange === 'slower') patch.rate = current.rate - RATE_STEP;
        if (args.mode === 'full' || args.mode === 'brief') patch.mode = args.mode;
        if (typeof args.skipHashtags === 'boolean') patch.skipHashtags = args.skipHashtags;
        if (args.pictureDetail === 'short' || args.pictureDetail === 'long') patch.pictureDetail = args.pictureDetail;
        const next = await deps.settings.update(patch);
        const limit = patch.rate !== undefined && next.rate !== patch.rate ? ` The speed is limited to ${MIN_RATE} to ${MAX_RATE} times normal.` : '';
        return { respond: true, result: `SETTINGS_CHANGED: Now ${settingsSummary(next)}.${limit} Confirm in a few words.` };
      }
      case 'gesture_help':
        return { speak: messages.gestures, respond: false, result: "GESTURES_READ: The app read the gestures aloud. Don't repeat them." };
      case 'remember': {
        if (!deps.memory) return { respond: true, result: "MEMORY_UNAVAILABLE: Memory isn't available right now. Tell the user it wasn't saved." };
        const fact = typeof args.fact === 'string' ? args.fact : '';
        const othersText = focus && focus.author.id !== deps.account()?.id ? focus.text : null;
        const rejected = memoryRejection(fact, othersText);
        if (rejected) {
          return {
            respond: true,
            result: `NOT_REMEMBERED (${rejected}): Only short facts the user states about themselves can be remembered, never other people's posts, passwords or codes. Tell the user briefly.`,
          };
        }
        const memory = await deps.memory.remember(fact.trim());
        return { respond: true, result: `REMEMBERED [${memory.id}] ${memory.text} Confirm in a few words.` };
      }
      case 'recall_memories': {
        if (!deps.memory) return { respond: true, result: "MEMORY_UNAVAILABLE: Memory isn't available right now." };
        const memories = await deps.memory.list();
        return {
          respond: true,
          result: memories.length
            ? `MEMORIES:\n${memories.map((memory) => `- [${memory.id}] ${memory.text}`).join('\n')}\nTell the user briefly, without the ids.`
            : 'MEMORIES: Nothing is remembered yet. Tell the user.',
        };
      }
      case 'forget_memory': {
        if (!deps.memory) return { respond: true, result: "MEMORY_UNAVAILABLE: Memory isn't available right now." };
        const ids = Array.isArray(args.ids) ? args.ids.filter((id): id is string => typeof id === 'string') : [];
        if (!ids.length) return { respond: true, result: 'NOTHING_FORGOTTEN: No memory ids were given. Call recall_memories to find them.' };
        const forgotten = await deps.memory.forget(ids);
        return {
          respond: true,
          result: forgotten.length ? `FORGOTTEN: ${forgotten.map((memory) => memory.text).join(' ')} Confirm in a few words.` : 'NOTHING_FORGOTTEN: No matching memories were found.',
        };
      }
      case 'open_sign_in':
        return { respond: false, after: 'signIn', result: 'OPENING_SIGN_IN: The conversation ends now.' };
      case 'end_conversation':
        return { respond: false, after: 'end', result: 'ENDING: The conversation ends now.' };
      default:
        return { respond: true, result: `UNKNOWN_TOOL: There is no tool called ${name}.` };
    }
  }

  return {
    publisher,
    async run(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
      try {
        return await run(name, args);
      } catch (error) {
        return {
          respond: true,
          result: `FAILED: ${error instanceof Error ? error.message : 'Something went wrong'}. Nothing changed. Tell the user it didn't work and they can try again.`,
        };
      }
    },
    // Called when the app hears "undo" in the five seconds or during the send, before the model does.
    undoFromTranscript(): UndoOutcome {
      const undone = publisher.undo();
      if (undone) lastUndoneAt = deps.now().getTime();
      if (undone?.state === 'stopped') history.push(ALREADY_REMOVED);
      return undone;
    },
  };
}

export type ToolHandlers = ReturnType<typeof createToolHandlers>;
