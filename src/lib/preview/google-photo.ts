/**
 * Google Images (via Serper, https://serper.dev) as the first web source for preview photos. Pure helpers:
 * queries, Serper result normalizing, filtering (stock/watermark sites, logos, tiny or non-landscape images)
 * and scoring when no vision model is available. The search itself is in google-photo.server.ts.
 *
 * These photos are TEMPORARY: they belong to someone else and are shown only in the preview. Each stored one
 * carries `temporary` metadata (source page, domain, image URL, query) so the build step can swap it.
 */
import { expandedKeywords, sceneKeywords, webQueries } from "./web-photo.ts";

export type GoogleImage = {
  title: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  /** The page the image is on. */
  link: string;
  domain: string;
  /** Site name as Google shows it. */
  source: string;
  position: number;
};

/** Stored with a preview photo from Google Images: enough to credit it and to replace it at build time. */
export type TemporaryPhoto = {
  provider: "Google Images";
  /** "Serper" on the master server; "photo-search proxy" on a white-label clone. */
  via: "Serper" | "photo-search proxy";
  title: string;
  imageUrl: string;
  sourcePage: string;
  domain: string;
  query: string;
  /** "vision" (Grok picked it) or "score" (title/size/aspect). */
  pickedBy: "vision" | "score";
};

/** Stock sites whose previews are watermarked (and not ours to use). */
export const STOCK_DOMAINS = [
  "shutterstock.com",
  "gettyimages.",
  "istockphoto.com",
  "alamy.com",
  "dreamstime.com",
  "stock.adobe.com",
  "adobestock.com",
  "ftcdn.net", // Adobe Stock's image CDN
  "123rf.com",
  "depositphotos.com",
  "bigstockphoto.com",
  "canstockphoto.com",
  "agefotostock.com",
  "pond5.com",
  "vectorstock.com",
  "freepik.com",
];

const LOGOISH = /\b(logo|logos|icon|icons|vector|clip ?art|clipart|cartoon|illustration|drawing|diagram|infographic|map|maps|flyer|poster|template|mock ?up|banner ad|seal|emblem|badge|screenshot|qr)\b|\.svg(\?|$)/i;

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Serper /images JSON (or the master's photo-search proxy, which returns the same shape) -> clean list. */
export function normalizeImages(json: unknown): GoogleImage[] {
  const list = (json && typeof json === "object" && Array.isArray((json as { images?: unknown }).images) ? (json as { images: unknown[] }).images : []) as Record<string, unknown>[];
  return list
    .map((r, i) => {
      const imageUrl = String(r?.imageUrl ?? "");
      const link = String(r?.link ?? "");
      return {
        title: String(r?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
        imageUrl,
        imageWidth: Number(r?.imageWidth) || 0,
        imageHeight: Number(r?.imageHeight) || 0,
        link: /^https?:\/\//.test(link) ? link : "",
        domain: String(r?.domain ?? "").toLowerCase().slice(0, 100) || host(link) || host(imageUrl),
        source: String(r?.source ?? "").slice(0, 100),
        position: Number(r?.position) || i + 1,
      };
    })
    .filter((r) => /^https:\/\//.test(r.imageUrl) && r.imageUrl.length < 2000)
    .slice(0, 40);
}

/** Why an image can't be used, or "" if it can. */
export function rejectReason(img: GoogleImage): string {
  const where = `${img.domain} ${host(img.imageUrl)} ${host(img.link)}`;
  if (STOCK_DOMAINS.some((d) => where.includes(d))) return "stock / watermarked";
  if (LOGOISH.test(`${img.title} ${img.imageUrl}`)) return "logo / graphic";
  if (img.imageWidth && img.imageWidth < 1000) return "too small";
  if (img.imageWidth && img.imageHeight && (img.imageWidth / img.imageHeight < 1.2 || img.imageWidth / img.imageHeight > 2.8)) return "not a landscape hero shape";
  if (/\.(gif|svg)(\?|$)/i.test(img.imageUrl)) return "not a photo";
  return "";
}

/**
 * Google Images queries, best first, at most two (each costs a Serper credit):
 * the subject in its town ("red bricks Pauls Valley Oklahoma") and the subject's usual meaning anywhere
 * ("red brick street"). Without a subject: the business type in its town ("plumbing company Oklahoma City Oklahoma").
 */
export function googleQueries(scene: string | undefined, place: { city: string; state: string } | undefined, kind: string): string[] {
  if (!scene) return [[kind, place?.city, place?.state].filter(Boolean).join(" ").trim()].filter(Boolean);
  const all = webQueries(scene, place);
  const town = all.find((q) => q.scope === "town");
  const out: string[] = [];
  if (town) out.push(`${town.q.replace(new RegExp(`^${(place?.city ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")} ${place?.city ?? ""} ${place?.state ?? ""}`.replace(/\s+/g, " ").trim());
  const generic = all.find((q) => q.scope === "generic");
  // The subject anywhere, but not a lone word ("downtown") that could be any town's.
  if (generic && generic.q.trim().split(/\s+/).length >= 2) out.push(generic.q);
  if (!out.length) out.push(scene);
  return [...new Set(out)].slice(0, 2);
}

/** Score without vision: subject words in the title/page, the town, size and a hero-friendly aspect. -1 = no. */
export function scoreGoogleImage(img: GoogleImage, scene: string | undefined, place: { city: string; state: string } | undefined, kind: string): number {
  if (rejectReason(img)) return -1;
  const title = img.title.toLowerCase();
  const where = `${img.link} ${img.imageUrl}`.toLowerCase().replace(/[-_/.%]+/g, " ");
  const keywords = scene ? expandedKeywords(sceneKeywords(scene, place)) : sceneKeywords(kind, undefined);
  const has = (text: string, k: string) => new RegExp(`\\b${k.replace(/s$/, "")}(s|es)?\\b`).test(text);
  const inTitle = keywords.filter((k) => has(title, k)).length;
  const inUrl = keywords.filter((k) => !has(title, k) && has(where, k)).length;
  if (scene && !inTitle && !inUrl) return -1;
  const city = place?.city.toLowerCase() ?? "";
  const ratio = img.imageWidth && img.imageHeight ? img.imageWidth / img.imageHeight : 1.5;
  return (
    inTitle * 3 +
    inUrl +
    (city && (title.includes(city) || where.includes(city)) ? 2 : 0) +
    (img.imageWidth >= 1600 ? 1 : 0) +
    (ratio >= 1.35 && ratio <= 1.95 ? 1 : 0) +
    Math.max(0, 10 - img.position) / 10
  );
}

/** The card line for a temporary preview photo. */
export const TEMP_PHOTO_LINE = "Photo: from Google Images (preview only, replaced when your site is built)";
