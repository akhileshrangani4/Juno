import { p256 } from '@noble/curves/nist.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';

import { authorizeMemory, didSource, isPublicAddress, signingKeyOf, type AuthDeps, type DidSource, type MemoryAccess, type SigningKey } from '../../../convex/memoryAuth';
import { MEMORY_METHOD, memoryAudience } from '../../../convex/memoryService';
import { MEMORY_LIMITS, takeOne, type Bucket, type RateCheck } from '../memoryRateLimits';

const AUDIENCE = memoryAudience('https://dependable-goshawk-583.convex.site');
const ALICE = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const NOW = Date.UTC(2026, 10, 15, 12) ;
const SESSION_A = 'a'.repeat(64);
const SESSION_B = 'b'.repeat(64);

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Uint8Array): string {
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
  let text = '';
  for (; value > 0n; value /= 58n) text = BASE58[Number(value % 58n)] + text;
  return '1'.repeat(bytes.findIndex((byte) => byte !== 0)) + text;
}

type Account = { did: string; curve: 'k256' | 'p256'; secretKey: Uint8Array };

function account(did: string, curve: 'k256' | 'p256' = 'k256'): Account {
  const lib = curve === 'k256' ? secp256k1 : p256;
  return { did, curve, secretKey: lib.utils.randomSecretKey() };
}

function didDocument({ did, curve, secretKey }: Account): string {
  const lib = curve === 'k256' ? secp256k1 : p256;
  const prefix = curve === 'k256' ? [0xe7, 0x01] : [0x80, 0x24];
  const multikey = `z${base58(Uint8Array.from([...prefix, ...lib.getPublicKey(secretKey, true)]))}`;
  return JSON.stringify({
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: did,
    alsoKnownAs: ['at://someone.bsky.social'],
    verificationMethod: [{ id: `${did}#atproto`, type: 'Multikey', controller: did, publicKeyMultibase: multikey }],
    service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }],
  });
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

