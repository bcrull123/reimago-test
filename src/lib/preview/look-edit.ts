/**
 * "The Night Brick is best, just a little too dark." — targeted refinement of ONE existing look.
 *
 * Pure helpers (no I/O), shared by the server edit step and tests:
 * - findTargetLook(): which look the feedback names (its name, fuzzily; "the second one"; "the dark one";
 *   "the editorial one"; "this one" = the look being previewed). No named look = the old "3 new looks" path.
 * - readAdjustments(): deterministic reading of common tweaks ("too dark", "a bit brighter", "more contrast",
 *   "too busy", "bigger text"...), with an amount (slight / medium / strong). The AI planner returns the same shape.
 * - tunePalette() / tuneCss(): the actual, measurable change: OKLCH lightness/chroma/hue of the look's backgrounds
 *   and surfaces, text colors recomputed to keep WCAG AA, and CSS for the hero scrim, photo filter, type size and
 *   spacing. Everything is computed from the look's ORIGINAL palette plus cumulative levels, so repeated edits
 *   never drift.
 */
import type { Archetype, SitePalette } from "./types.ts";

export const ADJUST_TYPES = [
  "lighten",
  "darken",
  "more-contrast",
  "less-contrast",
  "saturate",
  "desaturate",
  "warmer",
  "cooler",
  "bigger-text",
  "smaller-text",
  "more-space",
  "less-space",
  "more-color",
  "less-busy",
  "daylight",
] as const;
export type AdjustType = (typeof ADJUST_TYPES)[number];
export type Amount = "slight" | "medium" | "strong";
export type Adjustment = { type: AdjustType; amount: Amount };

/** What the owner asked to change on one look. */
export type LookEdit = {
  /** Look id (resolved by findTargetLook or the AI planner). */
  targetId?: string;
  how?: string;
  adjustments: Adjustment[];
  /** New hero headline / intro text, when the owner dictated it. */
  copy?: { headline?: string; lead?: string };
  /** A different hero photo subject ("…but with the depot photo"). */
  photo?: string;
  /** "Use Editorial's picture on Dark Premium": take these assets from another look on screen. */
  borrow?: { fromId: string; assets: BorrowAsset[] };
  /** The owner's own new-photo request, subject words kept ("brick streets", maybe "Pine Street"). */
  photoRequest?: PhotoRequest;
  /** Only when the owner explicitly asked this card for another style ("make it Bold Photo"): its new archetype. */
  restyle?: Archetype;
  from: "AI planner" | "wording";
};

export type BorrowAsset = "photo" | "palette" | "fonts";

/** Cumulative numeric levels per adjustment (slight = 1, medium = 2, strong = 3), stored on the edited look. */
export type TuneLevels = Partial<Record<AdjustType, number>>;

/** Stored on an edited look's design (DesignDirection.tune). */
export type LookTune = {
  levels: TuneLevels;
  /** The look's palette and motifs before any edit (every edit is recomputed from these). */
  base: { palette: SitePalette; motifs: string[]; name: string };
  /** Lowest hero scrim factor that keeps white hero text at WCAG AA on this photo (measured server-side). */
  scrimMin?: number;
  /** "lighter", "a bit lighter still"… shown after the look's name on the card. */
  variant?: string;
  /** "Changed: lightened backgrounds and photo overlay (slight)". */
  changed?: string;
};

export const AMOUNT_LEVEL: Record<Amount, number> = { slight: 1, medium: 2, strong: 3 };

export function amountWord(level: number): string {
  const n = Math.abs(level);
  return n <= 1.05 ? "slight" : n <= 1.55 ? "slight–medium" : n <= 2.05 ? "medium" : n <= 2.55 ? "medium–strong" : "strong";
}

// ------------------------------------------------------------------------------------------- reading the request

const SLIGHT = /\b(?:a\s+(?:little|bit|touch|tad|smidge|hair)|little\s+bit|slightly|just\s+a\s+(?:little|bit|touch|tad)|somewhat|a\s+little\s+bit|kind\s+of|kinda|marginally|a\s+notch)\b/;
const STRONG = /\b(?:much|a\s+lot|way|very|really|super|significantly|considerably|far|so|extremely|drastically|way\s+too|a\s+ton)\b/;

function amountNear(text: string, at: number, end: number): Amount {
  const window = text.slice(Math.max(0, at - 28), Math.min(text.length, end + 16));
  if (SLIGHT.test(window)) return "slight";
  if (STRONG.test(window)) return "strong";
  return "medium";
}

const RULES: { type: AdjustType; pattern: RegExp }[] = [
  { type: "lighten", pattern: /\btoo\s+(?:dark|dim|gloomy|black|moody|heavy)\b|\b(?:lighter|brighter|lighten(?:ed)?(?:\s+up)?|brighten(?:ed)?(?:\s+up)?|less\s+dark|not\s+(?:so|as)\s+dark|more\s+light|lift(?:ed)?\s+the\s+(?:darkness|shadows))\b/ },
  { type: "darken", pattern: /\btoo\s+(?:light|bright|washed[\s-]?out|white|pale)\b|\b(?:darker|darken(?:ed)?|moodier|less\s+bright|not\s+(?:so|as)\s+bright|dimmer)\b/ },
  { type: "more-contrast", pattern: /\b(?:more|higher|stronger|better|increase(?:d)?\s+the)\s+contrast\b|\b(?:raise|increase|boost|improve|add|show|up)\s+(?:the\s+|some\s+)?(?:text\s+|type\s+)?contrast\b|\b(?:text|type|words|writing)\s+(?:to\s+)?(?:show|have|with|needs?)\s+(?:more\s+|better\s+)?contrast\b|\bcontrast\s+(?:on|for|of)\s+the\s+(?:text|type|words)\b|\bhard\s+to\s+read\b|\blow\s+contrast\b|\bmore\s+pop\b|\bpop\s+more\b|\bnot\s+enough\s+contrast\b/ },
  { type: "less-contrast", pattern: /\b(?:less|lower|softer|reduce(?:d)?\s+the)\s+contrast\b|\btoo\s+(?:harsh|contrasty|stark)\b/ },
  { type: "saturate", pattern: /\b(?:more\s+(?:vivid|saturated|vibrant)|richer\s+colou?rs?|colou?rs?\s+(?:pop|more\s+vivid)|too\s+(?:dull|muted|washed)|washed[\s-]+out|(?:dull|faded)\s+colou?rs?)\b/ },
  { type: "desaturate", pattern: /\b(?:less\s+(?:saturated|vivid|vibrant)|more\s+muted|tone(?:d)?\s+(?:it\s+)?down|too\s+(?:saturated|garish|loud|colou?rful|neon))\b/ },
  { type: "warmer", pattern: /\b(?:warmer|more\s+warm|warm\s+it\s+up|too\s+(?:cold|cool|blue|sterile))\b/ },
  { type: "cooler", pattern: /\b(?:cooler|more\s+cool|cool\s+it\s+down|too\s+(?:warm|yellow|orange))\b/ },
  { type: "bigger-text", pattern: /\b(?:bigger|larger)\s+(?:text|font|type|letters|words|headlines?|writing)\b|\b(?:text|font|type|writing|words)\s+(?:is\s+|are\s+)?too\s+small\b|\b(?:increase|enlarge)\s+the\s+(?:text|font)\b|\bhard\s+to\s+see\b/ },
  { type: "smaller-text", pattern: /\b(?:smaller|tinier)\s+(?:text|font|type|letters|headlines?)\b|\b(?:text|font|type|headlines?)\s+(?:is\s+|are\s+)?too\s+(?:big|large|huge)\b/ },
  { type: "more-space", pattern: /\b(?:more\s+(?:space|spacing|white\s*space|breathing\s+room|room|padding)|roomier|too\s+(?:cramped|crowded|tight|squished))\b/ },
  { type: "less-space", pattern: /\b(?:less\s+(?:space|spacing|white\s*space|padding)|tighter|more\s+compact|too\s+(?:much\s+(?:white\s*)?space|spread\s+out|sparse))\b/ },
  { type: "more-color", pattern: /\b(?:more\s+colou?r(?:ful)?|add\s+(?:some\s+)?colou?r|too\s+(?:plain|gr[ae]y|bland|boring|beige)|needs\s+colou?r)\b/ },
  // "make the image daylight": the SAME photo, brighter and sunnier (never a new photo by itself).
  { type: "daylight", pattern: /\b(?:in\s+)?(?:day[\s-]?light|day[\s-]?time|sunny|sunnier|sunlit|sunlight|sunshine|mid[\s-]?day|in\s+the\s+day|less\s+(?:night|nighttime|dusk)|not\s+(?:at\s+)?night)\b/ },
  { type: "less-busy", pattern: /\b(?:too\s+busy|less\s+busy|cluttered|too\s+much\s+going\s+on|cleaner|simpler|calmer|less\s+cluttered|declutter|tone\s+down\s+the\s+decorations)\b/ },
];

