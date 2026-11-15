import { ConvexError } from 'convex/values';

import { createMemoryStore } from '@/storage/keyValueStore';

import { MEMORY_METHOD, memoryAudience } from '../../../convex/memoryService';
import { createMemoryClient } from '../convexMemory';
import { createMemoryAccess, proofLifetimeMs } from '../memoryAccess';
import { PermissionMissingError } from '@/social/types';

import { MemorySignInNeededError, MemoryUnavailableError } from '../memoryClient';
import { SIGNED_OUT_MEMORIES } from '../memoryOffer';

const AUDIENCE = memoryAudience('https://dependable-goshawk-583.convex.site');
const ALICE = { id: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', handle: 'alice.bsky.social' };

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (n: number) => `${b64({ alg: 'ES256K' })}.${b64({ iat: 1000, exp: 1060, jti: `nonce-${n}` })}.sig`;

function phone(signedIn: typeof ALICE | null = ALICE) {
  let now = 0;
  let n = 0;
  let account = signedIn;
  const store = createMemoryStore();
  const serviceAuth = jest.fn(async (_request: { aud: string; lxm: string }) => token(++n));
  const access = createMemoryAccess({ store, account: () => account, serviceAuth, audience: AUDIENCE, now: () => now });
  const sent: { name: string; args: any }[] = [];
  const replies: unknown[] = [];
  const action = jest.fn(async (name: string, args: Record<string, unknown>) => {
    sent.push({ name, args });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return (reply ?? (name === 'remember' ? { id: 'fact_1', text: args.fact } : [])) as never;
  });
  const memory = createMemoryClient(action as never, access, store);
  return { memory, sent, replies, serviceAuth, store, advance: (ms: number) => void (now += ms), signIn: (next: typeof ALICE | null) => void (account = next) };
}

describe('memory access on the phone', () => {
  it("asks the account's own server for a proof for Juno's memory method and this deployment", async () => {
    const { memory, sent, serviceAuth } = phone();
    await memory.list();
    expect(serviceAuth).toHaveBeenCalledWith({ aud: AUDIENCE, lxm: MEMORY_METHOD });
    expect(sent[0].args.access).toEqual({ kind: 'account', did: ALICE.id, session: expect.stringMatching(/^[0-9a-f]{64}$/), proof: token(1) });
  });

  it('sends nothing but the DID, the proof and its own session secret', async () => {
    const { memory, sent } = phone();
    await memory.remember('Call me Sam.');
    expect(Object.keys(sent[0].args.access).sort()).toEqual(['did', 'kind', 'proof', 'session']);
    expect(Object.keys(sent[0].args).sort()).toEqual(['access', 'fact']);
  });

  it("uses one proof for the conversation's calls until shortly before it expires", async () => {
    const { memory, sent, serviceAuth, advance } = phone();
    await memory.list();
    advance(30_000);
    await memory.remember('Call me Sam.');
    expect(serviceAuth).toHaveBeenCalledTimes(1);
    expect(sent[1].args.access.session).toBe(sent[0].args.access.session);
    advance(25_000);
    await memory.list();
    expect(serviceAuth).toHaveBeenCalledTimes(2);
    expect(sent[2].args.access.session).not.toBe(sent[0].args.access.session);
  });

  it('gets one new proof when the server no longer knows the session', async () => {
    const { memory, sent, replies, serviceAuth } = phone();
    replies.push(new ConvexError({ code: 'proofNeeded' }));
    await expect(memory.list()).resolves.toEqual([]);
    expect(serviceAuth).toHaveBeenCalledTimes(2);
    expect(sent[1].args.access.proof).toBe(token(2));
  });

  it("says memory can't be reached when no proof can be had or it is refused, and never falls back to the device key", async () => {
    const offline = phone();
    offline.serviceAuth.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(offline.memory.list()).rejects.toBeInstanceOf(MemoryUnavailableError);
    expect(offline.sent).toEqual([]);

    const refused = phone();
    refused.replies.push(new ConvexError({ code: 'proofRefused', reason: 'badSignature' }));
    await expect(refused.memory.remember('Call me Sam.')).rejects.toBeInstanceOf(MemoryUnavailableError);
    expect(refused.sent.map(({ args }) => args.access.kind)).toEqual(['account']);
  });

  it('tells a sign-in that lacks the memory permission apart from memory being out of reach', async () => {
    const { memory, serviceAuth, sent } = phone();
    serviceAuth.mockRejectedValue(new PermissionMissingError('no memory scope'));
    await expect(memory.list()).rejects.toBeInstanceOf(MemorySignInNeededError);
    serviceAuth.mockRejectedValue(new Error('Network request failed'));
    const error = await memory.list().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MemoryUnavailableError);
    expect(error).not.toBeInstanceOf(MemorySignInNeededError);
    expect(sent).toEqual([]);
  });

  it('turns the server codes into plain words', async () => {
    const { memory, replies } = phone();
    replies.push(new ConvexError({ code: 'tooMany' }));
    await expect(memory.list()).rejects.toThrow('Too many memory requests. Try again in a few minutes.');
  });

  it("uses this phone's own key when signed out, and notes that there is something to offer after sign-in", async () => {
    const { memory, sent, serviceAuth, store } = phone(null);
    await memory.remember('Call me Sam.');
    expect(serviceAuth).not.toHaveBeenCalled();
    expect(sent[0].args.access).toEqual({ kind: 'device', deviceId: expect.stringMatching(/^[0-9a-f]{48}$/), secret: expect.stringMatching(/^[0-9a-f]{48}$/) });
    await expect(store.get(SIGNED_OUT_MEMORIES)).resolves.toBe('1');
  });

  it("moves what was saved signed out from this phone's key to the account", async () => {
    const { memory, sent, replies } = phone();
    replies.push({ carried: 2, left: 0 });
    await expect(memory.carryOver()).resolves.toEqual({ carried: 2, left: 0 });
    expect(sent[0]).toEqual({ name: 'carryOver', args: { from: expect.objectContaining({ kind: 'device' }), to: expect.objectContaining({ kind: 'account', did: ALICE.id }) } });
  });

  it("reads a proof's lifetime from the token itself, not the phone's clock", () => {
    expect(proofLifetimeMs(token(1))).toBe(60_000);
    expect(proofLifetimeMs('garbage')).toBe(0);
  });
});
