import type { Post, PostMedia, PostRef } from '../types';

type Rec = Record<string, unknown>;

const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null;
const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
const num = (value: unknown): number => (typeof value === 'number' ? value : 0);

function ref(value: unknown): PostRef | null {
  if (!isRec(value)) return null;
  const uri = str(value.uri);
  const cid = str(value.cid);
  return uri && cid ? { uri, cid } : null;
}

function mapMedia(embed: unknown): PostMedia[] {
  if (!isRec(embed)) return [];
  switch (embed.$type) {
    case 'app.bsky.embed.images#view': {
      const images = (Array.isArray(embed.images) ? embed.images : []).filter(isRec).map((image) => ({
        url: str(image.fullsize) ?? str(image.thumb) ?? '',
        alt: str(image.alt),
      }));
      return images.length ? [{ kind: 'images', images }] : [];
    }
    case 'app.bsky.embed.video#view':
      return [{ kind: 'video', alt: str(embed.alt), thumbUrl: str(embed.thumbnail) }];
    case 'app.bsky.embed.external#view': {
      if (!isRec(embed.external)) return [];
      const url = str(embed.external.uri);
      return url ? [{ kind: 'link', url, title: str(embed.external.title) ?? '' }] : [];
    }
    case 'app.bsky.embed.record#view': {
      const record = embed.record;
      if (!isRec(record) || record.$type !== 'app.bsky.embed.record#viewRecord') return [];
      const author = isRec(record.author) ? record.author : {};
      return [
        {
          kind: 'quote',
          authorName: str(author.displayName) ?? str(author.handle) ?? 'someone',
          text: isRec(record.value) ? (str(record.value.text) ?? '') : '',
        },
      ];
    }
    case 'app.bsky.embed.recordWithMedia#view':
      return [...mapMedia(embed.media), ...mapMedia(isRec(embed.record) ? { ...embed.record, $type: 'app.bsky.embed.record#view' } : null)];
    default:
      return [];
  }
}

export function mapFeedItem(item: unknown): Post | null {
  if (!isRec(item) || !isRec(item.post)) return null;
  const post = item.post;
  const self = ref(post);
  if (!self || !isRec(post.author)) return null;
  const record = isRec(post.record) ? post.record : {};
  const handle = str(post.author.handle);
  const id = str(post.author.did);
  if (!handle || !id) return null;
  const reason = isRec(item.reason) && item.reason.$type === 'app.bsky.feed.defs#reasonRepost' && isRec(item.reason.by) ? item.reason.by : null;
  return {
    ...self,
    author: { id, handle, displayName: str(post.author.displayName), avatarUrl: str(post.author.avatar) },
    text: str(record.text) ?? '',
    createdAt: str(record.createdAt) ?? str(post.indexedAt) ?? new Date(0).toISOString(),
    media: mapMedia(post.embed),
    repostedBy: reason ? (str(reason.displayName) ?? str(reason.handle)) : null,
    replyRoot: isRec(record.reply) ? ref(record.reply.root) : null,
    counts: { likes: num(post.likeCount), reposts: num(post.repostCount), replies: num(post.replyCount) },
  };
}
