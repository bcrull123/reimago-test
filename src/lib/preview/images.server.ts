/**
 * Images for preview sites.
 *
 * Policy: prefer the business's own photos (scraped from their site) when they
 * are big enough to look good; generate photos only for the gaps (hero, a
 * feature image, service cards). Every image — real or generated — is copied
 * into preview storage with the site record, so pages never hotlink expiring
 * provider URLs or slow third-party hosts. Never generate logos or text.
 */
import { generateImage, imageProvider, sniffImageType } from "@/lib/ai-provider.server";
import { saveImage } from "@/lib/pages.server";
import type { DesignDirection, SiteFacts, StoredImage } from "@/lib/preview/types";

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

/** Fetch and measure the scraped photos; keep the ones big enough for a modern site, best first. */
export async function goodPhotos(facts: SiteFacts, max = 5): Promise<Photo[]> {
  const candidates = facts.images.filter((u) => /^https?:\/\//.test(u) && u !== facts.logo).slice(0, 8);
  const photos = (await Promise.all(candidates.map(fetchPhoto))).filter((p): p is Photo => Boolean(p));
  return photos
    .filter((p) => p.width >= 640 && p.height >= 400 && p.width / p.height < 3 && p.height / p.width < 2)
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, max);
}

export function heroWorthy(photo: Photo | undefined): boolean {
  return Boolean(photo && photo.width >= 1100 && photo.width / photo.height >= 1.2);
}

/** Store the business's own photos with the site as photo-1..n. */
export async function storePhotos(siteId: string, photos: Photo[], facts: SiteFacts): Promise<Record<string, StoredImage>> {
  const out: Record<string, StoredImage> = {};
  await Promise.all(
    photos.map(async (photo, i) => {
      const name = `photo-${i + 1}`;
      try {
        await saveImage(siteId, name, photo.type, photo.bytes);
        out[name] = { name, type: photo.type, source: "photo", alt: `${facts.name}`, width: photo.width, height: photo.height };
      } catch {
        // Skip a photo that cannot be stored.
      }
    }),
  );
  return out;
}

const TRADES: [RegExp, string][] = [
  [/plumb|drain|sewer|water heater/i, "plumbing company"],
  [/roof/i, "roofing company"],
  [/hvac|heating|air condition|furnace/i, "heating and air-conditioning company"],
  [/electric/i, "electrical contractor"],
  [/landscap|lawn|garden|tree service/i, "landscaping company"],
  [/dentist|dental|orthodont/i, "dental practice"],
  [/attorney|law firm|lawyer|legal/i, "law firm"],
  [/restaurant|bistro|kitchen|grill|pizza|taco|sushi/i, "restaurant"],
  [/bakery|cafe|coffee/i, "cafe"],
  [/salon|barber|spa\b|nails/i, "salon"],
  [/clean|maid|janitor/i, "cleaning company"],
  [/auto|mechanic|collision|tire/i, "auto repair shop"],
  [/fitness|gym|yoga|pilates/i, "fitness studio"],
  [/paint/i, "painting company"],
  [/pest|exterminat/i, "pest control company"],
  [/construct|remodel|contractor|builder/i, "construction company"],
];

function businessKind(facts: SiteFacts): string {
  if (facts.industry) return facts.industry;
  const text = [facts.name, facts.tagline, facts.description, ...facts.services.slice(0, 6)].filter(Boolean).join(" ");
  const trade = TRADES.find(([pattern]) => pattern.test(text));
  return trade?.[1] ?? (facts.services[0] || "local business");
}

/** Prompts never include the business name (models love to paint it as a fake logo). */
export function imagePrompt(slot: "hero" | "feature" | "service", facts: SiteFacts, design: DesignDirection, subject = ""): string {
  const kind = businessKind(facts);
  const style = `Art direction: ${design.imagery} Mood: ${design.mood}`.slice(0, 600);
  if (slot === "hero") {
    return `${design.heroSubject || `A striking, authentic scene that represents a ${kind}`}. Website hero photograph for a ${kind}. Wide composition with calm negative space for a headline. ${style}`;
  }
  if (slot === "feature") {
    return `Authentic behind-the-scenes photograph of skilled ${kind} work in progress, details of tools, materials and craft, natural candid framing. ${style}`;
  }
  return `Photograph illustrating "${subject}" for a ${kind}. Clear single subject, editorial product-style composition. ${style}`;
}

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
