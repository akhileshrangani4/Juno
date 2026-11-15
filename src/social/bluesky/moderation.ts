import { BSKY_LABELER_DID, moderatePost, type AppBskyFeedDefs, type ModerationPrefs } from '@atproto/api';

const PREFS: ModerationPrefs = {
  adultContentEnabled: false,
  labels: { porn: 'hide', sexual: 'hide', nudity: 'hide', 'graphic-media': 'hide', gore: 'hide' },
  labelers: [{ did: BSKY_LABELER_DID, labels: {} }],
  mutedWords: [],
  hiddenPosts: [],
};

const EXTRA_HIDDEN_LABELS = new Set(['suggestive', 'sexual-figurative']);

type Labeled = { labels?: { val: string }[] };

function labelValues(post: AppBskyFeedDefs.PostView): string[] {
  return [post as Labeled, post.author as Labeled | undefined].flatMap((subject) => subject?.labels?.map((label) => label.val) ?? []);
}

export function isHiddenByModeration(post: AppBskyFeedDefs.PostView, userDid: string | undefined): boolean {
  if (labelValues(post).some((value) => EXTRA_HIDDEN_LABELS.has(value))) return true;
  try {
    return moderatePost(post, { userDid, prefs: PREFS }).ui('contentList').filter;
  } catch {
    return false;
  }
}
