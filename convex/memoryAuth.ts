import { p256 } from '@noble/curves/nist.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ConvexError } from 'convex/values';

import { callerChecks, didFetchChecks, userCheck, type RateCheck } from '../src/agent/memoryRateLimits';
import { MEMORY_METHOD } from './memoryService';

// Who may use a memory key (AKH-18). Pure logic with its storage and network passed in, so it is unit tested in
// src/agent/__tests__/memoryAuth.test.ts; convex/memory.ts wires it to Convex.
//
// - Signed out, the key is device:<random id> with a secret from the device's keychain. The id isn't public,
//   so the first device to use it owns it.
// - Signed in, the key is bsky:<DID>, which is public, so the caller has to prove they are signed in as that DID:
//   a service-auth token (https://atproto.com/specs/xrpc#inter-service-authentication-jwt) that the user's own
//   Bluesky server signs with the account's signing key, for this deployment as audience and MEMORY_METHOD as
//   method, valid for 60 seconds. It is checked against the #atproto key in the DID document and used once: it
//   opens a session for a random secret the phone made, which later calls present until the token's expiry.
//   No Bluesky session, refresh token, DPoP key or app password ever reaches this deployment.
//
// Order: the caller's address and the deployment windows first, before any verification work or network fetch;
// then the proof; then the user's own window, so a stranger can't use up someone else's allowance.

export const PROOF_LIFETIME_LIMIT_SECONDS = 120;
const CLOCK_SKEW_SECONDS = 30;
// A key read from a DID document is trusted for a day, so a returning user costs no fetch. The trade-off: a key the
// account rotated away keeps opening that account's memory (and nothing else) for up to a day.
export const KEY_CACHE_MS = 24 * 60 * 60_000;
// After any fetch of a DID's document, whatever came of it, that DID isn't fetched again for ten minutes: a DID
// that didn't resolve, or whose proof failed against a fresh key, is refused from the cache. A real key rotation
// is picked up within ten minutes.
export const REFETCH_AFTER_MS = 10 * 60_000;
export const DID_FETCH_TIMEOUT_MS = 3000;
export const DID_DOCUMENT_MAX_BYTES = 64 * 1024;

export type MemoryAccess =
  | { kind: 'device'; deviceId: string; secret: string }
  | { kind: 'account'; did: string; session: string; proof?: string };

export type MemoryErrorCode = 'invalid' | 'tooMany' | 'notOwner' | 'proofNeeded' | 'proofRefused';

export function memoryError(code: MemoryErrorCode, reason?: string): ConvexError<{ code: MemoryErrorCode; reason?: string }> {
  return new ConvexError(reason ? { code, reason } : { code });
}

export type SigningKey = { curve: 'p256' | 'k256'; publicKey: string };

// What the last fetch of a DID's document gave: its key, or null when it couldn't be had.
export type CachedKey = { key: SigningKey | null; fetchedAt: number };

export type DidSource = { kind: 'plc'; url: string } | { kind: 'web'; host: string };

const PLC = /^did:plc:[a-z2-7]{24}$/;
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
// did:web with a bare host name only: no port, no path, no IP address, and no names that only exist on a local
// network. The host is still checked against private addresses when it is resolved (convex/didWeb.ts).
const WEB = new RegExp(`^did:web:(${LABEL}(?:\\.${LABEL})*\\.[a-z][a-z0-9-]*[a-z0-9])$`);
const LOCAL_SUFFIX = /\.(?:local|localhost|internal|intranet|lan|home|corp|arpa|test|example|invalid|onion)$/;

export function didSource(did: string): DidSource | null {
  if (PLC.test(did)) return { kind: 'plc', url: `https://plc.directory/${did}` };
  const host = WEB.exec(did)?.[1];
  if (!host || host.length > 253 || LOCAL_SUFFIX.test(host)) return null;
  return { kind: 'web', host };
}

function ipv4Bytes(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.map(Number);
}

