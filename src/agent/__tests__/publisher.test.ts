import { makePost } from '@/testing/fixtures';

import { graphemeLength, isAffirmative, POST_LIMIT, Publisher, readBackOf, splitIntoParts, UNDO_WINDOW_MS } from '../publisher';
import { maya, makeScheduler } from '@/testing/agent';

function setup() {
  const scheduler = makeScheduler();
  const sent: string[][] = [];
  let ids = 0;
  const publisher = new Publisher({
    send: async (draft) => void sent.push(draft.parts),
    schedule: scheduler.schedule,
    newId: () => `d${++ids}`,
    now: () => new Date('2026-11-15T12:00:00.000Z'),
  });
  return { publisher, scheduler, sent };
}

describe('Publisher', () => {
  it('reads a reply back with who it is to and exactly what will be published', () => {
    const { publisher } = setup();
    const outcome = publisher.draftText('reply', "That's beautiful, where was this?", maya, 1);
    expect(outcome.ok && outcome.readBack).toBe(
      'Replying to Maya\'s post that starts "Meet our new puppy Biscuit!": That\'s beautiful, where was this? Shall I send the reply?',
    );
  });

  it('publishes only after a yes in the turn right after the read-back, then waits five seconds before sending', async () => {
    const { publisher, scheduler, sent } = setup();
    const draft = publisher.draftText('post', 'Hello from my new app.', null, 1);
    if (!draft.ok) throw new Error('expected a draft');
    expect(publisher.confirm(draft.draft.id, 1, 'yes')).toEqual({ ok: false, reason: 'sameTurn' });
    expect(publisher.confirm(draft.draft.id, 2, 'no, wait')).toEqual({ ok: false, reason: 'notAffirmative' });
    expect(publisher.confirm(draft.draft.id, 3, 'Yes, post it.')).toEqual({ ok: false, reason: 'expired', readBack: 'Posting to your followers: Hello from my new app. Shall I post it?' });
    const confirmed = publisher.confirm(draft.draft.id, 4, 'Yes, post it.');
    expect(confirmed).toMatchObject({ ok: true, announcement: 'Posting in five seconds. Say undo to stop it.' });
    publisher.startCountdown();
    await scheduler.advance(UNDO_WINDOW_MS - 1);
    expect(sent).toEqual([]);
    await scheduler.advance(1);
    expect(sent).toEqual([['Hello from my new app.']]);
  });

  it('refuses to publish a draft that was never read back', () => {
    const { publisher, sent } = setup();
    const long = publisher.draftText('post', 'word '.repeat(70), null, 1);
    expect(long).toMatchObject({ ok: false, reason: 'tooLong' });
    if (long.ok || long.reason !== 'tooLong') throw new Error('expected tooLong');
    expect(publisher.confirm(long.draft.id, 2, 'yes')).toEqual({ ok: false, reason: 'notReadBack' });
    expect(publisher.confirm('made-up', 2, 'yes')).toEqual({ ok: false, reason: 'staleDraft' });
    expect(sent).toEqual([]);
  });

  it('sends nothing when undo comes inside the window', async () => {
    const { publisher, scheduler, sent } = setup();
    const draft = publisher.draftText('post', 'Hello', null, 1);
    if (!draft.ok) throw new Error('expected a draft');
    publisher.confirm(draft.draft.id, 2, 'yes');
    publisher.startCountdown();
    await scheduler.advance(4000);
    expect(publisher.undo()).toMatchObject({ state: 'stopped', draft: { text: 'Hello' } });
    await scheduler.advance(10_000);
    expect(sent).toEqual([]);
    expect(scheduler.pending()).toBe(0);
    expect(publisher.undo()).toBeNull();
  });

  it('needs a new read-back after an edit, and edits keep the rest of the words', () => {
    const { publisher } = setup();
    const first = publisher.draftText('post', 'Going to the park today.', null, 1);
    if (!first.ok) throw new Error('expected a draft');
    const edited = publisher.edit('the park', 'the beach', 2);
    expect(edited).toMatchObject({ ok: true, readBack: 'Posting to your followers: Going to the beach today. Shall I post it?' });
    expect(publisher.confirm(first.draft.id, 3, 'yes')).toEqual({ ok: false, reason: 'staleDraft' });
    if (!edited.ok) throw new Error('expected an edit');
    expect(publisher.confirm(edited.draft.id, 2, 'yes')).toEqual({ ok: false, reason: 'sameTurn' });
    expect(publisher.edit('mountains', 'sea', 3)).toEqual({ ok: false, reason: 'notFound' });
    expect(publisher.discard()).toBe(true);
    expect(publisher.confirm(edited.draft.id, 4, 'yes')).toEqual({ ok: false, reason: 'noDraft' });
  });

  it('counts graphemes, not code units, against the 300 limit', () => {
    const family = '👨‍👩‍👧';
    expect(graphemeLength(family)).toBe(1);
    const { publisher } = setup();
    expect(publisher.draftText('post', family.repeat(POST_LIMIT), null, 1)).toMatchObject({ ok: true });
    expect(publisher.draftText('post', family.repeat(POST_LIMIT + 1), null, 1)).toMatchObject({ ok: false, reason: 'tooLong', graphemes: 301, parts: 2 });
  });

  it('splits a long draft into a thread that is read back before it can be published', async () => {
    const { publisher, scheduler, sent } = setup();
    const sentence = 'This is a sentence that has exactly enough words to matter here. ';
    const text = sentence.repeat(8).trim();
    const long = publisher.draftText('post', text, null, 1);
    expect(long).toMatchObject({ ok: false, reason: 'tooLong' });
    const split = publisher.split(2);
    if (!split.ok) throw new Error('expected a split');
    expect(split.draft.parts.length).toBe(2);
    expect(split.draft.parts.every((part) => graphemeLength(part) <= POST_LIMIT)).toBe(true);
    expect(split.draft.parts.join(' ')).toBe(text);
    expect(split.readBack).toMatch(/^Posting to your followers: This will be a thread of 2 posts\. Post 1: This is/);
    publisher.confirm(split.draft.id, 3, 'yes');
    publisher.startCountdown();
    await scheduler.advance(UNDO_WINDOW_MS);
    expect(sent).toEqual([split.draft.parts]);
  });

  it('names a post that is only hashtags by its tags, and a post with no words just once', () => {
    const { publisher } = setup();
    const sam = { id: 'did:plc:sam', handle: 'sam.bsky.social', displayName: 'Sam', avatarUrl: null };
    const tagsOnly = makePost({ author: sam, text: '#sunset #beach #nofilter' });
    const repost = publisher.draftAction('repost', tagsOnly, 1);
    expect(repost.ok && repost.readBack).toBe("Reposting Sam's post tagged sunset, beach, and nofilter to your followers. Shall I repost it?");
    publisher.discard();
    const reply = publisher.draftText('reply', 'Gorgeous', tagsOnly, 1);
    expect(reply.ok && reply.readBack).toBe("Replying to Sam's post tagged sunset, beach, and nofilter: Gorgeous. Shall I send the reply?");
    publisher.discard();
    const photo = makePost({ author: sam, text: '', media: [{ kind: 'images', images: [{ url: 'https://img/2.jpg', alt: '' }] }] });
    const bare = publisher.draftAction('repost', photo, 1);
    expect(bare.ok && bare.readBack).toBe("Reposting Sam's post to your followers. Shall I repost it?");
  });

  it('splits by words, then by graphemes, when a sentence is too long', () => {
    expect(splitIntoParts('a'.repeat(650))).toEqual(['a'.repeat(300), 'a'.repeat(300), 'a'.repeat(50)]);
    const words = 'word '.repeat(100).trim();
    const parts = splitIntoParts(words);
    expect(parts.every((part) => graphemeLength(part) <= POST_LIMIT)).toBe(true);
    expect(parts.join(' ')).toBe(words);
  });

  it('reads back reposts and deletions', () => {
    const { publisher } = setup();
    const repost = publisher.draftAction('repost', maya, 1);
    expect(repost.ok && repost.readBack).toBe('Reposting Maya\'s post that starts "Meet our new puppy Biscuit!" to your followers. Shall I repost it?');
    const mine = makePost({ text: 'My old post', createdAt: '2026-11-15T09:00:00.000Z' });
    const del = publisher.draftAction('delete', mine, 1);
    expect(del.ok && del.readBack).toBe("Deleting your post from 3 hours ago: My old post. A deleted post can't be brought back. Shall I delete it?");
    expect(del.ok && readBackOf(del.draft, new Date('2026-11-15T12:00:00.000Z'))).toBe(del.ok && del.readBack);
    const ended = publisher.draftAction('delete', makePost({ text: 'Done for today.', createdAt: '2026-11-15T09:00:00.000Z' }), 1);
    expect(ended.ok && ended.readBack).toBe("Deleting your post from 3 hours ago: Done for today. A deleted post can't be brought back. Shall I delete it?");
  });

  it('ends the spoken text with a full stop before the question', () => {
    const { publisher } = setup();
    const draft = publisher.draftText('post', 'Hello from my new app', null, 1);
    expect(draft.ok && draft.readBack).toBe('Posting to your followers: Hello from my new app. Shall I post it?');
    const asked = publisher.draftText('post', 'Is anyone here?', null, 1);
    expect(asked.ok && asked.readBack).toBe('Posting to your followers: Is anyone here? Shall I post it?');
  });

  it('only treats an utterance made of nothing but assent as a yes', () => {
    const yes = ['yes', 'Yes.', 'yes please', 'Yeah, post it.', 'go ahead', 'Do it!', 'Yep, send it', 'sure', 'okay', 'Post it!', 'yes, delete it', 'Go ahead and send it.'];
    for (const said of yes) expect([said, isAffirmative(said)]).toEqual([said, true]);
    const no = [
      'okay let me think',
      'sure, but change it to goodbye',
      'yes and add a smiley',
      'right, actually change hello to hi',
      'hmm okay so what else',
      'maybe',
      'yes?',
      'Is that okay?',
      'no',
      'No.',
      'wait',
      'stop',
      "don't",
      'yes, no, cancel',
      'not yet',
      'please',
      '',
    ];
    for (const said of no) expect([said, isAffirmative(said)]).toEqual([said, false]);
  });

  it('matches an assent verb to the kind of draft', () => {
    for (const [said, kind, fits] of [
      ['yes', 'delete', true],
      ['go ahead', 'post', true],
      ['yes, delete it', 'post', false],
      ['yes, delete it', 'delete', true],
      ['remove it', 'delete', true],
      ['send it', 'delete', false],
      ['publish', 'delete', false],
      ['yeah post it', 'reply', true],
      ['repost it', 'post', false],
      ['repost it', 'repost', true],
      ['yes send it', 'repost', true],
    ] as const) {
      expect([said, kind, isAffirmative(said, kind)]).toEqual([said, kind, fits]);
    }
  });

  it('needs a new read-back when the assistant speaks before the user answers', () => {
    const { publisher } = setup();
    const draft = publisher.draftText('post', 'Hello', null, 1);
    if (!draft.ok) throw new Error('expected a draft');
    publisher.assistantSpoke(1);
    expect(publisher.confirm(draft.draft.id, 2, 'yes')).toMatchObject({ ok: false, reason: 'expired' });
    publisher.assistantSpoke(3);
    expect(publisher.confirm(draft.draft.id, 3, 'yes')).toMatchObject({ ok: true });
  });

  it('accepts a yes only in the very next turn after the read-back', () => {
    const { publisher } = setup();
    const draft = publisher.draftText('post', 'Hello', null, 1);
    if (!draft.ok) throw new Error('expected a draft');
    const twoTurnsLater = publisher.confirm(draft.draft.id, 3, 'yes');
    expect(twoTurnsLater).toMatchObject({ ok: false, reason: 'expired', readBack: 'Posting to your followers: Hello. Shall I post it?' });
    expect(publisher.confirm(draft.draft.id, 4, 'yes')).toMatchObject({ ok: true });
  });

  it('voids the read-back when anything else happens before the yes', () => {
    const { publisher } = setup();
    const draft = publisher.draftText('post', 'Hello', null, 1);
    if (!draft.ok) throw new Error('expected a draft');
    publisher.interrupt();
    expect(publisher.confirm(draft.draft.id, 2, 'yes')).toMatchObject({ ok: false, reason: 'expired' });
    expect(publisher.confirm(draft.draft.id, 3, 'yes')).toMatchObject({ ok: true });
  });

  it('holds an undo said during the send for that send, and never cancels anything when it is over', async () => {
    const { scheduler } = setup();
    let finish: () => void = () => undefined;
    let asked: () => boolean = () => false;
    const publisher = new Publisher({
      send: (_draft, undoRequested) => {
        asked = undoRequested;
        return new Promise<void>((resolve) => (finish = resolve));
      },
      schedule: scheduler.schedule,
      newId: () => 'd1',
    });
    const draft = publisher.draftText('post', 'Hello', null, 1);
    if (!draft.ok) throw new Error('expected a draft');
    publisher.confirm(draft.draft.id, 2, 'yes');
    publisher.startCountdown();
    await scheduler.advance(UNDO_WINDOW_MS);
    expect(publisher.busy).toBe(true);
    expect(publisher.undo()).toMatchObject({ state: 'sending', draft: { text: 'Hello' } });
    expect(asked()).toBe(true);
    finish();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(publisher.busy).toBe(false);
    expect(publisher.undo()).toBeNull();
  });
});
