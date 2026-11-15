import { authorizeMemory, fetchPlcDocument, type AuthDeps, type MemoryAccess, type SigningKey } from '../../../convex/memoryAuth';
import { MEMORY_METHOD, memoryAudience } from '../../../convex/memoryService';
import { takeOne, type Bucket } from '../memoryRateLimits';

// The memory proof against Bluesky's real servers (AKH-18): an app-password session asks bsky.social for a proof
// with the same XRPC call as BlueskyProvider.serviceAuth, and convex/memoryAuth.ts checks it against the account's
// real DID document on plc.directory. Storage is in memory here; the checks are the shipped code. (The script
// calls XRPC itself because BlueskyProvider pulls in Expo's native OAuth modules, which don't bundle for Node.)
//   BLUESKY_TEST_HANDLE=... BLUESKY_TEST_APP_PASSWORD=... pnpm eval:memory-proof
// Prints outcomes and timings only, never a token or a credential.

const handle = process.env.BLUESKY_TEST_HANDLE ?? '';
const password = process.env.BLUESKY_TEST_APP_PASSWORD ?? '';
const AUDIENCE = memoryAudience(process.env.CONVEX_SITE_URL ?? 'https://dependable-goshawk-583.convex.site');
const OTHER_DID = 'did:plc:z72i7hdynmk6r22z27h6tvur';

const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

function deps(timings: Record<string, number>): AuthDeps {
  const buckets = new Map<string, Bucket>();
  const proofs = new Map<string, string>();
  const sessions = new Map<string, { did: string; expiresAt: number }>();
  const keys = new Map<string, { key: SigningKey; fetchedAt: number }>();
  const take = (checks: { key: string; limit: number; windowMs: number }[]) => {
    const next = checks.map((check) => takeOne(buckets.get(check.key) ?? null, check, Date.now()));
    if (next.some((bucket) => !bucket)) return false;
    checks.forEach((check, i) => buckets.set(check.key, next[i]!));
    return true;
  };
  const live = (did: string, hash: string) => (sessions.get(hash)?.did === did && (sessions.get(hash)?.expiresAt ?? 0) > Date.now());
  return {
    now: Date.now,
    audience: AUDIENCE,
    addressHash: 'local',
    sha256: async (text) => text,
    take: async (checks) => take(checks),
    claimDevice: async () => 'notOwner',
    useSession: async (did, hash, checks) => (!live(did, hash) ? 'unknown' : take(checks) ? 'ok' : 'limited'),
    openSession: async ({ proofId, did, sessionHash, expiresAt, checks }) => {
      const used = proofs.get(proofId);
      if (used !== undefined && (used !== sessionHash || !live(did, sessionHash))) return 'replayed';
      if (used === undefined) {
        proofs.set(proofId, sessionHash);
        sessions.set(sessionHash, { did, expiresAt });
      }
      return take(checks) ? 'ok' : 'limited';
    },
    cachedKey: async (did) => keys.get(did) ?? null,
    storeKey: async (did, key) => void keys.set(did, { key, fetchedAt: Date.now() }),
    fetchDocument: async (source) => {
      if (source.kind !== 'plc') return null;
      const started = performance.now();
      const text = await fetchPlcDocument(source.url);
      timings[`DID document fetch (${source.url.endsWith(OTHER_DID) ? 'other account' : 'test account'})`] = Math.round(performance.now() - started);
      return text;
    },
  };
}

async function xrpc(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`https://bsky.social/xrpc/${path}`, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { message?: string }).message ?? `${path.split('?')[0]} failed with ${response.status}`);
  return body;
}

async function outcome(run: () => Promise<string>): Promise<string> {
  try {
    return `accepted as ${(await run()).replace(/did:plc:\w+/, (did) => (did === OTHER_DID ? 'the other account' : 'the test account'))}`;
  } catch (error) {
    const data = (error as { data?: { code: string; reason?: string } }).data;
    return data ? `refused: ${data.code}${data.reason ? ` (${data.reason})` : ''}` : `error: ${(error as Error).message}`;
  }
}

