import { flattenReplies } from '../replies';

let n = 0;
const node = (author: string, replies: unknown[] = [], labels: { val: string }[] = []) => {
  n += 1;
  return {
    $type: 'app.bsky.feed.defs#threadViewPost',
    post: {
      uri: `at://${author}/post/${n}`,
      cid: `cid-${n}`,
      author: { did: `did:plc:${author}`, handle: `${author}.bsky.social`, displayName: author[0].toUpperCase() + author.slice(1) },
      record: { text: `${author} ${n}`, createdAt: '2026-11-15T10:00:00.000Z' },
      labels: labels.map(({ val }) => ({ src: 'did:plc:ar7c4by46qjdydhdevvrndac', uri: 'x', val, cts: '2026-11-15T10:00:00.000Z' })),
    },
    replies,
  };
};

describe('flattenReplies', () => {
  it('lists replies in reading order, depth first, and records who each nested reply answers', () => {
    const thread = node('root', [node('maya', [node('sam', [node('lee')]), node('kim')]), node('ana')]);
    const flat = flattenReplies(thread, undefined);
    expect(flat.map((reply) => reply.author.handle.split('.')[0])).toEqual(['maya', 'sam', 'lee', 'kim', 'ana']);
    expect(flat.map((reply) => reply.parentAuthor?.displayName ?? null)).toEqual([null, 'Maya', 'Sam', 'Maya', null]);
  });

  it('applies the content filter to replies and drops what answers a hidden reply', () => {
    const thread = node('root', [node('maya', [node('sam')], [{ val: 'porn' }]), node('ana', [], [{ val: 'sexual' }]), node('kim')]);
    expect(flattenReplies(thread, undefined).map((reply) => reply.author.handle)).toEqual(['kim.bsky.social']);
  });

  it('skips deleted and blocked replies', () => {
    const thread = node('root', [{ $type: 'app.bsky.feed.defs#notFoundPost', uri: 'at://gone', notFound: true }, { $type: 'app.bsky.feed.defs#blockedPost' }, node('kim')]);
    expect(flattenReplies(thread, undefined)).toHaveLength(1);
  });

  it('fails plainly when the post itself is gone', () => {
    expect(() => flattenReplies({ $type: 'app.bsky.feed.defs#notFoundPost' }, undefined)).toThrow('This post is not available.');
  });
});
