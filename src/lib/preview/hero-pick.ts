/**
 * Picking the hero photos for the three looks of a round (pure: no I/O, so it is unit-tested).
 *
 * Every candidate (Google Images results and the site's own photos) gets one hero score from what it shows (its
 * title / alt text / Grok vision label) and from its pixels (brightness, contrast, how much is sky or grass).
 * Wide street / downtown / landmark scenes in good light win; signs, plaques and text, dim or flat photos, and
 * sky- or grass-dominated shots lose. Then the three looks are assigned together so no two show the same subject
 * (same scene words, or a near-duplicate picture by perceptual hash), and each look's photo suits its mood where
 * possible (dark premium: dusk or night; editorial: a daytime historic building; playful / bold: a lively street).
 */
import { LOW_QUALITY } from "./hero-brief.ts";
import type { Archetype } from "./types.ts";
import { isTextGraphicLabel } from "./site-brand.ts";

// ------------------------------------------------------------------------------------------------ pixels

export type PixelStats = {
  /** Mean luma (0-1, gamma encoded). */
  mean: number;
  /** Standard deviation of luma (global contrast). */
  contrast: number;
  /** Share of the frame that is sky (bright, blue or flat grey, little texture). */
  sky: number;
  /** Share that is green vegetation / grass. */
  green: number;
  /** Mean colorfulness (0-1). */
  saturation: number;
  /** Red-minus-blue balance (-1 cool … 1 warm). */
  warm: number;
};

/** Brightness / contrast / sky / green from RGBA pixels (sampled; any size). */
export function pixelStats(data: Uint8Array, width: number, height: number): PixelStats {
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 20_000)));
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  let sky = 0;
  let green = 0;
  let sat = 0;
  let warm = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i]! / 255;
      const g = data[i + 1]! / 255;
      const b = data[i + 2]! / 255;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      // Texture: difference to the pixel `step` to the right.
      const j = (y * width + Math.min(width - 1, x + step)) * 4;
      const l2 = (0.299 * data[j]! + 0.587 * data[j + 1]! + 0.114 * data[j + 2]!) / 255;
      const flat = Math.abs(l - l2) < 0.03;
      if (flat && ((b > r + 0.04 && b >= g && l > 0.45) || (max - min < 0.06 && l > 0.7))) sky += 1;
      if (g > r + 0.03 && g > b + 0.03 && l > 0.12) green += 1;
      sum += l;
      sum2 += l * l;
      sat += max - min;
      warm += r - b;
      n += 1;
    }
  }
  const mean = sum / n;
  return {
    mean: round(mean),
    contrast: round(Math.sqrt(Math.max(0, sum2 / n - mean * mean))),
    sky: round(sky / n),
    green: round(green / n),
    saturation: round(sat / n),
    warm: round(warm / n),
  };
}