function claimsOf(token: string) {
  const { iat, exp, lxm, aud, jti } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  return { lifetimeSeconds: exp - iat, lxm, aud, hasNonce: typeof jti === 'string' && jti.length >= 16 };
}

async function main() {
  if (!handle || !password) throw new Error('BLUESKY_TEST_HANDLE and BLUESKY_TEST_APP_PASSWORD are required');
  const created = await xrpc('com.atproto.server.createSession', { method: 'POST', body: JSON.stringify({ identifier: handle, password }) });
  const { did, accessJwt, refreshJwt } = created as { did: string; accessJwt: string; refreshJwt: string };
  const provider = {
    serviceAuth: async ({ aud, lxm }: { aud: string; lxm: string }) =>
      ((await xrpc(`com.atproto.server.getServiceAuth?${new URLSearchParams({ aud, lxm })}`, { headers: { authorization: `Bearer ${accessJwt}` } })) as { token: string }).token,
  };
  const timings: Record<string, number> = {};
  const server = deps(timings);
  const results: Record<string, unknown> = {};

  let started = performance.now();
  const proof = await provider.serviceAuth({ aud: AUDIENCE, lxm: MEMORY_METHOD });
  timings['proof from bsky.social (first)'] = Math.round(performance.now() - started);
  started = performance.now();
  const second = await provider.serviceAuth({ aud: AUDIENCE, lxm: MEMORY_METHOD });
  timings['proof from bsky.social (second)'] = Math.round(performance.now() - started);
  results['proof claims'] = claimsOf(proof);

  const session = randomHex(32);
  const access = (overrides: Partial<Extract<MemoryAccess, { kind: 'account' }>> = {}): MemoryAccess => ({ kind: 'account', did, session, proof, ...overrides });
  started = performance.now();
  results['real proof for the test account'] = await outcome(() => authorizeMemory(access(), server));
  timings['first check (key not cached)'] = Math.round(performance.now() - started);
  started = performance.now();
  results['later call in the same session, no proof'] = await outcome(() => authorizeMemory(access({ proof: undefined }), server));
  timings['later call (session)'] = Math.round(performance.now() - started);
  started = performance.now();
  results['second proof, second device'] = await outcome(() => authorizeMemory(access({ session: randomHex(32), proof: second }), server));
  timings['second proof check (key cached)'] = Math.round(performance.now() - started);
  results['same proof replayed with another session'] = await outcome(() => authorizeMemory(access({ session: randomHex(32) }), server));
  results['proof for the test account presented for another account'] = await outcome(() => authorizeMemory(access({ did: OTHER_DID, session: randomHex(32) }), server));
  const [header, payload, signature] = proof.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), iss: OTHER_DID })).toString('base64url');
  results["test account's signature on a proof claiming another account"] = await outcome(() =>
    authorizeMemory(access({ did: OTHER_DID, session: randomHex(32), proof: `${header}.${forged}.${signature}` }), server),
  );
  const elsewhere = await provider.serviceAuth({ aud: 'did:web:api.bsky.app#bsky_appview', lxm: MEMORY_METHOD });
  results['real proof for another audience'] = await outcome(() => authorizeMemory(access({ session: randomHex(32), proof: elsewhere }), server));
  const otherMethod = await provider.serviceAuth({ aud: AUDIENCE, lxm: 'app.bsky.feed.getTimeline' });
  results['real proof for another method'] = await outcome(() => authorizeMemory(access({ session: randomHex(32), proof: otherMethod }), server));
  await new Promise((resolve) => setTimeout(resolve, 61_000));
  results['the first proof again, a minute later, with a new session'] = await outcome(() => authorizeMemory(access({ session: randomHex(32) }), server));
  results['bsky.social refuses a proof for a protected method'] = await provider
    .serviceAuth({ aud: AUDIENCE, lxm: 'com.atproto.identity.requestPlcOperationSignature' })
    .then(() => 'issued', (error: Error) => `refused: ${error.message}`);

  await xrpc('com.atproto.server.deleteSession', { method: 'POST', headers: { authorization: `Bearer ${refreshJwt}` } }).catch(() => undefined);
  console.log(JSON.stringify({ results, timingsMs: timings }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
