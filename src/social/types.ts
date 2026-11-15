export type PostRef = { uri: string; cid: string };

export type PostImage = { url: string; alt: string | null };

export type PostMedia =
  | { kind: 'images'; images: PostImage[] }
  | { kind: 'video'; alt: string | null; thumbUrl: string | null }
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
  counts: { likes: number; reposts: number; replies: number };
};

export type TimelinePage = { posts: Post[]; cursor: string | null };

export type SocialAccount = { id: string; handle: string };

export type UploadedImage = { alt: string; handle: unknown };

export type NewPost = { text: string; images?: UploadedImage[] };

export type ReplyParent = Pick<Post, 'uri' | 'cid' | 'replyRoot'>;

export type RecordRef = { uri: string };

export interface SocialProvider {
  readonly id: string;
  readonly name: string;
  hasStoredSession(): Promise<boolean>;
  restoreSession(): Promise<SocialAccount | null>;
  signIn(identifier: string, password: string): Promise<SocialAccount>;
  signOut(): Promise<void>;
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
