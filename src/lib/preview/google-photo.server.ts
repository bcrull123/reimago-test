/**
 * Google Images via Serper (https://serper.dev) — the first web source for preview photos when configured.
 *
 *   SERPER_API_KEY            master server only: search Serper directly (header X-API-KEY).
 *   PHOTO_SEARCH_PROXY_URL    white-label clone without a Serper key: call the master's /api/photo-search
 *   PHOTO_SEARCH_PROXY_KEY    instead, with this shared key (the master checks the same value).
 *   (neither set)             no Google Images; everything works exactly as before.
 *
 * 6 s per query; results cached per query (30 min). Candidates are downloaded server-side with the same
 * SSRF-guarded fetcher as the image proxy (public hosts only, size-capped), checked for real size, then ranked:
 * Grok vision when real AI is on, else title/size/aspect. Picks are cached per site + subject so the three looks
 * share one search and each gets a different photo. Keys are never logged or returned.
 */
// Relative imports (and lazy server-only ones) so node's test runner can load this file.
import type { Photo } from "./images.server.ts";
import { googleQueries, normalizeImages, rejectReason, scoreGoogleImage, type GoogleImage, type TemporaryPhoto } from "./google-photo.ts";
import { placeOf } from "./web-photo.ts";
import { businessKind, isCivic } from "./image-prompts.ts";
import type { SiteFacts } from "./types.ts";

type Fetcher = (url: string) => Promise<Photo | null | undefined>;

export type GooglePhoto = { photo: Photo; temp: TemporaryPhoto };

type Mode = { mode: "serper"; key: string; base: string } | { mode: "proxy"; url: string; key: string };

const env = (k: string) => process.env[k]?.trim() || undefined;

function okUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname));
  } catch {
    return false;
  }
}

/** How photo search is reached here, if at all. A server with its own key never proxies. */
export function photoSearchMode(): Mode | undefined {
  const key = env("SERPER_API_KEY");
  if (key) {
    // SERPER_BASE_URL exists for tests (a local mock); production uses google.serper.dev.
    const base = env("SERPER_BASE_URL") ?? "https://google.serper.dev";
    return okUrl(base) ? { mode: "serper", key, base: base.replace(/\/+$/, "") } : undefined;
  }
  const url = env("PHOTO_SEARCH_PROXY_URL");
  const proxyKey = env("PHOTO_SEARCH_PROXY_KEY");
  if (url && proxyKey && okUrl(url)) return { mode: "proxy", url, key: proxyKey };
  return undefined;
}

export function photoSearchEnabled(): boolean {
  return Boolean(photoSearchMode());
}

const queryCache = new Map<string, { at: number; images: Promise<GoogleImage[]> }>();

/** Serper directly (master). Throws on HTTP errors; the caller treats any failure as "no results". */
export async function serperImages(q: string, key: string, base: string, timeoutMs = 6000): Promise<GoogleImage[]> {
  const res = await fetch(`${base}/images`, {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q, num: 20, gl: "us", hl: "en", tbs: "isz:l" }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  return normalizeImages(await res.json());
}

async function proxyImages(q: string, url: string, key: string, timeoutMs = 6000): Promise<GoogleImage[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ q }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`photo-search proxy ${res.status}`);
  return normalizeImages(await res.json());
}

/** One Google Images query (cached 30 min). Never throws: failures are logged (status only) and give []. */
export function googleImages(q: string): Promise<GoogleImage[]> {
  const mode = photoSearchMode();
  if (!mode || !q) return Promise.resolve([]);
  const key = `${mode.mode}|${q.toLowerCase()}`;
  const hit = queryCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.images;
  const images = (mode.mode === "serper" ? serperImages(q, mode.key, mode.base) : proxyImages(q, mode.url, mode.key)).catch((error) => {
    console.warn(`[photo-search] ${mode.mode} query failed: ${error instanceof Error ? error.message.slice(0, 80) : "error"}`);
    queryCache.delete(key);
    return [] as GoogleImage[];
  });
  queryCache.set(key, { at: Date.now(), images });
  if (queryCache.size > 300) queryCache.delete(queryCache.keys().next().value!);
  return images;
}

/** Ask Grok which downloaded candidates show the subject and suit a website hero, best first. */
async function visionRank(subject: string, items: { photo: Photo; img: GoogleImage }[], deadline: number): Promise<number[] | undefined> {
  const { aiModel, chatJson } = await import("@/lib/ai-provider.server");
  const content: unknown[] = [
    {
      type: "text",
      text: `We need a website hero photo of: ${subject}. Below are ${items.length} candidate photos numbered 1-${items.length}. List the numbers of the photos that clearly show ${subject} and would work as a wide website hero (a real photo, sharp, no watermark, no text overlay, no logo, not a collage), best first. Answer only JSON: {"good": [numbers]} (empty if none).`,
    },
  ];
  items.forEach((it, i) => {
    content.push({ type: "text", text: `Photo ${i + 1}: "${it.img.title.slice(0, 80)}" (${it.img.domain})` });
    content.push({ type: "image_url", image_url: { url: `data:${it.photo.type};base64,${it.photo.bytes.toString("base64")}`, detail: "low" } });
  });
  try {
    const answer = await chatJson<{ good?: unknown }>({
      model: process.env.PREVIEW_VISION_MODEL || aiModel(),
      messages: [{ role: "user", content: content as never }],
      maxTokens: 300,
      temperature: 0,
      timeoutMs: Math.max(3000, Math.min(20_000, deadline - Date.now())),
      deadline,
      retry: false,
    });
    if (!Array.isArray(answer.good)) return undefined;
    return [...new Set(answer.good.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= items.length).map((n) => n - 1))];
  } catch {
    return undefined;
  }
}

