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

/** The words of a requested scene that a photo's title or tags should mention, singular. */
export function sceneKeywords(scene: string, place?: { city: string; state: string }): string[] {
  const placeWords = new Set(`${place?.city ?? ""} ${place?.state ?? ""}`.toLowerCase().split(/\s+/).filter(Boolean));
  return [
    ...new Set(
      scene
        .toLowerCase()
        .replace(/[^a-z\s-]/g, " ")
        .split(/[\s-]+/)
        .filter((w) => w.length > 2 && !STOP.test(w) && !placeWords.has(w))
        .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)),
    ),
  ];
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
  const keywords = sceneKeywords(scene, place);
  const sceneHits = hits(keywords, candidate.text);
  // "Street" alone is noise (every address has one): a photo must match a more telling word of the scene.
  if (!hits(keywords.filter((k) => !WEAK.has(k)), candidate.text)) return -1;
  // Most of the scene must match ("brick streets": a brick house is not enough). A photo titled as the town's
  // downtown / historic district counts double for a downtown scene: that is the place the owner means.
  const placeLevel = keywords.includes("downtown") && hits(["downtown"], candidate.title) ? 1 : 0;
  if (sceneHits + placeLevel < Math.min(2, keywords.length)) return -1;
  // A match in the photo's own title counts more than one in its categories ("…Historic District" category on a train station).
  const titleHits = hits(keywords, candidate.title);
  const text = candidate.text.toLowerCase();
  const inCity = place?.city ? text.includes(place.city.toLowerCase()) : false;
  if (place?.city && !inCity) return -1;
  return titleHits * 3 + sceneHits * 2 + (inCity ? 3 : 0) + (place?.state && text.includes(place.state.toLowerCase()) ? 1 : 0) + (candidate.width >= 1600 ? 0.5 : 0);
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
