/**
 * Round 15c — normalize headline and copy casing after a refine or copy pass.
 * Sentence or title case to match the look; all-caps looks stay all-caps via CSS
 * (see theme.ts `text-transform: uppercase` on condensed display fonts).
 * Proper nouns and acronyms (Pauls Valley, Oklahoma, OSU) are preserved.
 */

export type CopyCase = "sentence" | "title";

const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "the", "to", "up", "via", "vs", "vs.", "with"]);

const ACRONYMS = new Set(["OSU", "OK", "USA", "US", "UK", "UAE", "HVAC", "BBQ", "AI", "LLC", "OKC", "PD", "FD", "EMT", "CEO", "CTA", "FAQ", "NASA", "AM", "PM"]);

/** Well-known place and institution names we always keep, plus any the caller passes in. */
const KNOWN_PROPER = [
  "Pauls Valley",
  "Oklahoma City",
  "Oklahoma",
  "United States",
  "New York",
  "Los Angeles",
  "San Francisco",
  "Fort Worth",
  "Las Vegas",
  "New Orleans",
  "El Paso",
  "St. Louis",
  "Washington",
  "City Hall",
];

export type CaseFacts = {
  name?: string;
  tagline?: string;
  host?: string;
  address?: string;
  location?: string;
  city?: string;
  description?: string;
};

/** Proper nouns taken from the business facts, longest first. */
export function properNounsFrom(facts?: CaseFacts): string[] {
  const out: string[] = [...KNOWN_PROPER];
  if (!facts) return uniqueProper(out);
  const blobs = [facts.name, facts.location, facts.city, facts.address, facts.tagline, facts.host?.replace(/\.[a-z]{2,}$/i, "").replace(/\./g, " ")];
  for (const blob of blobs) {
    if (!blob) continue;
    const cleaned = String(blob).replace(/https?:\/\//i, "").replace(/\/.*$/, "").replace(/[,/|]+/g, ",");
    for (const part of cleaned.split(",")) {
      const p = part.replace(/\s+/g, " ").trim();
      if (p.length < 2) continue;
      if (/^[A-Za-z][A-Za-z .'-]+[A-Za-z]$/.test(p) || /^[A-Za-z]{2,}$/.test(p)) out.push(p);
      // "Pauls Valley, Oklahoma" already split; also add each capitalized token pair.
      const words = p.split(" ").filter(Boolean);
      if (words.length >= 2) {
        for (let i = 0; i < words.length - 1; i += 1) {
          const pair = `${words[i]} ${words[i + 1]}`;
          if (words[i]![0] === words[i]![0]!.toUpperCase() && words[i + 1]![0] === words[i + 1]![0]!.toUpperCase()) out.push(pair);
        }
      }
    }
  }
  return uniqueProper(out);
}

function uniqueProper(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const k = item.toLowerCase();
    if (seen.has(k) || k.length < 2) continue;
    // Don't treat generic words as proper nouns.
    if (/^(the|and|of|city|town|street|streets|our|your|explore|welcome)$/i.test(item)) continue;
    seen.add(k);
    out.push(item);
  }
  return out.sort((a, b) => b.length - a.length);
}

function isAcronym(word: string): boolean {
  const bare = word.replace(/[^A-Za-z0-9]/g, "");
  if (ACRONYMS.has(bare.toUpperCase()) && bare.length <= 5) return true;
  return /^[A-Z]{2,5}$/.test(word);
}

function splitWords(text: string): string[] {
  return text.replace(/\s+/g, " ").trim().split(" ");
}

function capFirst(word: string): string {
  if (!word) return word;
  // Keep leading punctuation.
  const m = word.match(/^([^A-Za-z]*)([A-Za-z])(.*)$/);
  if (!m) return word;
  return `${m[1]}${m[2]!.toUpperCase()}${m[3]!.toLowerCase()}`;
}

function lowerRest(word: string): string {
  const m = word.match(/^([^A-Za-z]*)([A-Za-z])(.*)$/);
  if (!m) return word;
  return `${m[1]}${m[2]!.toLowerCase()}${m[3]!.toLowerCase()}`;
}

/** Apply canonical proper-noun / acronym casing to an already-cased string. */
function applyProper(text: string, proper: string[]): string {
  let out = text;
  for (const name of proper) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "gi");
    out = out.replace(re, name);
  }
  out = out.replace(/\b([A-Za-z]{2,5})\b/g, (w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w));
  return out;
}

export function toSentenceCase(text: string, proper: string[] = []): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return trimmed;
  const words = splitWords(trimmed);
  const out = words.map((w, i) => {
    const bare = w.replace(/[^A-Za-z0-9]/g, "");
    if (isAcronym(w) || ACRONYMS.has(bare.toUpperCase())) return w.replace(bare, bare.toUpperCase());
    if (i === 0 || /[.!?]$/.test(words[i - 1] ?? "")) return capFirst(w);
    return lowerRest(w);
  });
  return applyProper(out.join(" "), proper);
}

