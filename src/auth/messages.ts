import type { SocialAccount } from '@/social/types';

import { spellHandle } from './handle';

const act = (screenReader: boolean) => (screenReader ? 'Double tap' : 'Tap');

export const authMessages = {
  choices: 'Welcome to Juno. You can sign in with your Bluesky handle, create a new Bluesky account, or listen to a public feed without signing in.',
  expired: 'Your Bluesky sign-in has ended. Sign in again to pick up where you left off.',
  unreachable:
    "Bluesky couldn't be reached, so your timeline can't load yet. You're still signed in. Check your connection, then choose Retry, or listen to a public feed without signing in.",
  retrying: 'Trying Bluesky again.',
  signedOut: 'Signed out. Your Bluesky sign-in was removed from this device.',
  signOutFailed: 'Sign out did not finish. Try again.',
  handlePrompt: (screenReader: boolean) => `Type or dictate your Bluesky handle, then ${act(screenReader).toLowerCase()} Continue.`,
  emptyHandle: 'Type or dictate your handle first.',
  invalidHandle: 'That does not look like a handle. A handle looks like maya dot bsky dot social.',
  checking: (handle: string) => `Looking up ${spellHandle(handle)}.`,
  readBack: (handle: string, addedDomain: boolean, screenReader: boolean) =>
    `${addedDomain ? `Did you mean ${spellHandle(handle)}?` : `${spellHandle(handle)}.`} ${act(screenReader)} Continue if that's right.`,
  notFound: (handle: string) => `I couldn't find ${spellHandle(handle)} on Bluesky. Check the spelling and try again.`,
  lookupFailed: "Couldn't reach Bluesky to look up your handle. Check your connection and try again.",
  opening: "Bluesky's sign-in page will open. Enter your password there. You'll come back here when you're done.",
  signedIn: (account: SocialAccount) => `Signed in as ${account.displayName?.trim() || spellHandle(account.handle)}.`,
  cancelled: (screenReader: boolean) => `Sign in was cancelled. ${act(screenReader)} Continue to try again, or choose Use an app password instead.`,
  networkFailure: "Sign in didn't finish because Bluesky couldn't be reached. Check your connection, then try again.",
  serverFailure: "Bluesky couldn't finish signing you in. Try again, or choose Use an app password instead.",
  createAccount:
    "Bluesky's sign-up page will open. It asks you to choose a username, then for your email address and a password, then for a check that you're human. That check may be a picture puzzle with no audio option, so you may need a sighted helper for that one step. You'll come back here signed in when you're done.",
  createCancelled: 'Account creation was cancelled. You can try again, or sign in if you already have an account.',
  createNetworkFailure: "Bluesky's sign-up page couldn't be reached. Check your connection, then try again.",
  createServerFailure: "Bluesky couldn't finish creating your account here. Try again, or sign in if you already have an account.",
  appPasswordPrompt:
    'App password sign in. Enter your handle and an app password. You create an app password in Bluesky settings under Privacy and security. Never enter your main Bluesky password here.',
  appPasswordMissing: 'Enter your handle and your app password.',
  notAnAppPassword: "That doesn't look like an app password. An app password is four groups of four letters or numbers. Never enter your main Bluesky password here.",
  appPasswordFailed: 'Could not sign in to Bluesky. Check your handle and app password, then try again.',
  confirmSignOut: "Sign out of Bluesky on this device? You'll need to sign in again to read your timeline.",
};

const APP_PASSWORD = /^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/i;

export function looksLikeAppPassword(value: string): boolean {
  return APP_PASSWORD.test(value.trim());
}
