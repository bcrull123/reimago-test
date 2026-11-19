/**
 * Round 8c — a NEW photo the owner asked for on one look ("change the photo to one of the brick streets, maybe
 * Pine Street"), found by the owner's own subject words:
 *   1. the site's own photos and the photos the other looks already show (by caption, then by looking);
 *   2. Google Images, most specific query first ("Pine Street" Pauls Valley brick), loosening step by step
 *      ("brick street" Pauls Valley Oklahoma, brick street Oklahoma …), never the town's generic query;
 *   3. Grok vision judges whether each photo SHOWS the request (the specific name, the subject, or neither), plus
 *      a minimum hero quality; a matching photo beats a prettier non-matching one;
 *   4. never the current photo or a near-duplicate of it;
 *   5. the card says honestly what was found ("couldn't find Pine Street; used a brick street photo").
 * Dependencies are injectable so the unit tests run without network or AI.
 */
import { createHash } from "node:crypto";
import { captionMatch, photoOutcomeNote, photoRequestLabel, photoRequestQueries, type PhotoOutcome, type PhotoRequest } from "./look-edit.ts";
import { photoKey } from "./site-photos.ts";
import { rejectReason, type GoogleImage, type TemporaryPhoto } from "./google-photo.ts";
import { hamming, mainSubject } from "./hero-pick.ts";
import type { Photo } from "./images.server.ts";
import type { StoredImage } from "./types.ts";
import type { PhotoCredit } from "./web-photo.ts";

export type Match = "named" | "subject" | "none";
/** Round 9b: "weak" = the caption / alt text names the request but vision says the picture doesn't show it. */
export type Strength = Match | "weak";
export type SubjectVerdict = { shows: Match; rating: number; what?: string };

/** A photo that could become the hero: from the site, another look, or Google. */
export type RequestCandidate = {
  id: string;
  from: "your site" | "another look" | "Google Images";
  caption: string;
  photo: Photo;
  hash?: string;
  /** 0 = the most specific query (Google only). */
  level: number;
  google?: { img: GoogleImage; query: string };
  credit?: PhotoCredit;
  caption_match: Match;
  verdict?: SubjectVerdict;
};

/**
 * Round 9b — what the look shows now, so it is never offered as the "new" photo: its URLs (the site photo's own
 * address, the Google image / page), the exact bytes (sha1), a perceptual hash when the format can be decoded
 * (JPEG / PNG; a WebP hero has none, which is how Bob's welcome sign slipped through), and its specific caption.
 */
export type CurrentPhoto = { urls: string[]; hash?: string; sha1?: string[]; captions?: string[] };

export const sha1Of = (bytes: Buffer) => createHash("sha1").update(bytes).digest("hex");
const normCaption = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Is this candidate the current hero (or a near-duplicate of it)? By URL, normalized URL, bytes, hash, caption. */
export function sameAsCurrent(c: { id: string; hash?: string; caption?: string; photo?: { bytes: Buffer; url?: string }; google?: { img: GoogleImage } }, current: CurrentPhoto): string | undefined {
  const urls = [c.id, c.photo?.url, c.google?.img.link, c.google?.img.imageUrl].filter((u): u is string => Boolean(u));
  if (urls.some((u) => current.urls.includes(u))) return "same URL";
  const keys = new Set(current.urls.map(photoKey));
  if (urls.some((u) => keys.has(photoKey(u)))) return "same picture at another size";
  if (c.photo && current.sha1?.includes(sha1Of(c.photo.bytes))) return "same file";
  if (c.hash && current.hash && hamming(c.hash, current.hash) <= 10) return "near-duplicate";
  const cap = normCaption(c.caption ?? "");
  if (cap.length >= 15 && (current.captions ?? []).some((k) => normCaption(k) === cap)) return "same caption";
  return undefined;
}

export type RequestDeps = {
  search: (q: string) => Promise<GoogleImage[]>;
  fetch: (url: string) => Promise<Photo | null | undefined>;
  hash: (bytes: Buffer, type: string) => string | undefined;
  /** Grok vision: does each photo show the request? Undefined = no vision (captions decide). */
  judge?: (req: PhotoRequest, place: string, items: RequestCandidate[], deadline: number) => Promise<(SubjectVerdict | undefined)[] | undefined>;
  log?: (line: string) => void;
};

