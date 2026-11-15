import type { PostInput } from './describeCache';

type Captions = NonNullable<PostInput['video']>['captions'];

const TIMEOUT_MS = 3000;
const MAX_CHARS = 600;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'error' });
  } finally {
    clearTimeout(timer);
  }
}

// The DID document is written by the post's author, so its PDS address is only fetched when it is a public
// https host name: no IP literals, ports, localhost or internal names.
export function publicHttpsOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const internal = host === 'localhost' || /\.(local|internal|localhost)$/.test(host) || /^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.');
    return url.protocol === 'https:' && !url.port && !url.username && !internal ? url.origin : null;
  } catch {
    return null;
  }
}

async function pdsOf(did: string): Promise<string | null> {
  if (!/^did:plc:[a-z2-7]{24}$/.test(did)) return null;
  const response = await fetchWithTimeout(`https://plc.directory/${did}`);
  if (!response.ok) return null;
  const document = (await response.json()) as { service?: { id: string; serviceEndpoint: string }[] };
  return publicHttpsOrigin(document.service?.find((service) => service.id === '#atproto_pds' || service.id.endsWith('#atproto_pds'))?.serviceEndpoint);
}

export function vttText(vtt: string): string {
  return vtt
    .split(/\r?\n/)
    .filter((line) => line.trim() && !/^WEBVTT|^NOTE|^\d+$|-->/.test(line.trim()))
    .map((line) => line.replace(/<[^>]+>/g, '').trim())
    .filter((line, i, lines) => line !== lines[i - 1])
    .join(' ');
}

// Bluesky stores video captions as WebVTT blobs on the author's PDS; the feed only carries their CIDs.
// Any failure here just means the description is written without captions.
export async function fetchCaptions(did: string, captions: Captions): Promise<string | null> {
  const caption = captions.find((entry) => entry.lang.startsWith('en')) ?? captions[0];
  if (!caption) return null;
  try {
    const pds = await pdsOf(did);
    if (!pds) return null;
    const response = await fetchWithTimeout(`${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(caption.cid)}`);
    if (!response.ok) return null;
    const text = vttText(await response.text());
    return text ? (text.length > MAX_CHARS ? `${text.slice(0, text.lastIndexOf(' ', MAX_CHARS))} …` : text) : null;
  } catch {
    return null;
  }
}
