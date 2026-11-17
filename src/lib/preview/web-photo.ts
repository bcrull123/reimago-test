/**
 * Finding a real photo of what the owner asked for ("Use a photo of the downtown brick streets as background").
 * Pure helpers (no network), shared by web-photo.server.ts and the tests:
 * - placeOf: the business's city/state, so a web search looks for *their* brick streets;
 * - sceneKeywords / matchScraped: does one of the site's own photos already show it (alt text, title, file name)?
 * - licenseOk / scoreWebPhoto / pickWebPhoto: rank free-license web results (Openverse, Wikimedia Commons).
 */
import type { SiteFacts } from "./types.ts";

export type PhotoCredit = {
  title: string;
  author: string;
  /** Short license name, e.g. "CC BY-SA 3.0" or "Public domain". */
  license: string;
  licenseUrl: string;
  /** Page the photo came from (its Commons/Flickr page, or the business's own page). */
  sourceUrl: string;
  provider: "Openverse" | "Wikimedia Commons" | "your site";
};

export type WebPhotoCandidate = PhotoCredit & {
  /** Direct image URL to download (a ~1600px rendition when the source offers one). */
  imageUrl: string;
  width: number;
  height: number;
  /** Title, tags and description, for matching. */
  text: string;
  /** "town": from a search that named the business's town; "generic": the subject anywhere ("red brick street"). */
  scope?: "town" | "generic";
  /** Words of the search that found it (Commons full-text search also reads the file page). */
  queryWords?: string[];
};