function ipv6Bytes(address: string): number[] | null {
  let text = address.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  let tail: number[] = [];
  if (v4) {
    const bytes = ipv4Bytes(v4[1]);
    if (!bytes) return null;
    tail = bytes;
    text = text.slice(0, -v4[1].length) + '0:0';
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const groups = (half: string) => (half ? half.split(':') : []);
  const head = groups(halves[0]);
  const rest = halves.length === 2 ? groups(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if ((halves.length === 2 && missing < 1) || (halves.length === 1 && missing !== 0)) return null;
  const all = [...head, ...Array(missing).fill('0'), ...rest];
  if (all.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  const bytes = all.flatMap((group) => [parseInt(group, 16) >> 8, parseInt(group, 16) & 255]);
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

const PRIVATE_V4: [number[], number][] = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 88, 99, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
];

const inPrefix = (bytes: number[], prefix: number[], bits: number) =>
  prefix.every((byte, i) => {
    const take = Math.max(0, Math.min(8, bits - i * 8));
    const mask = take ? (0xff << (8 - take)) & 0xff : 0;
    return (bytes[i] & mask) === (byte & mask);
  });

// Whether an address a DID host resolved to may be fetched: anything loopback, private, link-local, shared,
// multicast, reserved or documentation-only is refused, including IPv4 written inside IPv6.
export function isPublicAddress(address: string): boolean {
  const v4 = ipv4Bytes(address);
  if (v4) return !PRIVATE_V4.some(([prefix, bits]) => inPrefix(v4, prefix, bits));
  const v6 = ipv6Bytes(address);
  if (!v6) return false;
  const mapped = inPrefix(v6, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 96) || inPrefix(v6, [0, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0], 96);
  if (mapped) return isPublicAddress(v6.slice(12).join('.'));
  if (!inPrefix(v6, [0x20], 3)) return false;
  return !inPrefix(v6, [0x20, 0x01, 0x0d, 0xb8], 32) && !inPrefix(v6, [0x20, 0x01, 0], 23) && !inPrefix(v6, [0x20, 0x02], 16);
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function fromBase58(text: string): Uint8Array | null {
  let value = 0n;
  for (const char of text) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  for (; value > 0n; value >>= 8n) bytes.unshift(Number(value & 255n));
  const zeros = text.length - text.replace(/^1+/, '').length;
  return Uint8Array.from([...Array(zeros).fill(0), ...bytes]);
}

const toHex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));

// The account's signing key: the #atproto verification method of its DID document, as a Multikey (multicodec
// secp256k1-pub 0xe7 or p256-pub 0x1200) or one of the two legacy key types.
export function signingKeyOf(document: unknown, did: string): SigningKey | null {
  if (!document || typeof document !== 'object') return null;
  const { id, verificationMethod } = document as { id?: unknown; verificationMethod?: unknown };
  if (id !== did || !Array.isArray(verificationMethod)) return null;
  const method = verificationMethod.find((entry) => entry && (entry.id === '#atproto' || entry.id === `${did}#atproto`));
  const multibase = method?.publicKeyMultibase;
  if (typeof multibase !== 'string' || !multibase.startsWith('z')) return null;
  const bytes = fromBase58(multibase.slice(1));
  if (!bytes) return null;
  let key: SigningKey | null = null;
  if (method.type === 'Multikey' && bytes[0] === 0xe7 && bytes[1] === 0x01) key = { curve: 'k256', publicKey: toHex(bytes.slice(2)) };
  else if (method.type === 'Multikey' && bytes[0] === 0x80 && bytes[1] === 0x24) key = { curve: 'p256', publicKey: toHex(bytes.slice(2)) };
  else if (method.type === 'EcdsaSecp256k1VerificationKey2019') key = { curve: 'k256', publicKey: toHex(bytes) };
  else if (method.type === 'EcdsaSecp256r1VerificationKey2019') key = { curve: 'p256', publicKey: toHex(bytes) };
  if (!key) return null;
  try {
    (key.curve === 'k256' ? secp256k1 : p256).Point.fromHex(key.publicKey);
    return key;
  } catch {
    return null;
  }
}

export type ProofClaims = { iss: string; aud: string; lxm: string; exp: number; iat?: number; jti: string };
export type ParsedProof = { alg: 'ES256' | 'ES256K'; claims: ProofClaims; signingInput: Uint8Array; signature: Uint8Array };

function decodeSegment(segment: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  try {
    const binary = atob(segment.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
  } catch {
    return null;
  }
}

function fromBase64url(segment: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  try {
    return Uint8Array.from(atob(segment.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

// The token's structure only; nothing is trusted until proofRefusal and signatureValid have passed.
export function parseProof(token: string): ParsedProof | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = decodeSegment(parts[0]) as { alg?: unknown; typ?: unknown } | null;
  const claims = decodeSegment(parts[1]) as Record<string, unknown> | null;
  const signature = fromBase64url(parts[2]);
  if (!header || !claims || !signature || signature.length !== 64) return null;
  if (header.alg !== 'ES256' && header.alg !== 'ES256K') return null;
  if (header.typ === 'at+jwt' || header.typ === 'refresh+jwt' || header.typ === 'dpop+jwt') return null;
  const { iss, aud, lxm, exp, iat, jti } = claims;
  if (typeof iss !== 'string' || typeof aud !== 'string' || typeof lxm !== 'string' || typeof jti !== 'string') return null;
  if (typeof exp !== 'number' || (iat !== undefined && typeof iat !== 'number')) return null;
  return { alg: header.alg, claims: { iss, aud, lxm, exp, iat, jti }, signingInput: new TextEncoder().encode(`${parts[0]}.${parts[1]}`), signature };
}

// Why the claims don't allow this call, or null when they do. Checked before any key is fetched.
export function proofRefusal({ claims }: ParsedProof, expected: { did: string; audience: string; nowMs: number }): string | null {
  const now = expected.nowMs / 1000;
  if (claims.iss !== expected.did) return 'wrongAccount';
  if (claims.aud !== expected.audience) return 'wrongAudience';
  if (claims.lxm !== MEMORY_METHOD) return 'wrongMethod';
  if (claims.exp <= now) return 'expired';
  if (claims.exp > now + PROOF_LIFETIME_LIMIT_SECONDS + CLOCK_SKEW_SECONDS) return 'tooLong';
  if (claims.iat !== undefined && (claims.iat > now + CLOCK_SKEW_SECONDS || claims.exp - claims.iat > PROOF_LIFETIME_LIMIT_SECONDS)) return 'tooLong';
  if (claims.jti.length < 8 || claims.jti.length > 128) return 'badNonce';
  return null;
}

export function signatureValid(proof: ParsedProof, key: SigningKey): boolean {
  if ((proof.alg === 'ES256K') !== (key.curve === 'k256')) return false;
  try {
    return (key.curve === 'k256' ? secp256k1 : p256).verify(proof.signature, proof.signingInput, fromHex(key.publicKey), { lowS: true });
  } catch {
    return false;
  }
}

export type SessionOutcome = 'ok' | 'unknown' | 'limited';

export type AuthDeps = {
  now(): number;
  audience: string;
  addressHash: string | null;
  sha256(text: string): Promise<string>;
  // Takes one call from every window, or from none when any is used up.
  take(checks: RateCheck[]): Promise<boolean>;
  // A device key's owner check, then that key's own window.
  claimDevice(userKey: string, secretHash: string, checks: RateCheck[]): Promise<'ok' | 'notOwner' | 'limited'>;
  // A session opened by an earlier proof, then the user's window.
  useSession(did: string, sessionHash: string, checks: RateCheck[]): Promise<SessionOutcome>;
  // Marks the proof used and opens the session, then takes the user's window. 'replayed' when the proof was used
  // before for another session.
  openSession(session: { proofId: string; did: string; sessionHash: string; expiresAt: number; checks: RateCheck[] }): Promise<'ok' | 'replayed' | 'limited'>;
  cachedKey(did: string): Promise<CachedKey | null>;
  storeKey(did: string, key: SigningKey | null): Promise<unknown>;
  // The DID document's text, or null when it can't be fetched safely.
  fetchDocument(source: DidSource): Promise<string | null>;
};

// plc.directory is a fixed host, so this runs in Convex's default runtime. did:web hosts are the caller's and are
// fetched by convex/didWeb.ts instead, which refuses private addresses.
export async function fetchPlcDocument(url: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DID_FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { redirect: 'error', signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > DID_DOCUMENT_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(bytes);
  } finally {
    clearTimeout(timer);
  }
}

export function validAccess(access: MemoryAccess): boolean {
  if (access.kind === 'device') return /^[0-9a-f]{32,64}$/.test(access.deviceId) && access.secret.length >= 16 && access.secret.length <= 200;
  return didSource(access.did) !== null && /^[0-9a-f]{64}$/.test(access.session) && (access.proof === undefined || access.proof.length <= 4096);
}

export function userKeyOf(access: MemoryAccess): string {
  return access.kind === 'device' ? `device:${access.deviceId}` : `bsky:${access.did}`;
}

function keyOf(text: string | null, did: string): SigningKey | null {
  if (!text || text.length > DID_DOCUMENT_MAX_BYTES) return null;
  try {
    return signingKeyOf(JSON.parse(text), did);
  } catch {
    return null;
  }
}

// The cached key first. A fetch only when the DID wasn't fetched in the last ten minutes, after the caller's
// and the deployment's fetch windows, and its outcome is cached either way (REFETCH_AFTER_MS). A fetch that fails
// or finds no key never discards a key verified before: anyone can force a refetch with a badly signed proof, so
// while the directory is failing that would lock the owner out. The old key stays in use until a fetch returns
// another one.
async function proofVerified(proof: ParsedProof, did: string, deps: AuthDeps): Promise<boolean> {
  const cached = await deps.cachedKey(did);
  const age = cached ? deps.now() - cached.fetchedAt : Infinity;
  if (cached?.key && age < KEY_CACHE_MS && signatureValid(proof, cached.key)) return true;
  if (age < REFETCH_AFTER_MS) return false;
  const source = didSource(did);
  if (!source) return false;
  if (!(await deps.take(didFetchChecks(deps.addressHash)))) throw memoryError('tooMany');
  const key = keyOf(await deps.fetchDocument(source).catch(() => null), did) ?? cached?.key ?? null;
  await deps.storeKey(did, key);
  return key !== null && signatureValid(proof, key);
}

// The memory key this call may use, or a ConvexError saying why not.
export async function authorizeMemory(access: MemoryAccess, deps: AuthDeps): Promise<string> {
  if (!validAccess(access)) throw memoryError('invalid');
  if (!(await deps.take(callerChecks(deps.addressHash)))) throw memoryError('tooMany');
  const userKey = userKeyOf(access);
  if (access.kind === 'device') {
    const outcome = await deps.claimDevice(userKey, await deps.sha256(access.secret), userCheck(userKey));
    if (outcome === 'notOwner') throw memoryError('notOwner');
    if (outcome === 'limited') throw memoryError('tooMany');
    return userKey;
  }
  const sessionHash = await deps.sha256(`session:${access.session}`);
  const known = await deps.useSession(access.did, sessionHash, userCheck(userKey));
  if (known === 'limited') throw memoryError('tooMany');
  if (known === 'ok') return userKey;
  if (!access.proof) throw memoryError('proofNeeded');
  const proof = parseProof(access.proof);
  if (!proof) throw memoryError('proofRefused', 'malformed');
  const refusal = proofRefusal(proof, { did: access.did, audience: deps.audience, nowMs: deps.now() });
  if (refusal) throw memoryError('proofRefused', refusal);
  if (!(await proofVerified(proof, access.did, deps))) throw memoryError('proofRefused', 'badSignature');
  const opened = await deps.openSession({
    proofId: `${access.did} ${proof.claims.jti}`,
    did: access.did,
    sessionHash,
    expiresAt: proof.claims.exp * 1000,
    checks: userCheck(userKey),
  });
  if (opened === 'replayed') throw memoryError('proofRefused', 'replayed');
  if (opened === 'limited') throw memoryError('tooMany');
  return userKey;
}