const pickCache = new Map<string, { at: number; result: Promise<{ photos: GooglePhoto[]; queries: string[]; seen: number; rejected: Record<string, number> }> }>();

/** The uncached search (exported for tests, which pass their own downloader). */
export async function searchGooglePhotos(scene: string | undefined, facts: SiteFacts, useVision: boolean, deadline: number, max: number, fetcher?: Fetcher) {
  const fetchPhoto: Fetcher = fetcher ?? (await import("@/lib/preview/images.server")).fetchPhoto;
  const place = placeOf(facts);
  const trade = businessKind(facts);
  const kind = isCivic(facts) ? "downtown" : /^(other|local business)$/i.test(trade) ? facts.services[0] || "" : trade;
  const queries = googleQueries(scene, place, kind);
  const rejected: Record<string, number> = {};
  const seen = new Map<string, { img: GoogleImage; q: string }>();
  for (const q of queries) {
    if (Date.now() > deadline - 2000) break;
    for (const img of await googleImages(q)) if (!seen.has(img.imageUrl)) seen.set(img.imageUrl, { img, q });
    // The first query usually suffices; the second only when it found few usable images.
    if ([...seen.values()].filter((s) => !rejectReason(s.img)).length >= 5) break;
  }
  const label = scene || [kind, place?.city].filter(Boolean).join(" in ");
  const candidates = [...seen.values()]
    .map((s) => {
      const why = rejectReason(s.img);
      if (why) rejected[why] = (rejected[why] ?? 0) + 1;
      // With vision, relevance is judged by looking; without it, the title/page must name the subject.
      return { ...s, score: why ? -1 : useVision ? Math.max(0.1, scoreGoogleImage(s.img, scene, place, kind)) : scoreGoogleImage(s.img, scene, place, kind) };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, useVision ? 8 : max + 3);
  // Download (broken / tiny / non-landscape images drop out here: the real size is measured).
  const loaded = (
    await Promise.all(
      candidates.map(async (c) => {
        if (Date.now() > deadline - 1500) return undefined;
        const photo = await fetchPhoto(c.img.imageUrl);
        if (!photo || photo.width < 1000 || photo.width / photo.height < 1.2) {
          rejected[photo ? "too small after download" : "broken"] = (rejected[photo ? "too small after download" : "broken"] ?? 0) + 1;
          return undefined;
        }
        return { photo, img: c.img, q: c.q };
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => Boolean(x));
  let order = loaded.map((_, i) => i);
  let pickedBy: TemporaryPhoto["pickedBy"] = "score";
  if (useVision && loaded.length) {
    const small = loaded.filter((l) => l.photo.bytes.length < 1_800_000);
    const ranked = await visionRank(label, small, deadline);
    if (ranked) {
      order = ranked.map((i) => loaded.indexOf(small[i]!));
      pickedBy = "vision";
    } else {
      // Vision unavailable: fall back to the strict title/size/aspect score.
      order = loaded.map((l, i) => ({ i, s: scoreGoogleImage(l.img, scene, place, kind) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.i);
    }
  }
  const via: TemporaryPhoto["via"] = photoSearchMode()?.mode === "proxy" ? "photo-search proxy" : "Serper";
  const photos = order.slice(0, max).map((i) => {
    const l = loaded[i]!;
    return {
      photo: l.photo,
      temp: { provider: "Google Images", via, title: l.img.title || label, imageUrl: l.img.imageUrl, sourcePage: l.img.link, domain: l.img.domain, query: l.q, pickedBy } satisfies TemporaryPhoto,
    };
  });
  return { photos, queries, seen: seen.size, rejected };
}

/**
 * Up to `max` Google Images photos of `scene` (or, without a scene, of the business type in its town), best
 * first. Cached per site + subject so every look of one preview shares the same search and ranking.
 */
export function findGooglePhotos(scene: string | undefined, facts: SiteFacts, useVision: boolean, deadline: number, max = 3) {
  const key = `${facts.sourceUrl}|${(scene ?? "").toLowerCase()}|${useVision ? 1 : 0}|${max}`;
  const hit = pickCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.result;
  const result = searchGooglePhotos(scene, facts, useVision, deadline, max).catch(() => ({ photos: [] as GooglePhoto[], queries: [] as string[], seen: 0, rejected: {} as Record<string, number> }));
  pickCache.set(key, { at: Date.now(), result });
  // A failed or empty search is not remembered past this preview's own looks.
  void result.then((r) => {
    if (!r.photos.length) setTimeout(() => pickCache.get(key)?.result === result && pickCache.delete(key), 60_000);
  });
  if (pickCache.size > 100) pickCache.delete(pickCache.keys().next().value!);
  return result;
}
