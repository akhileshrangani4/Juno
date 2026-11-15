import type { LookupAddress } from 'node:dns';

import { fetchDidWebDocument, publicOnlyLookup } from '../../../convex/didWeb';

const resolvingTo = (...addresses: string[]) =>
  jest.fn((_host: string, _options: { all: true }, callback: (error: NodeJS.ErrnoException | null, found: LookupAddress[]) => void) =>
    callback(null, addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))),
  );

function lookup(resolve: ReturnType<typeof resolvingTo>, all: boolean) {
  return new Promise<{ error: NodeJS.ErrnoException | null; address: unknown }>((done) =>
    (publicOnlyLookup(resolve) as unknown as (host: string, options: { all: boolean }, callback: (error: NodeJS.ErrnoException | null, address: unknown) => void) => void)(
      'alice.example.org',
      { all },
      (error, address) => done({ error, address }),
    ),
  );
}

describe('did:web fetches', () => {
  it('connect only to the public addresses the host name resolved to', async () => {
    await expect(lookup(resolvingTo('93.184.215.14'), false)).resolves.toEqual({ error: null, address: '93.184.215.14' });
    await expect(lookup(resolvingTo('93.184.215.14', '2606:4700::1'), true)).resolves.toEqual({
      error: null,
      address: [
        { address: '93.184.215.14', family: 4 },
        { address: '2606:4700::1', family: 6 },
      ],
    });
  });

  it('refuse a host name with any private address, so a second answer cannot swap one in', async () => {
    for (const addresses of [['127.0.0.1'], ['169.254.169.254'], ['93.184.215.14', '10.0.0.5'], ['::1'], ['::ffff:192.168.0.1']]) {
      const { error } = await lookup(resolvingTo(...addresses), false);
      expect(error?.code).toBe('EPRIVATE');
    }
  });

  it('give up on the document when the host name resolves to a private address', async () => {
    const resolve = resolvingTo('127.0.0.1');
    await expect(fetchDidWebDocument('alice.example.org', resolve)).resolves.toBeNull();
    expect(resolve).toHaveBeenCalledWith('alice.example.org', { all: true }, expect.any(Function));
  });
});
