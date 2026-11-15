import type { Post } from '../types';

type Profile = { did: string; displayName?: string };

const BATCH = 25;

export async function withMentionNames(posts: Post[], lookup: (dids: string[]) => Promise<Profile[]>, timeoutMs = 1500): Promise<Post[]> {
  const dids = [...new Set(posts.flatMap((post) => (post.facets ?? []).flatMap((facet) => (facet.kind === 'mention' ? [facet.did] : []))))];
  if (!dids.length) return posts;
  const batches = Array.from({ length: Math.ceil(dids.length / BATCH) }, (_, i) => dids.slice(i * BATCH, (i + 1) * BATCH));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), timeoutMs)));
  const profiles = await Promise.race([Promise.all(batches.map((batch) => lookup(batch))).catch(() => null), timeout]);
  clearTimeout(timer);
  if (!profiles) return posts;
  const names = new Map(profiles.flat().flatMap((profile) => (profile.displayName?.trim() ? [[profile.did, profile.displayName.trim()] as const] : [])));
  return posts.map((post) =>
    post.facets?.some((facet) => facet.kind === 'mention' && names.has(facet.did))
      ? { ...post, facets: post.facets.map((facet) => (facet.kind === 'mention' ? { ...facet, name: names.get(facet.did) ?? null } : facet)) }
      : post,
  );
}
