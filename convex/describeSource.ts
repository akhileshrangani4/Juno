import { descriptionInput } from '../src/narration/buildNarration';
import { mapFeedItem } from '../src/social/bluesky/mapPost';
import { isPostUri, type PostInput } from './describeCache';

const GET_POSTS = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts';
const TIMEOUT_MS = 5000;

// The only source of what the model sees. The client sends a post URI and nothing else, so nobody can pair
// a real post's URI with invented text, alt text or images and have every listener hear the result. A URI
// that does not resolve to a post on Bluesky's public AppView gives null: no model call, no cache row.
export async function fetchPost(uri: string): Promise<PostInput | null> {
  if (!isPostUri(uri)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${GET_POSTS}?uris=${encodeURIComponent(uri)}`, { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { posts?: { uri?: unknown }[] };
    const view = body.posts?.find((post) => post?.uri === uri);
    const post = view ? mapFeedItem({ post: view }) : null;
    return post ? descriptionInput(post) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
