/**
 * Round 9 — the site's own photos, collected from every page the scraper read (homepage first, then about,
 * gallery, services, menu, parks, events …): <img> (largest srcset entry, lazy-load attributes), <picture>
 * sources, CSS backgrounds (inline, data-bg, stylesheets), og:image / twitter:image, JSON-LD images and linked
 * full-size images. Logos, icons, sprites, tracking pixels, screenshots and tiny images are skipped.
 *
 * Pure: site-photos.server.ts fetches and measures them; the hero gate (google-photo.server.ts) rates them.
 */
import type { SiteFacts } from "./types.ts";

/** Big enough for a supporting section (feature, gallery, about). */
export const SITE_PHOTO_MIN_W = 640;
export const SITE_PHOTO_MIN_H = 360;
/** Big enough for a hero (shown with a treatment — framed, tinted overlay — when under SITE_HERO_SHARP_W). */
export const SITE_HERO_MIN_W = 800;
export const SITE_HERO_SHARP_W = 1400;
/** How many of the site's pictures are fetched and measured per site (time-boxed). */
export const SITE_PHOTO_MAX = 40;

/** Words / file names of pictures that are never photos of the business. */
export const NOT_PHOTO =
  /\b(?:logos?|icons?|favicon|sprites?|pixel|spacer|badges?|avatars?|gravatar|emoji|placeholder|loader|spinner|buttons?|arrows?|chevron|qr|payment|visa|mastercard|paypal|social|facebook|instagram|twitter|linkedin|youtube|tiktok|yelp|bbb|tracking|seal|signature|wordmark)\b/i;
/** Screenshots of text / documents: never a hero. */
export const SCREENSHOT = /\b(?:screen\s?shots?|screenshot|screen\s?capture|scan(?:ned)?|document|flyer|brochure|agenda|minutes|pdf)\b/i;

export type SitePhotoRef = { url: string; label: string; home: boolean; page: string; from: string };

/** A stable key for "the same picture" (size variants, CDN parameters). */
export function photoKey(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/-\d{2,4}x\d{2,4}(?=\.[a-z0-9]{3,4}$)/i, "").replace(/-scaled(?=\.[a-z0-9]{3,4}$)/i, "").replace(/@\dx(?=\.[a-z0-9]{3,4}$)/i, "");
    return `${u.hostname.replace(/^www\./, "")}${path}`.toLowerCase();
  } catch {
    return url;
  }
}

/**
 * The full-size file for a picture, tried before the one on the page: a WordPress "-300x200" thumbnail's
 * original, a Squarespace / Shopify / Wix CDN image at a hero-friendly width.
 */
export function fullSizeUrls(url: string): string[] {
  const out: string[] = [];
  try {
    const u = new URL(url);
    if (/squarespace-cdn\.com$/i.test(u.hostname) && !u.searchParams.has("format")) {
      const big = new URL(u);
      big.searchParams.set("format", "1500w");
      out.push(big.toString());
    } else if (/cdn\.shopify\.com$/i.test(u.hostname) && !u.searchParams.has("width")) {
      const big = new URL(u);
      big.searchParams.set("width", "1600");
      out.push(big.toString());
    } else if (/-\d{2,4}x\d{2,4}\.(?:jpe?g|png|webp)$/i.test(u.pathname)) {
      const big = new URL(u);
      big.pathname = u.pathname.replace(/-\d{2,4}x\d{2,4}(?=\.[a-z0-9]{3,4}$)/i, "");
      out.push(big.toString());
    }
  } catch {
    // not a URL
  }
  out.push(url);
  return [...new Set(out)];
}

/**
 * Every candidate photo URL on the site with its words, homepage first, de-duplicated, logos / icons / pixels /
 * screenshots / tiny declared sizes skipped. `skipped` counts why the others were dropped (for the log).
 */
