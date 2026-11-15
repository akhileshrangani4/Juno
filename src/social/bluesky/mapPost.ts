import type { Post, PostFacet, PostMedia, PostRef, PostReplyContext, VideoCaption } from '../types';

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
    case 'app.bsky.embed.gallery#view': {
      const images = (Array.isArray(embed.items) ? embed.items : []).filter(isRec).map((image) => ({
        url: str(image.fullsize) ?? str(image.thumbnail) ?? '',
        alt: str(image.alt),
      }));
      return images.length ? [{ kind: 'images', images }] : [];
    }
    case 'app.bsky.embed.video#view': {
      const ratio = isRec(embed.aspectRatio) ? embed.aspectRatio : null;
      return [
        {
          kind: 'video',
          alt: str(embed.alt),
          thumbUrl: str(embed.thumbnail),
          captions: [],
          aspectRatio: ratio && num(ratio.width) && num(ratio.height) ? { width: num(ratio.width), height: num(ratio.height) } : null,
        },
      ];
    }
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

function videoCaptions(recordEmbed: unknown): VideoCaption[] {
  if (!isRec(recordEmbed)) return [];
  const video = recordEmbed.$type === 'app.bsky.embed.recordWithMedia' ? recordEmbed.media : recordEmbed;
  if (!isRec(video) || !Array.isArray(video.captions)) return [];
  return video.captions.filter(isRec).flatMap((caption) => {
    const link = isRec(caption.file) && isRec(caption.file.ref) ? str(caption.file.ref.$link) : null;
    return link ? [{ lang: str(caption.lang) ?? 'und', cid: link }] : [];
  });
}

function charOffsets(text: string): Map<number, number> {
  const offsets = new Map<number, number>();
  let bytes = 0;
  let index = 0;
  for (const char of text) {
    offsets.set(bytes, index);
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    index += char.length;
  }
  offsets.set(bytes, index);
  return offsets;
}

function mapFacets(text: string, facets: unknown): PostFacet[] {
  if (!Array.isArray(facets) || !text) return [];
  const offsets = charOffsets(text);
  return facets.filter(isRec).flatMap((facet): PostFacet[] => {
    const index = isRec(facet.index) ? facet.index : {};
    const start = offsets.get(num(index.byteStart));
    const end = offsets.get(num(index.byteEnd));
    const feature = Array.isArray(facet.features) ? facet.features.find(isRec) : undefined;
    if (start === undefined || end === undefined || end <= start || !feature) return [];
    switch (feature.$type) {
      case 'app.bsky.richtext.facet#link': {
        const url = str(feature.uri);
        return url ? [{ start, end, kind: 'link', url }] : [];
      }
      case 'app.bsky.richtext.facet#mention': {
        const did = str(feature.did);
        return did ? [{ start, end, kind: 'mention', did, name: null }] : [];
      }
      case 'app.bsky.richtext.facet#tag': {
        const tag = str(feature.tag);
        return tag ? [{ start, end, kind: 'tag', tag }] : [];
      }
      default:
        return [];
    }
  });
}

function replyContext(item: Rec, record: Rec, authorId: string): PostReplyContext | null {
  if (!isRec(record.reply)) return null;
  const parent = isRec(item.reply) && isRec(item.reply.parent) ? item.reply.parent : null;
  const author = parent && isRec(parent.author) ? parent.author : null;
  if (!author) return { authorName: null, isSelf: false };
  return { authorName: str(author.displayName) ?? str(author.handle), isSelf: str(author.did) === authorId };
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
  const text = str(record.text) ?? '';
  const media = mapMedia(post.embed).map((entry) => (entry.kind === 'video' ? { ...entry, captions: videoCaptions(record.embed) } : entry));
  const reason = isRec(item.reason) && item.reason.$type === 'app.bsky.feed.defs#reasonRepost' && isRec(item.reason.by) ? item.reason.by : null;
  return {
    ...self,
    author: { id, handle, displayName: str(post.author.displayName), avatarUrl: str(post.author.avatar) },
    text,
    createdAt: str(record.createdAt) ?? str(post.indexedAt) ?? new Date(0).toISOString(),
    media,
    repostedBy: reason ? (str(reason.displayName) ?? str(reason.handle)) : null,
    replyRoot: isRec(record.reply) ? ref(record.reply.root) : null,
    replyTo: replyContext(item, record, id),
    facets: mapFacets(text, record.facets),
    langs: Array.isArray(record.langs) ? record.langs.filter((lang): lang is string => typeof lang === 'string').slice(0, 3) : [],
    counts: { likes: num(post.likeCount), reposts: num(post.repostCount), replies: num(post.replyCount) },
  };
}
