import { authMessages, looksLikeAppPassword } from '../messages';
import { nextSignIn, startSignIn, type SignInEvent, type SignInFlow } from '../signInFlow';

const run = (entry: string, events: SignInEvent[], screenReader = true) =>
  [{ type: 'edit', entry } as SignInEvent, ...events].reduce<SignInFlow>((state, event) => nextSignIn(state, event, screenReader), startSignIn('', screenReader));

const account = { id: 'did:plc:maya', handle: 'maya.bsky.social', displayName: 'Maya' };

describe('the iPhone sign-in prompt', () => {
  it('is announced before sign-in and sign-up open Bluesky', () => {
    expect(authMessages.opening).toContain('First, iPhone asks whether Juno may use a website, usually bsky.social, to sign in. Choose Continue.');
    expect(authMessages.createAccount).toMatch(/^Bluesky's sign-up page will open\. First, iPhone asks whether Juno may use a website, usually bsky\.social, to sign in\. Choose Continue\. The page asks/);
  });

  it('is left out where the system shows no such prompt', () => {
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { authMessages: android } = require('../messages') as typeof import('../messages');
      expect(android.opening).toBe("Bluesky's sign-in page will open. Then enter your password on Bluesky's page. You'll come back here when you're done.");
      expect(android.createAccount).not.toContain('iPhone');
    });
  });
});

describe('sign in flow', () => {
  it('asks for the handle first', () => {
    expect(startSignIn('', true)).toMatchObject({ step: 'entry', message: 'Type or dictate your Bluesky handle, then double tap Continue.' });
  });

  it('looks the handle up, reads it back, warns before opening Bluesky and ends signed in by name', () => {
    const checking = run('maya', [{ type: 'submit' }]);
    expect(checking).toMatchObject({ step: 'checking', handle: 'maya.bsky.social', message: 'Looking up maya dot bsky dot social.' });
    const confirm = nextSignIn(checking, { type: 'found' }, true);
    expect(confirm).toMatchObject({ step: 'confirm', message: "Did you mean maya dot bsky dot social? Double tap Continue if that's right." });
    const opening = nextSignIn(confirm, { type: 'confirm' }, true);
    expect(opening).toMatchObject({
      step: 'opening',
      message:
        "Bluesky's sign-in page will open. First, iPhone asks whether Juno may use a website, usually bsky.social, to sign in. Choose Continue. Then enter your password on Bluesky's page. You'll come back here when you're done.",
    });
    expect(nextSignIn(opening, { type: 'result', result: { status: 'success', account } }, true)).toEqual({ step: 'signedIn', account, message: 'Signed in as Maya.' });
  });

  it('names the account by its handle when it has no display name', () => {
    expect(authMessages.signedIn({ id: 'd', handle: 'maya.example.com', displayName: null })).toBe('Signed in as maya dot example dot com.');
  });

  it('keeps the entry for correction when the handle does not resolve', () => {
    const state = run('mayaa.bsky.social', [{ type: 'submit' }, { type: 'notFound' }]);
    expect(state).toEqual({
      step: 'entry',
      entry: 'mayaa.bsky.social',
      error: true,
      message: "I couldn't find mayaa dot bsky dot social on Bluesky. Check the spelling and try again.",
    });
  });

  it('says plainly when the lookup cannot reach Bluesky', () => {
    expect(run('maya', [{ type: 'submit' }, { type: 'lookupFailed' }])).toMatchObject({ step: 'entry', entry: 'maya', message: authMessages.lookupFailed });
  });

  it('treats a cancel as a cancel and says how to try again', () => {
    const state = run('maya.bsky.social', [{ type: 'submit' }, { type: 'found' }, { type: 'confirm' }, { type: 'result', result: { status: 'cancelled' } }]);
    expect(state).toMatchObject({ step: 'confirm', handle: 'maya.bsky.social', error: false, message: 'Sign in was cancelled. Double tap Continue to try again, or choose Use an app password instead.' });
    expect(nextSignIn(state, { type: 'confirm' }, true).step).toBe('opening');
  });

  it('gives a plain reason when sign in fails', () => {
    const opening = run('maya', [{ type: 'submit' }, { type: 'found' }, { type: 'confirm' }]);
    expect(nextSignIn(opening, { type: 'result', result: { status: 'failed', reason: 'network' } }, true)).toMatchObject({ step: 'confirm', error: true, message: authMessages.networkFailure });
    expect(nextSignIn(opening, { type: 'result', result: { status: 'failed', reason: 'server' } }, true)).toMatchObject({ step: 'confirm', error: true, message: authMessages.serverFailure });
  });

  it('refuses empty and malformed handles without looking them up', () => {
    expect(run('  ', [{ type: 'submit' }])).toMatchObject({ step: 'entry', error: true, message: authMessages.emptyHandle });
    expect(run('maya!', [{ type: 'submit' }])).toMatchObject({ step: 'entry', error: true, message: authMessages.invalidHandle });
  });

  it('lets the user change the handle after hearing it read back', () => {
    const state = run('maya', [{ type: 'submit' }, { type: 'found' }, { type: 'change' }]);
    expect(state).toMatchObject({ step: 'entry', entry: 'maya', error: false });
  });

  it('says tap instead of double tap without a screen reader', () => {
    expect(run('maya', [{ type: 'submit' }, { type: 'found' }], false)).toMatchObject({ message: "Did you mean maya dot bsky dot social? Tap Continue if that's right." });
  });

  it('ignores events that do not belong to the current step', () => {
    const entry = run('maya', []);
    expect(nextSignIn(entry, { type: 'confirm' }, true)).toBe(entry);
    expect(nextSignIn(entry, { type: 'result', result: { status: 'cancelled' } }, true)).toBe(entry);
  });
});

describe('app password check', () => {
  it('accepts only the app password format', () => {
    const isAppKey = looksLikeAppPassword;
    expect(isAppKey('abcd-efgh-ijkl-mnop')).toBe(true);
    expect(isAppKey('my main password')).toBe(false);
    expect(isAppKey('hunter22')).toBe(false);
  });
});
