'use node';

import { v } from 'convex/values';
import { lookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import type { LookupFunction } from 'node:net';

import { internalAction } from './_generated/server';
import { DID_DOCUMENT_MAX_BYTES, DID_FETCH_TIMEOUT_MS, isPublicAddress } from './memoryAuth';

// A did:web document lives on a host the caller names, so its address is checked when the name is resolved and
// the connection goes to exactly the addresses that were checked: a name with any private address is refused,
// and a second lookup can't swap one in. Redirects aren't followed, and the response is capped in time and size.

type Resolve = (hostname: string, options: { all: true }, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;
type Callback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

export function publicOnlyLookup(resolve: Resolve = lookup as unknown as Resolve): LookupFunction {
  const lookupPublic = (hostname: string, options: { all?: boolean }, callback: Callback) => {
    resolve(hostname, { all: true }, (error, addresses) => {
      if (error) return callback(error, []);
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
        return callback(Object.assign(new Error(`${hostname} resolves to a private address`), { code: 'EPRIVATE' }), []);
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
  return lookupPublic as unknown as LookupFunction;
}

export function fetchDidWebDocument(host: string, resolve?: Resolve): Promise<string | null> {
  return new Promise((done) => {
    const req = request(
      { host, path: '/.well-known/did.json', method: 'GET', headers: { accept: 'application/json' }, lookup: publicOnlyLookup(resolve), agent: false, timeout: DID_FETCH_TIMEOUT_MS },
      (response) => {
        if (response.statusCode !== 200) {
          req.destroy();
          return done(null);
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > DID_DOCUMENT_MAX_BYTES) {
            req.destroy();
            done(null);
          } else chunks.push(chunk);
        });
        response.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
        response.on('error', () => done(null));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done(null);
    }, DID_FETCH_TIMEOUT_MS);
    req.on('close', () => clearTimeout(timer));
    req.on('timeout', () => req.destroy());
    req.on('error', () => done(null));
    req.end();
  });
}

export const fetchDocument = internalAction({
  args: { host: v.string() },
  handler: async (_ctx, { host }): Promise<string | null> => fetchDidWebDocument(host),
});