const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** "123 Main St, Pauls Valley, OK 73075" -> { city: "Pauls Valley", state: "Oklahoma" }; "City of Pauls Valley" works too. */
export function placeOf(facts: Pick<SiteFacts, "address" | "name">): { city: string; state: string } | undefined {
  const address = (facts.address || "").replace(/\s+/g, " ");
  const stateNames = Object.values(STATES).join("|");
  const m =
    address.match(new RegExp(`(?:^|,|\\d\\s)\\s*([A-Za-z][A-Za-z .'-]{1,40}?),?\\s+(${Object.keys(STATES).join("|")}|${stateNames})\\.?(?:\\s+\\d{5}(?:-\\d{4})?)?\\s*(?:,|$|USA|United States)`)) ??
    undefined;
  if (m) {
    const city = m[1]!.replace(/^.*\b(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Hwy|Suite|Ste)\.?\s+/i, "").trim();
    const state = STATES[m[2]!.toUpperCase()] ?? m[2]!;
    if (city && !/\d/.test(city)) return { city, state };
  }
  const civic = (facts.name || "").match(/\b(?:City|Town|Village) of ([A-Z][A-Za-z .'-]{1,40})/);
  if (civic) return { city: civic[1]!.trim(), state: "" };
  return undefined;
}

const STOP = /^(the|a|an|of|our|my|some|more|and|with|in|on|at|for|to|as|photo|photos|picture|pictures|image|images|background|hero|nice|beautiful|old|real)$/;
/** Close words count as a match ("downtown" ~ "historic district", "streets" ~ "avenue"). */
const SYNONYMS: Record<string, string[]> = {
  downtown: ["downtown", "historic district", "main street", "storefront", "business district", "town square", "courthouse square"],
  street: ["street", "streets", "avenue", "road", "main st"],
  brick: ["brick", "bricks", "cobblestone", "paver"],
};

const COLOR = /^(red|orange|yellow|green|blue|navy|purple|pink|black|white|gr[ae]y|brown|tan|golden|gold|silver|dark|light|bright|warm)$/;

/** The words of a requested scene that a photo's title or tags should mention, singular. Colors only describe ("red bricks" -> brick). */
export function sceneKeywords(scene: string, place?: { city: string; state: string }): string[] {
  const placeWords = new Set(`${place?.city ?? ""} ${place?.state ?? ""}`.toLowerCase().split(/\s+/).filter(Boolean));
  const words = [
    ...new Set(
      scene
        .toLowerCase()
        .replace(/[^a-z\s-]/g, " ")
        .split(/[\s-]+/)
        .filter((w) => w.length > 2 && !STOP.test(w) && !placeWords.has(w))
        .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)),
    ),
  ];
  const things = words.filter((w) => !COLOR.test(w));
  return things.length ? things : words;
}

/** What a subject usually means in a photo: bricks on a town site are brick streets. */
const EXPAND: Record<string, string> = { brick: "street", cobblestone: "street", paver: "street" };

/** Keywords plus the usual companion word ("brick" -> "brick", "street"), for searches without the town. */
export function expandedKeywords(keywords: string[]): string[] {
  const extra = keywords.map((k) => EXPAND[k]).filter((k): k is string => Boolean(k) && !keywords.includes(k!));
  return [...new Set([...keywords, ...extra])];
}

/**
 * Search words, best first: the town with the subject ("Pauls Valley red brick"), the town with each word and the
 * usual meaning ("Pauls Valley brick street"), the town itself, then the subject anywhere ("red brick street").
 */
export function webQueries(scene: string, place?: { city: string; state: string }): { q: string; scope: "town" | "generic" }[] {
  const keywords = sceneKeywords(scene, place);
  const expanded = expandedKeywords(keywords);
  const plain = scene
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.test(w) && !`${place?.city ?? ""}`.toLowerCase().split(" ").includes(w))
    .join(" ");
  const out: { q: string; scope: "town" | "generic" }[] = [];
  if (place?.city) {
    out.push({ q: `${place.city} ${plain}`.trim(), scope: "town" });
    if (expanded.length > keywords.length) out.push({ q: `${place.city} ${expanded.join(" ")}`, scope: "town" });
    for (const k of keywords.slice(0, 3)) out.push({ q: `${place.city} ${k}`, scope: "town" });
    out.push({ q: `${place.city} ${place.state}`.trim(), scope: "town" });
  }
  const color = plain.split(" ").filter((w) => COLOR.test(w));
  const paved = keywords.find((k) => EXPAND[k]);
  // "brick street" alone finds streets *named* Brick Street / Brick Lane; "brick paved street" finds brick streets.
  if (color.length || !paved) out.push({ q: [...color, ...expanded].join(" "), scope: "generic" });
  if (paved) out.push({ q: `${paved} paved ${EXPAND[paved]}`, scope: "generic" });
  return out.filter((x, i, list) => x.q && list.findIndex((y) => y.q === x.q) === i);
}

/**
 * A street *named* after the subject ("Brick Street, Derby", "Street signs in Brick Lane") rather than one paved
 * with it ("A brick paved street in Owosso", "Redmond, WA - Red Brick Road").
 */
function namedStreet(candidate: WebPhotoCandidate, keywords: string[]): boolean {
  if (/paved|pavers?\b|cobble/i.test(candidate.text)) return false;
  return keywords.some((k) => {
    if (!EXPAND[k]) return false;
    const name = new RegExp(`(^|[^A-Za-z-])(\\w+ )?${k[0]!.toUpperCase()}${k.slice(1)}s? (Street|St|Lane|Road|Rd|Avenue|Ave|Place|Court|Row)\\b`);
    const m = candidate.title.match(name);
    return Boolean(m && !COLOR.test((m[2] ?? "").trim().toLowerCase()));
  });
}

const WEAK = new Set(["street", "road", "avenue", "ave", "way", "area", "view", "place"]);

function hits(keywords: string[], text: string): number {
  const t = ` ${text.toLowerCase().replace(/[_\-/.]+/g, " ")} `;
  return keywords.filter((k) => (SYNONYMS[k] ?? [k]).some((s) => new RegExp(`\\b${s}s?\\b`).test(t))).length;
}

