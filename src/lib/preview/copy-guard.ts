/**
 * Round 15c — unfortunate-phrasing guard for headlines and body copy.
 * Catches double entendres and off-putting wording, especially around food
 * (linger, gas, moist, aftertaste) and “to die for” in healthcare.
 * Pure: no I/O, so node tests can run it. The server layer adds a model check.
 */

export type GuardFacts = {
  name?: string;
  description?: string;
  about?: string;
  industry?: string;
  services?: string[];
  tagline?: string;
  notes?: string;
  brief?: string;
  address?: string;
  host?: string;
};

export type GuardHit = { phrase: string; reason: string; excerpt: string };

export type GuardRewrite = { from: string; to: string; reason: string };

const FOOD_SITE =
  /\b(restaurant|caf[eé]|diner|bistro|bakery|brunch|dinner|lunch|breakfast|menu|chef|cuisine|eatery|grill|tavern|pizzeria|sushi|steakhouse|gastropub|wine bar|coffee shop|roastery|food truck|plates?|kitchen|catering|bar\s*&\s*grill|pub)\b/i;

const FOOD_WORDS =
  /\b(dinner|lunch|brunch|breakfast|plates?|menu|chef|cuisine|dish(?:es)?|food|meal|taste|tasting|flavor|flavours?|kitchen|dining|table|recipes?|appetizer|dessert|entree|entr[eé]e|wine|cocktail|coffee|bakery|bread|pizza|burger|steak)\b/i;

const HEALTH_SITE =
  /\b(hospital|clinic|medical|doctor|dentist|dental|healthcare|health care|physician|hospice|urgent care|veterinar|pharmacy|patient|optometr|chiropract|therap)\b/i;

const GAS_OK = /\b(gas\s+(?:grill|range|stove|oven|fireplace|lamp|light|station|works)|natural\s+gas|gasoline|gas\s+company)\b/i;

/** Always off-putting, any kind of site. */
const ALWAYS: { re: RegExp; phrase: string; reason: string }[] = [
  { re: /\bmoist\b/i, phrase: "moist", reason: "off-putting adjective" },
  { re: /\booz(?:e|es|ed|ing)\b/i, phrase: "ooze", reason: "off-putting bodily image" },
  { re: /\bfester(?:s|ed|ing)?\b/i, phrase: "fester", reason: "off-putting decay image" },
  { re: /\baftertaste\b/i, phrase: "aftertaste", reason: "unappetizing food association" },
  { re: /\bregrets?\b/i, phrase: "regret", reason: "negative leftover feeling" },
  { re: /\bexplos(?:ive|ion|ions)\b/i, phrase: "explosive", reason: "violent or bodily double meaning" },
  { re: /\bleav(?:e|es|ing) you wanting\b/i, phrase: "leaves you wanting", reason: "cliché with an off reading" },
  { re: /\bleft wanting\b/i, phrase: "left wanting", reason: "cliché with an off reading" },
  { re: /\b(bathroom|toilet|urinal|urine|feces|fecal|stool|diarrhea|vomit(?:ing)?|flatulence|fart|burp|phlegm|mucus|bile|pus)\b/i, phrase: "bodily", reason: "bathroom or bodily wording" },
  { re: /\bto die for\b/i, phrase: "to die for", reason: "death cliché" },
];

