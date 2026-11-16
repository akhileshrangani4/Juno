import { getFunctionName } from 'convex/server';
import { encode } from 'jpeg-js';

import { windowStart } from '../../convex/describeCache';
import { decide, describeImage } from '../../convex/look';
import { IMAGE_LIMITS, LOOK_ADDRESS_BUDGET_USD_PER_HOUR, LOOK_BUDGET_USD_PER_HOUR, LOOK_LIMITS, lookHash, reservationUsd, type LookAction } from '../../convex/lookLimits';
import * as lookUsage from '../../convex/lookUsage';
import { FakeDb } from './fakeConvex';

// The real describeImage and decide handlers, run against the real reserve and settle mutations over an
// in-memory database (the FakeDb of fakeConvex.ts), with fetch mocked. Every mutation and fetch is recorded in
// one list, so the tests can check what happened in which order.

type Handler = { _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown> };
const mutations: Record<string, Handler> = { 'lookUsage:reserve': lookUsage.reserve, 'lookUsage:settle': lookUsage.settle } as unknown as Record<string, Handler>;
const actions = { describe: describeImage, decide } as unknown as Record<LookAction, Handler>;

const NOW = Date.UTC(2026, 10, 15, 18, 20);
const HOUR = windowStart(NOW);
const IP = '203.0.113.7';
const DEVICE = '3f1c2a9e-77aa-4c1b-9a51-0f6e8c3d2b11';
const jpeg = (width: number, height: number) => encode({ width, height, data: Buffer.alloc(width * height * 4, 128) }, 80).data.toString('base64');
const args = {
  describe: { image: jpeg(576, 768), deviceId: DEVICE, purpose: 'view' },
  decide: { image: jpeg(384, 512), deviceId: DEVICE, subject: 'my mug', checks: ['inView', 'cutOff', 'quality'] },
};
const reserves = { describe: reservationUsd('gpt-6-luna', 'describe')!, decide: reservationUsd('gpt-6-luna', 'decide')! };
const usage = { input_tokens: 1500, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 100 };
const success = {
  describe: {
    status: 'completed',
    model: 'gpt-6-luna',
    usage,
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ visible_text: [], description: 'A red mug on a desk.', alt_text: '' }) }] }],
  },
  decide: { model: 'gpt-6-luna', usage, answers: [{ type: 'predicate', name: 'in_view', probability: 0.9 }] },
};
// What each success above costs on gpt-6-luna: describe bills output tokens, decide does not.
const reported = { describe: 0.0002, decide: 0.00015 };

type Failure = 'http' | 'network' | 'timeout' | 'malformed';

function setup({ ip = IP as string | null, reply = 'ok' as 'ok' | Failure } = {}) {
  const db = new FakeDb();
  const events: string[] = [];
  const mutationCalls: { name: string; args: Record<string, unknown> }[] = [];
  const ctx = {
    runMutation: async (reference: unknown, mutationArgs: Record<string, unknown>) => {
      const name = getFunctionName(reference as never);
      events.push(name);
      mutationCalls.push({ name, args: mutationArgs });
      return mutations[name]._handler({ db }, mutationArgs);
    },
    meta: { getRequestMetadata: async () => ({ ip }) },
  };
  const fetchMock = jest.fn((url: string, init: { signal: AbortSignal }) => {
    events.push('fetch');
    const action: LookAction = url.endsWith('/decisions') ? 'decide' : 'describe';
    if (reply === 'http') return Promise.resolve(Response.json({ error: { message: 'boom' } }, { status: 500 }));
    if (reply === 'network') return Promise.reject(new TypeError('fetch failed'));
    if (reply === 'malformed') return Promise.resolve(Response.json(action === 'describe' ? { status: 'completed', output: [{ type: 'message', content: 'x' }] } : null));
    if (reply === 'timeout') {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
        jest.advanceTimersByTime(20_000);
      });
    }
    return Promise.resolve(Response.json(success[action]));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const run = (action: LookAction, overrides: Record<string, unknown> = {}) => actions[action]._handler(ctx, { ...args[action], ...overrides });
  const spend = (key: string) => db.table('describeUsage').find((row) => row.key === key && row.windowStart === HOUR)?.costUsd;
  const seedSpend = (key: string, costUsd: number) => db.insert('describeUsage', { key, windowStart: HOUR, calls: 1, costUsd });
  const addressKey = async () => `look:address:${await lookHash('address', IP)}`;
  return { db, events, mutationCalls, fetchMock, run, spend, seedSpend, addressKey };
}

