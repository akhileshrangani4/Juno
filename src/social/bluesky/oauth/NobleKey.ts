import { JwtVerifyError, Key, type JwtHeader, type JwtPayload, type SignedJwt, type VerifyOptions, type VerifyResult } from '@atproto/oauth-client';
import { p256 } from '@noble/curves/nist.js';

export type RandomBytes = (length: number) => Uint8Array;

type EcJwk = { kty: 'EC'; crv: 'P-256'; alg: 'ES256'; kid: string; x: string; y: string; d?: string; key_ops?: ('sign' | 'verify')[] };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const encodeJson = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)));

export class NobleKey extends Key<EcJwk> {
  static generate(algs: string[], randomBytes: RandomBytes): NobleKey {
    if (!algs.includes('ES256')) throw new TypeError(`No supported algorithm in ${algs.join(', ')}`);
    const secretKey = p256.utils.randomSecretKey(randomBytes(48));
    const publicKey = p256.getPublicKey(secretKey, false);
    return new NobleKey({
      kty: 'EC',
      crv: 'P-256',
      alg: 'ES256',
      kid: base64url(randomBytes(12)),
      x: base64url(publicKey.slice(1, 33)),
      y: base64url(publicKey.slice(33, 65)),
      d: base64url(secretKey),
      key_ops: ['sign'],
    });
  }

  async createJwt(header: JwtHeader, payload: JwtPayload): Promise<SignedJwt> {
    if (!this.jwk.d) throw new TypeError('A private key is required to sign');
    const input = `${encodeJson({ ...header, alg: 'ES256' })}.${encodeJson(payload)}`;
    const signature = p256.sign(encoder.encode(input), fromBase64url(this.jwk.d));
    return `${input}.${base64url(signature)}` as SignedJwt;
  }

  async verifyJwt<C extends string = never>(token: SignedJwt, options: VerifyOptions<C> = {}): Promise<VerifyResult<C>> {
    const [header, payload, signature] = token.split('.');
    const protectedHeader = JSON.parse(decoder.decode(fromBase64url(header))) as JwtHeader;
    const claims = JSON.parse(decoder.decode(fromBase64url(payload))) as JwtPayload;
    const publicKey = Uint8Array.from([4, ...fromBase64url(this.jwk.x), ...fromBase64url(this.jwk.y)]);
    if (protectedHeader.alg !== 'ES256' || !p256.verify(fromBase64url(signature), encoder.encode(`${header}.${payload}`), publicKey)) {
      throw new JwtVerifyError('Invalid signature');
    }
    const now = Math.floor((options.currentDate ?? new Date()).getTime() / 1000);
    const tolerance = options.clockTolerance ?? 0;
    if (claims.exp != null && claims.exp + tolerance < now) throw new JwtVerifyError('Token expired');
    if (claims.nbf != null && claims.nbf - tolerance > now) throw new JwtVerifyError('Token not yet valid');
    return { payload: claims, protectedHeader } as VerifyResult<C>;
  }
}
