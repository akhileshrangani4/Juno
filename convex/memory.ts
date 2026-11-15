import { v } from 'convex/values';

import { memoryRejection, type Memory } from '../src/agent/memoryClient';
import { MAX_FACTS } from '../src/agent/memoryRateLimits';
import { internal } from './_generated/api';
import { action, type ActionCtx } from './_generated/server';
import { authorizeMemory, fetchPlcDocument, memoryError, type MemoryAccess } from './memoryAuth';
import { memoryAudience } from './memoryService';

// Per-user memory in Supermemory. Each fact the user states is one document, so recall returns exactly what
// they said, at once, and deleting the document also forgets the memories Supermemory derived from it.
// SUPERMEMORY_API_KEY is set only in this deployment's environment. Who may use which memory: convex/memoryAuth.ts.

const API = 'https://api.supermemory.ai';
const SOURCE = 'user_stated';

const deviceAccess = v.object({ kind: v.literal('device'), deviceId: v.string(), secret: v.string() });
const accountAccess = v.object({ kind: v.literal('account'), did: v.string(), session: v.string(), proof: v.optional(v.string()) });
const access = v.union(deviceAccess, accountAccess);

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}


// The namespace is a hash, so Supermemory never sees the user's DID or device id.
async function namespaceFor(ctx: ActionCtx, memoryAccess: MemoryAccess): Promise<string> {
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!siteUrl) throw memoryError('proofRefused', 'notConfigured');
  const { ip } = await ctx.meta.getRequestMetadata();
  const userKey = await authorizeMemory(memoryAccess, {
    now: Date.now,
    audience: memoryAudience(siteUrl),
    addressHash: ip ? await sha256(`address:${ip}`) : null,
    sha256,
    take: (checks) => ctx.runMutation(internal.memoryLimits.take, { checks }),
    claimDevice: (key, secretHash, checks) => ctx.runMutation(internal.memoryOwners.claim, { userKey: key, secretHash, checks }),
    useSession: (did, sessionHash, checks) => ctx.runMutation(internal.memoryAccess.useSession, { did, sessionHash, checks }),
    openSession: (session) => ctx.runMutation(internal.memoryAccess.openSession, session),
    cachedKey: (did) => ctx.runQuery(internal.memoryAccess.cachedKey, { did }),
    storeKey: (did, key) => ctx.runMutation(internal.memoryAccess.storeKey, { did, key }),
    fetchDocument: (source) => (source.kind === 'plc' ? fetchPlcDocument(source.url) : ctx.runAction(internal.didWeb.fetchDocument, { host: source.host })),
  });
  return `consumerhack_${(await sha256(`memory:${userKey}`)).slice(0, 40)}`;
}

async function supermemory<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) throw new Error('Memory is not configured');
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Supermemory ${method} ${path.replace(/\/ns\/[^/]+/, '/ns/…')} failed with ${response.status}`);
  return (await response.json()) as T;
}

type Document = { id: string; content?: string | null; title?: string | null; metadata?: { source?: string; text?: string } };

async function listFacts(namespace: string): Promise<Memory[]> {
  const { documents } = await supermemory<{ documents: Document[] }>('POST', `/ns/${namespace}/list/documents?limit=50`, { include: { content: true } });
  return documents
    .filter((document) => document.metadata?.source === SOURCE)
    .map((document) => ({ id: document.id, text: document.metadata?.text ?? document.content ?? '' }))
    .filter((memory) => memory.text);
}

async function addFact(namespace: string, text: string): Promise<Memory> {
  const id = `fact_${crypto.randomUUID().replace(/-/g, '')}`;
  await supermemory('POST', `/ns/${namespace}/document`, { id, content: text, metadata: { source: SOURCE, text }, dreaming: 'instant' });
  return { id, text };
}

// The facts that are gone afterwards.
async function deleteFacts(namespace: string, facts: Memory[]): Promise<Memory[]> {
  if (!facts.length) return [];
  // A fact stored seconds ago can still be processing, and Supermemory refuses to delete it until it is done.
  for (let attempt = 0; attempt < 8; attempt++) {
    const { errors } = await supermemory<{ errors: { id: string; error: string }[] }>('DELETE', `/ns/${namespace}/document`, { ids: facts.map((memory) => memory.id) });
    if (!errors.some((error) => /processing/i.test(error.error))) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const left = new Set((await listFacts(namespace)).map((memory) => memory.id));
  return facts.filter((memory) => !left.has(memory.id));
}

export const remember = action({
  args: { access, fact: v.string() },
  handler: async (ctx, { access, fact }): Promise<Memory> => {
    const text = fact.trim();
    const rejected = memoryRejection(text, null);
    if (rejected) throw new Error(`Not stored: ${rejected}`);
    const namespace = await namespaceFor(ctx, access);
    if ((await listFacts(namespace)).length >= MAX_FACTS) throw new Error(`Not stored: memory is full (${MAX_FACTS} facts). Forget something first.`);
    return addFact(namespace, text);
  },
});

export const list = action({
  args: { access },
  handler: async (ctx, { access }): Promise<Memory[]> => listFacts(await namespaceFor(ctx, access)),
});

export const forget = action({
  args: { access, ids: v.array(v.string()) },
  handler: async (ctx, { access, ids }): Promise<Memory[]> => {
    const namespace = await namespaceFor(ctx, access);
    return deleteFacts(namespace, (await listFacts(namespace)).filter((memory) => ids.includes(memory.id)));
  },
});

// After a signed-out user signs in and says yes: what they saved on this phone moves to their account. Facts the
// account already has aren't copied twice, and what doesn't fit under MAX_FACTS stays on the phone.
export const carryOver = action({
  args: { from: deviceAccess, to: accountAccess },
  handler: async (ctx, { from, to }): Promise<{ carried: number; left: number }> => {
    const source = await namespaceFor(ctx, from);
    const target = await namespaceFor(ctx, to);
    const [saved, existing] = await Promise.all([listFacts(source), listFacts(target)]);
    const known = new Set(existing.map((memory) => memory.text.trim().toLowerCase()));
    const moved: Memory[] = [];
    let room = MAX_FACTS - existing.length;
    for (const memory of saved) {
      const duplicate = known.has(memory.text.trim().toLowerCase());
      if (!duplicate && room <= 0) continue;
      if (!duplicate) {
        await addFact(target, memory.text);
        known.add(memory.text.trim().toLowerCase());
        room--;
      }
      moved.push(memory);
    }
    const removed = await deleteFacts(source, moved);
    return { carried: moved.length, left: saved.length - removed.length };
  },
});
