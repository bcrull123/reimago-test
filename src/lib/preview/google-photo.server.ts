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
import { createHash } from "node:crypto";
import type { Photo } from "./images.server.ts";
import { googleQueries, normalizeImages, rejectReason, scoreGoogleImage, type GoogleImage, type TemporaryPhoto } from "./google-photo.ts";
import { placeOf } from "./web-photo.ts";
import { businessKind, isCivic } from "./image-prompts.ts";
import type { Archetype, SiteFacts } from "./types.ts";
import { assignHeroes, heroScore, withDuplicateSigns, type HeroCandidate, type HeroPick } from "./hero-pick.ts";

type Fetcher = (url: string) => Promise<Photo | null | undefined>;

/** `label`: Grok vision's short subject and sign flag (proactive searches with real AI). */
export type GooglePhoto = { photo: Photo; temp: TemporaryPhoto; label?: { subject?: string; sign?: boolean }; relevance?: number };

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
type VisionLabel = { subject?: string; sign?: boolean };

async function visionRank(subject: string, items: { photo: Photo; img: GoogleImage }[], deadline: number, labels?: VisionLabel[]): Promise<number[] | undefined> {
  const { aiModel, chatJson } = await import("@/lib/ai-provider.server");
  const content: unknown[] = [
    {
      type: "text",
      text:
        `We need a website hero photo of: ${subject}. Below are ${items.length} candidate photos numbered 1-${items.length}. List the numbers of the photos that clearly show ${subject} and would work as a wide website hero (a real photo, sharp, no watermark, no text overlay, no logo, not a collage), best first. ` +
        (labels
          ? `Prefer wide scenes with depth and good light (streets, downtown, historic buildings, landmarks, people); put close-ups of signs, plaques or text, dim or flat photos, and shots that are mostly sky or grass last or leave them out. Also describe EVERY photo: a 2-4 word subject (e.g. "welcome sign", "downtown street at night", "train depot", "city park") and whether it is mainly a sign, plaque or text. Answer only JSON: {"good": [numbers], "photos": [{"n": 1, "subject": "...", "sign": false}, ...]}.`
          : `Answer only JSON: {"good": [numbers]} (empty if none).`),
    },
  ];
  items.forEach((it, i) => {
    content.push({ type: "text", text: `Photo ${i + 1}: "${it.img.title.slice(0, 80)}" (${it.img.domain})` });
    content.push({ type: "image_url", image_url: { url: `data:${it.photo.type};base64,${it.photo.bytes.toString("base64")}`, detail: "low" } });
  });
  try {
    const answer = await chatJson<{ good?: unknown; photos?: unknown }>({
      model: process.env.PREVIEW_VISION_MODEL || aiModel(),
      messages: [{ role: "user", content: content as never }],
      maxTokens: labels ? 900 : 300,
      temperature: 0,
      timeoutMs: Math.max(3000, Math.min(20_000, deadline - Date.now())),
      deadline,
      retry: false,
    });
    if (labels && Array.isArray(answer.photos)) {
      for (const raw of answer.photos as { n?: unknown; subject?: unknown; sign?: unknown }[]) {
        const n = Number(raw?.n);
        if (!Number.isInteger(n) || n < 1 || n > items.length) continue;
        labels[n - 1] = { subject: typeof raw.subject === "string" ? raw.subject.slice(0, 60) : undefined, sign: raw.sign === true };
      }
    }
    if (!Array.isArray(answer.good)) return undefined;
    return [...new Set(answer.good.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= items.length).map((n) => n - 1))];
  } catch {
    return undefined;
  }
}

export type GoogleSearch = {
  photos: GooglePhoto[];
  queries: string[];
  seen: number;
  rejected: Record<string, number>;
  /** How the order was decided: "vision", "score", or why vision was not used. */
  ranking?: string;
};

const pickCache = new Map<string, { at: number; result: Promise<GoogleSearch> }>();

