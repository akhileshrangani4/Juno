import { createMemoryStore } from '@/storage/keyValueStore';
import { makeMemory, setup } from '@/testing/agent';

import { buildAssistant, FIRST_MESSAGE } from '../assistant';
import { MemoryUnavailableError } from '../memoryClient';
import { createMemoryOffer, offerQuestion, SIGNED_OUT_MEMORIES } from '../memoryOffer';

const ME = { id: 'did:plc:me', handle: 'me.bsky.social' };

function offered(saved = [{ id: 'fact_a', text: 'Call the user Sam.' }, { id: 'fact_b', text: 'Skip hashtags.' }]) {
  const store = createMemoryStore();
  const memory = makeMemory();
  memory.savedSignedOut.mockResolvedValue(saved);
  memory.carryOver.mockResolvedValue({ carried: saved.length, left: 0 });
  let account: typeof ME | null = ME;
  const offer = createMemoryOffer(store, memory, () => account);
  return { store, memory, offer, signOut: () => void (account = null) };
}

const context = { account: 'Signed in.', settings: 'Normal.', memories: 'Nothing yet.', focus: 'None.' };
const contextPrompt = (assistant: ReturnType<typeof buildAssistant>) => assistant.model.messages[0].content;

describe('keeping what was saved before sign-in', () => {
  it('asks only when something was saved signed out on this phone', async () => {
    const { store, offer, memory } = offered();
    await expect(offer.prepare()).resolves.toBeNull();
    expect(memory.savedSignedOut).not.toHaveBeenCalled();
    await store.set(SIGNED_OUT_MEMORIES, '1');
    await expect(offer.prepare()).resolves.toBe(offerQuestion(2));
    expect(offerQuestion(2)).toBe('Before you signed in, you asked me to remember 2 things on this phone. Shall I keep them with your account?');
    expect(offerQuestion(1)).toBe('Before you signed in, you asked me to remember one thing on this phone. Shall I keep it with your account?');
  });

  it('asks in the first words of the conversation and tells the agent how to answer', () => {
    const assistant = buildAssistant({ ...context, memoryOffer: offerQuestion(2) });
    expect(assistant.firstMessage).toBe(`${FIRST_MESSAGE} ${offerQuestion(2)}`);
    expect(contextPrompt(assistant)).toContain('Call answer_memory_offer with keep true only if they say yes');
    expect(buildAssistant(context).firstMessage).toBe(FIRST_MESSAGE);
  });

  it('moves them to the account on a plain yes', async () => {
    const { store, offer, memory } = offered();
    await store.set(SIGNED_OUT_MEMORIES, '1');
    await offer.prepare();
    const { handlers, say } = setup({ memoryOffer: offer, memory });
    say('Yes please.');
    expect((await handlers.run('answer_memory_offer', { keep: true })).result).toBe('CARRIED_OVER: 2 saved things are now kept with their account. Confirm in a few words.');
    expect(memory.carryOver).toHaveBeenCalledTimes(1);
    await expect(store.get(SIGNED_OUT_MEMORIES)).resolves.toBeNull();
    expect((await handlers.run('answer_memory_offer', { keep: true })).result).toMatch(/^NO_OFFER/);
  });

  it('moves nothing on anything but a plain yes, even if the agent says it was one', async () => {
    const { store, offer, memory } = offered();
    await store.set(SIGNED_OUT_MEMORIES, '1');
    await offer.prepare();
    const { handlers, say } = setup({ memoryOffer: offer, memory });
    for (const said of ['Yes, but only the first one.', 'What did I save?', 'Hmm, maybe later.', 'Read me the next post.']) {
      say(said);
      expect([said, (await handlers.run('answer_memory_offer', { keep: true })).result]).toEqual([said, expect.stringMatching(/^NOT_A_YES/)]);
    }
    expect(memory.carryOver).not.toHaveBeenCalled();
  });

  it("keeps them on the phone on a no, and doesn't ask that account again", async () => {
    const { store, offer, memory } = offered();
    await store.set(SIGNED_OUT_MEMORIES, '1');
    await offer.prepare();
    const { handlers, say } = setup({ memoryOffer: offer, memory });
    say('No thanks.');
    expect((await handlers.run('answer_memory_offer', { keep: false })).result).toMatch(/^KEPT_ON_PHONE/);
    expect(memory.carryOver).not.toHaveBeenCalled();
    await expect(offer.prepare()).resolves.toBeNull();
    await expect(store.get(SIGNED_OUT_MEMORIES)).resolves.toBe('1');
  });

  it('does nothing without an open question, or once the account signed out', async () => {
    const { store, offer, memory, signOut } = offered();
    const { handlers, say } = setup({ memoryOffer: offer, memory });
    say('Yes.');
    expect((await handlers.run('answer_memory_offer', { keep: true })).result).toMatch(/^NO_OFFER/);
    await store.set(SIGNED_OUT_MEMORIES, '1');
    await offer.prepare();
    signOut();
    expect((await handlers.run('answer_memory_offer', { keep: true })).result).toMatch(/^NO_OFFER/);
    expect(memory.carryOver).not.toHaveBeenCalled();
  });

  it("doesn't open the question when the conversation started without asking it", async () => {
    const { store, offer, memory } = offered();
    await store.set(SIGNED_OUT_MEMORIES, '1');
    let release: (saved: { id: string; text: string }[]) => void = () => undefined;
    const slow = new Promise<{ id: string; text: string }[]>((resolve) => (release = resolve));
    memory.savedSignedOut.mockReturnValue(slow);
    const late = offer.prepare();
    offer.withdraw();
    release([{ id: 'fact_a', text: 'Call the user Sam.' }]);
    await expect(late).resolves.toBeNull();
    expect(offer.isOpen()).toBe(false);
  });

  it("asks nothing when the saved memories can't be reached", async () => {
    const { store, offer, memory } = offered();
    await store.set(SIGNED_OUT_MEMORIES, '1');
    memory.savedSignedOut.mockRejectedValue(new MemoryUnavailableError('offline'));
    await expect(offer.prepare()).resolves.toBeNull();
  });
});

describe("when the user's memory can't be reached", () => {
  it('says so in one short sentence and keeps everything else working', async () => {
    const memory = makeMemory();
    memory.remember.mockRejectedValue(new MemoryUnavailableError('No proof of the account'));
    memory.list.mockRejectedValue(new MemoryUnavailableError('No proof of the account'));
    const { handlers } = setup({ memory });
    const unreachable = "MEMORY_UNREACHABLE: The user's memory can't be reached right now, so nothing was saved, read or forgotten. Say in one short sentence that you can't reach their memory right now, then carry on.";
    expect((await handlers.run('remember', { fact: 'Call me Sam.' })).result).toBe(unreachable);
    expect((await handlers.run('recall_memories', {})).result).toBe(unreachable);
    expect((await handlers.run('like_post', {})).result).toMatch(/^LIKED/);
  });
});
