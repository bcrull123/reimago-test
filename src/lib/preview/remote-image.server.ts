/**
 * Same-origin copies of the few images a preview page still hotlinks (mainly SVG logos), so the browser
 * can screenshot the page for the lead email without a tainted canvas.
 *
 * Safety: only URLs that the preview's own homepage actually shows as <img src> are fetched (an exact-match
 * allowlist built from the stored site, never an open proxy). Fetches go through fetchLogoFile, which refuses
 * private/internal hosts, follows at most a few redirects, and caps the body at 2 MB. The originals of this
 * preview's temporary Google Images photos (stored metadata) are allowed too.
 */
import { readSite } from "@/lib/pages.server";
import { renderSitePage } from "@/lib/preview/render";

function decodeAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** The remote (https) image URLs a site's homepage shows. */
export function remoteImagesOf(html: string): Set<string> {
  const found = new Set<string>();
  for (const match of html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/gi)) {
    const src = decodeAttr(match[1]!);
    if (/^https:\/\//i.test(src)) found.add(src);
  }
  return found;
}

export async function remoteImageResponse(siteId: string, url: string): Promise<Response> {
  const notFound = () => new Response("Not found.", { status: 404 });
  if (!url || url.length > 2000 || !/^https:\/\//i.test(url)) return notFound();
  const site = await readSite(siteId);
  if (!site) return notFound();
  const html = renderSitePage(site, "home") ?? "";
  const allowed = remoteImagesOf(html);
  if (site.logo && /^https:\/\//i.test(site.logo)) allowed.add(site.logo);
  // Temporary Google Images photos are saved with the preview, but their originals stay reachable for this
  // preview only (e.g. a later swap or re-crop), never for any other URL.
  for (const img of Object.values(site.images ?? {})) if (img.temporary?.imageUrl && /^https:\/\//i.test(img.temporary.imageUrl)) allowed.add(img.temporary.imageUrl);
  if (!allowed.has(url)) return new Response("That image is not part of this preview.", { status: 403 });
  const { fetchLogoFile } = await import("@/lib/preview/images.server");
  const file = await fetchLogoFile(url);
  if (!file || !/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.type)) return notFound();
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.type,
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
      // An SVG opened directly can't run anything.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