/** Only licenses that allow commercial use and changes: CC0, public domain, CC BY, CC BY-SA. */
export function licenseOk(license: string): boolean {
  const l = license.toLowerCase().trim();
  if (!l || /\bnc\b|non-?commercial|\bnd\b|no-?deriv/.test(l)) return false;
  return /^(cc0|pdm|public domain|pd\b|pd-|no restrictions|no known copyright|cc[ -]?by(?:[ -]?sa)?(?:[ -]\d(?:\.\d)?)?$|by(?:-sa)?(?: \d(?:\.\d)?)?$)/.test(l);
}

/** A scraped photo of the business whose alt text / title / file name names the requested scene. */
export function matchScraped(
  scene: string,
  place: { city: string; state: string } | undefined,
  candidates: { url: string; label: string }[],
): { url: string; label: string } | undefined {
  const keywords = sceneKeywords(scene, place);
  if (!keywords.length) return undefined;
  const need = Math.min(2, keywords.length);
  let best: { url: string; label: string; score: number } | undefined;
  for (const c of candidates) {
    let file = "";
    try {
      file = decodeURIComponent(new URL(c.url).pathname.split("/").pop() ?? "");
    } catch {
      file = "";
    }
    const score = hits(keywords, `${c.label} ${file}`);
    if (score >= need && (!best || score > best.score)) best = { ...c, score };
  }
  return best && { url: best.url, label: best.label };
}

/** How well a web photo fits: must name the place (when known) and at least one scene word; landscape, >=1200px wide. */
export function scoreWebPhoto(candidate: WebPhotoCandidate, scene: string, place?: { city: string; state: string }): number {
  if (!licenseOk(candidate.license)) return -1;
  if (candidate.width && candidate.height && (candidate.width < 1200 || candidate.width / candidate.height < 1.2)) return -1;
  const text = candidate.text.toLowerCase();
  const inCity = place?.city ? text.includes(place.city.toLowerCase()) : false;
  if (candidate.scope === "generic") {
    // The subject anywhere: most of the subject and its usual meaning must be in the photo's own words.
    const expanded = expandedKeywords(sceneKeywords(scene, place));
    const strong = hits(expanded.filter((k) => !WEAK.has(k)), candidate.text);
    const all = hits(expanded, candidate.text);
    if (!strong || all < Math.min(2, expanded.length)) return -1;
    if (namedStreet(candidate, expanded)) return -1;
    return hits(expanded, candidate.title) * 2 + all + (inCity ? 3 : 0) - 1;
  }
  const keywords = sceneKeywords(scene, place);
  const sceneHits = hits(keywords, candidate.text);
  // Commons search also reads the file page: a photo titled with the town, found by "<town> <subject word>",
  // is about that subject even when its short description doesn't say so ("Pauls Valley Historic District").
  const strongWords = keywords.filter((k) => !WEAK.has(k));
  const searchHit =
    Boolean(place?.city) && candidate.title.toLowerCase().includes(place!.city.toLowerCase()) && (candidate.queryWords ?? []).some((w) => strongWords.includes(w));
  // "Street" alone is noise (every address has one): a photo must match a more telling word of the scene.
  if (!hits(strongWords, candidate.text) && !searchHit) return -1;
  // Most of the scene must match ("brick streets": a brick house is not enough). A photo titled as the town's
  // downtown / historic district counts double for a downtown scene: that is the place the owner means.
  // (Its title, or a category such as "Pauls Valley Historic District" on a photo of a downtown building.)
  const placeLevel = keywords.includes("downtown") && hits(["downtown"], candidate.text) ? 1 : 0;
  if (sceneHits + placeLevel + (searchHit && !sceneHits ? 1 : 0) < Math.min(2, keywords.length)) return -1;
  // A match in the photo's own title counts more than one in its categories ("…Historic District" category on a train station).
  const titleHits = hits(keywords, candidate.title);
  if (place?.city && !inCity) return -1;
  return 4 + titleHits * 3 + sceneHits * 2 + (searchHit ? 1 : 0) + (inCity ? 3 : 0) + (place?.state && text.includes(place.state.toLowerCase()) ? 1 : 0) + (candidate.width >= 1600 ? 0.5 : 0);
}