export function sitePhotoRefs(facts: Pick<SiteFacts, "images" | "imageText" | "siteArt" | "logo" | "sourceUrl">, max = SITE_PHOTO_MAX): { refs: SitePhotoRef[]; skipped: Record<string, number>; seen: number } {
  const skipped: Record<string, number> = {};
  const skip = (why: string) => {
    skipped[why] = (skipped[why] ?? 0) + 1;
  };
  const raw: (SitePhotoRef & { declared?: number; i: number })[] = [];
  let i = 0;
  for (const a of facts.siteArt ?? []) {
    i += 1;
    if (a.kind === "svg") continue;
    if (a.kind === "logo") {
      skip("logo");
      continue;
    }
    if (!/^https:\/\//.test(a.url)) continue;
    raw.push({ url: a.url, label: a.label, home: a.home, page: a.page, from: a.kind, declared: a.width && a.height ? Math.min(a.width, a.height) : undefined, i });
  }
  for (const url of facts.images ?? []) {
    i += 1;
    if (!/^https:\/\//.test(url)) continue;
    raw.push({ url, label: facts.imageText?.[url] ?? "", home: true, page: facts.sourceUrl, from: "img", i });
  }
  const seen = new Map<string, SitePhotoRef & { declared?: number; i: number }>();
  for (const r of raw) {
    const words = `${r.label} ${r.url.split(/[?#]/)[0]}`;
    if (facts.logo && photoKey(r.url) === photoKey(facts.logo)) {
      skip("logo");
      continue;
    }
    if (/\.(?:svg|gif|ico)(?:[?#]|$)/i.test(r.url)) {
      skip("icon / svg / gif");
      continue;
    }
    if (NOT_PHOTO.test(words)) {
      skip("logo / icon / social");
      continue;
    }
    if (SCREENSHOT.test(r.label)) {
      skip("screenshot / document");
      continue;
    }
    if (r.declared !== undefined && r.declared < 200) {
      skip("tiny");
      continue;
    }
    const key = photoKey(r.url);
    const prev = seen.get(key);
    if (prev) {
      if (!prev.label && r.label) prev.label = r.label;
      prev.home = prev.home || r.home;
      continue;
    }
    seen.set(key, { ...r });
  }
  const refs = [...seen.values()]
    // homepage first, then pictures with words, then page order
    .sort((a, b) => Number(b.home) - Number(a.home) || Number(Boolean(b.label)) - Number(Boolean(a.label)) || a.i - b.i)
    .map(({ url, label, home, page, from }) => ({ url, label, home, page, from }));
  if (refs.length > max) skipped["over the limit"] = refs.length - max;
  return { refs: refs.slice(0, max), skipped, seen: raw.length };
}

/** A loaded photo's size class: usable in a section, as a hero, and whether the hero needs a treatment. */
export function sizeClass(width: number, height: number): { usable: boolean; hero: boolean; small: boolean; why?: string } {
  const ratio = width / Math.max(1, height);
  if (width < SITE_PHOTO_MIN_W || height < SITE_PHOTO_MIN_H) return { usable: false, hero: false, small: true, why: `too small (${width}x${height})` };
  if (ratio > 3.5 || ratio < 0.45) return { usable: false, hero: false, small: false, why: `banner / strip shape (${width}x${height})` };
  // Landscape from 800px wide; a big square / portrait photo (a plated dish, a storefront) too: the hero crops it
  // (cover) and the score prefers wide ones.
  const hero = (width >= SITE_HERO_MIN_W && ratio >= 1.15) || (width >= 1000 && ratio >= 0.66);
  return { usable: true, hero, small: width < SITE_HERO_SHARP_W, why: hero ? undefined : ratio < 1.15 ? `portrait / square (${width}x${height}): sections only` : `under ${SITE_HERO_MIN_W}px wide: sections only` };
}

/** A PNG with an alpha channel is a cutout graphic (logo, wordmark, mascot), not a photo. */
export function isAlphaPng(bytes: Buffer, type: string): boolean {
  return type === "image/png" && bytes.length > 26 && (bytes[25] === 4 || bytes[25] === 6);
}

/**
 * Round 10: an alt / caption that is really a file name ("background fx dji still004 dji still", "IMG_2041",
 * "DSC01234 edited", "hero-bg-2x.jpg") is not a caption: the card shows a vision-written description instead.
 */
const CAMERA = /^(?:dji|dsc[nf]?|img|imag|pxl|mvimg|gopro|dcim|screenshot|screen|shot|untitled|copy|final|edited?|fx|bg|hd|4k|uhd|hdr|raw|scaled|still|frame|clip|export|resized?|thumb(?:nail)?|v\d+|\d+x\d+|\d+px|e\d{6,}|wp|uploads?)$/;
export function isFilenameLike(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (/\.(?:jpe?g|png|webp|gif|heic|avif|tiff?)\b/.test(t)) return true;
  if (!/\s/.test(t) && /[_-]/.test(t) && /\d/.test(t)) return true;
  const tokens = t.split(/[\s_.+-]+/).filter(Boolean);
  if (!tokens.length) return false;
  let score = 0;
  const seen = new Set<string>();
  for (const tok of tokens) {
    if (CAMERA.test(tok)) score++;
    else if (/^[a-z]+\d{2,}[a-z]*$|^\d{2,}[a-z]+$/.test(tok)) score++;
    else if (/^\d{3,}$/.test(tok)) score++;
    if (seen.has(tok) && tok.length > 1) score++;
    seen.add(tok);
  }
  return score >= 2 || (tokens.length <= 2 && score >= 1);
}

/** The words to show for a site photo: its caption, unless that is a file name; then the vision description. */
export function photoCaption(alt: string | undefined, vision: string | undefined): string {
  const a = (alt ?? "").trim();
  if (a && !isFilenameLike(a)) return a;
  const v = (vision ?? "").trim();
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : "";
}
