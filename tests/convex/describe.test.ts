import { getFunctionName } from 'convex/server';

import { describePost } from '../../convex/describe';

const did = 'did:plc:abcdefghijklmnopqrstuvwx';
const uri = `at://${did}/app.bsky.feed.post/3kreal`;
const imageUrl = `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/bafyreal@jpeg`;
const realView = {
  uri,
  cid: 'bafypost',
  author: { did, handle: 'alice.bsky.social', displayName: 'Alice' },
  record: { $type: 'app.bsky.feed.post', text: 'Our garden this morning', createdAt: '2026-11-15T10:00:00Z' },
  embed: { $type: 'app.bsky.embed.images#view', images: [{ thumb: imageUrl, fullsize: imageUrl, alt: 'Tomatoes on the vine' }] },
};

type Call = { name: string; args: Record<string, unknown> };

function fakeContext(claim: Record<string, unknown> = { kind: 'claim', windowStart: 0 }) {
  const calls: Call[] = [];
  const record = (reference: unknown, args: Record<string, unknown>) => {
    const name = getFunctionName(reference as never);
    calls.push({ name, args });
    return name;
  };
  const ctx = {
    runQuery: async (reference: unknown, args: Record<string, unknown>) => (record(reference, args), null),
    runMutation: async (reference: unknown, args: Record<string, unknown>) => (record(reference, args) === 'postDescriptions:claim' ? claim : null),
  };
  return { ctx, calls, mutations: () => calls.filter((call) => call.name !== 'postDescriptions:get') };
}

function network(views: unknown[]) {
  const modelInputs: string[] = [];
  const fetchMock = jest.fn(async (url: string, init?: { body?: string }) => {
    if (url.startsWith('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts')) return Response.json({ posts: views });
    if (url === 'https://api.openai.com/v1/responses') {
      modelInputs.push(init?.body ?? '');
      const parsed = { images: [{ description: 'Red tomatoes hang from a green vine.', beyond_alt: '' }], video: '', hashtag_topic: '' };
      return Response.json({
        status: 'completed',
        model: 'gpt-6-luna',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(parsed) }] }],
        usage: { input_tokens: 2000, output_tokens: 80, input_tokens_details: { cached_tokens: 0 } },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, modelInputs };
}

const run = (ctx: unknown, args: Record<string, unknown>) =>
  (describePost as unknown as { _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown> })._handler(ctx, args);

describe('describe:describePost', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
    jest.restoreAllMocks();
  });

  it('accepts only a post URI, a detail level and a device id from the client', () => {
    const args = JSON.parse((describePost as unknown as { exportArgs: () => string }).exportArgs());
    expect(Object.keys(args.value).sort()).toEqual(['detail', 'deviceId', 'uri']);
  });

  it('builds the model input from the post Bluesky returns, so a forged request cannot change what is stored', async () => {
    const { modelInputs } = network([realView]);
    const { ctx, calls } = fakeContext();
    const forged = {
      uri,
      detail: 'standard',
      deviceId: 'device-0001',
      post: { text: 'FORGED', images: [{ url: 'https://cdn.bsky.app/forged.jpg', alt: 'FORGED alt: a crime scene' }] },
    };
    const result = await run(ctx, forged);
    expect(modelInputs).toHaveLength(1);
    expect(modelInputs[0]).toContain('Tomatoes on the vine');
    expect(modelInputs[0]).toContain(imageUrl);
    expect(modelInputs[0]).not.toContain('FORGED');
    expect(modelInputs[0]).not.toContain('forged.jpg');
    const complete = calls.find((call) => call.name === 'postDescriptions:complete');
    expect(JSON.stringify(complete?.args)).not.toContain('FORGED');
    expect(complete?.args.parts).toEqual({ images: [{ description: 'Red tomatoes hang from a green vine.', beyondAlt: '' }], video: null, hashtagTopic: null });
    expect(result).toEqual({ parts: complete?.args.parts, source: 'model' });
  });

  it('makes no model call and writes nothing for a URI that is not a real post', async () => {
    const { fetchMock, modelInputs } = network([]);
    const { ctx, mutations } = fakeContext();
    await expect(run(ctx, { uri: `at://${did}/app.bsky.feed.post/3kinvented`, detail: 'standard', deviceId: 'device-0001' })).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(modelInputs).toHaveLength(0);
    expect(mutations()).toEqual([]);
  });

  it('fetches nothing for a did:web or malformed URI', async () => {
    const { fetchMock } = network([realView]);
    const { ctx, calls } = fakeContext();
    await expect(run(ctx, { uri: 'at://did:web:evil.example/app.bsky.feed.post/3k', detail: 'standard', deviceId: 'device-0001' })).resolves.toBeNull();
    await expect(run(ctx, { uri, detail: 'standard', deviceId: 'x' })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('passes only a digest of the device id to the database', async () => {
    network([realView]);
    const { ctx, calls } = fakeContext({ kind: 'limited' });
    await expect(run(ctx, { uri, detail: 'standard', deviceId: 'device-0001' })).resolves.toBeNull();
    expect(JSON.stringify(calls)).not.toContain('device-0001');
    expect(calls.find((call) => call.name === 'postDescriptions:claim')?.args.deviceHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
