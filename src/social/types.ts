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
  counts: { likes: number; reposts: number; replies: number };
};

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

export type UploadedImage = { alt: string; handle: unknown };

export type NewPost = { text: string; images?: UploadedImage[] };

export type ReplyParent = Pick<Post, 'uri' | 'cid' | 'replyRoot'>;

export type RecordRef = { uri: string };

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
  getTimeline(options?: { cursor?: string; limit?: number }): Promise<TimelinePage>;
  createPost(post: NewPost): Promise<PostRef>;
  repost(post: PostRef): Promise<RecordRef>;
  like(post: PostRef): Promise<RecordRef>;
  reply(parent: ReplyParent, post: NewPost): Promise<PostRef>;
  uploadImage(image: { uri: string; mimeType: string }, alt: string): Promise<UploadedImage>;
  unlike(post: PostRef, like?: RecordRef): Promise<boolean>;
  unrepost(post: PostRef, repost?: RecordRef): Promise<boolean>;
  deletePost(post: PostRef): Promise<void>;
  getMyLatestPost(): Promise<Post | null>;
}
