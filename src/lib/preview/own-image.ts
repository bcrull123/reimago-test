/**
 * Images this app stored itself under /made/<id>/img/<name> (uploaded logos and photos, AI logos).
 * Pure: the server uses this to read them from the store instead of fetching over the network.
 */
export type OwnStoredImage = { host: string; id: string; name: string };

const OWN = /^https?:\/\/([^/]+)\/made\/([a-f0-9]{16})\/img\/([a-z0-9-]{1,40})$/i;

export function parseOwnStoredImage(url: string): OwnStoredImage | undefined {
  const m = url.trim().match(OWN);
  if (!m) return undefined;
  return { host: m[1]!, id: m[2]!, name: m[3]!.toLowerCase() };
}

export function isOwnStoredImageUrl(url: string): boolean {
  return Boolean(parseOwnStoredImage(url));
}
