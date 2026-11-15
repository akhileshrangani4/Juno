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

import { fakeConvex } from './fakeConvex';
import { FETCH_LIMITS, hashAddress, hashDevice, LIMITS, windowStart } from '../../convex/describeCache';
import { PROMPT_VERSION } from '../../convex/describePrompt';
import * as postDescriptions from '../../convex/postDescriptions';

type Reply = 'ok' | 'error' | 'abort';

function network(views: unknown[], reply: Reply = 'ok') {
  const modelInputs: string[] = [];
  const fetchMock = jest.fn(async (url: string, init?: { body?: string }) => {
    if (url.startsWith('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts')) return Response.json({ posts: views });
    if (url === 'https://api.openai.com/v1/responses') {
      modelInputs.push(init?.body ?? '');
      if (reply === 'error') return new Response('upstream exploded', { status: 500 });
      if (reply === 'abort') throw new DOMException('This operation was aborted', 'AbortError');
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
  const bluesky = () => fetchMock.mock.calls.filter(([url]) => url.startsWith('https://public.api.bsky.app')).length;
  return { fetchMock, modelInputs, bluesky };
}

const run = (ctx: unknown, args: Record<string, unknown>) =>
  (describePost as unknown as { _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown> })._handler(ctx, args);
const mutation = (name: keyof typeof postDescriptions) =>
  postDescriptions[name] as unknown as { _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown> };

const NOW = Date.UTC(2026, 10, 15, 18, 20);
const request = { uri, detail: 'standard', deviceId: 'device-0001' };
const key = { postUri: uri, promptVersion: PROMPT_VERSION, detail: 'standard' };
const parts = { images: [{ description: 'Red tomatoes hang from a green vine.', beyondAlt: '' }], video: null, hashtagTopic: null };

describe('describe:describePost', () => {
  const realFetch = globalThis.fetch;
  let now = NOW;
  beforeEach(() => {
    now = NOW;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    process.env.OPENAI_API_KEY = 'test-key';
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
    jest.restoreAllMocks();
  });

  const globalCost = (convex: ReturnType<typeof fakeConvex>) =>
    convex.db.table('describeUsage').find((entry) => entry.key === 'global' && entry.windowStart === windowStart(NOW))?.costUsd;
  const stored = (convex: ReturnType<typeof fakeConvex>) => convex.db.table('postDescriptions')[0];

  it('accepts only a post URI, a detail level and a device id from the client', () => {
    const args = JSON.parse((describePost as unknown as { exportArgs: () => string }).exportArgs());
    expect(Object.keys(args.value).sort()).toEqual(['detail', 'deviceId', 'uri']);
  });

  it('builds the model input from the post Bluesky returns, so a forged request cannot change what is stored', async () => {
    const { modelInputs } = network([realView]);
    const convex = fakeConvex();
    const forged = { ...request, post: { text: 'FORGED', images: [{ url: 'https://cdn.bsky.app/forged.jpg', alt: 'FORGED alt: a crime scene' }] } };
    const result = await run(convex.ctx, forged);
    expect(modelInputs).toHaveLength(1);
    expect(modelInputs[0]).toContain('Tomatoes on the vine');
    expect(modelInputs[0]).toContain(imageUrl);
    expect(modelInputs[0]).not.toContain('FORGED');
    expect(modelInputs[0]).not.toContain('forged.jpg');
    expect(JSON.stringify(convex.db.tables)).not.toContain('FORGED');
    expect(stored(convex)).toMatchObject({ status: 'done', parts });
    expect(result).toEqual({ parts, source: 'model' });
  });

  it('fetches nothing for a did:web or malformed URI', async () => {
    const { fetchMock } = network([realView]);
    const convex = fakeConvex();
    await expect(run(convex.ctx, { ...request, uri: 'at://did:web:evil.example/app.bsky.feed.post/3k' })).resolves.toBeNull();
    await expect(run(convex.ctx, { ...request, deviceId: 'x' })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(convex.calls).toEqual([]);
  });

  it('passes only digests of the device id and caller address to the database', async () => {
    network([realView]);
    const convex = fakeConvex({ ip: '198.51.100.23' });
    await run(convex.ctx, request);
    const written = JSON.stringify([convex.calls, convex.db.tables]);
    expect(written).not.toContain('device-0001');
    expect(written).not.toContain('198.51.100.23');
    expect(convex.calls.find((call) => call.name === 'postDescriptions:admit')?.args).toEqual({
      deviceHash: await hashDevice('device-0001'),
      addressHash: await hashAddress('198.51.100.23'),
    });
  });

  it('serves a cached description without fetching or taking a fetch from the limits', async () => {
    const { fetchMock } = network([realView]);
    const convex = fakeConvex();
    await convex.db.insert('postDescriptions', { ...key, status: 'done', parts, createdAt: NOW, updatedAt: NOW });
    await expect(run(convex.ctx, request)).resolves.toEqual({ parts, source: 'cache' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(convex.calls.map((call) => call.name)).toEqual(['postDescriptions:get']);
  });

  it('fetches an invented URI once and then answers it from the negative cache', async () => {
    const { bluesky, modelInputs } = network([]);
    const convex = fakeConvex();
    const invented = { ...request, uri: `at://${did}/app.bsky.feed.post/3kinvented` };
    await expect(run(convex.ctx, invented)).resolves.toBeNull();
    now += 60_000;
    await expect(run(convex.ctx, invented)).resolves.toBeNull();
    expect(bluesky()).toBe(1);
    expect(modelInputs).toHaveLength(0);
    expect(stored(convex)).toMatchObject({ status: 'failed', error: 'post not found' });
    expect(globalCost(convex)).toBeUndefined();
    now += LIMITS.failureRetryMs;
    await run(convex.ctx, invented);
    expect(bluesky()).toBe(2);
  });

  it.each([
    ['device', async () => `fetch:device:${await hashDevice('device-0001')}`, FETCH_LIMITS.perDevice],
    ['caller address', async () => `fetch:address:${await hashAddress('203.0.113.7')}`, FETCH_LIMITS.perAddress],
    ['deployment', async () => 'fetch:deployment', FETCH_LIMITS.deployment],
  ])('makes no fetch once the %s has used its hourly fetches', async (_name, counterKey, limit) => {
    const { fetchMock } = network([realView]);
    const convex = fakeConvex();
    await convex.db.insert('describeUsage', { key: await counterKey(), windowStart: windowStart(NOW), calls: limit, costUsd: 0 });
    for (let i = 0; i < 5; i++) {
      await expect(run(convex.ctx, { ...request, uri: `at://${did}/app.bsky.feed.post/3kinvented${i}` })).resolves.toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(convex.db.table('postDescriptions')).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith('describePost fetch limit reached');
  });

  it('counts one fetch against the device, the address and the deployment, and starts again next hour', async () => {
    const { bluesky } = network([]);
    const convex = fakeConvex();
    await convex.db.insert('describeUsage', { key: 'fetch:deployment', windowStart: windowStart(NOW), calls: FETCH_LIMITS.deployment - 1, costUsd: 0 });
    await run(convex.ctx, { ...request, uri: `at://${did}/app.bsky.feed.post/3kone` });
    await run(convex.ctx, { ...request, uri: `at://${did}/app.bsky.feed.post/3ktwo` });
    expect(bluesky()).toBe(1);
    expect(convex.db.table('describeUsage').map((entry) => [String(entry.key).split(':').slice(0, 2).join(':'), entry.calls]).sort()).toEqual([
      ['fetch:address', 1],
      ['fetch:deployment', FETCH_LIMITS.deployment],
      ['fetch:device', 1],
    ]);
    now += LIMITS.windowMs;
    await run(convex.ctx, { ...request, uri: `at://${did}/app.bsky.feed.post/3kthree` });
    expect(bluesky()).toBe(2);
  });

  it('still limits by device and deployment when Convex reports no caller address', async () => {
    network([]);
    const convex = fakeConvex({ ip: null });
    await run(convex.ctx, request);
    expect(convex.calls.find((call) => call.name === 'postDescriptions:admit')?.args.addressHash).toBeNull();
    expect(convex.db.table('describeUsage').map((entry) => entry.key)).not.toContainEqual(expect.stringMatching(/^fetch:address/));
  });

  it('swaps the reservation for the real cost when the model answers', async () => {
    network([realView]);
    const convex = fakeConvex();
    await run(convex.ctx, request);
    expect(stored(convex)).toMatchObject({ status: 'done' });
    expect(stored(convex).reservation).toBeUndefined();
    expect(globalCost(convex)).toBeGreaterThan(0);
    expect(globalCost(convex)).toBeLessThan(LIMITS.reserveUsd);
  });

  it.each([
    ['an OpenAI error', 'error' as Reply],
    ['a timed-out model call', 'abort' as Reply],
  ])('gives the reservation back after %s', async (_name, reply) => {
    network([realView], reply);
    const convex = fakeConvex();
    await expect(run(convex.ctx, request)).resolves.toBeNull();
    expect(globalCost(convex)).toBe(0);
    expect(stored(convex)).toMatchObject({ status: 'failed' });
    expect(stored(convex).reservation).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('reservation released'));
  });

  it('gives the reservation back when the model key is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    network([realView]);
    const convex = fakeConvex();
    await expect(run(convex.ctx, request)).resolves.toBeNull();
    expect(globalCost(convex)).toBe(0);
  });

  it('expires a claim whose action never reported back, and leaves a completed one alone', async () => {
    const convex = fakeConvex();
    const claim = (await mutation('claim')._handler(convex.mutationCtx, { ...key, deviceHash: 'd'.repeat(64) })) as { windowStart: number };
    expect(globalCost(convex)).toBe(LIMITS.reserveUsd);
    expect(convex.scheduled).toEqual([{ ms: LIMITS.expireMs, name: 'postDescriptions:expire', args: { ...key, claimedAt: NOW } }]);
    now += LIMITS.expireMs;
    await convex.runScheduled();
    expect(globalCost(convex)).toBe(0);
    expect(stored(convex)).toMatchObject({ status: 'failed', error: 'the action never reported back' });

    now += LIMITS.failureRetryMs;
    const second = await mutation('claim')._handler(convex.mutationCtx, { ...key, deviceHash: 'd'.repeat(64) });
    expect(second).toMatchObject({ kind: 'claim' });
    const usage = { inputTokens: 2000, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 80, costUsd: 0.0004 };
    await mutation('complete')._handler(convex.mutationCtx, { ...key, windowStart: claim.windowStart, parts, model: 'gpt-6-luna', latencyMs: 900, usage });
    await convex.runScheduled();
    expect(stored(convex)).toMatchObject({ status: 'done', parts });
    expect(globalCost(convex)).toBeCloseTo(0.0004, 10);
  });

  it('still counts the real cost when the model answers after the claim expired', async () => {
    const convex = fakeConvex();
    const claim = (await mutation('claim')._handler(convex.mutationCtx, { ...key, deviceHash: 'd'.repeat(64) })) as { windowStart: number };
    await convex.runScheduled();
    expect(globalCost(convex)).toBe(0);
    const usage = { inputTokens: 2000, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 80, costUsd: 0.0004 };
    await mutation('complete')._handler(convex.mutationCtx, { ...key, windowStart: claim.windowStart, parts, model: 'gpt-6-luna', latencyMs: 90_000, usage });
    expect(globalCost(convex)).toBeCloseTo(0.0004, 10);
  });

  it('gives a stale claim\'s reservation back before taking a new one', async () => {
    const convex = fakeConvex();
    await mutation('claim')._handler(convex.mutationCtx, { ...key, deviceHash: 'd'.repeat(64) });
    now += LIMITS.pendingStaleMs;
    await mutation('claim')._handler(convex.mutationCtx, { ...key, deviceHash: 'd'.repeat(64) });
    expect(globalCost(convex)).toBeCloseTo(LIMITS.reserveUsd, 10);
  });
});
