import { createMemoryStore } from '@/storage/keyValueStore';

import { GUEST_KEY, signOut } from '../signOut';

describe('signing out', () => {
  it('ends the session, forgets guest mode, and deletes what the camera saved on the phone', async () => {
    const provider = { signOut: jest.fn(async () => undefined) };
    const store = createMemoryStore();
    await store.set(GUEST_KEY, '1');
    const forget = jest.fn(async () => undefined);
    await signOut(provider as never, store, forget);
    expect(provider.signOut).toHaveBeenCalled();
    expect(await store.get(GUEST_KEY)).toBeNull();
    expect(forget).toHaveBeenCalled();
  });

  it('still forgets on the phone when the server sign-out fails', async () => {
    const forget = jest.fn(async () => undefined);
    await signOut({ signOut: jest.fn(async () => Promise.reject(new Error('offline'))) } as never, createMemoryStore(), forget);
    expect(forget).toHaveBeenCalled();
  });
});