// What a Bluesky PDS's com.atproto.server.getServiceAuth returns (createServiceJwt in @atproto/xrpc-server).
function serviceToken(signer: Account, claims: Partial<{ iss: string; aud: string; lxm: string; exp: number; iat: number; jti: string }> = {}): string {
  const iat = Math.floor(NOW / 1000);
  const header = { typ: 'JWT', alg: signer.curve === 'k256' ? 'ES256K' : 'ES256' };
  const payload = { iat, iss: signer.did, aud: AUDIENCE, exp: iat + 60, lxm: MEMORY_METHOD, jti: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex'), ...claims };
  const input = `${b64(header)}.${b64(payload)}`;
  const signature = (signer.curve === 'k256' ? secp256k1 : p256).sign(new TextEncoder().encode(input), signer.secretKey);
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}

// The same rules as the Convex side (memoryLimits.take, memoryOwners.claim, memoryAccess.*), in memory, with a
// log of every step so the order can be checked.
function server(documents: Record<string, string> = {}) {
  const log: string[] = [];
  const buckets = new Map<string, Bucket>();
  const owners = new Map<string, string>();
  const proofs = new Map<string, string>();
  const sessions = new Map<string, { did: string; expiresAt: number }>();
  const keys = new Map<string, { key: SigningKey; fetchedAt: number }>();
  let now = NOW;
  const take = (checks: RateCheck[]) => {
    const next = checks.map((check) => takeOne(buckets.get(check.key) ?? null, check, now));
    if (next.some((bucket) => !bucket)) return false;
    checks.forEach((check, i) => buckets.set(check.key, next[i]!));
    return true;
  };
  const live = (did: string, hash: string) => {
    const session = sessions.get(hash);
    return !!session && session.did === did && session.expiresAt > now;
  };
  const deps: AuthDeps = {
    now: () => now,
    audience: AUDIENCE,
    addressHash: 'address-1',
    sha256: async (text) => `h(${text})`,
    take: async (checks) => {
      log.push(`take ${checks.map((check) => check.key).join(',')}`);
      return take(checks);
    },
    claimDevice: async (userKey, secretHash, checks) => {
      log.push(`claimDevice ${userKey}`);
      if (!owners.has(userKey)) owners.set(userKey, secretHash);
      if (owners.get(userKey) !== secretHash) return 'notOwner';
      return take(checks) ? 'ok' : 'limited';
    },
    useSession: async (did, hash, checks) => {
      log.push('useSession');
      if (!live(did, hash)) return 'unknown';
      log.push(`take ${checks[0].key}`);
      return take(checks) ? 'ok' : 'limited';
    },
    openSession: async ({ proofId, did, sessionHash, expiresAt, checks }) => {
      log.push('openSession');
      const used = proofs.get(proofId);
      if (used !== undefined && (used !== sessionHash || !live(did, sessionHash))) return 'replayed';
      if (used === undefined) {
        proofs.set(proofId, sessionHash);
        sessions.set(sessionHash, { did, expiresAt });
      }
      log.push(`take ${checks[0].key}`);
      return take(checks) ? 'ok' : 'limited';
    },
    cachedKey: async (did) => {
      log.push('cachedKey');
      return keys.get(did) ?? null;
    },
    storeKey: async (did, key) => void keys.set(did, { key, fetchedAt: now }),
    fetchDocument: async (source: DidSource) => {
      log.push(`fetch ${source.kind === 'plc' ? source.url : source.host}`);
      return documents[source.kind === 'plc' ? source.url.replace('https://plc.directory/', '') : `did:web:${source.host}`] ?? null;
    },
  };
  return {
    deps,
    log,
    owners,
    buckets,
    advance: (ms: number) => void (now += ms),
    authorize: (access: MemoryAccess) => authorizeMemory(access, deps),
  };
}

const refused = (reason: string) => expect.objectContaining({ data: { code: 'proofRefused', reason } });
const asAccount = (did: string, session: string, proof?: string): MemoryAccess => ({ kind: 'account', did, session, proof });

describe('signed-in memory access', () => {
  const alice = account(ALICE);
  const bob = account(BOB, 'p256');
  const documents = { [ALICE]: didDocument(alice), [BOB]: didDocument(bob) };

  it("accepts a proof signed by the account's own key, with either key type", async () => {
    const memory = server(documents);
    await expect(memory.authorize(asAccount(ALICE, SESSION_A, serviceToken(alice)))).resolves.toBe(`bsky:${ALICE}`);
    await expect(memory.authorize(asAccount(BOB, SESSION_B, serviceToken(bob)))).resolves.toBe(`bsky:${BOB}`);
  });

  it('opens a session for the life of the proof, so later calls fetch nothing and need no new proof', async () => {
    const memory = server(documents);
    await memory.authorize(asAccount(ALICE, SESSION_A, serviceToken(alice)));
    memory.log.length = 0;
    await expect(memory.authorize(asAccount(ALICE, SESSION_A))).resolves.toBe(`bsky:${ALICE}`);
    expect(memory.log).toEqual(['take address:address-1,deployment', 'useSession', `take user:bsky:${ALICE}`]);
    memory.advance(60_000);
    await expect(memory.authorize(asAccount(ALICE, SESSION_A))).rejects.toEqual(expect.objectContaining({ data: { code: 'proofNeeded' } }));
  });

  it("checks the DID document once, then the cached key, until a signature fails and the key may have changed", async () => {
    const memory = server(documents);
    await memory.authorize(asAccount(ALICE, SESSION_A, serviceToken(alice)));
    await memory.authorize(asAccount(ALICE, SESSION_B, serviceToken(alice)));
    expect(memory.log.filter((step) => step.startsWith('fetch'))).toEqual([`fetch https://plc.directory/${ALICE}`]);
    const rotated = { ...alice, secretKey: secp256k1.utils.randomSecretKey() };
    documents[ALICE] = didDocument(rotated);
    memory.advance(61_000);
    await expect(memory.authorize(asAccount(ALICE, 'c'.repeat(64), serviceToken(rotated, { iat: Math.floor(NOW / 1000) + 61, exp: Math.floor(NOW / 1000) + 121 })))).resolves.toBe(`bsky:${ALICE}`);
    expect(memory.log.filter((step) => step.startsWith('fetch'))).toHaveLength(2);
    documents[ALICE] = didDocument(alice);
  });

  it("refuses a proof for one account presented for another, and one claiming an account it wasn't signed by", async () => {
    const memory = server(documents);
    await expect(memory.authorize(asAccount(BOB, SESSION_A, serviceToken(alice)))).rejects.toEqual(refused('wrongAccount'));
    await expect(memory.authorize(asAccount(BOB, SESSION_A, serviceToken(alice, { iss: BOB })))).rejects.toEqual(refused('badSignature'));
  });

  it('refuses the wrong audience, the wrong method, an expired proof and one that lives too long', async () => {
    const memory = server(documents);
    const iat = Math.floor(NOW / 1000);
    await expect(memory.authorize(asAccount(ALICE, SESSION_A, serviceToken(alice, { aud: 'did:web:api.bsky.app#bsky_appview' })))).rejects.toEqual(refused('wrongAudience'));
    await expect(memory.authorize(asAccount(ALICE, SESSION_A, serviceToken(alice, { lxm: 'app.bsky.feed.getTimeline' })))).rejects.toEqual(refused('wrongMethod'));
    await expect(memory.authorize(asAccount(ALICE, SESSION_A, serviceToken(alice, { iat: iat - 120, exp: iat - 1 })))).rejects.toEqual(refused('expired'));
    await expect(memory.authorize(asAccount(ALICE, SESSION_A, serviceToken(alice, { exp: iat + 3600 })))).rejects.toEqual(refused('tooLong'));
    expect(memory.log.some((step) => step.startsWith('fetch') || step === 'cachedKey')).toBe(false);
  });

  it('refuses a proof used before, unless it comes with the session it opened', async () => {
    const memory = server(documents);
    const proof = serviceToken(alice);
    await memory.authorize(asAccount(ALICE, SESSION_A, proof));
    await expect(memory.authorize(asAccount(ALICE, SESSION_B, proof))).rejects.toEqual(refused('replayed'));
    await expect(memory.authorize(asAccount(ALICE, SESSION_A, proof))).resolves.toBe(`bsky:${ALICE}`);
  });

  it('refuses a badly signed proof: another key, a changed payload, a broken token', async () => {
    const memory = server(documents);
    const impostor = { ...alice, secretKey: secp256k1.utils.randomSecretKey() };
    await expect(memory.authorize(asAccount(ALICE, SESSION_A, serviceToken(impostor)))).rejects.toEqual(refused('badSignature'));
    const [header, , signature] = serviceToken(alice).split('.');
    const changed = b64({ iat: Math.floor(NOW / 1000), iss: ALICE, aud: AUDIENCE, exp: Math.floor(NOW / 1000) + 60, lxm: MEMORY_METHOD, jti: 'changed-nonce-1' });
    await expect(memory.authorize(asAccount(ALICE, SESSION_A, `${header}.${changed}.${signature}`))).rejects.toEqual(refused('badSignature'));
    await expect(memory.authorize(asAccount(ALICE, SESSION_A, 'not.a.token'))).rejects.toEqual(refused('malformed'));
    const k256AsP256 = serviceToken(alice).replace(b64({ typ: 'JWT', alg: 'ES256K' }), b64({ typ: 'JWT', alg: 'ES256' }));
    await expect(memory.authorize(asAccount(ALICE, SESSION_A, k256AsP256))).rejects.toEqual(refused('badSignature'));
  });

  it("refuses when the DID document can't be had, or doesn't hold the account's key", async () => {
    const memory = server({ [ALICE]: JSON.stringify({ id: BOB, verificationMethod: [] }) });
    await expect(memory.authorize(asAccount(ALICE, SESSION_A, serviceToken(alice)))).rejects.toEqual(refused('badSignature'));
    await expect(server({}).authorize(asAccount(ALICE, SESSION_A, serviceToken(alice)))).rejects.toEqual(refused('badSignature'));
  });

  it('gives two devices signed in as the same account the same memory, with no setup', async () => {
    const memory = server(documents);
    const phone = await memory.authorize(asAccount(ALICE, SESSION_A, serviceToken(alice)));
    const tablet = await memory.authorize(asAccount(ALICE, SESSION_B, serviceToken(alice)));
    expect(phone).toBe(tablet);
    await expect(memory.authorize(asAccount(ALICE, SESSION_A))).resolves.toBe(phone);
    await expect(memory.authorize(asAccount(ALICE, SESSION_B))).resolves.toBe(phone);
  });

  it("isn't blocked by an old first-come device-secret claim on the account's key", async () => {
    const memory = server(documents);
    memory.owners.set(`bsky:${ALICE}`, 'h(a stranger)');
    await expect(memory.authorize(asAccount(ALICE, SESSION_A, serviceToken(alice)))).resolves.toBe(`bsky:${ALICE}`);
    expect(memory.log.some((step) => step.startsWith('claimDevice'))).toBe(false);
  });

  it("takes the caller's windows before any verification or fetch, the fetch window before the fetch, and the user's window only after the proof checks out", async () => {
    const memory = server(documents);
    await memory.authorize(asAccount(ALICE, SESSION_A, serviceToken(alice)));
    expect(memory.log).toEqual([
      'take address:address-1,deployment',
      'useSession',
      'cachedKey',
      'take didFetch',
      `fetch https://plc.directory/${ALICE}`,
      'openSession',
      `take user:bsky:${ALICE}`,
    ]);

    const stranger = server(documents);
    for (let i = 0; i < 40; i++) await stranger.authorize(asAccount(ALICE, SESSION_B, serviceToken(bob))).catch(() => undefined);
    expect(stranger.buckets.get(`user:bsky:${ALICE}`)).toBeUndefined();
  });

  it('does no verification work at all once the caller is over its limit', async () => {
    const memory = server(documents);
    for (let i = 0; i < MEMORY_LIMITS.address.limit; i++) await memory.deps.take([{ key: 'address:address-1', ...MEMORY_LIMITS.address }]);
    memory.log.length = 0;
    await expect(memory.authorize(asAccount(ALICE, SESSION_A, serviceToken(alice)))).rejects.toEqual(expect.objectContaining({ data: { code: 'tooMany' } }));
    expect(memory.log).toEqual(['take address:address-1,deployment']);
  });

  it('stops fetching DID documents when the fetch window is used up', async () => {
    const memory = server(documents);
    for (let i = 0; i < MEMORY_LIMITS.didFetch.limit; i++) await memory.deps.take([{ key: 'didFetch', ...MEMORY_LIMITS.didFetch }]);
    await expect(memory.authorize(asAccount(ALICE, SESSION_A, serviceToken(alice)))).rejects.toEqual(expect.objectContaining({ data: { code: 'tooMany' } }));
    expect(memory.log.some((step) => step.startsWith('fetch'))).toBe(false);
  });
});

describe('signed-out memory access', () => {
  const device = (deviceId: string, secret: string): MemoryAccess => ({ kind: 'device', deviceId, secret });

  it('lets the first device claim its own random key, and refuses another secret', async () => {
    const memory = server();
    const id = 'c'.repeat(48);
    await expect(memory.authorize(device(id, 'secret-of-this-phone'))).resolves.toBe(`device:${id}`);
    await expect(memory.authorize(device(id, 'secret-of-this-phone'))).resolves.toBe(`device:${id}`);
    await expect(memory.authorize(device(id, 'someone-elses-secret'))).rejects.toEqual(expect.objectContaining({ data: { code: 'notOwner' } }));
  });

  it("can't reach an account's memory with a device secret", async () => {
    const memory = server();
    await expect(memory.authorize(device(`bsky:${ALICE}`, 'secret-of-this-phone'))).rejects.toEqual(expect.objectContaining({ data: { code: 'invalid' } }));
  });
});

describe('DID documents', () => {
  it('fetches only did:plc from plc.directory and did:web on a public host name', () => {
    expect(didSource(ALICE)).toEqual({ kind: 'plc', url: `https://plc.directory/${ALICE}` });
    expect(didSource('did:web:alice.example.org')).toEqual({ kind: 'web', host: 'alice.example.org' });
    for (const did of [
      'did:plc:short',
      'did:plc:AAAAAAAAAAAAAAAAAAAAAAAA',
      'did:web:localhost',
      'did:web:127.0.0.1',
      'did:web:10.0.0.1',
      'did:web:[::1]',
      'did:web:example.com%3A8080',
      'did:web:example.com:users:alice',
      'did:web:printer.local',
      'did:web:metadata.google.internal',
      'did:web:1.0.0.127.in-addr.arpa',
      'did:web:Example.com',
      'did:key:zQ3shokFTS3brHcDQrn82RUDfCZESWL1ZdCEJwekUDPQiYBme',
      `did:web:${'a'.repeat(250)}.com`,
    ]) {
      expect([did, didSource(did)]).toEqual([did, null]);
    }
  });

  it('only lets a did:web host resolve to public addresses', () => {
    for (const address of ['93.184.215.14', '1.1.1.1', '2606:4700:4700::1111', '2a00:1450:4001:82a::200e']) expect([address, isPublicAddress(address)]).toEqual([address, true]);
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12:3456::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::ffff:a9fe:a9fe',
      '64:ff9b::a9fe:a9fe',
      '2001:db8::1',
      '2002:7f00:1::',
      'not an address',
    ]) {
      expect([address, isPublicAddress(address)]).toEqual([address, false]);
    }
  });

  it("reads the account's #atproto key and nothing else", () => {
    const alice = account(ALICE);
    const document = JSON.parse(didDocument(alice));
    expect(signingKeyOf(document, ALICE)).toEqual({ curve: 'k256', publicKey: Buffer.from(secp256k1.getPublicKey(alice.secretKey, true)).toString('hex') });
    expect(signingKeyOf(document, BOB)).toBeNull();
    expect(signingKeyOf({ ...document, verificationMethod: [{ ...document.verificationMethod[0], id: `${ALICE}#other` }] }, ALICE)).toBeNull();
    expect(signingKeyOf({ ...document, verificationMethod: [{ ...document.verificationMethod[0], publicKeyMultibase: 'z111' }] }, ALICE)).toBeNull();
  });
});
