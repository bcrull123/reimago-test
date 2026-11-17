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
import { assignHeroes, hamming, heroScore, passesBar, withDuplicateSigns, HERO_BAR, type HeroCandidate, type HeroPick } from "./hero-pick.ts";
import { brandOnlyMatch, businessAbout, heroBrief, type HeroBrief } from "./hero-brief.ts";
import type { PhotoCredit } from "./web-photo.ts";

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

export type HeroRating = { rating: number; note?: string; sign?: boolean; subject?: string };

/**
 * The hero quality gate: the vision model rates every candidate (Google, the site's own, free-license) 1-10 for
 * "would a designer use this as the hero of a beautiful homepage for THIS business?", judged against the
 * business type's brief (hero-brief.ts). Undefined when vision is unavailable (the keyword fallback applies).
 */
export async function rateHeroes(brief: HeroBrief, name: string, about: string, items: { bytes: Buffer; type: string; title: string; source: string }[], deadline: number): Promise<(HeroRating | undefined)[] | undefined> {
  if (!items.length) return [];
  const { aiModel, chatJson } = await import("@/lib/ai-provider.server");
  const content: unknown[] = [
    {
      type: "text",
      text:
        `Rate EVERY photo as a homepage hero. The site: ${name ? `"${name}", ` : ""}${about || brief.kind}. ` +
        `Judge BUSINESS FIT first: would this photo make a visitor understand what THIS business does? A photo that only shares a word with the business NAME (a person, pet or place that happens to be called the same), a vintage/archival photo, or a portrait of an unrelated person is off-topic: rate it 1-3 however good it looks. ` +
        `A great hero for this kind of business shows ${brief.good}. Rate low: ${brief.avoid}; also anything dim, murky, flat or low-saturation, blurry or low-resolution, cluttered, mostly sky/grass/pavement, a sign, logo or text, a stock-looking scene unrelated to this business, or an off-topic subject for it. ` +
        `For each photo give "rating" 1-10 = would a top designer use this as the hero of a beautiful homepage for THIS business (${HERO_BAR}+ = yes, gladly), a 2-5 word "subject", a 2-6 word "note" on why, and "sign" (true when it is mainly a sign, plaque, logo or text). ` +
        `Answer only JSON: {"photos": [{"n": 1, "rating": 8, "subject": "...", "note": "...", "sign": false}, ...]}.`,
    },
  ];
  items.forEach((it, i) => {
    content.push({ type: "text", text: `Photo ${i + 1} (${it.source}): "${it.title.slice(0, 90)}"` });
    content.push({ type: "image_url", image_url: { url: `data:${it.type};base64,${it.bytes.toString("base64")}`, detail: "low" } });
  });
  try {
    const answer = await chatJson<{ photos?: unknown }>({
      model: process.env.PREVIEW_VISION_MODEL || aiModel(),
      messages: [{ role: "user", content: content as never }],
      maxTokens: 1400,
      temperature: 0,
      timeoutMs: Math.max(3000, Math.min(25_000, deadline - Date.now())),
      deadline,
      retry: false,
    });
    if (!Array.isArray(answer.photos)) return undefined;
    const out: (HeroRating | undefined)[] = items.map(() => undefined);
    for (const raw of answer.photos as { n?: unknown; rating?: unknown; note?: unknown; sign?: unknown; subject?: unknown }[]) {
      const n = Number(raw?.n);
      const rating = Number(raw?.rating);
      if (!Number.isInteger(n) || n < 1 || n > items.length || !Number.isFinite(rating)) continue;
      out[n - 1] = {
        rating: Math.max(1, Math.min(10, Math.round(rating))),
        note: typeof raw.note === "string" ? raw.note.slice(0, 60) : undefined,
        subject: typeof raw.subject === "string" ? raw.subject.slice(0, 60) : undefined,
        sign: raw.sign === true,
      };
    }
    return out;
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
  const queries = proactive?.length ? proactive.slice(0, 5) : googleQueries(scene, place, kind);
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
  /** Free-license photos (Openverse / Wikimedia) added when too few candidates passed the quality bar. */
  web?: { url: string; credit: PhotoCredit; width: number; height: number; candidate: HeroCandidate }[];
  /** The quality gate's verdict per candidate id (image URL). */
  bar?: { passed: string[]; failed: string[]; rated: boolean; brief: string };
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
export function plannedKey(facts: Pick<SiteFacts, "sourceUrl" | "name">, queries: string[], avoid?: PhotoAvoid): string {
  const extra = avoid && (avoid.keys.length || avoid.hashes.length) ? `|avoid:${[...avoid.keys, ...avoid.hashes].sort().join(",")}` : "";
  return createHash("sha256").update(`${facts.sourceUrl}|${facts.name}|${queries.join("|").toLowerCase()}${extra}`).digest("hex").slice(0, 16);
}

/** Photos shown in earlier rounds of the session (SitePlan.avoidPhotos). */
export type PhotoAvoid = { keys: string[]; hashes: string[] };

/** Was this photo (by URL / source page, or by its perceptual hash) already shown in an earlier round? */
export function shownBefore(avoid: PhotoAvoid | undefined, urls: (string | undefined)[], hash: string | undefined): boolean {
  if (!avoid) return false;
  if (urls.some((u) => u && avoid.keys.includes(u))) return true;
  return hash ? avoid.hashes.some((h) => hamming(h, hash) <= 10) : false;
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
  opts: { archetypes?: Promise<(Archetype | undefined)[] | undefined>; site?: boolean; avoid?: PhotoAvoid } = {},
): Promise<PlannedPhotos | undefined> {
  if (!photoSearchEnabled() || !queries.length) return undefined;
  const { measurePhoto, siteHeroPhotos } = await import("@/lib/preview/hero-pick.server");
  type SitePhoto = Awaited<ReturnType<typeof siteHeroPhotos>>[number];
  const [found, sitePhotos] = await Promise.all([
    findGooglePhotos(undefined, facts, useVision, deadline, 10, queries),
    opts.site === false ? Promise.resolve([] as SitePhoto[]) : siteHeroPhotos(facts).catch(() => [] as SitePhoto[]),
  ]);
  const site = sitePhotos.map((p) => p.candidate);
  const brief = heroBrief(facts);
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
      shownBefore: shownBefore(opts.avoid, [p.temp.imageUrl, p.temp.sourcePage], m?.hash) || undefined,
    };
    return { temp: p.temp, width: p.photo.width, height: p.photo.height, candidate };
  });
  for (const c of site) if (shownBefore(opts.avoid, [c.id], c.hash)) c.shownBefore = true;
  // The quality gate, judged for THIS kind of business (hero-brief.ts): off-topic titles (no-AI fallback) and
  // the vision rating of every candidate.
  for (const c of [...photos.map((p) => p.candidate!), ...site]) if (brief.offTopic.test(`${c.visionSubject ?? ""} ${c.text}`)) c.offTopic = true;
  // A Google result whose title matches only the brand name ("Bob" for Bob.me) is not about the business.
  for (const c of photos.map((p) => p.candidate!)) if (brandOnlyMatch(c.text, facts, queries)) c.offTopic = true;
  const rateItems = [
    ...found.photos.map((p, i) => ({ c: photos[i]!.candidate!, bytes: p.photo.bytes, type: p.photo.type, title: p.temp.title, source: `Google Images, ${p.temp.domain}` })),
    ...sitePhotos.map((p) => ({ c: p.candidate, bytes: p.bytes, type: p.type, title: p.candidate.text, source: "the business's own site" })),
  ].filter((x) => x.bytes.length < 2_500_000).slice(0, 16);
  let rated = false;
  const applyRatings = async (items: typeof rateItems) => {
    if (!useVision || !items.length || Date.now() > deadline - 4000) return;
    const ratings = await rateHeroes(brief, facts.name, businessAbout(facts, brief), items, deadline);
    if (!ratings) return;
    rated = true;
    items.forEach((it, i) => {
      const r = ratings[i];
      if (!r) return;
      it.c.appeal = r.rating;
      it.c.appealNote = r.note;
      if (r.sign) it.c.visionSign = true;
      if (r.subject && !it.c.visionSubject) it.c.visionSubject = r.subject;
    });
  };
  await applyRatings(rateItems);
  // Too few good photos: free-license photos of the brief's best scene, rated the same way.
  let web: NonNullable<PlannedPhotos["web"]> = [];
  const goodCount = () => [...photos.map((p) => p.candidate!), ...site, ...web.map((w) => w.candidate)].map(heroScore).filter(passesBar).length;
  if (goodCount() < 3 && Date.now() < deadline - 9000) {
    const { findWebPhotos, webPhotosEnabled } = await import("./web-photo.server.ts");
    const { briefQueries } = await import("./hero-brief.ts");
    if (webPhotosEnabled()) {
      const scene = briefQueries(facts, brief)[0] ?? queries[0]!;
      const found2 = await findWebPhotos(scene, placeOf(facts), Math.min(8_000, deadline - Date.now() - 6000), 4).catch(() => []);
      const pairs = found2
        .map((w) => {
          const m = measurePhoto(w.photo.bytes, w.photo.type);
          const candidate: HeroCandidate = { id: w.photo.url ?? "", source: "web", text: w.credit.title, width: w.photo.width, height: w.photo.height, stats: m?.stats, hash: m?.hash, relevance: 1.5 };
          if (brief.offTopic.test(candidate.text) || brandOnlyMatch(candidate.text, facts, [scene])) candidate.offTopic = true;
          if (shownBefore(opts.avoid, [candidate.id, w.credit.sourceUrl], m?.hash)) candidate.shownBefore = true;
          return { w, entry: { url: w.photo.url ?? "", credit: w.credit, width: w.photo.width, height: w.photo.height, candidate } };
        })
        .filter((x) => x.entry.url);
      web = pairs.map((x) => x.entry);
      await applyRatings(pairs.map((x) => ({ c: x.entry.candidate, bytes: x.w.photo.bytes, type: x.w.photo.type, title: x.w.credit.title, source: `free-license photo, ${x.w.credit.provider}` })));
      console.info(`[photo-search] quality gate: only ${goodCount() - web.map((w) => heroScore(w.candidate)).filter(passesBar).length} candidates passed; free-license search “${scene}”: ${web.length} found`);
    }
  }
  // The looks' archetypes (from the directions step, running alongside) let each photo suit its look's mood.
  const archetypes = ((await opts.archetypes?.catch(() => undefined)) ?? [undefined, undefined, undefined]).slice(0, 3);
  const all = [...photos.map((p) => p.candidate!), ...site, ...web.map((w) => w.candidate)];
  const picks = assignHeroes(all, archetypes);
  const scoredAll = all.map(heroScore);
  const bar = { passed: scoredAll.filter(passesBar).map((c) => c.id), failed: scoredAll.filter((c) => !passesBar(c)).map((c) => c.id), rated, brief: `${brief.category}: ${brief.kind}` };
  const planned: PlannedPhotos = {
    queries: found.queries,
    photos,
    web,
    bar,
    site,
    assign: { archetypes, picks },
    seen: found.seen,
    rejected: found.rejected,
    ranking: found.ranking,
    at: new Date().toISOString(),
  };
  console.info(`[photo-search] proactive ${JSON.stringify(found.queries)}: ${found.seen} results, ${planned.photos.length} usable (${found.ranking ?? "score"})${Object.keys(found.rejected).length ? `; skipped ${JSON.stringify(found.rejected)}` : ""}; ${site.length} site photo${site.length === 1 ? "" : "s"}${web.length ? ` + ${web.length} free-license` : ""} competing`);
  console.info(`[photo-search] quality gate (${bar.brief}): ${rated ? `vision-rated, bar ${HERO_BAR}/10` : "no vision rating; keyword + light/contrast rules"} · ${bar.passed.length} passed, ${bar.failed.length} failed`);
  for (const c of withDuplicateSigns(all.map(heroScore)).sort((a, b) => b.score - a.score)) {
    console.info(`[photo-search]   candidate ${c.source} ${passesBar(c) ? "PASS" : "FAIL"}${c.appeal !== undefined ? ` rating ${c.appeal}/10${c.appealNote ? ` “${c.appealNote}”` : ""}` : ""} score ${c.score}${c.sign ? " SIGN" : ""}${c.offTopic ? " OFF-TOPIC" : ""}${c.shownBefore ? " SHOWN-BEFORE" : ""} subject "${c.subject || "?"}" “${(c.visionSubject ? `${c.visionSubject} / ` : "") + c.text.slice(0, 60)}”${c.stats ? ` brightness ${c.stats.mean} contrast ${c.stats.contrast}` : ""}`);
  }
  for (const p of picks) console.info(`[photo-search] pick look ${p.index + 1}${archetypes[p.index] ? ` (${archetypes[p.index]})` : ""}: ${p.source} “${all.find((c) => c.id === p.id)?.text.slice(0, 60)}” · ${p.reason}`);
  try {
    const { saveImage } = await import("@/lib/pages.server");
    await saveImage(plannedKey(facts, queries, opts.avoid), "photo-search", "application/json", Buffer.from(JSON.stringify(planned)));
  } catch {
    // In-memory cache still serves this instance.
  }
  return planned;
}

/** The stored proactive ranking for this site + queries; searched now if the plan step's prefetch isn't there. */
export async function plannedPhotos(facts: SiteFacts, queries: string[], useVision: boolean, deadline: number, avoid?: PhotoAvoid): Promise<PlannedPhotos | undefined> {
  if (!photoSearchEnabled() || !queries.length) return undefined;
  try {
    const { readImage } = await import("@/lib/pages.server");
    const stored = await readImage(plannedKey(facts, queries, avoid), "photo-search");
    if (stored?.type === "application/json") {
      const data = JSON.parse(stored.bytes.toString("utf8")) as PlannedPhotos;
      if (Array.isArray(data.photos) && Date.now() - Date.parse(data.at) < 6 * 3_600_000) return data;
    }
  } catch {
    // fall through to a fresh (cached) search
  }
  return prefetchPlannedPhotos(facts, queries, useVision, deadline, { avoid });
}
