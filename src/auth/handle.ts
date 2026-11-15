export const DEFAULT_HANDLE_DOMAIN = 'bsky.social';

const HANDLE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

export type NormalizedHandle = { handle: string; addedDomain: boolean };

export function normalizeHandle(entry: string): NormalizedHandle | null {
  const words = entry
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/\s+dot\s+/g, '.')
    .replace(/\s+/g, '')
    .replace(/^\.+|\.+$/g, '');
  if (!words) return null;
  const addedDomain = !words.includes('.');
  const handle = addedDomain ? `${words}.${DEFAULT_HANDLE_DOMAIN}` : words;
  return HANDLE.test(handle) ? { handle, addedDomain } : null;
}

export function spellHandle(handle: string): string {
  return handle.split('.').map((part) => part.split('-').join(' dash ')).join(' dot ');
}