export type RequestResult = {
  pick?: RequestCandidate;
  match: Exclude<PhotoOutcome, "illustrated" | "none">;
  note: string;
  label: string;
  queries: string[];
  tried: number;
};

/** Minimum hero quality (1-10) for a photo that shows the request; lower than the round-1 bar on purpose. */
export const REQUEST_MIN_RATING = 5;
const RANK: Record<Match, number> = { named: 2, subject: 1, none: 0 };

export async function findRequestedPhoto(
  req: PhotoRequest,
  place: { city: string; state: string } | undefined,
  pools: { own: RequestCandidate[]; current: CurrentPhoto },
  deps: RequestDeps,
  opts: { deadline: number; step?: number; googleEnabled: boolean },
): Promise<RequestResult> {
  const log = deps.log ?? (() => undefined);
  const label = photoRequestLabel(req);
  const queries = photoRequestQueries(req, place);
  const all: RequestCandidate[] = [];
  const sha = new Map<RequestCandidate, string>();
  // The current hero (and near-duplicates) are removed BEFORE ranking: never offered as the "new" photo.
  const add = (c: RequestCandidate) => {
    const why = sameAsCurrent(c, pools.current);
    if (why) return log(`[photo-search] skipped the current photo (${why}): “${c.caption.slice(0, 60)}” (${c.from})`);
    const h = sha1Of(c.photo.bytes);
    if (all.some((o) => o.id === c.id || sha.get(o) === h || (o.hash && c.hash && hamming(o.hash, c.hash) <= 6))) return;
    sha.set(c, h);
    all.push(c);
  };
  for (const c of pools.own) add({ ...c, caption_match: captionMatch(c.caption, req) });
  const ownMatches = all.filter((c) => c.caption_match !== "none").length;
  const fromSite = pools.own.filter((c) => c.from === "your site").length;
  log(`[photo-search] requested photo “${label}”: ${fromSite} of the site's own photos + ${pools.own.length - fromSite} already shown checked (${all.length} after removing the current photo and duplicates), ${ownMatches} name it by caption`);
  if (!opts.googleEnabled) log(`[photo-search] Google Images not used for this request (not configured)`);
  // Google: specific first, then looser; stop once a few photos name the request (named ones end the search early).
  if (opts.googleEnabled) {
    for (const [level, q] of queries.entries()) {
      if (Date.now() > opts.deadline - 6000) {
        log(`[photo-search] out of time before “${q}”`);
        break;
      }
      const results = await deps.search(q).catch(() => [] as GoogleImage[]);
      const usable = results.filter((img) => !rejectReason(img));
      const ranked = usable
        .map((img) => ({ img, m: captionMatch(`${img.title} ${img.link}`, req) }))
        .sort((a, b) => RANK[b.m] - RANK[a.m])
        .slice(0, 4);
      let kept = 0;
      for (const { img, m } of ranked) {
        if (all.some((c) => c.id === img.imageUrl)) continue;
        const photo = await deps.fetch(img.imageUrl);
        if (!photo || photo.width < 1000 || photo.width / photo.height < 1.2) continue;
        add({ id: img.imageUrl, from: "Google Images", caption: img.title, photo, hash: deps.hash(photo.bytes, photo.type), level, google: { img, query: q }, caption_match: m });
        kept += 1;
      }
      const named = all.filter((c) => c.caption_match === "named").length;
      const subject = all.filter((c) => c.caption_match !== "none").length;
      log(`[photo-search] q=${JSON.stringify(q)} (step ${level + 1} of ${queries.length}): ${results.length} results, ${usable.length} usable, ${kept} downloaded · so far ${named} name ${req.named[0] ?? "it"}, ${subject} show “${req.subject}” by their titles`);
      if (named >= 2 || (subject >= 3 && level >= req.named.length * 2)) break;
    }
  }
  if (!all.length) return { match: "nothing", note: photoOutcomeNote(req, "nothing"), label, queries, tried: 0 };
  // Look: does each photo show the request? (by vision when available; else the caption decides)
  // Captions that name the request first; then Google results (they came from the subject searches, specific
  // first); the site's/other looks' photos that don't mention it last (vision may still see the subject in them).
  const prior = (c: RequestCandidate) => RANK[c.caption_match] * 10 + (c.from === "Google Images" ? 5 - Math.min(4, c.level) : 0);
  // Round 9b: up to 16 photos are looked at (the deep crawl finds many more than the old 7).
  const pool = [...all].sort((a, b) => prior(b) - prior(a)).slice(0, 16);
  const verdicts = deps.judge ? await deps.judge(req, place?.city ?? "", pool, opts.deadline).catch(() => undefined) : undefined;
  pool.forEach((c, i) => {
    c.verdict = verdicts?.[i];
  });
  // What each photo shows: vision decides; a caption that names the request when vision says no is a WEAK match,
  // used only after the real ones. Without vision, the caption decides.
  // Weak needs the caption's MAIN subject to name it ("Brick street at dusk"), not a passing mention ("a water park
  // with … a brick wall").
  const mainNames = (c: RequestCandidate) => c.caption_match !== "none" && captionMatch(mainSubject(c.caption), req) !== "none";
  const matchOf = (c: RequestCandidate): Strength => (c.verdict ? (c.verdict.shows !== "none" ? c.verdict.shows : mainNames(c) ? "weak" : "none") : c.caption_match);
  const ok = (c: RequestCandidate) => !c.verdict || c.verdict.rating >= REQUEST_MIN_RATING;
  const STRENGTH: Record<Strength, number> = { named: 3, subject: 2, weak: 1, none: 0 };
  // A photo that doesn't show the request is never used as the "new" photo (no "closest match" swaps).
  const order = pool
    .filter((c) => ok(c) && matchOf(c) !== "none")
    .sort((a, b) => {
      const m = STRENGTH[matchOf(b)] - STRENGTH[matchOf(a)];
      if (m) return m;
      const own = (c: RequestCandidate) => (c.from === "Google Images" ? 0 : 1);
      // The owner's own (site / already shown) first, then the better one, then the more specific search.
      return own(b) - own(a) || (b.verdict?.rating ?? 0) - (a.verdict?.rating ?? 0) || a.level - b.level;
    });
  for (const c of pool) {
    const v = c.verdict;
    const weak = matchOf(c) === "weak" ? ` · caption names it (${c.caption_match}) but vision says ${v?.shows} → weak match` : v && v.shows === "none" && c.caption_match !== "none" ? ` · caption mentions it only in passing and vision says none → not a match` : "";
    log(`[photo] candidate “${c.caption.slice(0, 60)}” (${c.from}${c.google ? `, q=${JSON.stringify(c.google.query)}` : ""}): ${v ? `vision: shows ${v.shows}, rating ${v.rating}${v.what ? `, “${v.what}”` : ""}` : "no vision"} · caption: ${c.caption_match}${weak}${ok(c) ? "" : ` · below the minimum ${REQUEST_MIN_RATING}`}`);
  }
  if (!order.length) {
    log(`[photo] requested “${label}” -> no photo shows it (${pool.length} looked at); the current photo is kept unless an illustration is made`);
    return { match: "nothing", note: photoOutcomeNote(req, "nothing"), label, queries, tried: pool.length };
  }
  const best = matchOf(order[0]!) as Exclude<Strength, "none">;
  const top = order.filter((c) => matchOf(c) === best);
  const pick = top[(opts.step ?? 0) % top.length]!;
  const what = shortWhat(pick.verdict?.what ?? pick.caption);
  const note = photoOutcomeNote(req, best, best === "named" ? undefined : what);
  log(`[photo] requested “${label}” -> ${best === "weak" ? "weak match (caption only)" : `shows ${best === "named" ? req.named[0] : req.subject}`}: “${pick.caption.slice(0, 70)}” (${pick.from}${pick.google ? `, q=${JSON.stringify(pick.google.query)}` : ""}) · card: ${note}`);
  return { pick, match: best, note, label, queries, tried: pool.length };
}

