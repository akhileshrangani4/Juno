import { createMemoryStore } from '@/storage/keyValueStore';
import { makeMemory, setup } from '@/testing/agent';

import { buildAssistant, FIRST_MESSAGE } from '../assistant';
import { MemorySignInNeededError, MemoryUnavailableError } from '../memoryClient';
import { describeMemories } from '../postContext';
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
    expect(contextPrompt(assistant)).toContain('If their very next reply is a yes, call answer_memory_offer with keep true');
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
    for (const said of ['Yes, but only the first one.', 'What did I save?', 'Hmm, maybe later.', 'Read me the next post.']) {
      const { store, offer, memory } = offered();
      await store.set(SIGNED_OUT_MEMORIES, '1');
      await offer.prepare();
      const { handlers, say } = setup({ memoryOffer: offer, memory });
      say(said);
      expect([said, (await handlers.run('answer_memory_offer', { keep: true })).result]).toEqual([said, expect.stringMatching(/^NOT_A_YES/)]);
      expect(memory.carryOver).not.toHaveBeenCalled();
    }
  });

  it("counts a yes only in the user's turn right after the question, like a publish confirmation", async () => {
    const { store, offer, memory } = offered();
    await store.set(SIGNED_OUT_MEMORIES, '1');
    await offer.prepare();
    const { handlers, say } = setup({ memoryOffer: offer, memory });
    say('Read me this post.');
    say('Yes.');
    expect((await handlers.run('answer_memory_offer', { keep: true })).result).toMatch(/^NO_OFFER: The question about saved memories was only open for their reply right after it/);
    expect((await handlers.run('answer_memory_offer', { keep: false })).result).toMatch(/^NO_OFFER/);
    expect(memory.carryOver).not.toHaveBeenCalled();
    await expect(offer.prepare()).resolves.toBe(offerQuestion(2));
  });

  it('asks again when the user asks for it by name, and then takes the yes that follows', async () => {
    const { store, offer, memory } = offered();
    await store.set(SIGNED_OUT_MEMORIES, '1');
    const { handlers, say } = setup({ memoryOffer: offer, memory });
    say('What can you do?');
    say('Keep what I saved before signing in with my account.');
    const asked = await handlers.run('ask_to_keep_saved_memories', {});
    expect(asked).toMatchObject({ speak: offerQuestion(2), respond: false });
    say('Yes please.');
    expect((await handlers.run('answer_memory_offer', { keep: true })).result).toMatch(/^CARRIED_OVER/);
    expect(memory.carryOver).toHaveBeenCalledTimes(1);
  });

  it('says when nothing was saved signed out, and needs a sign-in to ask', async () => {
    const empty = offered([]);
    const { handlers } = setup({ memoryOffer: empty.offer, memory: empty.memory });
    expect((await handlers.run('ask_to_keep_saved_memories', {})).result).toMatch(/^NOTHING_SAVED/);
    const signedOut = setup({ signedIn: false, memoryOffer: empty.offer, memory: empty.memory });
    expect((await signedOut.handlers.run('ask_to_keep_saved_memories', {})).result).toMatch(/^NOT_SIGNED_IN/);
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
    expect(offer.isOpen(1)).toBe(false);
  });

  it("asks nothing when the saved memories can't be reached", async () => {
    const { store, offer, memory } = offered();
    await store.set(SIGNED_OUT_MEMORIES, '1');
    memory.savedSignedOut.mockRejectedValue(new MemoryUnavailableError('offline'));
    await expect(offer.prepare()).resolves.toBeNull();
  });
});

describe("when the user's sign-in is older than memory", () => {
  it('says once per conversation that remembering needs them to sign in again, and offers sign-in', async () => {
    const memory = makeMemory();
    memory.remember.mockRejectedValue(new MemorySignInNeededError('no scope'));
    memory.list.mockRejectedValue(new MemorySignInNeededError('no scope'));
    const { handlers } = setup({ memory });
    expect((await handlers.run('remember', { fact: 'Call me Sam.' })).result).toBe(
      'MEMORY_NEEDS_SIGN_IN: Nothing was saved, read or forgotten, because their sign-in is older than memory. Say in one plain sentence that remembering needs them to sign in again, and ask if they want to open the sign-in screen. Call open_sign_in only if they say yes.',
    );
    expect((await handlers.run('recall_memories', {})).result).toBe(
      "MEMORY_NEEDS_SIGN_IN: Memory still needs them to sign in again, and you already told them in this conversation. Don't say it again; answer in a few words without memory.",
    );
    expect((await handlers.run('like_post', {})).result).toMatch(/^LIKED/);
  });

  it('tells the agent at the start without having it bring it up', () => {
    expect(describeMemories('signInNeeded')).toBe(
      "Memory needs them to sign in again, because their sign-in is older than memory. Don't bring it up yourself; if memory comes up, a result will say what to tell them.",
    );
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