/** 64-bit difference hash (9x8 grey grid) as 16 hex chars; near-duplicate photos are a few bits apart. */
export function dHash(data: Uint8Array, width: number, height: number): string {
  const cells: number[] = [];
  for (let gy = 0; gy < 8; gy += 1) {
    for (let gx = 0; gx < 9; gx += 1) {
      const x0 = Math.floor((gx * width) / 9);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / 9));
      const y0 = Math.floor((gy * height) / 8);
      const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / 8));
      const sx = Math.max(1, Math.floor((x1 - x0) / 6));
      const sy = Math.max(1, Math.floor((y1 - y0) / 6));
      let s = 0;
      let c = 0;
      for (let y = y0; y < y1; y += sy) {
        for (let x = x0; x < x1; x += sx) {
          const i = (y * width + x) * 4;
          s += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
          c += 1;
        }
      }
      cells.push(s / Math.max(1, c));
    }
  }
  let hex = "";
  for (let row = 0; row < 8; row += 1) {
    let byte = 0;
    for (let col = 0; col < 8; col += 1) byte = (byte << 1) | (cells[row * 9 + col]! > cells[row * 9 + col + 1]! ? 1 : 0);
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

// ------------------------------------------------------------------------------------------------ words

/** Signs, plaques, logos and other text-first pictures (fine once, never as every look's hero). */
export const SIGN_WORDS =
  /\b(?:welcome\s+(?:to\b|sign)|city\s+limits?|town\s+limits?|(?:entrance|entry|gateway|monument|welcome|city|town|road|street|highway|historical?|marquee)\s+signs?|signs?|signage|plaques?|historical\s+markers?|markers?|billboards?|logos?|seal|emblem|placards?|letters?|lettering|text|typography|wordmark|word mark|logotype|type treatment|text graphic|cropped text|monogram|lockup)\b/i;

/** The main clause of a caption ("A park with a flower bed and a historic sign" -> "A park"). */
export function mainSubject(text: string): string {
  return text.split(/,|\s·\s|\s+(?:with|and|featuring|beside|next to|in front of|in the)\s+/i)[0] ?? text;
}

export function isSignLike(text: string): boolean {
  return SIGN_WORDS.test(text) || isTextGraphicLabel(text);
}

/** Scene buckets, most specific first. Two photos in the same bucket show "the same subject". */
const BUCKETS: [string, RegExp][] = [
  ["sign", SIGN_WORDS],
  ["depot", /\b(?:depot|station|train|railroad|railway|amtrak|santa\s+fe)\b/i],
  ["courthouse", /\bcourt\s*house\b/i],
  ["city hall", /\b(?:city|town)\s+hall\b/i],
  ["water tower", /\bwater\s+tower\b/i],
  ["museum", /\bmuseum\b/i],
  ["church", /\b(?:church|chapel|cathedral)\b/i],
  ["festival", /\b(?:festival|parade|fair|rodeo|market|concert|crowd|celebration|event)\b/i],
  ["park", /\b(?:park|garden|playground|trail|pond)\b/i],
  ["lake", /\b(?:lake|river|reservoir|creek)\b/i],
  ["school", /\b(?:school|campus|university|college)\b/i],
  ["skyline", /\b(?:skyline|aerial|drone|overhead|bird'?s[-\s]eye)\b/i],
  ["night street", /\b(?:night|dusk|evening|twilight|sunset)\b/i],
  ["street", /\b(?:street|streets|avenue|road|main\s+st|brick[-\s]paved|sidewalk)\b/i],
  ["building", /\b(?:building|buildings|storefronts?|theat(?:er|re)|hotel|bank|block|facade|architecture|historic)\b/i],
  ["downtown", /\b(?:downtown|district|square|town\s+center|main\s+street)\b/i],
];

/** The subject bucket of a photo from its words ("welcome sign", "depot", "night street", …; "" = unknown). */
export function subjectOf(text: string): string {
  for (const [name, re] of BUCKETS) if (re.test(text)) return name;
  return "";
}

const SCENE_GOOD = /\b(?:downtown|main\s+street|historic|district|street|streets|avenue|square|skyline|aerial|depot|station|courthouse|city\s+hall|buildings?|storefronts?|festival|parade|people|crowd|market|theat(?:er|re)|landmark|museum|plaza|brick)\b/gi;
const NIGHT = /\b(?:night|dusk|evening|twilight|sunset|lights|neon|lit)\b/i;
const HISTORIC = /\b(?:historic|district|courthouse|depot|station|museum|building|buildings|facade|architecture|city\s+hall|bank|theat(?:er|re)|church)\b/i;
const LIVELY = /\b(?:festival|parade|crowd|people|market|street|streets|main\s+street|downtown|square|event|fair|rodeo|celebration)\b/i;

// ------------------------------------------------------------------------------------------------ scoring

export type HeroCandidate = {
  /** Stable id (the image URL). */
  id: string;
  source: "google" | "site" | "web";
  /** Title / alt text / vision label: what the picture shows. */
  text: string;
  /** Grok vision's short subject label when real AI looked at it. */
  visionSubject?: string;
  /** Vision said it is mainly a sign / plaque / text. */
  visionSign?: boolean;
  width: number;
  height: number;
  stats?: PixelStats;
  hash?: string;
  /** Search / page relevance, 0 (none) … 3 (best). */
  relevance: number;
  /** Already the hero of a look in an earlier round of this session (a new round should show something new). */
  shownBefore?: boolean;
  /** Vision rating 1-10: "would a designer use this as the hero of a beautiful homepage for THIS business?" */
  appeal?: number;
  /** The rater's few words on why ("dim gravel lot", "bright historic main street"). */
  appealNote?: string;
  /** Off-topic for this kind of business by its title / label (hero-brief.ts; the no-AI fallback). */
  offTopic?: boolean;
  /** A stock-site watermark: by its URL / domain / title (google-photo.ts WATERMARK_SOURCE) or seen by vision. */
  watermark?: boolean;
};

/** Minimum vision rating for a hero (out of 10). */
export const HERO_BAR = 7;
/**
 * The business's OWN photos need less (Bob: "use the actual photos on the site if available"; round 9: "look
 * through the site for pictures instead of finding random ones on the web"): a modest 5/10, still on-topic, not
 * blurry, not a sign / screenshot / watermarked stock / utility shot.
 */
export const SITE_BAR = 5;
/** How much a passing site photo is preferred over a Google / free-license one on the same score. */
export const SITE_BONUS = 4;

export function barFor(c: Pick<HeroCandidate, "source">): number {
  return c.source === "site" ? SITE_BAR : HERO_BAR;
}

/** Good enough to be a homepage hero: rated ≥ the bar by vision (6 for the site's own photos, 7 for others), or (no rating) a clean on-topic scene. */
export function passesBar(c: Scored): boolean {
  if (c.sign || c.watermark) return false;
  if (c.appeal !== undefined) return c.appeal >= barFor(c) && !c.offTopic;
  // A free-license photo matched by title words alone can't prove it fits the business: vision must rate it.
  if (c.source === "web") return false;
  return !c.offTopic && !LOW_QUALITY.test(`${c.visionSubject ?? ""} ${c.text}`) && c.score >= (c.source === "site" ? 3 + SITE_BONUS - 2 : 3);
}

export type Scored = HeroCandidate & { score: number; subject: string; sign: boolean; why: string[] };

const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** One hero score per candidate, with the reasons (for the log and the card trace). */
export function heroScore(c: HeroCandidate): Scored {
  const words = `${c.visionSubject ?? ""} ${c.text}`;
  // A site photo the vision model has looked at is a sign only when vision says so (round 9: "a park with a flower
  // bed and a historic sign" is a park: only the caption's main subject counts); others go by all their words.
  const sign = Boolean(c.visionSign) || isSignLike(c.source === "site" && c.appeal !== undefined ? mainSubject(c.text) : words);
  const subject = sign ? "sign" : subjectOf(words);
  const why: string[] = [];
  let score = 0;
  const add = (n: number, reason: string) => {
    if (!n) return;
    score += n;
    why.push(`${reason} ${fmt(Math.round(n * 10) / 10)}`);
  };
  const scene = new Set((words.match(SCENE_GOOD) ?? []).map((w) => w.toLowerCase())).size;
  add(Math.min(3, scene) * 1.2, "street/building/landmark scene");
  add(sign ? -5 : 0, "sign, plaque or text");
  add(c.shownBefore ? -8 : 0, "shown in an earlier round");
  if (c.appeal !== undefined) add((c.appeal - 6) * 1.5, `designer rating ${c.appeal}/10${c.appealNote ? ` (${c.appealNote})` : ""}`);
  add(c.offTopic ? -6 : 0, "off-topic for this business");
  add(c.watermark ? -10 : 0, "stock watermark");
  // The business's own photo wins over a stock / Google one when both pass the bar (Bob: use the site's photos).
  add(c.source === "site" && !c.offTopic && !sign && !c.watermark && !LOW_QUALITY.test(words) && (c.appeal === undefined || c.appeal >= SITE_BAR) ? SITE_BONUS : 0, "the business's own photo");
  add(LOW_QUALITY.test(words) ? -4 : 0, "low quality / unflattering subject");
  const ratio = c.width / Math.max(1, c.height);
  add(ratio >= 1.3 && ratio <= 2.1 ? 1 : ratio < 1.15 ? -1.5 : 0, ratio >= 1.3 && ratio <= 2.1 ? "wide" : "not wide");
  add(c.width >= 1600 ? 0.5 : 0, "large");
  add(Math.max(0, Math.min(3, c.relevance)) * 0.6, "search relevance");
  const s = c.stats;
  const nightScene = NIGHT.test(words);
  if (s) {
    if (nightScene && s.mean < 0.3) add(s.mean < 0.08 || s.contrast < 0.12 ? -2 : 0, `too dark even for a night shot (brightness ${s.mean})`);
    else if (s.mean < 0.22) add(-3, `dim (brightness ${s.mean})`);
    else if (s.mean < 0.3 && !NIGHT.test(words)) add(-1.5, `darkish (brightness ${s.mean})`);
    else if (s.mean > 0.82) add(-1, `washed out (brightness ${s.mean})`);
    else if (s.mean >= 0.33 && s.mean <= 0.68) add(1.5, `good light (brightness ${s.mean})`);
    if (s.contrast < 0.12) add(-2, `flat / low contrast (${s.contrast})`);
    else if (s.contrast >= 0.2) add(1, `contrast ${s.contrast}`);
    if (s.sky > 0.5) add(-2, `mostly sky (${Math.round(s.sky * 100)}%)`);
    if (s.green > 0.5) add(-2, `mostly grass/trees (${Math.round(s.green * 100)}%)`);
  }
  return { ...c, score: Math.round(score * 10) / 10, subject, sign, why };
}

/** How well a photo suits a look's mood (0 = neutral). */
export function moodFit(c: Scored, archetype: Archetype | undefined): { fit: number; why: string } {
  if (!archetype) return { fit: 0, why: "" };
  const words = `${c.visionSubject ?? ""} ${c.text}`;
  const s = c.stats;
  const night = NIGHT.test(words) || (s ? s.mean < 0.28 && s.contrast >= 0.16 : false);
  const day = !NIGHT.test(words) && (s ? s.mean >= 0.3 : true);
  switch (archetype) {
    case "dark-premium":
      return night ? { fit: 5, why: "dusk/night scene for a dark look" } : s && s.mean > 0.45 ? { fit: -1.5, why: "bright daylight for a dark look" } : { fit: 0, why: "" };
    case "editorial":
      return HISTORIC.test(words) && day ? { fit: 2.5, why: "daytime historic building for an editorial look" } : night ? { fit: -1, why: "night scene for an editorial look" } : { fit: 0, why: "" };
    case "playful":
    case "bold-photo":
      return LIVELY.test(words) && (!s || s.saturation >= 0.12) ? { fit: 2, why: "lively street/people for a bold look" } : { fit: 0, why: "" };
    case "warm-craft":
      return (s && s.warm > 0.06) || /\b(?:sunset|golden|warm)\b/i.test(words) ? { fit: 1.5, why: "warm light for a warm look" } : { fit: 0, why: "" };
    case "minimal-luxury":
      return s && s.contrast < 0.24 && !c.sign && (HISTORIC.test(words) || /\b(?:skyline|aerial|landmark)\b/i.test(words)) ? { fit: 1.5, why: "calm landmark for a minimal look" } : { fit: 0, why: "" };
    default:
      return { fit: 0, why: "" };
  }
}

/**
 * A near-duplicate of a sign is a sign too, whatever its title says ("Pauls Valley gateway" = the welcome sign at
 * another size): it gets the sign penalty and the sign subject.
 */
export function withDuplicateSigns(list: Scored[]): Scored[] {
  return list.map((c) => {
    if (c.sign || !c.hash) return c;
    const twin = list.find((o) => o.sign && o.hash && hamming(o.hash, c.hash!) <= 10);
    if (!twin) return c;
    return { ...c, sign: true, subject: "sign", score: Math.round((c.score - 5) * 10) / 10, why: [...c.why, `near-duplicate of a sign photo -5`] };
  });
}

/** Two photos show the same thing: same subject bucket (signs always), or near-duplicate pixels. */
export function sameSubject(a: Scored, b: Scored): boolean {
  if (a.id === b.id) return true;
  if (a.sign && b.sign) return true;
  if (a.hash && b.hash && hamming(a.hash, b.hash) <= 10) return true;
  // Two different photos of the business's own (two dishes, two parks) are different pictures: each look may
  // lead with one (round 9). Only identical / near-identical ones count as the same.
  if (a.source === "site" && b.source === "site") return false;
  return Boolean(a.subject) && a.subject === b.subject;
}

export type HeroPick = { index: number; id: string; source: "google" | "site" | "web"; subject: string; score: number; fit: number; reason: string };

/**
 * Assign one photo per look (indices 0..n-1), all different subjects, maximizing hero score + mood fit. Brute force
 * over the best candidates (3 looks × ≤12 candidates). Looks whose archetype is unknown only use the score.
 * With fewer distinct subjects than looks, the remaining looks get no pick (they fall back to the old path).
 */
export function assignHeroes(candidates: HeroCandidate[], archetypes: (Archetype | undefined)[]): HeroPick[] {
  const all = withDuplicateSigns(candidates.map(heroScore)).sort((a, b) => b.score - a.score);
  // The quality bar: only photos a designer would use compete; below-bar ones only when nothing passes.
  const passing = all.filter(passesBar);
  const scored = (passing.length ? passing : all).slice(0, 12);
  const n = archetypes.length;
  const fits = scored.map((c) => archetypes.map((a) => moodFit(c, a)));
  // Site photos first: every passing photo of the business's own is placed before any Google / free-license one
  // (each on its own look; the score and mood fit decide which look).
  const ownFirst = scored.map((c) => (c.source === "site" && passesBar(c) ? 15 : 0));
  let best: { total: number; picks: number[] } = { total: -Infinity, picks: [] };
  const walk = (look: number, picks: number[], total: number) => {
    if (look === n) {
      if (total > best.total) best = { total, picks: [...picks] };
      return;
    }
    let placed = false;
    for (let i = 0; i < scored.length; i += 1) {
      if (picks.some((p) => p >= 0 && sameSubject(scored[p]!, scored[i]!))) continue;
      placed = true;
      picks.push(i);
      walk(look + 1, picks, total + scored[i]!.score + fits[i]![look]!.fit + ownFirst[i]!);
      picks.pop();
    }
    if (!placed) {
      picks.push(-1);
      walk(look + 1, picks, total - 20);
      picks.pop();
    }
  };
  walk(0, [], 0);
  // Fewer good photos than looks: a look shows a good photo again (in its own treatment) rather than a bad one.
  const reused = new Set<number>();
  if (passing.length) {
    best.picks = best.picks.map((p, look) => {
      if (p >= 0) return p;
      let at = 0;
      let top = -Infinity;
      scored.forEach((c, i) => {
        const v = c.score + fits[i]![look]!.fit - best.picks.filter((q) => q === i).length * 3;
        if (v > top) {
          top = v;
          at = i;
        }
      });
      reused.add(look);
      return at;
    });
  }
  return best.picks.flatMap((p, look) => {
    if (p < 0) return [];
    const c = scored[p]!;
    const fit = fits[p]![look]!;
    const runnerUp = scored.find((o, i) => i !== p && !best.picks.includes(i));
    const reason = [
      `score ${c.score} (${c.why.join(", ") || "no signals"})`,
      fit.fit ? `mood ${fmt(fit.fit)} (${fit.why})` : "",
      runnerUp ? `beat “${runnerUp.text.slice(0, 50)}” (${runnerUp.source}, score ${runnerUp.score}${runnerUp.sign ? ", sign" : ""})` : "",
      c.subject ? `subject: ${c.subject}` : "",
      reused.has(look) ? `reused: only ${passing.length} photo${passing.length === 1 ? "" : "s"} passed the quality bar` : "",
      passing.length ? "" : "nothing passed the quality bar; best available",
    ]
      .filter(Boolean)
      .join(" · ");
    return [{ index: look, id: c.id, source: c.source, subject: c.subject, score: c.score, fit: fit.fit, reason }];
  });
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