/**
 * The uncached search (exported for tests, which pass their own downloader). With `queries` (the planner's
 * proactive imageQueries) all of them run in parallel and each result is judged against its own query;
 * otherwise the queries come from the owner's subject (or the business type in its town).
 */
export async function searchGooglePhotos(
  scene: string | undefined,
  facts: SiteFacts,
  useVision: boolean,
  deadline: number,
  max: number,
  fetcher?: Fetcher,
  proactive?: string[],
): Promise<GoogleSearch> {
  const fetchPhoto: Fetcher = fetcher ?? (await import("@/lib/preview/images.server")).fetchPhoto;
  const place = placeOf(facts);
  const trade = businessKind(facts);
  const kind = isCivic(facts) ? "downtown" : /^(other|local business)$/i.test(trade) ? facts.services[0] || "" : trade;
  const queries = proactive?.length ? proactive.slice(0, 3) : googleQueries(scene, place, kind);
  const rejected: Record<string, number> = {};
  const seen = new Map<string, { img: GoogleImage; q: string }>();
  if (proactive?.length) {
    const lists = await Promise.all(queries.map((q) => googleImages(q).then((list) => ({ q, list }))));
    // Interleave so every query contributes its best results first.
    for (let i = 0; i < 40; i += 1) for (const { q, list } of lists) if (list[i] && !seen.has(list[i]!.imageUrl)) seen.set(list[i]!.imageUrl, { img: list[i]!, q });
  } else {
    for (const q of queries) {
      if (Date.now() > deadline - 2000) break;
      for (const img of await googleImages(q)) if (!seen.has(img.imageUrl)) seen.set(img.imageUrl, { img, q });
      // The first query usually suffices; the second only when it found few usable images.
      if ([...seen.values()].filter((s) => !rejectReason(s.img)).length >= 5) break;
    }
  }
  const label = scene || (proactive?.length ? `a strong website hero for ${facts.name || "this business"} (${[kind, place?.city].filter(Boolean).join(", ")}), such as ${queries.map((q) => `"${q}"`).join(" or ")}` : [kind, place?.city].filter(Boolean).join(" in "));
  // Without a subject, each result is judged against the query that found it.
  const sceneOf = (q: string) => scene ?? (proactive?.length ? q : undefined);
  const strict = (img: GoogleImage, q: string) => scoreGoogleImage(img, sceneOf(q), place, kind);
  const candidates = [...seen.values()]
    .map((s) => {
      const why = rejectReason(s.img);
      if (why) rejected[why] = (rejected[why] ?? 0) + 1;
      // With vision, relevance is judged by looking; without it, the title/page must name the subject.
      return { ...s, score: why ? -1 : useVision ? Math.max(0.1, strict(s.img, s.q)) : strict(s.img, s.q) };
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
          const why = photo ? "too small after download" : "broken or blocked download";
          rejected[why] = (rejected[why] ?? 0) + 1;
          return undefined;
        }
        return { photo, img: c.img, q: c.q };
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const byScore = () => loaded.map((l, i) => ({ i, s: strict(l.img, l.q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.i);
  const visionLabels = new Map<(typeof loaded)[number], VisionLabel>();
  let order = useVision ? loaded.map((_, i) => i) : byScore();
  let pickedBy: TemporaryPhoto["pickedBy"] = "score";
  let ranking = useVision ? "" : "title/size/aspect score (no AI)";
  if (useVision && loaded.length) {
    const small = loaded.filter((l) => l.photo.bytes.length < 1_800_000);
    const labels: VisionLabel[] | undefined = proactive?.length ? [] : undefined;
    const ranked = small.length ? await visionRank(label, small, deadline, labels) : undefined;
    if (labels) small.forEach((l, i) => labels[i] && visionLabels.set(l, labels[i]!));
    if (ranked?.length) {
      order = ranked.map((i) => loaded.indexOf(small[i]!));
      pickedBy = "vision";
      ranking = `Grok vision kept ${ranked.length} of ${small.length}`;
    } else {
      // Vision unavailable, or it turned every candidate down: the strict title/size/aspect score decides
      // (the title or page must still name the subject), so a picky model can't silently drop Google Images.
      order = byScore();
      ranking = ranked ? `Grok vision kept none of ${small.length}; used the title/size score (${order.length} passed)` : `vision unavailable; used the title/size score (${order.length} passed)`;
    }
  }
  const via: TemporaryPhoto["via"] = photoSearchMode()?.mode === "proxy" ? "photo-search proxy" : "Serper";
  const photos = order.slice(0, max).map((i, rank) => {
    const l = loaded[i]!;
    return {
      label: visionLabels.get(l),
      // Search relevance for the hero score: rank in the vision / title order (3 = first).
      relevance: Math.max(0, 3 - rank * 0.4),
      photo: l.photo,
      temp: { provider: "Google Images", via, title: l.img.title || l.q, imageUrl: l.img.imageUrl, sourcePage: l.img.link, domain: l.img.domain, query: l.q, pickedBy } satisfies TemporaryPhoto,
    };
  });
  return { photos, queries, seen: seen.size, rejected, ranking };
}

/**
 * Up to `max` Google Images photos of `scene` (or, without a scene, of the business type in its town), best
 * first. Cached per site + subject so every look of one preview shares the same search and ranking.
 */
export function findGooglePhotos(scene: string | undefined, facts: SiteFacts, useVision: boolean, deadline: number, max = 3, proactive?: string[]): Promise<GoogleSearch> {
  const key = `${facts.sourceUrl}|${(scene ?? "").toLowerCase()}|${(proactive ?? []).join("|").toLowerCase()}|${useVision ? 1 : 0}|${max}`;
  const hit = pickCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.result;
  const result = searchGooglePhotos(scene, facts, useVision, deadline, max, undefined, proactive).catch((): GoogleSearch => ({ photos: [], queries: [], seen: 0, rejected: {}, ranking: "search failed" }));
  pickCache.set(key, { at: Date.now(), result });
  // A failed or empty search is not remembered past this preview's own looks.
  void result.then((r) => {
    if (!r.photos.length) setTimeout(() => pickCache.get(key)?.result === result && pickCache.delete(key), 60_000);
  });
  if (pickCache.size > 100) pickCache.delete(pickCache.keys().next().value!);
  return result;
}

/** A prefetched proactive search, as stored between steps (no image bytes: the chosen one is downloaded again). */
export type PlannedPhoto = { temp: TemporaryPhoto; width: number; height: number; candidate?: HeroCandidate };
export type PlannedPhotos = {
  queries: string[];
  photos: PlannedPhoto[];
  /** The site's own hero-sized photos, scored the same way (absent when the owner asked for new photos). */
  site?: HeroCandidate[];
  /** One hero per look, all different subjects, chosen together once the looks' archetypes are known. */
  assign?: { archetypes: (Archetype | undefined)[]; picks: HeroPick[] };
  seen: number;
  rejected: Record<string, number>;
  ranking?: string;
  at: string;
};

/** Stable 16-hex key for a site + its planner queries (the prefetch is stored under it, server-side only). */
export function plannedKey(facts: Pick<SiteFacts, "sourceUrl" | "name">, queries: string[]): string {
  return createHash("sha256").update(`${facts.sourceUrl}|${facts.name}|${queries.join("|").toLowerCase()}`).digest("hex").slice(0, 16);
}

/**
 * The planner's proactive imageQueries: search them all in parallel, verify and rank the candidates, and keep the
 * best few. Started by the plan step (so it runs while the looks are being designed) and stored server-side, so
 * the three look builds (which may run on other server instances) read the same ranking without new searches.
 */
export async function prefetchPlannedPhotos(
  facts: SiteFacts,
  queries: string[],
  useVision: boolean,
  deadline: number,
  opts: { archetypes?: Promise<(Archetype | undefined)[] | undefined>; site?: boolean } = {},
): Promise<PlannedPhotos | undefined> {
  if (!photoSearchEnabled() || !queries.length) return undefined;
  const { measurePhoto, siteHeroCandidates } = await import("@/lib/preview/hero-pick.server");
  const [found, site] = await Promise.all([
    findGooglePhotos(undefined, facts, useVision, deadline, 10, queries),
    opts.site === false ? Promise.resolve([] as HeroCandidate[]) : siteHeroCandidates(facts).catch(() => [] as HeroCandidate[]),
  ]);
  const photos: PlannedPhoto[] = found.photos.map((p) => {
    const m = measurePhoto(p.photo.bytes, p.photo.type);
    const candidate: HeroCandidate = {
      id: p.temp.imageUrl,
      source: "google",
      text: p.temp.title,
      visionSubject: p.label?.subject,
      visionSign: p.label?.sign,
      width: p.photo.width,
      height: p.photo.height,
      stats: m?.stats,
      hash: m?.hash,
      relevance: p.relevance ?? 1,
    };
    return { temp: p.temp, width: p.photo.width, height: p.photo.height, candidate };
  });
  // The looks' archetypes (from the directions step, running alongside) let each photo suit its look's mood.
  const archetypes = ((await opts.archetypes?.catch(() => undefined)) ?? [undefined, undefined, undefined]).slice(0, 3);
  const all = [...photos.map((p) => p.candidate!), ...site];
  const picks = assignHeroes(all, archetypes);
  const planned: PlannedPhotos = {
    queries: found.queries,
    photos,
    site,
    assign: { archetypes, picks },
    seen: found.seen,
    rejected: found.rejected,
    ranking: found.ranking,
    at: new Date().toISOString(),
  };
  console.info(`[photo-search] proactive ${JSON.stringify(found.queries)}: ${found.seen} results, ${planned.photos.length} usable (${found.ranking ?? "score"})${Object.keys(found.rejected).length ? `; skipped ${JSON.stringify(found.rejected)}` : ""}; ${site.length} site photo${site.length === 1 ? "" : "s"} competing`);
  for (const c of withDuplicateSigns(all.map(heroScore)).sort((a, b) => b.score - a.score)) {
    console.info(`[photo-search]   candidate ${c.source} score ${c.score}${c.sign ? " SIGN" : ""} subject "${c.subject || "?"}" “${(c.visionSubject ? `${c.visionSubject} / ` : "") + c.text.slice(0, 60)}”${c.stats ? ` brightness ${c.stats.mean} contrast ${c.stats.contrast}` : ""}`);
  }
  for (const p of picks) console.info(`[photo-search] pick look ${p.index + 1}${archetypes[p.index] ? ` (${archetypes[p.index]})` : ""}: ${p.source} “${all.find((c) => c.id === p.id)?.text.slice(0, 60)}” · ${p.reason}`);
  try {
    const { saveImage } = await import("@/lib/pages.server");
    await saveImage(plannedKey(facts, queries), "photo-search", "application/json", Buffer.from(JSON.stringify(planned)));
  } catch {
    // In-memory cache still serves this instance.
  }
  return planned;
}

/** The stored proactive ranking for this site + queries; searched now if the plan step's prefetch isn't there. */
export async function plannedPhotos(facts: SiteFacts, queries: string[], useVision: boolean, deadline: number): Promise<PlannedPhotos | undefined> {
  if (!photoSearchEnabled() || !queries.length) return undefined;
  try {
    const { readImage } = await import("@/lib/pages.server");
    const stored = await readImage(plannedKey(facts, queries), "photo-search");
    if (stored?.type === "application/json") {
      const data = JSON.parse(stored.bytes.toString("utf8")) as PlannedPhotos;
      if (Array.isArray(data.photos) && Date.now() - Date.parse(data.at) < 6 * 3_600_000) return data;
    }
  } catch {
    // fall through to a fresh (cached) search
  }
  return prefetchPlannedPhotos(facts, queries, useVision, deadline);
}