export function pickWebPhoto(candidates: WebPhotoCandidate[], scene: string, place?: { city: string; state: string }): WebPhotoCandidate[] {
  return candidates
    .map((c) => ({ c, s: scoreWebPhoto(c, scene, place) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

/** The search words: the scene (without "the", "photo of"...) plus the city. */
export function webQuery(scene: string, place?: { city: string; state: string }): string {
  const words = scene
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.test(w));
  const city = place?.city ?? "";
  return [city, ...words.filter((w) => !city.toLowerCase().split(" ").includes(w))].join(" ").trim();
}

/** 'Photo: “Pauls Valley Historic District” by Crimsonedge34 (CC BY-SA 3.0) from Wikimedia Commons' */
export function creditLine(credit: PhotoCredit): string {
  const title = credit.title.length > 70 ? `${credit.title.slice(0, 67)}…` : credit.title;
  return `“${title}”${credit.author ? ` by ${credit.author}` : ""} (${credit.license}) from ${credit.provider}`;
}

// ---------------------------------------------------------------- which of the site's own photos can be the hero

/** Places and views make the best town/business heroes; people and events are good too. */
const GOOD_PLACE =
  /\b(downtown|main street|streets?|park|parks|lake|river|creek|skyline|sunset|sunrise|aerial|landscape|landmark|courthouse|city hall|historic|storefronts?|shops?|exterior|facade|welcom\w*|sign|depot|museum|church|fountain|plaza|square|trail|garden|town|patio|dining room)\b/g;
const GOOD_PEOPLE = /\b(festival|parade|events?|market|families|family|people|crowd|neighbors|kids|children|team|crew|smiling|customers?)\b/g;
const BAD_ALWAYS = /\b(logo|icon|document|pdf|form|flyer|poster|screenshot|chart|graph|map|agenda|minutes|open bids|bids?|headshots?|portrait|staff photo|employee|mugshot|seal|clip ?art|text reading|qr code|placeholder)\b/g;
/** For a town/city site, utility and infrastructure photos are not a welcome (Bob: "why are pipes showing up in a town website?"). */
const BAD_CIVIC =
  /\b(pipes?|piping|valves?|meters?|pumps?|utility|utilities|sewer|wastewater|water treatment|treatment plant|plant room|tanks?|equipment|machinery|mechanical|industrial|infrastructure|substation|transformers?|wires?|hydrants?|manholes?|technical room|control panel)\b/g;
const BAD_CIVIC_URL = /(utilit|water|sewer|public-?works|department|staff|bids?|agenda|forms?|documents?|uploads\/.*(?:pdf|form))/;

const count = (re: RegExp, text: string) => (text.match(re) ?? []).length;

/**
 * How well one of the site's own photos works as the hero, from its alt/title text and URL:
 * > 0 good (downtown, landmarks, people, storefronts…), 0 neutral, < 0 keep it out of the hero (and, when very
 * low, off the homepage): documents, logos, headshots everywhere; pipes/equipment/utility-page photos on a town site.
 */
export function heroSuitability(url: string, label: string, civic: boolean): number {
  let file = "";
  try {
    const u = new URL(url);
    file = decodeURIComponent(u.pathname).toLowerCase();
  } catch {
    file = url.toLowerCase();
  }
  const text = `${label} ${file.split("/").pop() ?? ""}`.toLowerCase().replace(/[_\-.]+/g, " ");
  let score = Math.min(3, count(GOOD_PLACE, text)) * 2 + Math.min(2, count(GOOD_PEOPLE, text)) - count(BAD_ALWAYS, text) * 4;
  if (civic) score -= count(BAD_CIVIC, text) * 3 + (BAD_CIVIC_URL.test(file) ? 2 : 0);
  return score;
}
