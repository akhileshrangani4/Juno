import { AgentVoice } from '../agentVoice';

const readBack = 'Posting to your followers: @alice.bsky.social see you at 5. Shall I post it?';

function voice() {
  let now = 0;
  const v = new AgentVoice(() => now);
  return { v, advance: (ms: number) => void (now += ms) };
}

describe('AgentVoice', () => {
  it("puts a read-back Vapi sent in chunks with no source down to the app, and says when it was heard to the end", () => {
    const { v } = voice();
    v.appSays(readBack, 'd1');
    v.speechStarted(1);
    expect(v.attribute('Posting to your followers,')).toMatchObject({ speaker: 'app', by: 'timing and words', finished: [] });
    expect(v.attribute('alice dot bsky dot social see you at five.')).toMatchObject({ speaker: 'app', finished: [] });
    expect(v.attribute('Shall I post it?')).toMatchObject({ speaker: 'app', finished: ['d1'] });
    expect(v.settle()).toBeNull();
  });

  it('puts a chunk that leaves the say() down to the model, and the rest of that segment too', () => {
    const { v } = voice();
    v.appSays(readBack, 'd1');
    v.speechStarted(1);
    expect(v.attribute('Posting to your followers,').speaker).toBe('app');
    expect(v.attribute('Want me to like it too?')).toMatchObject({ speaker: 'model', finished: [] });
    expect(v.attribute('Shall I post it?')).toMatchObject({ speaker: 'model', finished: [] });
  });

  it('settles a read-back that stopped partway as the model, when the user speaks or the next segment starts', () => {
    const first = voice();
    first.v.appSays(readBack, 'd1');
    first.v.speechStarted(1);
    first.v.attribute('Posting to your followers,');
    expect(first.v.settle()).toMatchObject({ speaker: 'model', by: 'timing and words', finished: [] });
    expect(first.v.settle()).toBeNull();

    const second = voice();
    second.v.appSays(readBack, 'd1');
    second.v.speechStarted(1);
    second.v.attribute('Posting to your followers,');
    expect(second.v.speechStarted(2)).toMatchObject({ speaker: 'model' });
  });

  it("follows Vapi's force-say and reports the read-back finished once its words are covered", () => {
    const { v } = voice();
    v.appSays(readBack, 'd1');
    v.sourceReported('force-say', 1);
    expect(v.attribute('Posting to your followers,')).toMatchObject({ speaker: 'app', by: 'source', finished: [] });
    expect(v.attribute('Alice dot bsky dot social. See you at five. Shall I post it?')).toMatchObject({ speaker: 'app', by: 'source', finished: ['d1'] });
  });

  it("calls force-say the app whatever the words, but doesn't count a read-back it can't match as heard", () => {
    const { v } = voice();
    v.appSays(readBack, 'd1');
    v.sourceReported('force-say', 1);
    expect(v.attribute('Words the formatter rewrote beyond recognition.')).toMatchObject({ speaker: 'app', finished: [] });
  });

  it("allows Vapi's transcriber to drop a word of the read-back, but not to add or change one", () => {
    const dropped = voice();
    dropped.v.appSays('Posting to your followers: Good night everyone. Shall I post it?', 'd1');
    dropped.v.speechStarted(1);
    expect(dropped.v.attribute('posting to your followers,').speaker).toBe('app');
    expect(dropped.v.attribute('night, everyone. Shall I post it?')).toMatchObject({ speaker: 'app', finished: ['d1'] });

    const twice = voice();
    twice.v.appSays('Posting to your followers: Good night everyone. Shall I post it?', 'd1');
    twice.v.speechStarted(1);
    expect(twice.v.attribute('posting to your followers, night. Shall I post it?')).toMatchObject({ speaker: 'model', finished: [] });

    const added = voice();
    added.v.appSays('Posting to your followers: Good night everyone. Shall I post it?', 'd1');
    added.v.speechStarted(1);
    expect(added.v.attribute('posting to your followers, good night to everyone.')).toMatchObject({ speaker: 'model', finished: [] });

    const trailing = voice();
    trailing.v.appSays('Posting to your followers: Good night everyone. Shall I post it?', 'd1');
    trailing.v.speechStarted(1);
    expect(trailing.v.attribute('posting to your followers, good night everyone. Shall I post it? Or change it?')).toMatchObject({ speaker: 'model', finished: ['d1'] });
  });

  it('matches two say()s spoken one after the other in one segment', () => {
    const { v } = voice();
    v.appSays('I stopped it, nothing was sent.');
    v.appSays(readBack, 'd2');
    v.speechStarted(1);
    expect(v.attribute('I stopped it, nothing was sent. Posting to your followers,')).toMatchObject({ speaker: 'app', finished: [] });
    expect(v.attribute('alice dot bsky dot social see you at five. Shall I post it?')).toMatchObject({ speaker: 'app', finished: ['d2'] });
  });

  it('puts speech Vapi names as the model down to the model, even with a say() due', () => {
    const { v } = voice();
    v.appSays(readBack, 'd1');
    v.sourceReported('model', 1);
    expect(v.attribute('Posting to your followers. alice dot bsky dot social see you at five. Shall I post it?')).toMatchObject({ speaker: 'model', by: 'source', finished: [] });
  });

  it("doesn't take a say() for model speech that started before it was due", () => {
    const { v } = voice();
    v.speechStarted(1);
    v.appSays(readBack, 'd1');
    expect(v.attribute('Your post draft says,').speaker).toBe('model');
    v.speechStarted(2);
    expect(v.attribute(readBack)).toMatchObject({ speaker: 'app', finished: ['d1'] });
  });

  it('stops counting a say() as due when its speech never started', () => {
    const { v, advance } = voice();
    v.appSays(readBack, 'd1');
    advance(60_000);
    v.speechStarted(1);
    expect(v.attribute(readBack)).toMatchObject({ speaker: 'model', finished: [] });
  });
});
