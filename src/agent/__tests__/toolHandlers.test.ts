import { messages, type DescriptionParts, type DetailLevel } from '@/narration/buildNarration';
import type { Post } from '@/social/types';
import { makeMemory, makeProvider, maya, nextPost, setup } from '@/testing/agent';
import { makePost } from '@/testing/fixtures';

import { agentMessages } from '../agentMessages';
import { UNDO_WINDOW_MS } from '../publisher';
import { toolNames } from '../tools';
import { PICTURE_WAIT_MS, TOOL_CEILING_MS, TRANSCRIPT_WAIT_MS, usesOwnWords } from '../toolHandlers';

const draftIdOf = (result: string) => result.match(/draftId="([^"]+)"/)?.[1] ?? '';

describe('agent tools', () => {
  it('handles every tool the assistant is given', async () => {
    const { handlers, say } = setup();
    for (const name of toolNames) {
      say(name);
      expect((await handlers.run(name, {})).result).not.toMatch(/^UNKNOWN_TOOL/);
    }
    expect((await handlers.run('fly_away', {})).result).toMatch(/^UNKNOWN_TOOL/);
  });

  it('reads the post in focus aloud through the app in each mode', async () => {
    const { handlers, settings } = setup();
    const full = await handlers.run('read_post', { mode: 'full' });
    expect(full).toMatchObject({ respond: false, result: expect.stringMatching(/^READ_ALOUD/) });
    expect(full.speak).toBe('Maya, 2 hours ago. Meet our new puppy Biscuit! One image: A golden puppy asleep on a red blanket. Its paws twitch. Tagged puppy and dogsofbluesky.');
    expect((await handlers.run('read_post', { mode: 'brief' })).speak).toBe('Maya. Meet our new puppy Biscuit! Has an image and two hashtags.');
    expect((await handlers.run('read_post', { mode: 'exact' })).speak).toBe('Maya wrote, word for word: Meet our new puppy Biscuit! #puppy #dogsofbluesky');
    expect((await handlers.run('read_post', { mode: 'hashtags' })).speak).toBe('2 hashtags: puppy, dogsofbluesky.');
    expect((await handlers.run('read_post', { mode: 'picture' })).speak).toBe('Maya. One image: A golden puppy asleep on a red blanket. Its paws twitch.');
    await settings.update({ skipHashtags: true, pictureDetail: 'long' });
    expect((await handlers.run('read_post', { mode: 'full' })).speak).toBe(
      'Maya, 2 hours ago. Meet our new puppy Biscuit! One image: A golden puppy asleep on a red blanket. Its paws twitch.',
    );
  });

  it('asks for a description only when the reading uses one, at the detail the reading needs', async () => {
    const { handlers, deps, settings } = setup();
    const description = jest.fn(async (_post: Post, _detail: DetailLevel) => null);
    deps.description = description;
    await handlers.run('read_post', { mode: 'brief' });
    await handlers.run('read_post', { mode: 'exact' });
    expect(description).not.toHaveBeenCalled();
    await handlers.run('read_post', { mode: 'full' });
    await handlers.run('read_post', { mode: 'picture' });
    await settings.update({ pictureDetail: 'long' });
    await handlers.run('read_post', { mode: 'full' });
    expect(description.mock.calls.map(([, detail]) => detail)).toEqual(['standard', 'detailed', 'detailed']);
  });

  it('says there is no post when nothing is in focus', async () => {
    const { handlers } = setup({ focus: null });
    expect((await handlers.run('read_post', { mode: 'full' })).result).toMatch(/^NO_POST/);
    expect((await handlers.run('like_post', {})).result).toMatch(/^NO_POST/);
  });

  it('moves focus and reads the new post, or says why it cannot', async () => {
    const { handlers, focus } = setup();
    const next = await handlers.run('go_to_post', { direction: 'next' });
    expect(next.speak).toMatch(/Second post here\./);
    expect(next.result).toMatch(/^MOVED/);
    expect(focus()).toBe(nextPost);
    expect(await handlers.run('go_to_post', { direction: 'previous' })).toMatchObject({ speak: messages.atStart, respond: false });
  });

  it('likes without confirmation and undoes the like', async () => {
    const { handlers, provider } = setup();
    expect((await handlers.run('like_post', {})).result).toBe("LIKED: Liked Maya's post. Confirm in a word or two.");
    expect(provider.like).toHaveBeenCalledWith(maya);
    expect((await handlers.run('undo', {})).result).toMatch(/^UNDONE: Removed the like/);
    expect(provider.unlike).toHaveBeenCalledWith(maya, { uri: 'at://me/like/1' });
    expect((await handlers.run('undo', {})).result).toMatch(/^NOTHING_TO_UNDO/);
  });

  it('unlikes, and says so when the post was not liked', async () => {
    const provider = makeProvider({ unlike: jest.fn(async () => false) });
    const { handlers } = setup({ provider });
    expect((await handlers.run('unlike_post', {})).result).toMatch(/^NOT_LIKED/);
  });

  it('reposts only after the read-back and a yes, then can undo it', async () => {
    const { handlers, provider, say, scheduler, notify } = setup();
    say('repost this');
    const draft = await handlers.run('draft_repost', {});
    expect(draft.speak).toMatch(/^Reposting Maya's post/);
    say('yes');
    expect(await handlers.run('publish_draft', { draftId: draftIdOf(draft.result) })).toMatchObject({ speak: "Reposting Maya's post in five seconds. Say undo to stop it.", after: 'countdown' });
    handlers.publisher.startCountdown();
    await scheduler.advance(UNDO_WINDOW_MS);
    expect(provider.repost).toHaveBeenCalledWith(maya);
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/SENT\. Reposted Maya's post/));
    expect((await handlers.run('undo', {})).result).toMatch(/^UNDONE: Removed the repost/);
    expect(provider.unrepost).toHaveBeenCalledWith(maya, { uri: 'at://me/repost/1' });
  });

  it('replies to the post in focus in the user\'s words', async () => {
    const { handlers, provider, say, scheduler } = setup();
    say("reply, that's beautiful, where was this?");
    const draft = await handlers.run('draft_reply', { text: "That's beautiful, where was this?" });
    expect(draft).toMatchObject({ respond: false, speak: expect.stringMatching(/^Replying to Maya's post that starts "Meet our new puppy/) });
    say('Yes.');
    await handlers.run('publish_draft', { draftId: draftIdOf(draft.result) });
    handlers.publisher.startCountdown();
    await scheduler.advance(UNDO_WINDOW_MS);
    expect(provider.reply).toHaveBeenCalledWith(maya, { text: "That's beautiful, where was this?" });
  });

  it('refuses a draft that rewords what the user said', async () => {
    const { handlers, say } = setup();
    say('post hello from my new app');
    expect((await handlers.run('draft_post', { text: 'Greetings from my brand new application!' })).result).toMatch(/^REWORDED/);
    expect((await handlers.run('draft_post', { text: 'Hello from my new app.' })).result).toMatch(/^DRAFT_READ_BACK/);
  });

  it('refuses to publish without a yes in a later turn', async () => {
    const { handlers, say, provider, scheduler } = setup();
    say('post hello from my new app');
    const draft = await handlers.run('draft_post', { text: 'Hello from my new app.' });
    const id = draftIdOf(draft.result);
    const early = handlers.run('publish_draft', { draftId: id });
    await scheduler.advance(TRANSCRIPT_WAIT_MS);
    expect((await early).result).toMatch(/^REFUSED: The user hasn't answered/);
    say('hmm, not sure');
    expect((await handlers.run('publish_draft', { draftId: id })).result).toMatch(/^REFUSED: The user's reply to the read-back was not a plain yes/);
    expect((await handlers.run('publish_draft', { draftId: 'nope' })).result).toMatch(/out of date/);
    expect(provider.createPost).not.toHaveBeenCalled();
  });

  it('posts after five seconds, and undo inside the window sends nothing', async () => {
    const { handlers, say, provider, scheduler } = setup();
    say('post hello from my new app');
    const draft = await handlers.run('draft_post', { text: 'Hello from my new app.' });
    say('yes');
    await handlers.run('publish_draft', { draftId: draftIdOf(draft.result) });
    handlers.publisher.startCountdown();
    await scheduler.advance(3000);
    expect(await handlers.run('undo', {})).toMatchObject({ speak: 'Stopped. Nothing was sent.', respond: false });
    await scheduler.advance(10_000);
    expect(provider.createPost).not.toHaveBeenCalled();
  });

  it('undoes a sent post by deleting it, and a heard undo is not repeated by the model', async () => {
    const { handlers, say, provider, scheduler } = setup();
    say('post hello from my new app');
    const draft = await handlers.run('draft_post', { text: 'Hello from my new app.' });
    say('yes');
    await handlers.run('publish_draft', { draftId: draftIdOf(draft.result) });
    handlers.publisher.startCountdown();
    await scheduler.advance(UNDO_WINDOW_MS);
    expect(provider.createPost).toHaveBeenCalledWith({ text: 'Hello from my new app.' });
    expect((await handlers.run('undo', {})).result).toMatch(/^UNDONE: Deleted the post/);
    expect(provider.deletePost).toHaveBeenCalledWith({ uri: 'at://me/post/1', cid: 'cid-1' });

    say('post second try');
    const again = await handlers.run('draft_post', { text: 'Second try.' });
    say('yes');
    await handlers.run('publish_draft', { draftId: draftIdOf(again.result) });
    handlers.publisher.startCountdown();
    say('undo');
    expect(handlers.heard('undo')).toMatchObject({ kind: 'undone', speak: 'Stopped. Nothing was sent.' });
    expect(await handlers.run('undo', {})).toMatchObject({ respond: false, result: expect.stringMatching(/^ALREADY_UNDONE/) });
    await scheduler.advance(UNDO_WINDOW_MS);
    expect(provider.createPost).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft when the reply to the read-back is more than a yes, and reads it back again after anything else', async () => {
    const { handlers, say, provider } = setup();
    say('post hello from my new app');
    const draft = await handlers.run('draft_post', { text: 'Hello from my new app.' });
    const id = draftIdOf(draft.result);
    say('sure, but change it to goodbye');
    expect((await handlers.run('publish_draft', { draftId: id })).result).toMatch(/^REFUSED: .*not a plain yes.*edit_draft/);
    say('yes');
    const told = await handlers.run('publish_draft', { draftId: id });
    expect(told).toMatchObject({ speak: 'Say "post it" to send it, or "cancel".', respond: false, result: expect.stringMatching(/^NOT_SENT_YET/) });
    say('please like it');
    await handlers.run('like_post', {});
    say('yes');
    expect(await handlers.run('publish_draft', { draftId: id })).toMatchObject({
      speak: 'I\'ll keep it as a draft and stop asking. Say "post it" whenever you\'re ready, or "cancel".',
      result: expect.stringMatching(/^DRAFT_KEPT/),
    });
    say('post it please');
    expect(await handlers.run('publish_draft', { draftId: id })).toMatchObject({ after: 'countdown' });
    expect(provider.createPost).not.toHaveBeenCalled();
  });

  it('removes the confirmed post when undo comes while it is being sent, and leaves the earlier like alone', async () => {
    let finishSend: () => void = () => undefined;
    const provider = makeProvider({
      createPost: jest.fn(() => new Promise((resolve) => (finishSend = () => resolve({ uri: 'at://me/post/1', cid: 'cid-1' })))),
    });
    const { handlers, say, scheduler, notify } = setup({ provider });
    say('like this');
    await handlers.run('like_post', {});
    say('post hello from my new app');
    const draft = await handlers.run('draft_post', { text: 'Hello from my new app.' });
    say('yes');
    await handlers.run('publish_draft', { draftId: draftIdOf(draft.result) });
    handlers.publisher.startCountdown();
    await scheduler.advance(UNDO_WINDOW_MS);
    expect(provider.createPost).toHaveBeenCalledTimes(1);
    say('undo');
    expect(await handlers.run('undo', {})).toMatchObject({ speak: "One moment, it's going out right now.", respond: false, result: expect.stringMatching(/^UNDO_WHILE_SENDING/) });
    finishSend();
    await scheduler.advance(0);
    expect(provider.deletePost).toHaveBeenCalledWith({ uri: 'at://me/post/1', cid: 'cid-1' });
    expect(notify).toHaveBeenLastCalledWith(expect.stringMatching(/^Result of undo: It had gone out, so I deleted it\./), 'It had gone out, so I deleted it.');
    expect((await handlers.run('undo', {})).result).toMatch(/^NOTHING_TO_UNDO: The last action was already stopped or removed/);
    expect(provider.unlike).not.toHaveBeenCalled();
  });

  it('undoes the post, not the earlier like, when the send returns before the undo', async () => {
    const { handlers, say, provider, scheduler } = setup();
    say('like this');
    await handlers.run('like_post', {});
    say('post hello from my new app');
    const draft = await handlers.run('draft_post', { text: 'Hello from my new app.' });
    say('yes');
    await handlers.run('publish_draft', { draftId: draftIdOf(draft.result) });
    handlers.publisher.startCountdown();
    await scheduler.advance(UNDO_WINDOW_MS);
    say('undo');
    expect((await handlers.run('undo', {})).result).toMatch(/^UNDONE: Deleted the post/);
    expect(provider.deletePost).toHaveBeenCalledWith({ uri: 'at://me/post/1', cid: 'cid-1' });
    expect(provider.unlike).not.toHaveBeenCalled();
  });

  it('stops a thread before it goes out when undo comes before the first part is sent, and never undoes an earlier action after a failed send', async () => {
    const failing = makeProvider({ createPost: jest.fn(async () => Promise.reject(new Error('offline'))) });
    const { handlers, say, scheduler, notify } = setup({ provider: failing });
    say('like this');
    await handlers.run('like_post', {});
    say('post hello');
    const draft = await handlers.run('draft_post', { text: 'Hello' });
    say('yes');
    await handlers.run('publish_draft', { draftId: draftIdOf(draft.result) });
    handlers.publisher.startCountdown();
    await scheduler.advance(UNDO_WINDOW_MS);
    expect(notify).toHaveBeenLastCalledWith(expect.stringMatching(/^Result of publish_draft: FAILED/));
    say('undo');
    expect((await handlers.run('undo', {})).result).toMatch(/^NOTHING_TO_UNDO: The last post didn't go out/);
    expect(failing.unlike).not.toHaveBeenCalled();
  });

  it('confirms only with a verb that fits the draft, and reads it back again otherwise', async () => {
    const mine = makePost({ uri: 'at://me/post/9', cid: 'c9', text: 'Old news', createdAt: '2026-11-15T11:00:00.000Z' });
    const { handlers, say, provider } = setup({ provider: makeProvider({ getMyLatestPost: jest.fn(async () => mine) }) });
    say('post hello from my new app');
    const post = await handlers.run('draft_post', { text: 'Hello from my new app.' });
    say('yes, delete it');
    expect(await handlers.run('publish_draft', { draftId: draftIdOf(post.result) })).toMatchObject({
      speak: 'Say "post it" to send it, or "cancel".',
      result: expect.stringMatching(/^NOT_SENT_YET: Nothing was published, because "yes, delete it" doesn't fit this draft/),
    });
    say('send it');
    expect(await handlers.run('publish_draft', { draftId: draftIdOf(post.result) })).toMatchObject({ after: 'countdown' });
    handlers.publisher.cancelPending();

    say('delete my last post');
    const del = await handlers.run('draft_delete_my_last_post', {});
    say('send it');
    expect((await handlers.run('publish_draft', { draftId: draftIdOf(del.result) })).result).toMatch(/^NOT_SENT_YET/);
    say('remove it');
    expect(await handlers.run('publish_draft', { draftId: draftIdOf(del.result) })).toMatchObject({ after: 'countdown' });
    handlers.publisher.cancelPending();
    expect(provider.createPost).not.toHaveBeenCalled();
    expect(provider.deletePost).not.toHaveBeenCalled();
  });

  it('holds the send and reads the draft back when the user says more than yes during the five seconds', async () => {
    const { handlers, say, provider, scheduler } = setup();
    say('post hello from my new app');
    const draft = await handlers.run('draft_post', { text: 'Hello from my new app.' });
    say('Yes.');
    await handlers.run('publish_draft', { draftId: draftIdOf(draft.result) });
    handlers.publisher.startCountdown();
    await scheduler.advance(2000);
    say('Yes please.');
    expect(handlers.heard('Yes please.')).toBeNull();
    say('But change it to goodbye.');
    expect(handlers.heard('But change it to goodbye.')).toMatchObject({
      kind: 'held',
      speak: 'I stopped it, nothing was sent. Posting to your followers: Hello from my new app. Shall I post it?',
      message: expect.stringMatching(/^HELD draftId="d1": .*edit_draft/),
    });
    await scheduler.advance(20_000);
    expect(provider.createPost).not.toHaveBeenCalled();
    say('change it to goodbye');
    expect((await handlers.run('edit_draft', { find: 'Hello from my new app', replace: 'goodbye' })).speak).toBe('Posting to your followers: goodbye. Shall I post it?');
  });

  it('lets a plain thanks or okay during the five seconds pass without holding the send', async () => {
    const { handlers, say, provider, scheduler } = setup();
    say('post hello from my new app');
    const draft = await handlers.run('draft_post', { text: 'Hello from my new app.' });
    say('yes');
    await handlers.run('publish_draft', { draftId: draftIdOf(draft.result) });
    handlers.publisher.startCountdown();
    for (const said of ['thanks', 'Thank you!', 'Okay.', 'great', 'Great, thanks.']) {
      say(said);
      expect([said, handlers.heard(said)]).toEqual([said, null]);
    }
    await scheduler.advance(UNDO_WINDOW_MS);
    expect(provider.createPost).toHaveBeenCalledTimes(1);

    say('post second try');
    const again = await handlers.run('draft_post', { text: 'Second try.' });
    say('yes');
    await handlers.run('publish_draft', { draftId: draftIdOf(again.result) });
    handlers.publisher.startCountdown();
    say('thanks, but add a smiley');
    expect(handlers.heard('thanks, but add a smiley')).toMatchObject({ kind: 'held' });
  });

  it('says truthfully that a post went out when removing it after an undo fails, and keeps it undoable', async () => {
    let finishSend: () => void = () => undefined;
    const provider = makeProvider({
      createPost: jest.fn(() => new Promise((resolve) => (finishSend = () => resolve({ uri: 'at://me/post/1', cid: 'cid-1' })))),
      deletePost: jest.fn(async () => Promise.reject(new Error('offline'))),
    });
    const { handlers, say, scheduler, notify } = setup({ provider });
    say('post hello from my new app');
    const draft = await handlers.run('draft_post', { text: 'Hello from my new app.' });
    say('yes');
    await handlers.run('publish_draft', { draftId: draftIdOf(draft.result) });
    handlers.publisher.startCountdown();
    await scheduler.advance(UNDO_WINDOW_MS);
    say('undo');
    expect(handlers.heard('undo')).toMatchObject({ kind: 'undone', speak: "One moment, it's going out right now." });
    finishSend();
    await scheduler.advance(0);
    expect(provider.deletePost).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith(expect.stringMatching(/^Result of undo: REMOVE_FAILED\. It is public\./), "It went out, and I couldn't remove it. Say delete my last post to remove it.");
    provider.deletePost.mockResolvedValueOnce(undefined);
    expect((await handlers.run('undo', {})).result).toMatch(/^UNDONE: Deleted the post/);
  });

  it('catches drafts over 300 characters and publishes a split thread only after a new read-back', async () => {
    const { handlers, say, provider, scheduler } = setup();
    const words = Array.from({ length: 70 }, (_, i) => `word${i}`).join(' ');
    say(`post ${words}`);
    const long = await handlers.run('draft_post', { text: words });
    expect(long).toMatchObject({ respond: true, result: expect.stringMatching(/^TOO_LONG: The draft is 479 characters and Bluesky allows 300\. Split up, it would be a thread of 2 posts/) });
    expect(long.speak).toBeUndefined();
    say('yes');
    expect((await handlers.run('publish_draft', { draftId: 'd1' })).result).toMatch(/^REFUSED: There is no draft that was read back/);
    say('split it');
    const split = await handlers.run('split_draft', {});
    expect(split.speak).toMatch(/^Posting to your followers: This will be a thread of 2 posts\./);
    say('yes');
    await handlers.run('publish_draft', { draftId: draftIdOf(split.result) });
    handlers.publisher.startCountdown();
    await scheduler.advance(UNDO_WINDOW_MS);
    expect(provider.createPost).toHaveBeenCalledTimes(1);
    expect(provider.reply).toHaveBeenCalledWith(expect.objectContaining({ uri: 'at://me/post/1', replyRoot: { uri: 'at://me/post/1', cid: 'cid-1' } }), expect.anything());
  });

  it('changes words in a draft, starts over and cancels', async () => {
    const { handlers, say, scheduler } = setup();
    say('post going to the park today');
    await handlers.run('draft_post', { text: 'Going to the park today.' });
    say('change park to beach');
    expect((await handlers.run('edit_draft', { find: 'park', replace: 'beach' })).speak).toBe('Posting to your followers: Going to the beach today. Shall I post it?');
    const reworded = handlers.run('edit_draft', { find: 'beach', replace: 'moon base' });
    await scheduler.advance(TRANSCRIPT_WAIT_MS);
    expect((await reworded).result).toMatch(/^REWORDED/);
    say('cancel it');
    expect((await handlers.run('discard_draft', {})).result).toMatch(/^DISCARDED/);
    expect((await handlers.run('discard_draft', {})).result).toMatch(/^NO_DRAFT/);
  });

  it('prepares deleting my last post and deletes it after a yes', async () => {
    const mine = makePost({ uri: 'at://me/post/9', cid: 'c9', text: 'Old news', createdAt: '2026-11-15T11:00:00.000Z' });
    const provider = makeProvider({ getMyLatestPost: jest.fn(async () => mine) });
    const { handlers, say, scheduler } = setup({ provider });
    say('delete my last post');
    const draft = await handlers.run('draft_delete_my_last_post', {});
    expect(draft.speak).toBe("Deleting your post from 1 hour ago: Old news. A deleted post can't be brought back. Shall I delete it?");
    say('yes delete it');
    expect((await handlers.run('publish_draft', { draftId: draftIdOf(draft.result) })).speak).toBe('Deleting your post in five seconds. Say undo to stop it.');
    handlers.publisher.startCountdown();
    await scheduler.advance(UNDO_WINDOW_MS);
    expect(provider.deletePost).toHaveBeenCalledWith(mine);
    expect((await handlers.run('undo', {})).result).toMatch(/^CANNOT_UNDO/);
    const none = setup({ provider: makeProvider() });
    expect((await none.handlers.run('draft_delete_my_last_post', {})).result).toMatch(/^NO_POSTS/);
  });

  it('tells a signed-out user to sign in instead of failing silently', async () => {
    const { handlers, provider, say } = setup({ signedIn: false });
    say('post hello');
    for (const name of ['like_post', 'unlike_post', 'draft_post', 'draft_reply', 'draft_repost', 'draft_delete_my_last_post', 'publish_draft']) {
      const outcome = await handlers.run(name, { text: 'Hello', draftId: 'd1' });
      expect(outcome).toMatchObject({ respond: true, result: expect.stringMatching(/^NOT_SIGNED_IN: .*open the sign-in screen/) });
    }
    expect(provider.like).not.toHaveBeenCalled();
    expect(provider.createPost).not.toHaveBeenCalled();
    expect(await handlers.run('open_sign_in', {})).toMatchObject({ after: 'signIn' });
    expect((await handlers.run('read_post', { mode: 'brief' })).speak).toMatch(/^Maya/);
  });

  it('changes speech rate and narration mode within limits', async () => {
    const { handlers, settings } = setup();
    expect((await handlers.run('change_narration', { speedChange: 'faster' })).result).toMatch(/^SETTINGS_CHANGED: Now speed 1.25 times normal/);
    expect((await handlers.run('change_narration', { speed: 5 })).result).toMatch(/speed 3 times normal.*limited to 0.5 to 3/);
    await handlers.run('change_narration', { mode: 'brief', skipHashtags: true, pictureDetail: 'long' });
    expect(settings.get()).toEqual({ rate: 3, mode: 'brief', skipHashtags: true, pictureDetail: 'long' });
  });

  it('says which step a speed between steps was set to', async () => {
    const { handlers, settings } = setup();
    expect((await handlers.run('change_narration', { speed: 1.3 })).result).toMatch(/^SETTINGS_CHANGED: Now speed 1.25 times normal.* Speeds go in steps of 0.25, so 1.3 was set to 1.25, the nearest step/);
    expect(settings.get().rate).toBe(1.25);
    expect((await handlers.run('change_narration', { speed: 2 })).result).not.toMatch(/steps|limited/);
  });

  it('repeats the gesture help word for word', async () => {
    const { handlers } = setup();
    expect(await handlers.run('gesture_help', {})).toMatchObject({ speak: messages.gestures, respond: false });
  });

  it('remembers, recalls and forgets what the user states', async () => {
    const memory = makeMemory();
    const { handlers } = setup({ memory });
    expect((await handlers.run('remember', { fact: 'Call the user Sam.' })).result).toBe('REMEMBERED [fact_1] Call the user Sam. Confirm in a few words.');
    expect((await handlers.run('recall_memories', {})).result).toBe('MEMORIES:\n- [fact_1] Call the user Sam.\nTell the user briefly, without the ids.');
    expect((await handlers.run('forget_memory', { ids: ['fact_1'] })).result).toBe('FORGOTTEN: Call the user Sam. Confirm in a few words.');
    expect((await handlers.run('recall_memories', {})).result).toMatch(/Nothing is remembered/);
  });

  it('never stores credentials or other people\'s posts', async () => {
    const memory = makeMemory();
    const { handlers } = setup({ memory });
    expect((await handlers.run('remember', { fact: 'My app password is abcd-efgh-ijkl-mnop' })).result).toMatch(/^NOT_REMEMBERED \(credential\)/);
    expect((await handlers.run('remember', { fact: 'The user likes: meet our new puppy Biscuit puppy' })).result).toMatch(/^NOT_REMEMBERED \(othersContent\)/);
    expect(memory.remember).not.toHaveBeenCalled();
    const offline = setup({ memory: null });
    expect((await offline.handlers.run('remember', { fact: 'Call me Sam' })).result).toMatch(/^MEMORY_UNAVAILABLE/);
  });

  it('ends the conversation', async () => {
    const { handlers } = setup();
    expect(await handlers.run('end_conversation', {})).toMatchObject({ after: 'end' });
  });

  it('reports a failed action plainly', async () => {
    const provider = makeProvider({ like: jest.fn(async () => Promise.reject(new Error('Network down'))) });
    const { handlers } = setup({ provider });
    expect((await handlers.run('like_post', {})).result).toMatch(/^FAILED: Network down\. Nothing changed/);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const hang = () => new Promise<never>(() => undefined);
const collar = { images: [{ description: 'A golden puppy on a red blanket.', beyondAlt: 'Biscuit wears a blue collar.' }], video: null, hashtagTopic: null };

describe('agent reads without waiting on the network', () => {
  it('reads at once without a description it does not have, and says it if it lands while the post is in focus', async () => {
    const { handlers, deps, notify } = setup();
    const description = deferred<DescriptionParts | null>();
    deps.description = jest.fn(() => description.promise);
    const read = await handlers.run('read_post', { mode: 'full' });
    expect(read.speak).toBe('Maya, 2 hours ago. Meet our new puppy Biscuit! One image: A golden puppy asleep on a red blanket. Its paws twitch. Tagged puppy and dogsofbluesky.');
    expect(notify).not.toHaveBeenCalled();
    description.resolve(collar);
    await flush();
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/^DESCRIBED: /), 'About the image: Biscuit wears a blue collar.');
  });

  it('only caches a description that lands after focus moved on', async () => {
    const { handlers, deps, notify } = setup();
    const description = deferred<DescriptionParts | null>();
    deps.description = jest.fn(() => description.promise);
    await handlers.run('read_post', { mode: 'full' });
    await handlers.run('go_to_post', { direction: 'next' });
    description.resolve(collar);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it('reads a cached description without asking again', async () => {
    const { handlers, deps } = setup();
    deps.description = jest.fn(hang);
    deps.cachedDescription = () => collar;
    expect((await handlers.run('read_post', { mode: 'full' })).speak).toContain('Biscuit wears a blue collar.');
    expect(deps.description).not.toHaveBeenCalled();
  });

  it('waits a little for an asked-for picture description', async () => {
    const { handlers, deps, scheduler } = setup();
    const description = deferred<DescriptionParts | null>();
    deps.description = jest.fn(() => description.promise);
    const read = handlers.run('read_post', { mode: 'picture' });
    await scheduler.advance(PICTURE_WAIT_MS - 500);
    description.resolve(collar);
    expect((await read).speak).toBe('Maya. One image: A golden puppy asleep on a red blanket. Its paws twitch. Biscuit wears a blue collar.');
  });

  it('says a slow picture description is on its way, then says it, or that there is nothing more', async () => {
    const { handlers, deps, scheduler, notify } = setup();
    const description = deferred<DescriptionParts | null>();
    deps.description = jest.fn(() => description.promise);
    const read = handlers.run('read_post', { mode: 'picture' });
    await scheduler.advance(PICTURE_WAIT_MS);
    expect((await read).speak).toBe(`Maya. One image: A golden puppy asleep on a red blanket. Its paws twitch. ${agentMessages.descriptionOnItsWay}`);
    description.resolve(collar);
    await flush();
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/^DESCRIBED: /), 'About the image: Biscuit wears a blue collar.');

    const never = deferred<DescriptionParts | null>();
    deps.description = jest.fn(() => never.promise);
    notify.mockClear();
    const again = handlers.run('read_post', { mode: 'picture' });
    await scheduler.advance(PICTURE_WAIT_MS);
    await again;
    never.resolve(null);
    await flush();
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/^DESCRIPTION_UNAVAILABLE: /));
  });

  it(`answers every tool within ${TOOL_CEILING_MS} ms even when the network never answers`, async () => {
    const args: Record<string, Record<string, unknown>> = {
      read_post: { mode: 'picture' },
      go_to_post: { direction: 'next' },
      draft_post: { text: 'hello there' },
      draft_reply: { text: 'hello there' },
      edit_draft: { find: 'hello', replace: 'hello' },
      change_narration: { speed: 1.5 },
      remember: { fact: 'I like tea' },
      forget_memory: { ids: ['fact_1'] },
    };
    for (const name of toolNames) {
      const provider = makeProvider(Object.fromEntries(['like', 'unlike', 'repost', 'unrepost', 'createPost', 'reply', 'deletePost', 'getMyLatestPost'].map((method) => [method, jest.fn(hang)])));
      const memory = makeMemory();
      for (const method of ['list', 'remember', 'forget'] as const) memory[method].mockImplementation(hang);
      const { handlers, deps, scheduler, say } = setup({ provider, memory });
      deps.description = jest.fn(hang);
      say('hello there');
      let answered = false;
      void handlers.run(name, args[name] ?? {}).then(() => (answered = true));
      await scheduler.advance(TOOL_CEILING_MS);
      if (!answered) throw new Error(`${name} did not answer within ${TOOL_CEILING_MS} ms`);
    }
  });

  it('tells the model a slow call is still working, holds history tools until it lands, then reports it', async () => {
    const like = deferred<{ uri: string }>();
    const provider = makeProvider({ like: jest.fn(() => like.promise) });
    const { handlers, scheduler, notify } = setup({ provider });
    const liking = handlers.run('like_post', {});
    await scheduler.advance(TOOL_CEILING_MS);
    expect((await liking).result).toMatch(/^STILL_WORKING: like_post/);
    expect((await handlers.run('undo', {})).result).toMatch(/^BUSY: The app is still finishing like_post/);
    expect((await handlers.run('read_post', { mode: 'brief' })).speak).toMatch(/^Maya/);
    like.resolve({ uri: 'at://me/like/1' });
    await flush();
    expect(notify).toHaveBeenCalledWith("Result of like_post: LIKED: Liked Maya's post. Confirm in a word or two.", undefined);
    expect((await handlers.run('undo', {})).result).toMatch(/^UNDONE: Removed the like/);
  });
});

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('usesOwnWords', () => {
  it('accepts punctuation and capitalization fixes only', () => {
    expect(usesOwnWords("That's beautiful, where was this?", ['reply thats beautiful where was this'])).toBe(true);
    expect(usesOwnWords('#Cats are great', ['post hashtag cats are great'])).toBe(true);
    expect(usesOwnWords('That is stunning', ["reply that's beautiful"])).toBe(false);
    expect(usesOwnWords('hello hello', ['hello'])).toBe(false);
  });
});
