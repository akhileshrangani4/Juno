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

export interface SocialProvider {
  readonly id: string;
  readonly name: string;
  hasStoredSession(): Promise<boolean>;
  restoreSession(): Promise<SocialAccount | null>;
  signIn(identifier: string, password: string): Promise<SocialAccount>;
  signOut(): Promise<void>;
  getTimeline(options?: { cursor?: string; limit?: number }): Promise<TimelinePage>;
  createPost(post: NewPost): Promise<PostRef>;
  repost(post: PostRef): Promise<void>;
  like(post: PostRef): Promise<void>;
  reply(parent: Post, post: NewPost): Promise<PostRef>;
  uploadImage(image: { uri: string; mimeType: string }, alt: string): Promise<UploadedImage>;
}