export function toTitleCase(text: string, proper: string[] = []): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return trimmed;
  const words = splitWords(trimmed);
  const last = words.length - 1;
  const out = words.map((w, i) => {
    const bare = w.replace(/[^A-Za-z0-9]/g, "");
    if (isAcronym(w) || ACRONYMS.has(bare.toUpperCase())) return w.replace(bare, bare.toUpperCase());
    const lower = bare.toLowerCase();
    if (i !== 0 && i !== last && SMALL.has(lower)) return lowerRest(w);
    return capFirst(w);
  });
  return applyProper(out.join(" "), proper);
}

/**
 * Guess the look's headline style from its current heading and typography.
 * Condensed / all-caps looks still return title or sentence — uppercase is applied in CSS.
 */
export function headlineCaseFor(
  design?: { fonts?: { heading?: string }; archetype?: string },
  currentHeading?: string,
): CopyCase {
  const heading = (currentHeading ?? "").replace(/\s+/g, " ").trim();
  if (heading && heading !== heading.toUpperCase()) {
    const words = heading.split(" ").filter((w) => w.replace(/[^A-Za-z]/g, "").length > 3);
    const capped = words.filter((w) => /^[A-Z]/.test(w.replace(/^[^A-Za-z]+/, ""))).length;
    if (words.length >= 2) return capped / words.length >= 0.7 ? "title" : "sentence";
    if (words.length === 1) return "sentence";
  }
  const font = design?.fonts?.heading ?? "";
  const arch = design?.archetype ?? "";
  if (/Anton|Oswald|Big Shoulders|Archivo Black/.test(font) || arch === "bold-photo" || arch === "playful") return "title";
  return "sentence";
}

export function normalizeHeadline(text: string, style: CopyCase, proper: string[] = []): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return trimmed;
  return style === "title" ? toTitleCase(trimmed, proper) : toSentenceCase(trimmed, proper);
}

export function normalizeLead(text: string, proper: string[] = []): string {
  return toSentenceCase(text.replace(/\s+/g, " ").trim(), proper);
}

/** Pull a dictated headline out of “Have it say …” / “change the headline to …”. */
export function readDictatedCopy(text: string): { headline?: string; lead?: string } | undefined {
  const t = text.replace(/\s+/g, " ").trim();
  const patterns = [
    /\bhave\s+it\s+say\s*[:–-]?\s*[“"']?(.+?)[”"']?\s*$/i,
    /\bmake\s+it\s+say\s*[:–-]?\s*[“"']?(.+?)[”"']?\s*$/i,
    /\bchange\s+(?:the\s+)?(?:headline|heading|title|wording)\s+to\s*[:–-]?\s*[“"']?(.+?)[”"']?\s*$/i,
    /\b(?:the\s+)?(?:headline|heading|title)\s+should\s+(?:be|say)\s*[:–-]?\s*[“"']?(.+?)[”"']?\s*$/i,
    /\bit\s+should\s+say\s*[:–-]?\s*[“"']?(.+?)[”"']?\s*$/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    const headline = m[1].replace(/\s+/g, " ").trim().replace(/^[“"']|[”"']$/g, "").replace(/\s*\.$/, "");
    if (headline.length >= 2 && headline.length <= 120) return { headline };
  }
  return undefined;
}

/**
 * True when a photo/art caption is something a person would write.
 * Filters leaked CSS class names, SVG ids, and machine phrases like
 * “Marquee path group yui text hitbox focus”.
 */
export function isHumanCaption(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < 3 || t.length > 80) return false;
  if (/https?:\/\//i.test(t) || /^[a-f0-9]{8,}$/i.test(t)) return false;
  if (/\.(jpg|jpeg|png|gif|webp|svg|css|js)$/i.test(t)) return false;
  if (/\b(hitbox|bbox|clippath|viewbox|textbox|font-size|class=|yui-?|data-|aria-|js-|css-)\b/i.test(t)) return false;
  if (/\b(path group|group yui|text hitbox|hitbox focus|layer group|svg path)\b/i.test(t)) return false;
  const words = t.split(" ").filter(Boolean);
  if (!words.length) return false;
  const short = words.filter((w) => w.length <= 3).length;
  if (words.length >= 4 && short / words.length >= 0.5 && !/\b(the|and|of|in|on|for|our|its)\b/i.test(t)) return false;
  // "Marquee path group yui text" — several tool/css tokens.
  const junk = words.filter((w) => /^(path|group|layer|frame|focus|mask|clip|text|box|div|span|svg|g\d+|yui|marquee|hitbox|node)$/i.test(w)).length;
  if (junk >= 2) return false;
  return true;
}

export function cleanCaption(text: string | undefined, fallback?: string): string | undefined {
  if (!text) return fallback;
  const t = text.replace(/\s+/g, " ").trim();
  return isHumanCaption(t) ? t : fallback;
}