const LINGER = /\blinger(?:s|ing|ed)?\b/i;
const GAS = /\bgas\b/i;
const LINGER_SMELL = /\b(?:smell|odor|odour|aroma|scent|stench)s?\b[^.]{0,40}\blinger|\blinger[^.]{0,40}\b(?:smell|odor|odour|aroma|scent|stench)s?\b/i;
const DIE = /\b(?:to die for|drop dead|drop-dead|you'll die|you will die|to die)\b/i;

export function isFoodSite(facts?: GuardFacts, text = ""): boolean {
  const corpus = `${facts?.industry ?? ""} ${facts?.name ?? ""} ${facts?.description ?? ""} ${facts?.about ?? ""} ${(facts?.services ?? []).join(" ")} ${facts?.tagline ?? ""} ${facts?.host ?? ""} ${text}`;
  return FOOD_SITE.test(corpus);
}

export function isHealthSite(facts?: GuardFacts, text = ""): boolean {
  const corpus = `${facts?.industry ?? ""} ${facts?.name ?? ""} ${facts?.description ?? ""} ${facts?.about ?? ""} ${(facts?.services ?? []).join(" ")} ${facts?.tagline ?? ""} ${text}`;
  return HEALTH_SITE.test(corpus);
}

function excerptAround(text: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 24);
  const end = Math.min(text.length, idx + len + 24);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

export function findUnfortunatePhrasing(text: string, facts?: GuardFacts): GuardHit[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const hits: GuardHit[] = [];
  const seen = new Set<string>();
  const add = (phrase: string, reason: string, idx: number, len: number) => {
    const key = `${phrase}:${idx}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ phrase, reason, excerpt: excerptAround(t, idx, len) });
  };

  for (const rule of ALWAYS) {
    const m = t.match(rule.re);
    if (m && m.index != null) add(rule.phrase, rule.reason, m.index, m[0].length);
  }

  const food = isFoodSite(facts, t) || FOOD_WORDS.test(t);
  const health = isHealthSite(facts, t);

  const smell = t.match(LINGER_SMELL);
  if (smell && smell.index != null) add("linger+smell", "a smell that lingers is off-putting", smell.index, smell[0].length);

  if (food) {
    const linger = t.match(LINGER);
    if (linger && linger.index != null) add("linger", "on a food site, “linger” reads as an aftertaste or gas joke", linger.index, linger[0].length);
    if (!GAS_OK.test(t)) {
      const gas = t.match(GAS);
      if (gas && gas.index != null) add("gas", "on a food site, “gas” reads as a bodily joke", gas.index, gas[0].length);
    }
  } else {
    // Near food words even on a non-restaurant site.
    if (FOOD_WORDS.test(t)) {
      const linger = t.match(LINGER);
      if (linger && linger.index != null) add("linger", "“linger” next to food reads as an aftertaste or gas joke", linger.index, linger[0].length);
    }
  }

  if (health) {
    const die = t.match(DIE);
    if (die && die.index != null) add("die", "death wording is wrong on a healthcare site", die.index, die[0].length);
  }

  return hits;
}

/**
 * Deterministic rewrite. Prefer a close edit of the line; if it still hits,
 * fall back to a safe, specific sentence. Never leaves a denylist phrase in.
 */
export function rewriteUnfortunateText(text: string, facts?: GuardFacts): { text: string; hits: GuardHit[]; changed: boolean } {
  const hits = findUnfortunatePhrasing(text, facts);
  if (!hits.length) return { text, hits, changed: false };
  let out = text.replace(/\s+/g, " ").trim();

  out = out.replace(/\blinger longer over\b/gi, "Take your time over");
  out = out.replace(/\blinger over\b/gi, "Savor");
  out = out.replace(/\bthat lingers after dark\b/gi, "that shines after dark");
  out = out.replace(/\blingers after dark\b/gi, "shines after dark");
  out = out.replace(/\bafter dark,?\s*lingers\b/gi, "after dark");
  out = out.replace(/\blingering (?:aroma|smell|odor|odour|scent)\b/gi, "fresh aroma");
  out = out.replace(/\b(?:aroma|smell|odor|odour|scent) that lingers\b/gi, "fresh aroma");
  out = out.replace(/\blinger(?:s|ing|ed)?\b/gi, "stays memorable");
  out = out.replace(/\bmoist\b/gi, "tender");
  out = out.replace(/\booz(?:e|es|ed|ing)\b/gi, "shimmer");
  out = out.replace(/\bfester(?:s|ed|ing)?\b/gi, "fade");
  out = out.replace(/\baftertaste\b/gi, "finish");
  out = out.replace(/\bno regrets?\b/gi, "gladly");
  out = out.replace(/\bregrets?\b/gi, "doubt");
  out = out.replace(/\bexplos(?:ive|ion|ions)\b/gi, "bold");
  out = out.replace(/\bleav(?:e|es|ing) you wanting\b/gi, "worth a second visit");
  out = out.replace(/\bleft wanting\b/gi, "ready for more");
  out = out.replace(/\bto die for\b/gi, "you will love");
  out = out.replace(/\bdrop-dead\b/gi, "striking");
  if (!GAS_OK.test(out)) out = out.replace(/\bgas\b/gi, "spark");

  if (findUnfortunatePhrasing(out, facts).length) out = safeFallback(text, facts);
  // If the fallback somehow still hits (shouldn't), use a very plain line.
  if (findUnfortunatePhrasing(out, facts).length) {
    const name = facts?.name?.trim() || "this place";
    out = isFoodSite(facts, text) || FOOD_WORDS.test(text) ? `A table at ${name}` : `Welcome to ${name}`;
  }
  return { text: out, hits, changed: out !== text.replace(/\s+/g, " ").trim() };
}

function safeFallback(original: string, facts?: GuardFacts): string {
  const name = facts?.name?.trim();
  const food = isFoodSite(facts, original) || FOOD_WORDS.test(original);
  if (food) {
    if (/after dark/i.test(original)) return name ? `Dinner after dark at ${name}` : "Dinner after dark";
    if (/plates/i.test(original)) return name ? `The best plates at ${name}` : "The best plates, served with care";
    if (/brunch/i.test(original)) return name ? `Brunch at ${name}` : "Brunch, morning to afternoon";
    return name ? `A table at ${name}` : "A table tonight";
  }
  if (isHealthSite(facts, original)) return name ? `Care you can trust at ${name}` : "Care you can trust";
  return name ? `A closer look at ${name}` : "A closer look";
}

export type GuardedSection = {
  eyebrow?: string;
  heading?: string;
  text?: string;
  cta?: { label?: string; href?: string };
  secondary?: { label?: string; href?: string };
  items?: { title?: string; text?: string }[];
  [key: string]: unknown;
};

export function guardSections<T extends GuardedSection>(sections: T[], facts?: GuardFacts, lookName?: string): { sections: T[]; rewrites: GuardRewrite[] } {
  const rewrites: GuardRewrite[] = [];
  const apply = (value: string | undefined, field: string): string | undefined => {
    if (!value) return value;
    const result = rewriteUnfortunateText(value, facts);
    if (result.changed) rewrites.push({ from: value, to: result.text, reason: result.hits.map((h) => h.reason).join("; ") || field });
    return result.text;
  };
  const next = sections.map((s, i) => {
    const heading = apply(s.heading, `sections[${i}].heading`);
    const text = apply(s.text, `sections[${i}].text`);
    const eyebrow = apply(s.eyebrow, `sections[${i}].eyebrow`);
    const cta = s.cta ? { ...s.cta, label: apply(s.cta.label, `sections[${i}].cta`) ?? s.cta.label } : s.cta;
    const secondary = s.secondary ? { ...s.secondary, label: apply(s.secondary.label, `sections[${i}].secondary`) ?? s.secondary.label } : s.secondary;
    const items = s.items?.map((it, j) => ({
      ...it,
      title: apply(it.title, `sections[${i}].items[${j}].title`) ?? it.title,
      text: apply(it.text, `sections[${i}].items[${j}].text`) ?? it.text,
    }));
    return { ...s, heading, text, eyebrow, cta, secondary, items };
  });
  if (rewrites.length && lookName) {
    // Logging is the caller's job so this file stays pure; the look name is
    // accepted so server wrappers can include it.
  }
  return { sections: next, rewrites };
}

/** Rewrite denylist hits inside simple heading/lead tags of custom HTML. */
export function guardHtmlCopy(html: string, facts?: GuardFacts): { html: string; rewrites: GuardRewrite[] } {
  if (!html) return { html, rewrites: [] };
  const rewrites: GuardRewrite[] = [];
  const htmlOut = html.replace(/<(h1|h2|h3|p)(\b[^>]*)>([\s\S]*?)<\/\1>/gi, (all, tag: string, attrs: string, inner: string) => {
    if (/</.test(inner.replace(/<br\s*\/?>/gi, ""))) return all;
    const text = inner.replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
    const result = rewriteUnfortunateText(text, facts);
    if (!result.changed) return all;
    rewrites.push({ from: text, to: result.text, reason: result.hits.map((h) => h.reason).join("; ") });
    return `<${tag}${attrs}>${esc(result.text)}</${tag}>`;
  });
  return { html: htmlOut, rewrites };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function logCopyGuard(lookName: string, rewrites: GuardRewrite[], via: "denylist" | "model"): void {
  for (const r of rewrites) {
    console.info(`[copy-guard] “${lookName}” ${via} rewrote “${r.from.slice(0, 80)}” → “${r.to.slice(0, 80)}” (${r.reason})`);
  }
}