/** A few whole words (never a cut-off word) for the card line. */
export function shortWhat(text: string, max = 40): string {
  const t = text.replace(/\s+/g, " ").replace(/[·|].*$/, "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max + 1).replace(/\s+\S*$/, "").replace(/[,;:\s-]+$/, "");
}

/** Grok vision: for each photo, does it SHOW the requested subject (or the named place), and is it a usable hero? */
export async function judgeSubject(req: PhotoRequest, city: string, items: RequestCandidate[], deadline: number): Promise<(SubjectVerdict | undefined)[] | undefined> {
  const { aiModel, chatJson } = await import("@/lib/ai-provider.server");
  const ask = `${req.subject}${req.named.length ? ` (ideally ${req.named.join(" or ")})` : ""}${city ? ` in ${city}` : ""}`;
  const content: unknown[] = [
    {
      type: "text",
      text:
        `Does each photo SHOW what the owner asked for? The owner asked for a new website hero photo of: ${ask}. ` +
        `For each photo answer "shows": "named" when it clearly shows ${req.named.length ? req.named.join(" or ") : "the exact thing asked for"}, "subject" when it clearly shows ${req.subject} (but not that specific place), "no" otherwise (a generic street, a different subject, only the town). Judge what is IN the picture, not the business fit. ` +
        `Also "rating" 1-10 as a wide website hero (sharp, good light, no watermark, no text overlay) and "what": 2-5 words on what it shows. ` +
        `Answer only JSON: {"photos": [{"n": 1, "shows": "subject", "rating": 7, "what": "red brick street downtown"}, ...]}.`,
    },
  ];
  items.forEach((it, i) => {
    content.push({ type: "text", text: `Photo ${i + 1} (${it.from}): "${it.caption.slice(0, 90)}"` });
    content.push({ type: "image_url", image_url: { url: `data:${it.photo.type};base64,${it.photo.bytes.toString("base64")}`, detail: "low" } });
  });
  try {
    const answer = await chatJson<{ photos?: unknown }>({
      model: process.env.PREVIEW_VISION_MODEL || aiModel(),
      messages: [{ role: "user", content: content as never }],
      maxTokens: 900,
      temperature: 0,
      timeoutMs: Math.max(3000, Math.min(25_000, deadline - Date.now())),
      deadline,
      retry: false,
    });
    if (!Array.isArray(answer.photos)) return undefined;
    const out: (SubjectVerdict | undefined)[] = items.map(() => undefined);
    for (const raw of answer.photos as { n?: unknown; shows?: unknown; rating?: unknown; what?: unknown }[]) {
      const n = Number(raw?.n);
      const rating = Number(raw?.rating);
      if (!Number.isInteger(n) || n < 1 || n > items.length || !Number.isFinite(rating)) continue;
      const shows: Match = raw.shows === "named" ? "named" : raw.shows === "subject" ? "subject" : "none";
      out[n - 1] = { shows, rating: Math.max(1, Math.min(10, Math.round(rating))), what: typeof raw.what === "string" ? raw.what.slice(0, 50) : undefined };
    }
    return out;
  } catch {
    return undefined;
  }
}

/** The stored hero image + credit for a picked candidate. */
export function storedHeroFor(pick: RequestCandidate, via: TemporaryPhoto["via"]): StoredImage {
  if (pick.google) {
    const temp: TemporaryPhoto = { provider: "Google Images", via, title: pick.google.img.title || pick.google.query, imageUrl: pick.google.img.imageUrl, sourcePage: pick.google.img.link, domain: pick.google.img.domain, query: pick.google.query, pickedBy: pick.verdict ? "vision" : "score" };
    const credit: PhotoCredit = { title: temp.title, author: temp.domain, license: "preview only", licenseUrl: "", sourceUrl: temp.sourcePage || temp.imageUrl, provider: "Google Images" };
    return { name: "hero", type: pick.photo.type, source: "web", alt: temp.title, width: pick.photo.width, height: pick.photo.height, credit, temporary: temp };
  }
  return { name: "hero", type: pick.photo.type, source: "photo", alt: pick.caption.slice(0, 120), width: pick.photo.width, height: pick.photo.height, ...(pick.credit ? { credit: pick.credit } : {}) };
}
