/**
 * Web photo search for a scene the owner asked for, between "one of the site's own photos shows it" and
 * "generate it with AI". Free-license sources only, no keys: Openverse and Wikimedia Commons.
 * The whole search (queries + download) is time-boxed (~8s); any failure returns undefined so the caller
 * falls back to AI generation. The chosen photo is downloaded and stored with the preview (same origin).
 */
import { fetchPhoto, type Photo } from "@/lib/preview/images.server";
import { pickWebPhoto, webQueries, webQuery, type PhotoCredit, type WebPhotoCandidate } from "@/lib/preview/web-photo";

const UA = "ReimagoPreview/1.0 (https://reimago.ai; preview photo search)";
const cache = new Map<string, { at: number; value: WebPhotoResult[] }>();

export type WebPhotoResult = { photo: Photo; credit: PhotoCredit; query: string };

export function webPhotosEnabled(): boolean {
  return process.env.PREVIEW_WEB_PHOTOS !== "0";
}

const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function openverseLicense(license: string, version: string): string {
  const l = license.toLowerCase();
  if (l === "cc0") return "CC0";
  if (l === "pdm") return "Public domain";
  return `CC ${l.toUpperCase()}${version ? ` ${version}` : ""}`;
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function openverse(query: string, signal: AbortSignal): Promise<WebPhotoCandidate[]> {
  const url = `https://api.openverse.org/v1/images/?${new URLSearchParams({ q: query, license: "cc0,pdm,by,by-sa", page_size: "20" })}`;
  const json = (await getJson(url, signal)) as { results?: Record<string, unknown>[] };
  return (json.results ?? []).map((r) => {
    const tags = Array.isArray(r.tags) ? (r.tags as { name?: string }[]).map((t) => t?.name ?? "").join(" ") : "";
    return {
      title: String(r.title ?? "Untitled").slice(0, 160),
      author: String(r.creator ?? "").slice(0, 80),
      license: openverseLicense(String(r.license ?? ""), String(r.license_version ?? "")),
      licenseUrl: String(r.license_url ?? ""),
      sourceUrl: String(r.foreign_landing_url ?? r.url ?? ""),
      provider: "Openverse" as const,
      imageUrl: String(r.url ?? ""),
      width: Number(r.width) || 0,
      height: Number(r.height) || 0,
      text: `${r.title ?? ""} ${tags}`,
    };
  });
}

async function commons(query: string, signal: AbortSignal): Promise<WebPhotoCandidate[]> {
  const url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
    action: "query",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${query} filetype:bitmap`,
    gsrlimit: "20",
    prop: "imageinfo",
    iiprop: "url|size|extmetadata|mime",
    iiurlwidth: "1600",
    format: "json",
    origin: "*",
  })}`;
  const json = (await getJson(url, signal)) as { query?: { pages?: Record<string, { title?: string; imageinfo?: Record<string, unknown>[] }> } };
  return Object.values(json.query?.pages ?? {}).flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png|webp)$/.test(String(info.mime))) return [];
    const meta = (info.extmetadata ?? {}) as Record<string, { value?: string }>;
    const v = (k: string) => strip(String(meta[k]?.value ?? ""));
    const title = v("ObjectName") || String(page.title ?? "").replace(/^File:/, "").replace(/\.\w+$/, "");
    return [
      {
        title: title.slice(0, 160),
        author: v("Artist").slice(0, 80),
        license: v("LicenseShortName") || v("License"),
        licenseUrl: v("LicenseUrl"),
        sourceUrl: String(info.descriptionurl ?? ""),
        provider: "Wikimedia Commons" as const,
        imageUrl: String(info.thumburl ?? info.url ?? ""),
        width: Number(info.width) || 0,
        height: Number(info.height) || 0,
        text: `${page.title ?? ""} ${title} ${v("ImageDescription").slice(0, 400)} ${v("Categories")}`,
      },
    ];
  });
}

/** Search, rank and download up to `max` different free-license photos of `scene` near `place` (best first). Empty if none fit in time. */
export async function findWebPhotos(scene: string, place: { city: string; state: string } | undefined, budgetMs = 8_000, max = 3): Promise<WebPhotoResult[]> {
  const query = webQuery(scene, place);
  if (!query) return [];
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.value;
  const deadline = Date.now() + budgetMs;
  const signal = AbortSignal.timeout(Math.max(1000, budgetMs - 3000));
  // Town-scoped searches first ("Pauls Valley red brick", "Pauls Valley brick street", "Pauls Valley Oklahoma"),
  // then the subject anywhere ("red brick street"). Openverse gets the first town query and the plain one.
  const queries = webQueries(scene, place);
  const tag = (scope: "town" | "generic", q: string) => (list: WebPhotoCandidate[]) => {
    const words = q.toLowerCase().split(/\s+/).filter((w) => !(place?.city ?? "").toLowerCase().split(" ").includes(w)).map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
    return list.map((c) => ({ ...c, scope, queryWords: words }));
  };
  const firstTown = queries.find((x) => x.scope === "town");
  const searches = [
    ...queries.map((x) => commons(x.q, signal).then(tag(x.scope, x.q))),
    ...queries.filter((x) => x.scope === "generic" || x === firstTown).map((x) => openverse(x.q, signal).then(tag(x.scope, x.q))),
  ];
  const found = (await Promise.allSettled(searches)).flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  // The same photo found by a town search and a generic one counts as a town photo.
  const sorted = [...found].sort((x, y) => Number(x.scope === "generic") - Number(y.scope === "generic"));
  const unique = sorted.filter((c, i, list) => c.imageUrl && list.findIndex((x) => x.imageUrl === c.imageUrl || (x.title === c.title && x.provider === c.provider)) === i);
  const ranked = pickWebPhoto(unique, scene, place).slice(0, max + 2);
  // Download the best few in parallel, within what is left of the time box; keep rank order.
  const left = Math.max(500, deadline - Date.now());
  const downloads = await Promise.all(
    ranked.map((candidate) => Promise.race([fetchPhoto(candidate.imageUrl), new Promise<null>((r) => setTimeout(() => r(null), left))]).catch(() => null)),
  );
  const value: WebPhotoResult[] = [];
  downloads.forEach((photo, i) => {
    if (!photo || value.length >= max || photo.width < 1200 || photo.width / photo.height < 1.2) return;
    const { imageUrl: _u, width: _w, height: _h, text: _t, ...credit } = ranked[i]!;
    value.push({ photo, credit, query });
  });
  cache.set(query, { at: Date.now(), value });
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  return value;
}
