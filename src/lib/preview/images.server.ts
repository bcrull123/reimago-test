/**
 * Images for preview sites.
 *
 * Policy: prefer the business's own photos (scraped from their site) when they
 * are big enough to look good; generate photos only for the gaps (hero, a
 * feature image, service cards). Every image — real or generated — is copied
 * into preview storage with the site record, so pages never hotlink expiring
 * provider URLs or slow third-party hosts. Never generate logos or text.
 */
import { photoCaption } from "@/lib/preview/site-photos";
import { generateImage, imageProvider, sniffImageType } from "@/lib/ai-provider.server";
import { saveImage } from "@/lib/pages.server";
import type { SiteFacts, StoredImage } from "@/lib/preview/types";

export type Photo = { url: string; bytes: Buffer; type: string; width: number; height: number };

/** Read width/height from JPEG, PNG, WebP, or GIF bytes. */
export function imageSize(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 24) return undefined;
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.subarray(0, 3).toString("ascii") === "GIF") return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    const chunk = bytes.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = bytes.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    return undefined;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
      }
      i += 2 + bytes.readUInt16BE(i + 2);
    }
  }
  return undefined;
}

const photoCache = new Map<string, { at: number; photo: Photo | null }>();

export async function fetchPhoto(url: string): Promise<Photo | null> {
  const cached = photoCache.get(url);
  if (cached && Date.now() - cached.at < 15 * 60_000) return cached.photo;
  const own = await ownStoredImage(url);
  if (own) {
    const type = sniffImageType(own.bytes);
    const size = imageSize(own.bytes);
    const photo = size && /^image\/(jpeg|png|webp)$/.test(type) ? { url, bytes: own.bytes, type, ...size } : null;
    photoCache.set(url, { at: Date.now(), photo });
    return photo;
  }
  let photo: Photo | null = null;
  try {
    const { assertPublic, readCapped } = await import("@/lib/reimagine.server");
    let current = new URL(url);
    for (let hop = 0; hop < 3; hop += 1) {
      if (current.protocol !== "https:" && current.protocol !== "http:") break;
      await assertPublic(current);
      const response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        headers: { Accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8", "User-Agent": "ReimagoReimagine/1.0 (+https://reimago.ai)" },
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        current = new URL(response.headers.get("location")!, current);
        continue;
      }
      if (!response.ok) break;
      const bytes = await readCapped(response, 3_500_000);
      const type = sniffImageType(bytes);
      const size = imageSize(bytes);
      if (size && /^image\/(jpeg|png|webp)$/.test(type) && bytes.length < 3_500_000) photo = { url, bytes, type, ...size };
      break;
    }
  } catch {
    photo = null;
  }
  photoCache.set(url, { at: Date.now(), photo });
  if (photoCache.size > 300) photoCache.delete(photoCache.keys().next().value!);
  return photo;
}

export type LogoFile = { bytes: Buffer; type: string; url: string };

/**
 * Fetch a logo for analysis. Image CDNs (Squarespace, Shopify, Cloudinary…) negotiate the format, so this
 * asks for PNG/JPEG first — WebP/AVIF can't be read by the pure-JS analyser. SVG is returned as text bytes.
 * Returns null when the logo can't be loaded (then the business name is shown instead).
 */
/** An image this app stored itself (uploaded logo/photos, AI logos), read from the store instead of the network. */
async function ownStoredImage(url: string): Promise<{ bytes: Buffer; type: string } | undefined> {
  const { parseOwnStoredImage } = await import("./own-image");
  const parsed = parseOwnStoredImage(url);
  if (!parsed) return undefined;
  try {
    const { isVercelSystemHost, envPublicOrigin, readPublicBaseEnv } = await import("@/lib/public-base");
    // Legacy customer links may still carry a *.vercel.app host we mistakenly minted.
    if (!isVercelSystemHost(parsed.host)) {
      const known: string[] = [];
      const envHost = envPublicOrigin(readPublicBaseEnv())?.host;
      if (envHost) known.push(envHost.toLowerCase());
      try {
        const { publicBase } = await import("@/lib/publish.server");
        const base = publicBase();
        if (base) known.push(new URL(base).host.toLowerCase());
      } catch {
        // No request context.
      }
      if (known.length && !known.includes(parsed.host.toLowerCase())) return undefined;
    }
  } catch {
    // No request context (tests): the store is local to this process.
  }
  const { readImage } = await import("@/lib/pages.server");
  return (await readImage(parsed.id, parsed.name).catch(() => undefined)) ?? undefined;
}

export async function fetchLogoFile(url: string): Promise<LogoFile | null> {
  const own = await ownStoredImage(url);
  if (own && /^image\/(png|jpeg)$/.test(own.type)) return { bytes: own.bytes, type: own.type, url };
  try {
    const { assertPublic, readCapped } = await import("@/lib/reimagine.server");
    let current = new URL(url);
    for (let hop = 0; hop < 4; hop += 1) {
      if (current.protocol !== "https:" && current.protocol !== "http:") return null;
      await assertPublic(current);
      const response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        headers: { Accept: "image/png,image/jpeg;q=0.9,image/svg+xml;q=0.8,image/*;q=0.3", "User-Agent": "ReimagoReimagine/1.0 (+https://reimago.ai)" },
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        current = new URL(response.headers.get("location")!, current);
        continue;
      }
      if (!response.ok) return null;
      const bytes = await readCapped(response, 2_000_000);
      const head = bytes.subarray(0, 512).toString("utf8").trimStart();
      const type = /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(head) || /image\/svg/i.test(response.headers.get("content-type") ?? "") ? "image/svg+xml" : sniffImageType(bytes);
      if (!/^image\//.test(type) || bytes.length < 40) return null;
      if (type !== "image/svg+xml") {
        const size = imageSize(bytes);
        // Tracking pixels and placeholders are not logos.
        if (size && (size.width <= 2 || size.height <= 2)) return null;
      }
      return { bytes, type, url: current.toString() };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * The site's own photos, best first (round 9: every page the scraper read, full-size variants, ≥640px; see
 * site-photos.server.ts). Each photo's words are kept in facts.imageText under the URL it was loaded from.
 */
export async function goodPhotos(facts: SiteFacts, max = 5): Promise<Photo[]> {
  const { scanSitePhotos } = await import("./site-photos.server.ts");
  const scan = await scanSitePhotos(facts);
  facts.imageText = facts.imageText ?? {};
  for (const p of scan.photos) if (p.label && !facts.imageText[p.loaded]) facts.imageText[p.loaded] = p.label;
  return scan.photos.slice(0, max).map((p) => ({ ...p.photo, url: p.loaded }));
}

/** Hero-sized (round 9, site-photos.ts sizeClass): ≥800px wide landscape, or a big square / portrait photo. */
export function heroWorthy(photo: Photo | undefined): boolean {
  if (!photo) return false;
  const r = photo.width / photo.height;
  return (photo.width >= 800 && r >= 1.15) || (photo.width >= 1000 && r >= 0.66);
}

/** Store the business's own photos with the site as photo-1..n. */
export async function storePhotos(siteId: string, photos: Photo[], facts: SiteFacts): Promise<Record<string, StoredImage>> {
  const out: Record<string, StoredImage> = {};
  await Promise.all(
    photos.map(async (photo, i) => {
      const name = `photo-${i + 1}`;
      try {
        await saveImage(siteId, name, photo.type, photo.bytes);
        out[name] = { name, type: photo.type, source: "photo", alt: photoCaption(facts.imageText?.[photo.url], undefined).slice(0, 120) || `${facts.name}`, width: photo.width, height: photo.height, sourceUrl: photo.url };
      } catch {
        // Skip a photo that cannot be stored.
      }
    }),
  );
  return out;
}

export { imagePrompt } from "@/lib/preview/image-prompts";

export function imagesEnabled(): boolean {
  return imageProvider() !== "none";
}

/** Generate one image and store it. Returns metadata, or undefined on any failure (caller falls back). */
export async function generateAndStore(
  siteId: string,
  name: string,
  prompt: string,
  aspect: "16:9" | "4:3" | "1:1" | "3:4",
  alt: string,
  timeoutMs = 45_000,
): Promise<StoredImage | undefined> {
  const image = await generateImage({ prompt, aspect, timeoutMs });
  if (!image || !/^image\/(jpeg|png|webp)$/.test(image.type)) return undefined;
  try {
    await saveImage(siteId, name, image.type, image.bytes);
    const size = imageSize(image.bytes);
    return { name, type: image.type, source: "generated", alt, ...(size ?? {}) };
  } catch {
    return undefined;
  }
}