describe.each<LookAction>(['describe', 'decide'])('look:%s action', (action) => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.LOOK_MODEL;
    delete process.env.LOOK_DECISION_MODEL;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('reserves every limit before calling OpenAI, then settles at the reported cost', async () => {
    const convex = setup();
    const result = await convex.run(action);
    expect(result).toMatchObject({ ok: true, model: 'gpt-6-luna' });
    expect(convex.events).toEqual(['lookUsage:reserve', 'fetch', 'lookUsage:settle']);
    const addressKey = await convex.addressKey();
    const reserve = convex.mutationCalls[0].args;
    expect((reserve.checks as { key: string }[]).map((check) => check.key)).toEqual([
      `look:${action}:device:${await lookHash('device', DEVICE)}`,
      `look:${action}:address:${await lookHash('address', IP)}`,
      `look:${action}:deployment`,
    ]);
    expect(reserve.spends).toEqual([
      { key: 'look:global', limitUsd: LOOK_BUDGET_USD_PER_HOUR },
      { key: addressKey, limitUsd: LOOK_ADDRESS_BUDGET_USD_PER_HOUR },
    ]);
    expect(reserve.reserveUsd).toBe(reserves[action]);
    expect(convex.mutationCalls[1].args).toEqual({ windowStart: HOUR, spendKeys: ['look:global', addressKey], reserveUsd: reserves[action], costUsd: expect.any(Number) });
    expect(convex.spend('look:global')).toBeCloseTo(reported[action], 10);
    expect(convex.spend(addressKey)).toBeCloseTo(reported[action], 10);
  });

  it.each<Failure>(['http', 'network', 'timeout', 'malformed'])('releases the reservation when OpenAI fails (%s)', async (reply) => {
    if (reply === 'timeout') jest.useFakeTimers({ doNotFake: ['Date'] });
    const convex = setup({ reply });
    const addressKey = await convex.addressKey();
    await convex.seedSpend('look:global', 0.25);
    await convex.seedSpend(addressKey, 0.05);
    expect(await convex.run(action)).toEqual({ ok: false, reason: 'failed' });
    expect(convex.events).toEqual(['lookUsage:reserve', 'fetch', 'lookUsage:settle']);
    expect(convex.mutationCalls[1].args).toMatchObject({ costUsd: null, reserveUsd: reserves[action] });
    expect(convex.spend('look:global')).toBeCloseTo(0.25, 12);
    expect(convex.spend(addressKey)).toBeCloseTo(0.05, 12);
  });

  it('never calls OpenAI when a call-count window refuses', async () => {
    const convex = setup();
    await convex.db.insert('memoryRateLimits', { key: `look:${action}:device:${await lookHash('device', DEVICE)}`, windowStart: NOW, count: LOOK_LIMITS[action].device.limit });
    expect(await convex.run(action)).toEqual({ ok: false, reason: 'limited' });
    expect(convex.events).toEqual(['lookUsage:reserve']);
    expect(convex.fetchMock).not.toHaveBeenCalled();
    expect(convex.db.table('describeUsage')).toHaveLength(0);
  });

  it('never calls OpenAI when the hourly budget refuses', async () => {
    const convex = setup();
    await convex.seedSpend('look:global', LOOK_BUDGET_USD_PER_HOUR);
    expect(await convex.run(action)).toEqual({ ok: false, reason: 'budget' });
    expect(convex.events).toEqual(['lookUsage:reserve']);
    expect(convex.fetchMock).not.toHaveBeenCalled();
    expect(convex.spend('look:global')).toBe(LOOK_BUDGET_USD_PER_HOUR);
  });

  it("never calls OpenAI when the address's third of the budget refuses, while other addresses are served", async () => {
    const convex = setup();
    const addressKey = await convex.addressKey();
    await convex.seedSpend(addressKey, LOOK_ADDRESS_BUDGET_USD_PER_HOUR);
    expect(await convex.run(action)).toEqual({ ok: false, reason: 'budget' });
    expect(convex.fetchMock).not.toHaveBeenCalled();
    expect(convex.db.table('memoryRateLimits')).toHaveLength(0);
    const other = setup({ ip: '198.51.100.9' });
    await other.seedSpend(addressKey, LOOK_ADDRESS_BUDGET_USD_PER_HOUR);
    expect(await other.run(action)).toMatchObject({ ok: true });
  });

  it('with no ip in the request metadata, applies only the device and deployment limits (a known limit, as in describe.ts)', async () => {
    const convex = setup({ ip: null });
    expect(await convex.run(action)).toMatchObject({ ok: true });
    expect(convex.events).toEqual(['lookUsage:reserve', 'fetch', 'lookUsage:settle']);
    const reserve = convex.mutationCalls[0].args;
    expect((reserve.checks as { key: string }[]).map((check) => check.key)).toEqual([`look:${action}:device:${await lookHash('device', DEVICE)}`, `look:${action}:deployment`]);
    expect(reserve.spends).toEqual([{ key: 'look:global', limitUsd: LOOK_BUDGET_USD_PER_HOUR }]);
    expect(convex.db.table('memoryRateLimits').map((row) => row.key)).not.toContainEqual(expect.stringContaining(':address:'));
    expect(convex.db.table('describeUsage').map((row) => row.key)).toEqual(['look:global']);
  });

  it('never reserves or calls OpenAI for an invalid image', async () => {
    const { maxBytes, maxSide } = IMAGE_LIMITS[action];
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0));
    for (const image of ['A'.repeat(Math.ceil(maxBytes / 3) * 4 + 4), jpeg(maxSide + 1, 64), png, `data:image/jpeg;base64,${jpeg(64, 64)}`]) {
      const convex = setup();
      expect(await convex.run(action, { image })).toEqual({ ok: false, reason: 'invalid' });
      expect(convex.events).toEqual([]);
      expect(convex.fetchMock).not.toHaveBeenCalled();
    }
  });
});