/** The tweaks the owner's words ask for, each with an amount; opposite pairs keep the later one. */
export function readAdjustments(raw: string): Adjustment[] {
  const text = raw.toLowerCase().replace(/[’']/g, "'");
  const found: (Adjustment & { at: number })[] = [];
  for (const rule of RULES) {
    const match = new RegExp(rule.pattern.source, "g").exec(text);
    if (!match) continue;
    // "not too dark" / "don't make it darker" are not requests.
    if (/\b(?:not|don'?t|never|no)\s+(?:make\s+it\s+)?$/.test(text.slice(Math.max(0, match.index - 18), match.index)) && !/^not\s/.test(match[0])) continue;
    found.push({ type: rule.type, amount: amountNear(text, match.index, match.index + match[0].length), at: match.index });
  }
  const opposite: Partial<Record<AdjustType, AdjustType>> = {
    lighten: "darken",
    darken: "lighten",
    "more-contrast": "less-contrast",
    "less-contrast": "more-contrast",
    saturate: "desaturate",
    desaturate: "saturate",
    warmer: "cooler",
    cooler: "warmer",
    "bigger-text": "smaller-text",
    "smaller-text": "bigger-text",
    "more-space": "less-space",
    "less-space": "more-space",
  };
  return found
    .filter((a) => !found.some((b) => b.type === opposite[a.type] && b.at > a.at))
    .sort((a, b) => a.at - b.at)
    .map(({ type, amount }) => ({ type, amount }));
}

/** Validate the AI planner's adjustments (unknown types / amounts dropped). */
export function cleanAdjustments(raw: unknown): Adjustment[] {
  if (!Array.isArray(raw)) return [];
  const out: Adjustment[] = [];
  for (const item of raw) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const type = String(r.type ?? "").toLowerCase().trim().replace(/[\s_]+/g, "-") as AdjustType;
    const amount = String(r.amount ?? "medium").toLowerCase().trim() as Amount;
    if (!(ADJUST_TYPES as readonly string[]).includes(type)) continue;
    if (!out.some((a) => a.type === type)) out.push({ type, amount: amount in AMOUNT_LEVEL ? amount : "medium" });
  }
  return out.slice(0, 6);
}

// ------------------------------------------------------------------------------------------- which look

export type LookRef = { id: string; name: string; archetype: Archetype; index: number; background?: string; primary?: string; custom?: boolean };

/** "the custom one", "custom design", "the from-scratch one", "bespoke": the from-scratch look. */
const CUSTOM_LABEL = /\bcustom(?:[\s-]*design)?(?:'?s)?\b|\bfrom[\s-]*scratch\b|\bbespoke\b/g;

const STOP = new Set(["the", "and", "a", "an", "of", "look", "one", "with", "&"]);
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9&' ]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => norm(s).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length]!;
}

function tokenHit(word: string, words: string[]): boolean {
  const w = word.replace(/s$/, "");
  return words.some((t) => {
    const x = t.replace(/s$/, "");
    return x === w || (w.length >= 5 && lev(x, w) <= 1);
  });
}

/** How strongly the text names this look (0 = not at all). */
export function nameScore(text: string, name: string): number {
  const n = norm(name).replace(/^the /, "");
  const t = ` ${norm(text)} `;
  if (n && t.includes(` ${n} `)) return 10;
  const nameWords = tokens(name);
  if (!nameWords.length) return 0;
  const words = tokens(text);
  const hits = nameWords.filter((w) => tokenHit(w, words)).length;
  if (nameWords.length === 1) return hits ? 4 : 0;
  if (hits === nameWords.length) return 6 + hits;
  return nameWords.length >= 3 && hits >= nameWords.length - 1 ? 3 + hits : 0;
}

const ORDINALS: [RegExp, number | "last"][] = [
  [/\b(?:the\s+)?(?:first|1st|left(?:most)?|left[\s-]hand)\s+(?:one|look|design|option|version|card)\b|\b(?:look|option|design|version|card|number|no\.?)\s*#?\s*1\b|#1\b/, 0],
  [/\b(?:the\s+)?(?:second|2nd|middle|center|centre|mid)\s+(?:one|look|design|option|version|card)\b|\b(?:look|option|design|version|card|number|no\.?)\s*#?\s*2\b|#2\b/, 1],
  [/\b(?:the\s+)?(?:third|3rd|last|right(?:most)?|right[\s-]hand|final)\s+(?:one|look|design|option|version|card)\b|\b(?:look|option|design|version|card|number|no\.?)\s*#?\s*3\b|#3\b/, "last"],
];

const ARCHETYPE_WORDS: [RegExp, Archetype[]][] = [
  [/^(?:editorial|magazine|newspaper|paper)$/, ["editorial"]],
  [/^(?:playful|fun|cheerful|friendly|rounded)$/, ["playful"]],
  [/^(?:bold|loud|photo|photo[\s-]led|big[\s-]type)$/, ["bold-photo"]],
  [/^(?:premium|cinematic|night|moody|elegant)$/, ["dark-premium", "minimal-luxury"]],
  [/^(?:minimal|luxury|clean|simple|white)$/, ["minimal-luxury"]],
  [/^(?:craft|crafty|rustic|earthy|warm)$/, ["warm-craft"]],
];

const COLOR_HUES: Record<string, number> = { red: 25, orange: 55, yellow: 95, gold: 85, green: 145, teal: 185, blue: 255, navy: 260, purple: 305, pink: 350, brown: 50 };

/** OKLCH hue/chroma/lightness of a hex color. */
export function oklch(hex: string): { l: number; c: number; h: number } {
  const [L, a, b] = toOklab(hex);
  return { l: L, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

/** Style labels as people type them (the card shows ONE name per look: its style, e.g. "Dark Premium"). */
const LABELS: [Archetype, RegExp][] = [
  ["dark-premium", /\bdark[\s-]*premium(?:'?s)?\b|\bpremium(?:'?s)?\b/g],
  ["editorial", /\bedit[a-z]{3,6}(?:'?s)?\b/g],
  ["playful", /\bpla[a-z]{3,5}l(?:'?s)?\b/g],
  ["bold-photo", /\bbold[\s-]*photo(?:[\s-]*led)?(?:'?s)?\b|\bphoto[\s-]*led(?:'?s)?\b|\bbold(?:'s|s)?(?=\s+(?:one|look|version|design|option|card|picture|photo|image|pic|hero|background|colou?rs?|palette|fonts?)\b|\s*$)|\bthe\s+bold\b(?!er)/g],
  ["warm-craft", /\bwarm[\s-]*craft(?:'?s)?\b|\bcraft(?:'?s)?\b/g],
  ["minimal-luxury", /\bminimal[\s-]*luxury(?:'?s)?\b|\bluxury(?:'?s)?\b|\bthe\s+minimal\b/g],
];
/** Fuzzy single words for the labels (typos: "editoral", "premuim", "playfull"). */
const LABEL_WORDS: [string, Archetype][] = [
  ["editorial", "editorial"],
  ["premium", "dark-premium"],
  ["playful", "playful"],
  ["luxury", "minimal-luxury"],
];
const ADJECTIVAL = /\b(?:more|less|too|bit|very|so|super|extra|quite|less|it|feel|look|looks|feels|seem|seems)\s+$/;

export type LookMention = { id: string; how: string; at: number; end: number; possessive: boolean };

/**
 * Every look the text refers to, with where: by name (fuzzy), by style label ("Dark Premium", "editorials",
 * "the playful one"), by position ("the first one", "the middle one"). Used for single targets and for
 * cross-look edits ("Use editorials picture on dark premium").
 */
export function findLookRefs(text: string, looks: LookRef[]): LookMention[] {
  const t = norm(text);
  const out: LookMention[] = [];
  const add = (look: LookRef | undefined, how: string, at: number, end: number) => {
    if (!look || out.some((m) => m.id === look.id && Math.abs(m.at - at) < 3)) return;
    const after = t.slice(end, end + 3);
    const word = t.slice(at, end);
    out.push({ id: look.id, how, at, end, possessive: /'s$|s'$/.test(word) || /^'s\b/.test(after) || /s$/.test(word.replace(/'s$/, "")) });
  };
  // Names: exact phrase anywhere, else fuzzy (a unique best match only).
  const fuzzy: { look: LookRef; s: number }[] = [];
  for (const look of looks) {
    const n = norm(look.name).replace(/^the /, "");
    const at = n ? ` ${t} `.indexOf(` ${n}`) : -1;
    const adjectival = at >= 0 && ADJECTIVAL.test(t.slice(0, at)) && !/^\s*(?:one|look|version|design|option|card)\b/.test(t.slice(at + n.length));
    if (adjectival) continue; // "make it more playful" is a wish, not the Playful look
    if (at >= 0 && n.length >= 3) add(look, `named “${look.name}”`, at, at + n.length + (t.slice(at + n.length).startsWith("'s") ? 2 : 0));
    else {
      const s = nameScore(text, look.name);
      if (s > 0) fuzzy.push({ look, s });
    }
  }
  fuzzy.sort((a, b) => b.s - a.s);
  if (fuzzy.length && (fuzzy.length === 1 || fuzzy[0]!.s > fuzzy[1]!.s)) {
    const first = tokens(fuzzy[0]!.look.name)
      .map((w) => t.split(" ").findIndex((x) => tokenHit(w, [x])))
      .filter((i) => i >= 0);
    const words = t.split(" ");
    const wi = first.length ? Math.min(...first) : 0;
    const at = words.slice(0, wi).join(" ").length + (wi ? 1 : 0);
    add(fuzzy[0]!.look, `named “${fuzzy[0]!.look.name}”`, at, at + (words[wi]?.length ?? 0));
  }
  // Style labels.
  const byArchetype = (a: Archetype) => {
    // The from-scratch look keeps a template archetype for its sub-pages, but is never "the playful one".
    const hit = looks.filter((l) => l.archetype === a && !l.custom);
    return hit.length === 1 ? hit[0] : undefined;
  };
  for (const [archetype, pattern] of LABELS) {
    for (const m of t.matchAll(pattern)) {
      const at = m.index! + (m[0].startsWith("the ") ? 4 : 0);
      if (ADJECTIVAL.test(t.slice(0, at)) && !/^\s*(?:one|look|version|design|option|card)\b/.test(t.slice(at + m[0].length))) continue;
      if (archetype === "editorial" && !/^edit(?:orial|oral|orail|orial|torial|orials?|oral's)/.test(m[0]) && lev(m[0].replace(/'?s$/, ""), "editorial") > 1) continue;
      if (archetype === "playful" && lev(m[0].replace(/'?s$/, ""), "playful") > 1) continue;
      add(byArchetype(archetype), `style “${archetype}”`, at, at + m[0].length - (m[0].startsWith("the ") ? 4 : 0));
    }
  }
  const custom = looks.filter((l) => l.custom);
  if (custom.length === 1) {
    for (const m of t.matchAll(CUSTOM_LABEL)) {
      if (ADJECTIVAL.test(t.slice(0, m.index!)) && !/^\s*(?:one|look|version|design|option|card)\b/.test(t.slice(m.index! + m[0].length))) continue;
      add(custom[0], "the custom (from-scratch) look", m.index!, m.index! + m[0].length);
    }
  }
  let pos = 0;
  for (const w of t.split(" ")) {
    const bare = w.replace(/'?s$/, "");
    for (const [label, archetype] of LABEL_WORDS) {
      if (bare !== label && bare.length >= 6 && lev(bare, label) <= 1 && !ADJECTIVAL.test(t.slice(0, pos))) add(byArchetype(archetype), `style “${archetype}”`, pos, pos + w.length);
    }
    pos += w.length + 1;
  }
  // Positions.
  const byIndex = [...looks].sort((a, b) => a.index - b.index);
  for (const [pattern, at] of ORDINALS) {
    const m = pattern.exec(t);
    if (m) add(at === "last" ? byIndex.at(-1) : byIndex[at], `position (${at === "last" ? "last" : at + 1})`, m.index, m.index + m[0].length);
  }
  return out.sort((a, b) => a.at - b.at);
}

const ASSETS: [BorrowAsset, RegExp][] = [
  ["photo", /\b(?:picture|photo|photograph|pic|image|hero|background|backdrop|shot|bg)s?\b/],
  ["palette", /\b(?:colou?rs?|palette|color\s+scheme)\b/],
  ["fonts", /\b(?:fonts?|typefaces?|typography|lettering)\b/],
];

/**
 * A cross-look edit: "Use editorials picture on dark premium", "put the first one's photo on the playful one",
 * "give Dark Premium the editorial colors", "Dark Premium with the photo from Editorial". The destination is the
 * look that gets edited; the source only lends its asset. Undefined unless two different looks are named and an
 * asset (photo / colors / fonts) is mentioned.
 */
export function findBorrow(text: string, looks: LookRef[], focusedId?: string): { targetId: string; fromId: string; assets: BorrowAsset[]; how: string } | undefined {
  const t = norm(text);
  const assets = ASSETS.filter(([, p]) => p.test(t)).map(([a]) => a);
  if (!assets.length || !/\b(?:use|using|put|give|take|borrow|swap|apply|bring|copy|move|same|steal|with|from)\b/.test(t)) return undefined;
  const refs = findLookRefs(text, looks);
  const ids = [...new Set(refs.map((r) => r.id))];
  let dest: LookMention | undefined;
  let src: LookMention | undefined;
  if (ids.length === 1 && focusedId && focusedId !== ids[0] && /\b(?:this|current)\s+(?:one|look|design|version)\b/.test(t)) {
    return { targetId: focusedId, fromId: ids[0]!, assets, how: "the look you were previewing" };
  }
  if (ids.length < 2) return undefined;
  const before = (m: LookMention) => t.slice(Math.max(0, m.at - 14), m.at);
  dest = refs.find((m) => /\b(?:on|onto|to|for|into|in)\s+(?:the\s+)?$/.test(before(m)) && !m.possessive);
  dest ??= refs.find((m) => /\b(?:give|make|change|update|edit)\s+(?:the\s+)?$/.test(before(m)));
  src = refs.find((m) => m.id !== dest?.id && (/\bfrom\s+(?:the\s+)?$/.test(before(m)) || m.possessive));
  if (!dest && src) dest = refs.find((m) => m.id !== src!.id);
  if (dest && !src) src = refs.find((m) => m.id !== dest!.id);
  if (!dest || !src) {
    src = refs[0];
    dest = refs.find((m) => m.id !== src!.id);
  }
  if (!dest || !src || dest.id === src.id) return undefined;
  const name = (id: string) => looks.find((l) => l.id === id)?.name ?? id;
  return { targetId: dest.id, fromId: src.id, assets, how: `${assets.join(" + ")} from “${name(src.id)}” onto “${name(dest.id)}”` };
}

/**
 * Which existing look the feedback names: by name (fuzzy), position ("the second one", "the middle one"),
 * description ("the dark one", "the editorial one", "the green one"), or "this one" / "the one I'm previewing"
 * (the look currently shown). Undefined when no look is named (then three new looks are made, as before).
 */
export function findTargetLook(text: string, looks: LookRef[], focusedId?: string): { id: string; how: string } | undefined {
  if (!looks.length) return undefined;
  const t = norm(text);
  // 0. A cross-look edit edits the destination ("…picture on dark premium" -> Dark Premium).
  const borrow = findBorrow(text, looks, focusedId);
  if (borrow) return { id: borrow.targetId, how: borrow.how };
  // 1. By name, style label ("Dark Premium", "editorials") or position; with several, the first one named.
  const refs = findLookRefs(text, looks);
  if (refs.length) return { id: refs[0]!.id, how: refs[0]!.how };
  const byIndex = [...looks].sort((a, b) => a.index - b.index);
  // 2. "this one" / "the one I'm previewing".
  if (focusedId && looks.some((l) => l.id === focusedId) && /\b(?:this|current|previewed|selected)\s+(?:one|look|design|version|option)\b|\bthe\s+one\s+(?:i'?m|i\s+am)\s+(?:previewing|looking\s+at|viewing|seeing)\b|\bthe\s+one\s+(?:below|shown|on\s+screen)\b|\bthis\s+preview\b/.test(t)) {
    return { id: focusedId, how: "the look you were previewing" };
  }
  // 3. Position.
  for (const [pattern, at] of ORDINALS) {
    if (pattern.test(t)) {
      const look = at === "last" ? byIndex.at(-1) : byIndex[at];
      if (look) return { id: look.id, how: `position (${at === "last" ? "last" : at + 1})` };
    }
  }
  // 4. Description: "the dark one", "the editorial one", "the green look".
  for (const match of t.matchAll(/\bthe\s+([a-z-]+(?:\s+[a-z-]+)?)\s+(?:one|look|version|design|option)\b/g)) {
    const words = match[1]!.split(" ");
    const word = words.at(-1)!;
    const lum = (l: LookRef) => (l.background ? oklch(l.background).l : 0.9);
    if (/^(?:dark|darker|darkest|black|night)$/.test(word)) {
      const darkest = [...looks].sort((a, b) => lum(a) - lum(b))[0]!;
      if (lum(darkest) < 0.5) return { id: darkest.id, how: "the dark one" };
    }
    if (/^(?:light|lighter|lightest|bright|brightest)$/.test(word)) {
      const lightest = [...looks].sort((a, b) => lum(b) - lum(a))[0]!;
      return { id: lightest.id, how: "the light one" };
    }
    for (const [pattern, archetypes] of ARCHETYPE_WORDS) {
      if (!pattern.test(match[1]!) && !pattern.test(word)) continue;
      const hit = looks.filter((l) => archetypes.includes(l.archetype) && !l.custom);
      if (hit.length === 1) return { id: hit[0]!.id, how: `the ${match[1]} one` };
    }
    const hue = COLOR_HUES[word];
    if (hue !== undefined) {
      const dist = (l: LookRef) =>
        Math.min(
          ...[l.primary, l.background]
            .filter((c): c is string => Boolean(c))
            .map((c) => {
              const o = oklch(c);
              const d = Math.abs(((o.h - hue + 540) % 360) - 180);
              return o.c < 0.04 ? 999 : d;
            }),
        );
      const best = [...looks].sort((a, b) => dist(a) - dist(b));
      if (dist(best[0]!) < 40 && (best.length === 1 || dist(best[1]!) - dist(best[0]!) > 15)) return { id: best[0]!.id, how: `the ${word} one` };
    }
  }
  return undefined;
}

// ------------------------------------------------------------------------------------------- color math (OKLab)

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function hexRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
const toLin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLin = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

export function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = hexRgb(hex).map(toLin) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function labToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

/** OKLCH -> hex, reducing chroma until the color fits sRGB. */
export function fromOklch(l: number, c: number, h: number): string {
  const L = clamp(l, 0, 1);
  let chroma = Math.max(0, c);
  let rgb = labToLinear(L, chroma * Math.cos((h * Math.PI) / 180), chroma * Math.sin((h * Math.PI) / 180));
  for (let i = 0; i < 30 && rgb.some((v) => v < -0.0005 || v > 1.0005); i += 1) {
    chroma *= 0.9;
    rgb = labToLinear(L, chroma * Math.cos((h * Math.PI) / 180), chroma * Math.sin((h * Math.PI) / 180));
  }
  return `#${rgb.map((v) => Math.round(clamp(fromLin(clamp(v, 0, 1)), 0, 1) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance and contrast ratio. */
export function relLum(hex: string): number {
  const [r, g, b] = hexRgb(hex).map(toLin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Move a color's lightness (keeping hue/chroma) until it reaches `min` contrast against every background. */
export function readableOn(fg: string, backgrounds: string[], min: number): string {
  if (backgrounds.every((b) => contrastRatio(fg, b) >= min)) return fg;
  const { l, c, h } = oklch(fg);
  const avgBg = backgrounds.reduce((sum, b) => sum + oklch(b).l, 0) / backgrounds.length;
  const towardsLight = avgBg < 0.6;
  for (const dir of towardsLight ? [1, -1] : [-1, 1]) {
    for (let step = 1; step <= 60; step += 1) {
      const candidate = fromOklch(clamp(l + dir * step * 0.017, 0, 1), c * Math.max(0.3, 1 - step * 0.02), h);
      if (backgrounds.every((b) => contrastRatio(candidate, b) >= min)) return candidate;
    }
  }
  const white = backgrounds.every((b) => contrastRatio("#ffffff", b) >= contrastRatio("#111111", b));
  return white ? "#ffffff" : "#111111";
}

const adjustL = (hex: string, dl: number, dc = 0, dh = 0, cScale = 1) => {
  const o = oklch(hex);
  return fromOklch(o.l + dl, Math.max(0, o.c * cScale + dc), o.h + dh);
};

/** Signed level of one axis: lighten 1.5 -> +1.5, darken 1 -> -1. */
function axis(levels: TuneLevels, plus: AdjustType, minus: AdjustType): number {
  return (levels[plus] ?? 0) - (levels[minus] ?? 0);
}

/**
 * The edited palette, computed from the look's original one: backgrounds and surfaces move in OKLCH lightness /
 * chroma / hue, then text, muted text and the brand color are recomputed so they still pass WCAG AA (text 7:1 when
 * the original had it, else 4.5:1; muted 4.5:1; brand/link color 3:1 or its original contrast).
 */
export function tunePalette(base: SitePalette, levels: TuneLevels): SitePalette {
  const light = axis(levels, "lighten", "darken");
  const sat = axis(levels, "saturate", "desaturate") + (levels["more-color"] ?? 0) * 0.6;
  const warm = axis(levels, "warmer", "cooler");
  const con = axis(levels, "more-contrast", "less-contrast");
  const moreColor = levels["more-color"] ?? 0;
  const shift = (hex: string) => {
    const o = oklch(hex);
    let dl = 0;
    if (light > 0) dl = o.l < 0.5 ? 0.07 * light : (0.985 - o.l) * Math.min(0.9, 0.32 * light);
    if (light < 0) dl = o.l < 0.5 ? Math.max(-o.l + 0.06, 0.035 * light) : 0.06 * light;
    // More contrast pushes backgrounds away from the text; less pulls them in a little.
    if (con) dl += (o.l < 0.5 ? -1 : 1) * 0.018 * con;
    const warmHue = 70;
    const hueDelta = warm ? clamp(((warmHue - o.h + 540) % 360) - 180, -12, 12) * (Math.min(1, Math.abs(warm) / 3)) * Math.sign(warm) : 0;
    const dc = (warm ? 0.006 * Math.abs(warm) : 0) + (moreColor ? 0.012 * moreColor : 0);
    return fromOklch(o.l + dl, Math.max(0, o.c * (1 + 0.15 * sat) + dc), o.h + (warm > 0 ? hueDelta : warm < 0 ? -hueDelta : 0) + (o.c < 0.02 && moreColor ? 0 : 0));
  };
  let background = shift(base.background);
  let surface = shift(base.surface);
  if (moreColor) {
    const p = oklch(base.primary);
    const tint = (hex: string, k: number) => {
      const o = oklch(hex);
      return fromOklch(o.l, Math.max(o.c, 0.02 * moreColor * k), o.c < 0.03 ? p.h : o.h);
    };
    background = tint(background, 0.6);
    surface = tint(surface, 1);
  }
  const vivid = (hex: string) => adjustL(hex, 0, 0, 0, Math.max(0.2, 1 + 0.15 * sat + 0.1 * moreColor));
  let primary = sat || moreColor ? vivid(base.primary) : base.primary;
  const accent = sat || moreColor ? vivid(base.accent) : base.accent;
  const bgs = [background, surface];
  const textMin = Math.min(7, Math.max(4.5, contrastRatio(base.text, base.background) >= 7 ? 7 : 4.5) + (con > 0 ? 0.6 * con : 0));
  let text = base.text;
  if (con > 0) text = adjustL(text, (oklch(background).l < 0.5 ? 1 : -1) * 0.03 * con);
  text = readableOn(text, bgs, textMin);
  const muted = readableOn(base.muted, bgs, 4.5);
  primary = readableOn(primary, [background], Math.min(4.5, Math.max(3, contrastRatio(base.primary, base.background))));
  return { primary, accent, background, surface, text, muted };
}

// ------------------------------------------------------------------------------------------- CSS for an edit

/** Numbers for the hero scrim / photo / type / spacing (also used by tests to prove the change is real). */
export function tuneNumbers(levels: TuneLevels, scrimMin = 0) {
  const light = axis(levels, "lighten", "darken");
  const con = axis(levels, "more-contrast", "less-contrast");
  const sat = axis(levels, "saturate", "desaturate") + (levels["more-color"] ?? 0) * 0.6;
  const warm = axis(levels, "warmer", "cooler");
  const day = levels.daylight ?? 0;
  const scrimTarget = (light > 0 ? 1 - 0.27 * light : 1) - 0.12 * day;
  return {
    // Opacity factor of the hero's dark overlay (1 = as designed), never below what keeps white text at AA.
    scrim: Math.round(clamp(Math.max(scrimTarget, scrimMin), 0.15, 1) * 1000) / 1000,
    brightness: Math.round(clamp((light > 0 ? 1 + 0.11 * light : 1 + 0.09 * light) + 0.1 * day, 0.6, 1.6) * 1000) / 1000,
    contrast: Math.round(clamp(1 + 0.06 * con + 0.02 * day, 0.8, 1.3) * 1000) / 1000,
    saturate: Math.round(clamp(1 + 0.14 * sat + 0.06 * day, 0.3, 1.6) * 1000) / 1000,
    sepia: warm > 0 || day > 0 ? Math.round(clamp(0.05 * Math.max(0, warm) + 0.03 * day, 0, 0.25) * 1000) / 1000 : 0,
    hue: warm < 0 ? Math.round(clamp(-5 * warm, 0, 20)) : 0,
    text: Math.round(clamp(1 + 0.07 * axis(levels, "bigger-text", "smaller-text"), 0.8, 1.3) * 1000) / 1000,
    space: Math.round(clamp(1 + 0.15 * axis(levels, "more-space", "less-space"), 0.6, 1.6) * 1000) / 1000,
    calm: (levels["less-busy"] ?? 0) > 0,
  };
}

/** Extra CSS appended to an edited look's stylesheet (after the design system, so it wins). */
export function tuneCss(tune: LookTune | undefined): string {
  if (!tune) return "";
  const n = tuneNumbers(tune.levels, tune.scrimMin);
  const css: string[] = ["/* look edit */"];
  const extra = [n.brightness !== 1 ? `brightness(${n.brightness})` : "", n.contrast !== 1 ? `contrast(${n.contrast})` : "", n.saturate !== 1 ? `saturate(${n.saturate})` : "", n.sepia ? `sepia(${n.sepia})` : "", n.hue ? `hue-rotate(${n.hue}deg)` : ""].filter(Boolean).join(" ");
  if (n.scrim !== 1) {
    css.push(`.s-hero-photo::after{opacity:${n.scrim}}`);
    css.push(`.h-overlay .site-header{background:linear-gradient(180deg,rgba(0,0,0,${Math.round(0.55 * n.scrim * 100) / 100}),transparent)}`);
    // Lighter scrim: keep the hero text crisp with a slightly stronger shadow.
    css.push(`.s-hero-photo h1,.s-hero-photo .lead{text-shadow:0 2px 24px rgba(0,0,0,.45),0 1px 3px rgba(0,0,0,.35)}`);
  }
  if (extra) {
    css.push(`.s-hero-photo .bgimg img,.s-hero-split:not(.x-cutout) .media img,.s-hero-type .media img,.s-page-hero .media img{filter:${extra}}`);
    css.push(`.s-hero-photo.v-cinematic .bgimg img{filter:saturate(${Math.round(0.85 * n.saturate * 1000) / 1000}) contrast(${Math.round(1.08 * n.contrast * 1000) / 1000}) brightness(${n.brightness})${n.sepia ? ` sepia(${n.sepia})` : ""}${n.hue ? ` hue-rotate(${n.hue}deg)` : ""}}`);
    css.push(`.s-hero-split.v-collage:not(.x-cutout) .frame>.media:not(.tile) img{filter:grayscale(1) contrast(${Math.round(1.12 * n.contrast * 1000) / 1000}) brightness(${n.brightness})}`);
  }
  if (n.text !== 1) css.push(`body{font-size:${Math.round(17.5 * n.text * 10) / 10}px}h1{font-size:calc(var(--h1) * ${n.text})}h2{font-size:calc(clamp(2rem,4.2vw,3.4rem) * ${n.text})}h3{font-size:calc(clamp(1.2rem,1.8vw,1.45rem) * ${n.text})}.lead{font-size:calc(clamp(1.08rem,1.5vw,1.28rem) * ${n.text})}`);
  if (n.space !== 1) css.push(`.sec{padding-block:calc(clamp(4.5rem,9vw,8rem) * ${n.space})}.cards,.bento,.split,.gallery{gap:calc(1.6rem * ${n.space})}`);
  if (n.calm) css.push(`.badge,.s-hero-split.v-collage .tile,.ph::after,.marquee{display:none!important}`);
  return css.length > 1 ? css.join("\n") : "";
}

/**
 * The Custom Design page's photo edit (its HTML is Grok's own, so the template selectors don't apply): the same
 * filters on the business's photos (@img:hero / @img:photo-N), never on the logo, the signature graphic or Imagine art.
 */
export function customTuneCss(tune: LookTune | undefined): string {
  if (!tune) return "";
  const n = tuneNumbers(tune.levels, tune.scrimMin);
  const f = [n.brightness !== 1 ? `brightness(${n.brightness})` : "", n.contrast !== 1 ? `contrast(${n.contrast})` : "", n.saturate !== 1 ? `saturate(${n.saturate})` : "", n.sepia ? `sepia(${n.sepia})` : "", n.hue ? `hue-rotate(${n.hue}deg)` : ""].filter(Boolean).join(" ");
  return f ? `/* look edit: the business's photos */\nimg[src$="/img/hero"],img[src*="/img/photo-"]{filter:${f}}` : "";
}

// ------------------------------------------------------------------------------------------- labels

const VERB: Record<AdjustType, string> = {
  lighten: "lighter",
  darken: "darker",
  "more-contrast": "more contrast",
  "less-contrast": "softer",
  saturate: "more vivid",
  desaturate: "more muted",
  warmer: "warmer",
  cooler: "cooler",
  "bigger-text": "bigger text",
  "smaller-text": "smaller text",
  "more-space": "roomier",
  "less-space": "tighter",
  "more-color": "more color",
  "less-busy": "calmer",
  daylight: "daylight",
};

/** "lighter" / "a bit lighter still" / "noticeably lighter" (step 0, 1, 2). */
export function variantLabel(adjustments: Adjustment[], step: 0 | 1 | 2, extra?: string): string {
  const words = adjustments.slice(0, 2).map((a) => VERB[a.type]);
  if (!words.length) return extra ?? "edited";
  const first = words[0]!;
  const comparative = !first.includes(" ");
  const lead = step === 0 ? first : comparative ? (step === 1 ? `a bit ${first} still` : `noticeably ${first}`) : step === 1 ? `even ${first}` : `much ${first}`;
  return [lead, ...words.slice(1), extra].filter(Boolean).join(" & ");
}

const PHRASE: Record<AdjustType, (photoHero: boolean) => string> = {
  lighten: (p) => (p ? "lightened backgrounds and photo overlay" : "lightened backgrounds and photo"),
  darken: () => "darkened backgrounds and photo",
  "more-contrast": () => "raised text and photo contrast",
  "less-contrast": () => "softened contrast",
  saturate: () => "richer, more vivid colors",
  desaturate: () => "more muted colors",
  warmer: () => "warmer colors",
  cooler: () => "cooler colors",
  "bigger-text": () => "larger text",
  "smaller-text": () => "smaller text",
  "more-space": () => "more spacing",
  "less-space": () => "tighter spacing",
  "more-color": () => "more color in backgrounds and accents",
  "less-busy": () => "calmer layout (decorations removed)",
  daylight: () => "same photo in daylight (brighter, sunnier, lighter overlay)",
};

/** The card line: "Changed: lightened backgrounds and photo overlay (slight)". */
export function changedLine(adjustments: Adjustment[], scale: number, photoHero: boolean, notes: string[] = []): string {
  const parts = adjustments.map((a) => `${PHRASE[a.type](photoHero)} (${a.type === "less-busy" ? "on" : amountWord(AMOUNT_LEVEL[a.amount] * scale)})`);
  return `Changed: ${[...parts, ...notes].join("; ") || "nothing measurable"}`;
}

/** Levels after applying adjustments at a scale (1 = as asked; 1.5 / 2 for the variations) on top of earlier edits. */
export function addLevels(prev: TuneLevels | undefined, adjustments: Adjustment[], scale: number): TuneLevels {
  const out: TuneLevels = { ...(prev ?? {}) };
  for (const a of adjustments) out[a.type] = Math.round(((out[a.type] ?? 0) + AMOUNT_LEVEL[a.amount] * scale) * 100) / 100;
  return out;
}

/** Variation scales for the three edited looks: as asked, a half step more, a full step more. */
export function variationScales(adjustments: Adjustment[]): [number, number, number] {
  const top = Math.max(1, ...adjustments.map((a) => AMOUNT_LEVEL[a.amount]));
  return [1, (top + 0.5) / top, (top + 1) / top];
}

// ------------------------------------------------------------------------------------------- per-card requests

const STYLE_NAMES: [Archetype, RegExp][] = [
  ["editorial", /editorial/],
  ["dark-premium", /dark[\s-]*premium/],
  ["bold-photo", /bold[\s-]*photo/],
  ["playful", /playful/],
  ["minimal-luxury", /minimal[\s-]*luxury/],
  ["warm-craft", /warm[\s-]*craft/],
];

/**
 * An explicit style switch for ONE card ("use Bold Photo", "make it Editorial", "switch to Warm Craft style").
 * Only a full style name counts, and only one that is not the card's current style; anything else keeps the style.
 */
export function requestedStyle(raw: string, current: Archetype): Archetype | undefined {
  const text = raw.toLowerCase().replace(/[’']/g, "'");
  for (const [archetype, name] of STYLE_NAMES) {
    if (archetype === current) continue;
    const re = new RegExp(`\\b(?:use|make\\s+(?:it|this|this\\s+one|this\\s+look)(?:\\s+(?:a|an|the|into|in))?|switch\\s+(?:it\\s+|this\\s+)?to|change\\s+(?:it\\s+|this\\s+|the\\s+style\\s+)?to|turn\\s+(?:it\\s+|this\\s+)?into|restyle\\s+(?:it\\s+)?(?:as|to)|(?:go|try)\\s+(?:with\\s+)?|as|in)\\s+(?:the\\s+|a\\s+)?${name.source}(?:\\s+(?:style|look|template|design))?\\b`);
    if (re.test(text)) return archetype;
  }
  return undefined;
}

/** Whether the owner asked for a DIFFERENT photo (not just to adjust the current one: daylight, brighter…). */
export function wantsNewPhoto(raw: string): boolean {
  if (readPhotoRequest(raw)) return true;
  const text = raw.toLowerCase();
  return /\b(?:new|different|another|other|replace|swap|switch)\b[^.]{0,24}\b(?:photo|picture|image|pic|shot|background)s?\b|\b(?:photo|picture|image|pic|shot)s?\s+of\b|\buse\s+(?:a|an|the)\s+(?:photo|picture|image|pic|shot)\b/.test(text);
}

/** A planner "photo" that only names lighting ("daylight scene", "sunny") is an adjustment, not a new photo. */
export function lightingOnly(subject: string): boolean {
  return /^(?:(?:a|the|in|at|bright|brighter|sunny|sunlit|daylight|daytime|day|light|lighter|morning|midday|noon|scene|photo|image|picture|version|shot|of|time)\s*)+$/i.test(subject.trim());
}

// ------------------------------------------------------------------------------------------- a requested photo

/**
 * What the owner asked a NEW photo to show, in their own words (round 8c, Bob: "change the photo to one of the
 * brick streets, maybe Pine Street"): the core subject ("brick streets") and any specific names they offered
 * ("Pine Street"). Never collapsed into the town's generic subject.
 */
export type PhotoRequest = { subject: string; named: string[] };

const PHOTO_WORD = String.raw`(?:photo|picture|image|pic|shot|background|hero(?:\s+(?:photo|image|picture))?|banner)s?`;
const PHOTO_TRIGGERS = [
  // "change/swap/replace/make the photo (to|with) …", "the picture should show …"
  new RegExp(String.raw`\b(?:change|swap|switch|replace|update|make|set|turn)\s+(?:the\s+|this\s+|our\s+|its\s+|that\s+)?(?:main\s+|hero\s+|top\s+)?${PHOTO_WORD}\s+(?:to|with|into|for|of|showing|so\s+it\s+shows)\s+(.+)$`),
  // "a photo of …", "a picture showing …", "photo with …"
  new RegExp(String.raw`\b${PHOTO_WORD}\s+(?:of|showing|that\s+shows|with)\s+(.+)$`),
  // "use / show / put (in) / give it … as the photo", "use our blue truck for the photo"
  new RegExp(String.raw`\b(?:use|show|put\s+in|put|give\s+it)\s+(.+?)\s+(?:as|for|in)\s+(?:the\s+)?${PHOTO_WORD}\b`),
];
const FILLER_LEAD = /^(?:(?:one|some|any)\s+of\s+(?:the\s+|our\s+|its\s+)?|a\s+|an\s+|the\s+|some\s+|our\s+|my\s+|their\s+|its\s+|this\s+|that\s+|those\s+|these\s+|nice\s+|good\s+|real\s+|actual\s+)+/;
const FILLER_TAIL = /\s*(?:\b(?:instead|please|thanks|thank\s+you|if\s+possible|if\s+you\s+can|for\s+the\s+(?:background|hero|top|header)|as\s+the\s+(?:background|hero|main\s+photo)|on\s+(?:the\s+)?(?:hero|top|header|background))\b.*)?[\s.,!;:]*$/;
const ALTERNATE = /,?\s*\b(?:maybe|perhaps|possibly|ideally|preferably|like|such\s+as|especially|e\.g\.|for\s+example|or|say)\b\s*/;
const STREET = /\b(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|highway|hwy|square|park|plaza)\b/;

function cleanPart(part: string): string {
  return part.replace(FILLER_TAIL, "").replace(FILLER_LEAD, "").replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "").replace(/\s+/g, " ").trim();
}

function titleCase(s: string): string {
  return s.replace(/\b([a-z])([a-z]*)/g, (_, a: string, b: string) => a.toUpperCase() + b);
}

/** The owner's own photo request, read from their words (no AI). Undefined when they didn't ask for a new photo. */
export function readPhotoRequest(raw: string): PhotoRequest | undefined {
  const sentences = raw.replace(/[’']/g, "'").split(/(?<=[.!?;\n])\s+/);
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    for (const trigger of PHOTO_TRIGGERS) {
      const m = trigger.exec(lower);
      if (!m?.[1]) continue;
      const at = lower.indexOf(m[1], m.index);
      const original = sentence.slice(at, at + m[1].length);
      const parts = original.split(new RegExp(ALTERNATE.source, "i")).map(cleanPart).filter(Boolean);
      const subject = parts[0] ?? "";
      if (!subject || lightingOnly(subject) || /^(?:daylight|brighter|lighter|darker|it|this|that)$/i.test(subject)) continue;
      // "a photo with more contrast" is a tweak, not a subject.
      if (readAdjustments(subject).length || /^(?:more|less|better|higher|lower)\b/i.test(subject)) continue;
      const named = parts.slice(1).filter((p) => !lightingOnly(p)).map((p) => (/[A-Z]/.test(p) ? p : titleCase(p))).slice(0, 3);
      // A specific name inside the subject itself ("Pine Street bricks"): keep it as named too.
      const proper = original.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Park|Square|Plaza|Lane|Drive)\b/g) ?? [];
      for (const p of proper) if (!named.some((n) => n.toLowerCase() === p.toLowerCase()) && !subject.toLowerCase().startsWith(p.toLowerCase())) named.push(p);
      return { subject: subject.slice(0, 80), named };
    }
  }
  return undefined;
}

const GENERIC_PHOTO = new Set(["photo", "photos", "picture", "pictures", "image", "images", "scene", "view", "shot", "the", "and", "with", "of", "a", "an", "in", "at", "on", "our", "one"]);
export function contentWords(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !GENERIC_PHOTO.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(?:es|s)$/, "") : w));
}

/**
 * The request to search for: the owner's own words win. The planner's subject counts only when the owner's
 * words gave none AND it shares a real word with what they typed (so "downtown Pauls Valley" can never replace
 * "brick streets, maybe Pine Street").
 */
export function mergePhotoRequest(text: string, planner: string | undefined): PhotoRequest | undefined {
  const words = readPhotoRequest(text);
  if (words) return words;
  if (!planner || lightingOnly(planner)) return undefined;
  const typed = new Set(contentWords(text));
  return contentWords(planner).some((w) => typed.has(w)) ? { subject: planner.slice(0, 80), named: [] } : undefined;
}

function singular(phrase: string): string {
  return phrase.replace(/\b([a-z]{3,})(?<!s)s\b/gi, "$1");
}

/** The card's short label: "brick street (Pine St)". */
export function photoRequestLabel(req: PhotoRequest): string {
  const abbr = (n: string) => n.replace(/\bStreet\b/i, "St").replace(/\bAvenue\b/i, "Ave").replace(/\bRoad\b/i, "Rd").replace(/\bBoulevard\b/i, "Blvd");
  return `${singular(req.subject)}${req.named.length ? ` (${req.named.slice(0, 2).map(abbr).join(", ")})` : ""}`;
}

/**
 * Searches from most specific to looser, always with the owner's subject words (never the town's generic query):
 *   "Pine Street" Pauls Valley brick · "Pine Street" Pauls Valley Oklahoma · "brick street" Pauls Valley Oklahoma ·
 *   brick street Pauls Valley · brick street Oklahoma · brick street
 */
export function photoRequestQueries(req: PhotoRequest, place: { city: string; state: string } | undefined): string[] {
  const core = singular(req.subject).toLowerCase();
  const city = place?.city ?? "";
  const state = place?.state ?? "";
  const out: string[] = [];
  for (const n of req.named.slice(0, 2)) {
    const extra = contentWords(core).filter((w) => !contentWords(n).includes(w) && !STREET.test(w))[0] ?? "";
    out.push([`"${n}"`, city, extra].filter(Boolean).join(" "));
    out.push([`"${n}"`, city, state].filter(Boolean).join(" "));
  }
  out.push([`"${core}"`, city, state].filter(Boolean).join(" "));
  if (city) out.push(`${core} ${city}`);
  if (state) out.push(`${core} ${state}`);
  out.push(core);
  return [...new Set(out.map((q) => q.replace(/\s+/g, " ").trim()))].slice(0, 7);
}

const SYNONYMS: Record<string, string[]> = { street: ["street", "road", "avenue", "st", "ave", "lane", "alley", "paved", "main"], brick: ["brick", "bricks", "cobblestone"], truck: ["truck", "pickup", "van"], patio: ["patio", "terrace", "deck", "outdoor seating"], night: ["night", "dusk", "evening"] };

/** How well a caption / title / alt text names the request: "named" (a specific name), "subject", or "none". */
export function captionMatch(caption: string, req: PhotoRequest): "named" | "subject" | "none" {
  const text = ` ${caption.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const has = (w: string) => (SYNONYMS[w] ?? [w]).some((s) => new RegExp(`\\b${s}(?:s|es)?\\b`).test(text));
  for (const n of req.named) {
    const words = contentWords(n);
    const distinct = words.filter((w) => !STREET.test(w));
    if (distinct.length && distinct.every((w) => text.includes(` ${w}`)) && words.every((w) => has(w))) return "named";
  }
  const core = contentWords(req.subject);
  if (!core.length) return "none";
  const hits = core.filter((w) => has(w)).length;
  return has(core[0]!) && hits >= Math.ceil(core.length / 2) ? "subject" : "none";
}

/** How a requested photo turned out (round 9b adds "weak" and "illustrated"; "none" is treated as "nothing"). */
export type PhotoOutcome = "named" | "subject" | "weak" | "none" | "nothing" | "illustrated";

/** The card's honest change line for a requested photo. Never claims a new photo when the picture didn't change. */
export function photoOutcomeNote(req: PhotoRequest, match: PhotoOutcome, what?: string): string {
  const label = photoRequestLabel(req);
  const core = singular(req.subject);
  const asked = `${core}${req.named.length ? ` / ${req.named[0]}` : ""}`;
  if (match === "named") return `new photo: ${label}`;
  if (match === "subject") return req.named.length ? `couldn't find ${req.named[0]}; used a ${core} photo${what ? ` (${what})` : ""}` : `new photo: ${label}`;
  if (match === "weak") return `new photo: its caption says ${core}${what ? ` (${what})` : ""}, but it may not show it clearly`;
  if (match === "illustrated") return `Art: ${core}, illustrated by Grok Imagine (not a real photo${req.named.length ? ` of ${req.named[0]}` : ""})`;
  return `Couldn't find a ${asked} photo, so I kept your current photo`;
}

/** The card's short label for a requested photo: "new photo: brick street (Pine St)", honest when it fell short. */
export function photoVariantLabel(req: PhotoRequest, match: PhotoOutcome): string {
  const label = photoRequestLabel(req);
  const core = singular(req.subject);
  const abbr = (req.named[0] ?? "").replace(/\bStreet\b/i, "St").replace(/\bAvenue\b/i, "Ave").replace(/\bRoad\b/i, "Rd");
  if (match === "named") return `new photo: ${label}`;
  if (match === "subject") return req.named.length ? `new photo: ${core} (no ${abbr} found)` : `new photo: ${label}`;
  if (match === "weak") return `new photo: ${core}? (caption match)`;
  if (match === "illustrated") return `art: ${core} (illustrated)`;
  return `same photo (no ${core} found)`;
}

/**
 * Round 9b: may a request be shown as an illustration when no real photo shows it? Places, scenes and things
 * yes ("brick street", "the patio at night"); people, the owner's own specific things ("our blue truck", "my
 * dog"), logos, signs, menus and documents no: an illustration of those would pass itself off as the real one.
 */
export function illustrationFits(req: PhotoRequest): boolean {
  const s = req.subject.toLowerCase();
  if (/\b(?:our|my|his|her|their|the owner'?s?)\b/.test(s)) return false;
  if (/\b(?:me|us|owners?|team|staff|crew|employees?|family|people|person|customers?|portrait|headshot|selfie|face|kids?|chef|doctor|lawyer|logo|sign|signage|menu|document|screenshot|text|words?|map)s?\b/.test(s)) return false;
  return contentWords(req.subject).length > 0;
}

/** The Imagine prompt for an illustrated stand-in: clearly an illustration, the subject only, never the named place. */
export function illustrationPrompt(req: PhotoRequest, place: { city?: string; state?: string } | undefined, kind?: string): string {
  const core = singular(req.subject);
  const where = place?.state ? ` in a small ${place.state} town` : "";
  return (
    `An ILLUSTRATION (clearly a painted / drawn illustration, not a photograph) of a ${core}${where}, for a website hero${kind ? ` (${kind})` : ""}. ` +
    "Wide 16:9 composition, calm open area on the left for a headline, warm natural light, tasteful muted colors. " +
    "No text, no readable signs or street names, no logos, no people in focus, no watermark."
  );
}
