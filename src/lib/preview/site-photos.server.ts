/**
 * Round 9 — fetch and measure the site's own photos (site-photos.ts lists them), once per site per 15 minutes:
 * full-size variants first, then the page's file; too-small / strip-shaped / duplicate pictures are dropped and
 * counted. Used by every look (heroes and supporting sections) and by the hero quality gate.
 */
import { measurePhoto } from "./hero-pick.server.ts";
import { hamming, type PixelStats } from "./hero-pick.ts";
import { fetchPhoto, type Photo } from "./images.server.ts";
import { fullSizeUrls, isAlphaPng, sitePhotoRefs, sizeClass, SITE_PHOTO_MAX, type SitePhotoRef } from "./site-photos.ts";
import type { SiteFacts } from "./types.ts";

export type SitePhoto = SitePhotoRef & {
  photo: Photo;
  /** The URL the file was actually loaded from (a full-size variant when the CDN has one). */
  loaded: string;
  stats?: PixelStats;
  hash?: string;
  hero: boolean;
  small: boolean;
};

export type SitePhotoScan = {
  /** Usable photos, best first: hero-sized landscape ones first, then by size. */
  photos: SitePhoto[];
  /** Candidate pictures listed on the site (after dropping logos / icons / screenshots by their words). */
  listed: number;
  /** All pictures the scraper saw on the pages it read. */
  seen: number;
  pages: number;
  skipped: Record<string, number>;
  ms: number;
};

const cache = new Map<string, { at: number; scan: Promise<SitePhotoScan> }>();

async function loadOne(ref: SitePhotoRef): Promise<{ photo: Photo; loaded: string } | undefined> {
  for (const url of fullSizeUrls(ref.url)) {
    const photo = await fetchPhoto(url).catch(() => null);
    if (photo) return { photo, loaded: url };
  }
  return undefined;
}

export function scanSitePhotos(facts: SiteFacts, opts: { budgetMs?: number; max?: number } = {}): Promise<SitePhotoScan> {
  const key = `${facts.sourceUrl}|${(facts.siteArt ?? []).length}|${facts.images.length}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.scan;
  const scan = doScan(facts, opts.budgetMs ?? 12_000, opts.max ?? SITE_PHOTO_MAX);
  cache.set(key, { at: Date.now(), scan });
  if (cache.size > 50) cache.delete(cache.keys().next().value!);
  return scan;
}

async function doScan(facts: SiteFacts, budgetMs: number, max: number): Promise<SitePhotoScan> {
  const start = Date.now();
  const { refs, skipped, seen } = sitePhotoRefs(facts, max);
  const skip = (why: string) => {
    skipped[why] = (skipped[why] ?? 0) + 1;
  };
  const loaded: (SitePhoto | undefined)[] = refs.map(() => undefined);
  const queue = refs.map((r, i) => ({ r, i }));
  const deadline = start + budgetMs;
  const worker = async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      if (Date.now() > deadline) {
        skip("out of time");
        continue;
      }
      const got = await loadOne(next.r);
      if (!got) {
        skip("failed to load");
        continue;
      }
      const size = sizeClass(got.photo.width, got.photo.height);
      if (!size.usable) {
        skip(size.why?.startsWith("too small") ? "too small" : "banner / strip shape");
        continue;
      }
      if (isAlphaPng(got.photo.bytes, got.photo.type)) {
        skip("transparent graphic (logo / cutout)");
        continue;
      }
      const m = measurePhoto(got.photo.bytes, got.photo.type);
      loaded[next.i] = { ...next.r, photo: got.photo, loaded: got.loaded, stats: m?.stats, hash: m?.hash, hero: size.hero, small: size.small };
    }
  };
  // Round 9b: a hard cap — photos still downloading when the budget runs out are left out (never waited for).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capped = await Promise.race([
    Promise.all(Array.from({ length: 6 }, worker)).then(() => false),
    new Promise<boolean>((r) => {
      timer = setTimeout(() => r(true), budgetMs + 500);
    }),
  ]);
  clearTimeout(timer);
  if (capped) {
    skip("out of time");
    queue.length = 0;
  }
  const photos: SitePhoto[] = [];
  for (const p of loaded) {
    if (!p) continue;
    // The same picture at two sizes / two URLs: keep the bigger one.
    const twin = photos.findIndex((o) => (o.hash && p.hash && hamming(o.hash, p.hash) <= 6) || o.photo.bytes.equals(p.photo.bytes));
    if (twin >= 0) {
      skip("duplicate");
      if (p.photo.width > photos[twin]!.photo.width) photos[twin] = p;
      continue;
    }
    photos.push(p);
  }
  photos.sort((a, b) => Number(b.hero) - Number(a.hero) || Number(b.home) - Number(a.home) || b.photo.width * b.photo.height - a.photo.width * a.photo.height);
  const scan: SitePhotoScan = { photos, listed: refs.length, seen, pages: facts.pages?.length ?? 1, skipped, ms: Date.now() - start };
  const heroes = photos.filter((p) => p.hero).length;
  console.info(
    `[photo-search] site photos: read ${scan.pages} page${scan.pages === 1 ? "" : "s"}, ${seen} pictures seen, ${refs.length} candidates, ${photos.length} usable photos (≥640px), ${heroes} hero-sized (≥800px wide landscape, or ≥1000px square / portrait)${Object.keys(skipped).length ? ` · skipped ${Object.entries(skipped).map(([w, n]) => `${n} ${w}`).join(", ")}` : ""} · ${scan.ms}ms`,
  );
  for (const p of photos.slice(0, 16))
    console.info(`[photo-search]   site photo ${p.hero ? "HERO" : "section"} ${p.photo.width}x${p.photo.height}${p.small && p.hero ? " (small: shown with a treatment)" : ""} “${(p.label || "no words").slice(0, 60)}” ${p.url.slice(0, 120)}`);
  return scan;
}
