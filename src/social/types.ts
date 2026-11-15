export type PostRef = { uri: string; cid: string };

export type PostImage = { url: string; alt: string | null };

export type VideoCaption = { lang: string; cid: string };

export type PostFacet = { start: number; end: number } & (
  | { kind: 'link'; url: string }
  | { kind: 'mention'; did: string; name: string | null }
  | { kind: 'tag'; tag: string }
);

export type PostReplyContext = { authorName: string | null; isSelf: boolean };

export type PostMedia =
  | { kind: 'images'; images: PostImage[] }
  | { kind: 'video'; alt: string | null; thumbUrl: string | null; captions?: VideoCaption[]; aspectRatio?: { width: number; height: number } | null }
  | { kind: 'link'; url: string; title: string }
  | { kind: 'quote'; authorName: string; text: string };

export type PostAuthor = {
  id: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type Post = PostRef & {
  author: PostAuthor;
  text: string;
  createdAt: string;
  media: PostMedia[];
  repostedBy: string | null;
  replyRoot: PostRef | null;
  replyTo?: PostReplyContext | null;
  facets?: PostFacet[];
  // The languages the post's record declares (often missing or wrong, so only a hint).
  langs?: string[];
  counts: { likes: number; reposts: number; replies: number };
  likeUri: string | null;
  // Set only on posts from the signed-in user's own For You feed: what Bluesky's feed needs back to learn from the
  // user's likes and "more like this" / "less like this".
  feedContext?: { context: string | null; reqId: string | null };
};

export type FeedName = 'forYou' | 'following';

export type FeedFeedback = 'like' | 'more' | 'less';

export type Reply = Post & { parentAuthor: PostAuthor | null };

export type TimelinePage = { posts: Post[]; cursor: string | null };

export type SocialAccount = { id: string; handle: string; displayName?: string | null };

export type SignInResult =
  | { status: 'success'; account: SocialAccount }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: 'network' | 'server' };

export type RestoreResult =
  | { status: 'restored'; account: SocialAccount }
  | { status: 'none' }
  | { status: 'invalid'; account: SocialAccount | null }
  | { status: 'unreachable' };

export type UploadedImage = { alt: string; handle: unknown; aspectRatio?: { width: number; height: number } };

export type NewPost = { text: string; images?: UploadedImage[] };

export type ReplyParent = Pick<Post, 'uri' | 'cid' | 'replyRoot'>;

export type RecordRef = { uri: string };

// Thrown by a provider call that got no answer at all, so the caller can say the network is the problem. It never
// ends the session: the user stays signed in and can try again.
export class OfflineError extends Error {}

export interface SocialProvider {
  readonly id: string;
  readonly name: string;
  hasStoredSession(): Promise<boolean>;
  restoreSession(): Promise<RestoreResult>;
  findAccount(handle: string): Promise<boolean>;
  signIn(handle: string): Promise<SignInResult>;
  createAccount(): Promise<SignInResult>;
  signInWithAppPassword(identifier: string, appPassword: string): Promise<SocialAccount>;
  signOut(): Promise<void>;
  onSessionExpired(listener: (account: SocialAccount) => void): () => void;
  getTimeline(options?: { cursor?: string; limit?: number; feed?: FeedName }): Promise<TimelinePage>;
  // Tells the For You feed what the user thinks of one of its posts. Does nothing for any other post.
  sendFeedFeedback(post: Post, feedback: FeedFeedback): Promise<void>;
  createPost(post: NewPost): Promise<PostRef>;
  repost(post: PostRef): Promise<RecordRef>;
  like(post: PostRef): Promise<RecordRef>;
  getReplies(postUri: string): Promise<Reply[]>;
  reply(parent: ReplyParent, post: NewPost): Promise<PostRef>;
  uploadImage(image: { uri: string; mimeType: string; width?: number; height?: number }, alt: string): Promise<UploadedImage>;
  unlike(post: PostRef, like?: RecordRef): Promise<boolean>;
  unrepost(post: PostRef, repost?: RecordRef): Promise<boolean>;
  deletePost(post: PostRef): Promise<void>;
  getMyLatestPost(): Promise<Post | null>;
  // A short-lived token from the account's own server that proves to the named service (aud) that this app is
  // signed in as the account, for one method (lxm) only. Never a session token.
  serviceAuth(request: { aud: string; lxm: string }): Promise<string>;
}

// The account's sign-in doesn't include a permission this call needs, for example an OAuth sign-in made before
// the app asked for it. Signing in again grants it.
export class PermissionMissingError extends Error {}
