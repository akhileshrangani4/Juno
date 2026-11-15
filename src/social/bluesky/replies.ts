import type { AppBskyFeedDefs } from '@atproto/api';

import type { PostAuthor, Reply } from '../types';
import { mapFeedItem } from './mapPost';
import { isHiddenByModeration } from './moderation';

type Node = { $type?: string; post?: AppBskyFeedDefs.PostView; replies?: unknown[] };

const isThreadPost = (value: unknown): value is Node & { post: AppBskyFeedDefs.PostView } =>
  typeof value === 'object' && value !== null && (value as Node).$type === 'app.bsky.feed.defs#threadViewPost' && !!(value as Node).post;

export function flattenReplies(thread: unknown, userDid: string | undefined): Reply[] {
  if (!isThreadPost(thread)) throw new Error('This post is not available.');
  const flat: Reply[] = [];
  const visit = (node: Node, parentAuthor: PostAuthor | null) => {
    for (const child of node.replies ?? []) {
      if (!isThreadPost(child) || isHiddenByModeration(child.post, userDid)) continue;
      const post = mapFeedItem({ post: child.post });
      if (!post) continue;
      flat.push({ ...post, parentAuthor });
      visit(child, post.author);
    }
  };
  visit(thread, null);
  return flat;
}
