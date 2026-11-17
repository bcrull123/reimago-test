/**
 * Pixel measurements for hero picking (decode JPEG/PNG; WebP is scored by its words only) and the site's own
 * photos as hero candidates. Pure scoring and assignment live in hero-pick.ts.
 */
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { dHash, pixelStats, type HeroCandidate, type PixelStats } from "./hero-pick.ts";
import { heroSuitability } from "./web-photo.ts";
import { isCivic } from "./image-prompts.ts";
import type { SiteFacts } from "./types.ts";

/** Brightness / contrast / sky / green and a perceptual hash, from the image bytes. */
export function measurePhoto(bytes: Buffer, type: string): { stats: PixelStats; hash: string } | undefined {
  try {
    let data: Uint8Array;
    let width: number;
    let height: number;
    if (type === "image/jpeg") {
      const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 256 });
      ({ data, width, height } = img);
    } else if (type === "image/png") {
      const img = PNG.sync.read(bytes);
      ({ data, width, height } = img);
    } else return undefined;
    if (!width || !height) return undefined;
    return { stats: pixelStats(data, width, height), hash: dHash(data, width, height) };
  } catch {
    return undefined;
  }
}

/** What a site photo shows, from its alt text / AI label / file name. */
export function sitePhotoText(url: string, facts: SiteFacts): string {
  const cue = facts.imageText?.[url]?.trim();
  let file = "";
  try {
    file = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    // keep ""
  }
  file = file.replace(/\.[a-z0-9]+$/i, "").replace(/[-_+]+/g, " ").trim();
  return [cue, /[a-z]{3}/i.test(file) && !/^(img|dsc|image|photo)?\s*\d+$/i.test(file) ? file : ""].filter(Boolean).join(" · ");
}

/** The site's hero-sized photos as candidates (they compete with Google on the same score). */
export async function siteHeroCandidates(facts: SiteFacts): Promise<HeroCandidate[]> {
  const { goodPhotos, heroWorthy } = await import("@/lib/preview/images.server");
  const civic = isCivic(facts);
  const photos = (await goodPhotos(facts, 8)).filter((p) => heroWorthy(p));
  return photos.map((p) => {
    const m = measurePhoto(p.bytes, p.type);
    const suit = heroSuitability(p.url, facts.imageText?.[p.url] ?? "", civic);
    return { id: p.url, source: "site", text: sitePhotoText(p.url, facts) || "photo from your site", width: p.width, height: p.height, stats: m?.stats, hash: m?.hash, relevance: Math.max(0, Math.min(3, suit / 2)) };
  });
}
