import { writeFileSync } from 'node:fs';

import { ActionHistory } from '@/actions/history';
import { ConversationLog } from '@/agent/AgentSession';
import { settingsStore } from '@/agent/settings';
import { PreferencesStore } from '@/narration/preferences';
import { createToolHandlers, type ToolOutcome } from '@/agent/toolHandlers';
import { buildReplyScript } from '@/narration/comments';
import { BlueskyProvider } from '@/social/bluesky/BlueskyProvider';
import type { Post } from '@/social/types';
import { createMemoryStore } from '@/storage/keyValueStore';

// Real publishing through the agent's tool handlers against a Bluesky test account, then cleanup.
//   BLUESKY_TEST_HANDLE=... BLUESKY_TEST_APP_PASSWORD=... pnpm eval:bluesky
// Writes what happened (never the credentials) to EVAL_BLUESKY_LOG (default bluesky-eval.md).

const handle = process.env.BLUESKY_TEST_HANDLE ?? '';
const password = process.env.BLUESKY_TEST_APP_PASSWORD ?? '';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function check(condition: boolean, what: string) {
  if (!condition) throw new Error(`Check failed: ${what}`);
}

async function main() {
  if (!handle || !password) throw new Error('BLUESKY_TEST_HANDLE and BLUESKY_TEST_APP_PASSWORD are required');
  const provider = new BlueskyProvider({ store: createMemoryStore() });
  const account = await provider.signInWithAppPassword(handle, password);
  const conversation = new ConversationLog();
  const log: string[] = [];
  const notices: string[] = [];
  let focus: Post | null = null;
  let ids = 0;
  const handlers = createToolHandlers({
    provider,
    account: () => account,
    focused: () => focus,
    move: () => ({ outcome: 'atEnd', post: null }),
    feeds: { current: () => 'forYou', busy: () => false, switchTo: async () => null, refresh: async () => 0, toTop: () => null },
    description: async () => null,
    cachedDescription: () => null,
    loadedReplies: () => null,
    replies: async (post) => {
      const replies = await provider.getReplies(post.uri);
      return replies.map((reply, index) => buildReplyScript(reply, index, replies.length));
    },
    history: new ActionHistory(),
    mayNeedTranslation: () => false,
    translationState: () => null,
    settings: settingsStore(new PreferencesStore(createMemoryStore())),
    memory: null,
    conversation,
    notify: (text) => notices.push(text),
    schedule: (run, ms) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
    newId: () => `d${++ids}`,
    now: () => new Date(),
  });

  const step = async (utterance: string, tool: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> => {
    conversation.add(utterance);
    const outcome = await handlers.run(tool, args);
    log.push(`- User: "${utterance}" → \`${tool}\` → ${outcome.speak ? `app says "${outcome.speak}"; ` : ''}result ${outcome.result.split(/[:(]/)[0].trim()}`);
    if (outcome.after === 'countdown') {
      const started = Date.now();
      handlers.publisher.startCountdown();
      while (!notices.length) await pause(100);
      log.push(`  - after ${((Date.now() - started) / 1000).toFixed(1)} s the app tells the agent: ${notices.splice(0).join(' ')}`);
    }
    return outcome;
  };
  const draftId = (result: string) => result.match(/draftId="([^"]+)"/)?.[1] ?? '';

  const text = 'Hello from Juno, testing posting by voice. This post will be deleted in a minute.';
  const draft = await step(`post, ${text}`, 'draft_post', { text });
  await step('yes', 'publish_draft', { draftId: draftId(draft.result) });
  await pause(2000);
  const post = await provider.getMyLatestPost();
  check(post?.text === text, 'the post is on Bluesky with the exact words');
  log.push(`  - verified on Bluesky: ${post!.uri}`);

  focus = post;
  await step('like this', 'like_post');
  await step('undo', 'undo');

  const replyText = 'And this is a reply, also sent by voice.';
  const reply = await step(`reply, ${replyText}`, 'draft_reply', { text: replyText });
  await step('yes, send it', 'publish_draft', { draftId: draftId(reply.result) });
  await pause(2000);
  const sentReply = await provider.getMyLatestPost();
  check(sentReply?.text === replyText && sentReply.replyRoot?.uri === post!.uri, 'the reply is on Bluesky under the test post');
  log.push(`  - verified reply on Bluesky: ${sentReply!.uri}, replying to ${sentReply!.replyRoot!.uri}`);

  await step('undo', 'undo');
  await pause(2000);
  check((await provider.getMyLatestPost())?.uri === post!.uri, 'undo deleted the reply');
  log.push('  - verified: the reply is gone and the test post is the latest again');

  const del = await step('delete my last post', 'draft_delete_my_last_post');
  await step('yes, delete it', 'publish_draft', { draftId: draftId(del.result) });
  await pause(2000);
  const left = await provider.getMyLatestPost();
  check(left?.uri !== post!.uri, 'the test post was deleted');
  log.push(`  - verified: the test post is deleted; the latest post is now ${left ? left.uri : 'none'}`);

  writeFileSync(process.env.EVAL_BLUESKY_LOG ?? 'bluesky-eval.md', `Account: @${account.handle}\n\n${log.join('\n')}\n`);
  console.log(log.join('\n'));
  await provider.signOut();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
