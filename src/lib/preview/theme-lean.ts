/**
 * Round 14 — lean hard into a strong theme the owner actually asked for
 * (style notes like "scarry", a freak-show restaurant that serves eyeballs).
 *
 * Typo-tolerant. Does nothing unless a theme is clear. A period look (90s / Y2K /
 * brutalist) still wins for palettes and fonts when both apply; the theme still
 * guides copy and imagery in the AI prompts.
 *
 * Pure (no I/O), relative imports only, so node tests can run it.
 */
import { contrast } from "./design.ts";
import type { DesignDirection, Motif, SitePalette } from "./types.ts";

export type ThemeId = "horror";

export type ThemeMatch = { id: ThemeId; phrase: string };

type RequestFacts = {
  notes?: string;
  feedback?: string[];
  description?: string;
  name?: string;
  tagline?: string;
  brief?: string;
  about?: string;
};

/** Common misspellings we should still understand in style notes and copy. */
export const STYLE_TYPOS: [RegExp, string, string][] = [
  [/\bscarry\b/i, "scarry", "scary"],
  [/\bscarey\b/i, "scarey", "scary"],
  [/\bscray\b/i, "scray", "scary"],
  [/\bhorrer\b/i, "horrer", "horror"],
  [/\bspookey\b/i, "spookey", "spooky"],
  [/\bcreeepy\b/i, "creeepy", "creepy"],
  [/\bresturant\b/i, "resturant", "restaurant"],
  [/\brestaurent\b/i, "restaurent", "restaurant"],
  [/\bbuisness\b/i, "buisness", "business"],
];

/** Lines to add to AI prompts so "scarry" is read as "scary" without rewriting the owner's words on the card. */
export function typoGloss(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const [re, from, to] of STYLE_TYPOS) {
    if (re.test(text) && !seen.has(from)) {
      seen.add(from);
      found.push(`"${from}" is read as "${to}"`);
    }
  }
  return found;
}

export function typoGlossFor(facts: RequestFacts): string[] {
  const blobs = [facts.notes, facts.description, facts.name, facts.tagline, facts.brief, facts.about, ...(facts.feedback ?? [])]
    .filter(Boolean)
    .join("\n");
  return typoGloss(blobs);
}

/**
 * Horror / sideshow / macabre. Includes typo forms (scarry) and the offer itself
 * ("we serve eyeballs and brains", "freak show").
 */
const HORROR =
  /\b(?:scarry|scarey|scray|scary|horror|horrer|spooky|spookey|creepy|creeepy|macabre|gory|gore|gruesome|halloween|haunted|monsters?|zombies?|vampires?|blood(?:y)?|eyeballs?|brains?|freak\s*shows?|sideshow|cabinet of curiosit\w*|uncanny|unsettling|nightmar(?:e|ish)|terror|ghouls?|ghost(?:ly|s)?|occult|macabre)\b/i;

export function detectTheme(facts: RequestFacts): ThemeMatch | undefined {
  const texts: string[] = [
    ...(facts.feedback ?? []).slice().reverse(),
    facts.notes ?? "",
    facts.name ?? "",
    facts.tagline ?? "",
    facts.description ?? "",
    facts.about ?? "",
    facts.brief ?? "",
  ].filter(Boolean);
  for (const text of texts) {
    const m = text.match(HORROR);
    if (m) return { id: "horror", phrase: m[0].replace(/\s+/g, " ").trim() };
  }
  return undefined;
}

export const THEME_HEADING_FONTS = ["Creepster", "Eater", "Nosifer", "Pirata One", "New Rocker", "Griffy"] as const;
export const THEME_BODY_FONTS = ["Special Elite", "Libre Franklin", "Work Sans", "Nunito Sans"] as const;

type ThemeVariant = { name: string; palette: SitePalette; heading: string; body: string; mood: string; motifs: Motif[] };

function checked(p: SitePalette): SitePalette {
  // Defensive: tests assert contrast; keep text readable on the page background.
  if (contrast(p.text, p.background) < 4.5) throw new Error(`theme palette text contrast ${contrast(p.text, p.background)}`);
  if (contrast(p.muted, p.background) < 4.5) throw new Error(`theme palette muted contrast ${contrast(p.muted, p.background)}`);
  return p;
}

const HORROR_VARIANTS: [ThemeVariant, ThemeVariant, ThemeVariant] = [
  {
    name: "Midnight Carnival",
    palette: checked({ primary: "#e8c547", accent: "#c41e3a", background: "#0b0b0d", surface: "#16121a", text: "#f4efe6", muted: "#c9c0b3" }),
    heading: "Creepster",
    body: "Special Elite",
    mood: "A gleefully macabre carnival after dark: black velvet, bone-white type, a drop of carnival gold and blood red. Headlines feel hand-lettered and a little dripping; the offer is the attraction, not a polite menu.",
    motifs: ["grain", "outlined-type", "stamp-badges"],
  },
  {
    name: "Sideshow Handbill",
    palette: checked({ primary: "#f2e6d0", accent: "#e8c547", background: "#8b1018", surface: "#5c0c12", text: "#fff6e8", muted: "#f0d8b8" }),
    heading: "Eater",
    body: "Libre Franklin",
    mood: "A vintage sideshow poster torn off the tent wall: loud crimson, cream type, and a headline you can read from across the midway. Bold, graphic, slightly unhinged.",
    motifs: ["diagonal-cuts", "stamp-badges", "outlined-type"],
  },
  {
    name: "Cabinet of Cravings",
    palette: checked({ primary: "#d4b483", accent: "#9b1b24", background: "#140a0c", surface: "#1e1014", text: "#f6efe8", muted: "#cbb8ae" }),
    heading: "Pirata One",
    body: "Nunito Sans",
    mood: "A dim curiosity cabinet: wet wood, brass, jars on a dark shelf, hungry typography. Intimate and unsettling rather than cheap gore.",
    motifs: ["grain", "thin-rules", "underline-marks"],
  },
];

/** A strong creative-direction block for every AI step. Empty when no theme is clear. */
export function themeDirective(facts: RequestFacts): string {
  const theme = detectTheme(facts);
  if (!theme) return "";
  const gloss = typoGlossFor(facts);
  const typo = gloss.length ? ` Wording note: ${gloss.join("; ")}.` : "";
  return `THEME DIRECTION (explicit, lean all the way in; a misspelling still counts): the owner asked for "${theme.phrase}".${typo} This is a bold horror / sideshow / macabre theme, not a polite modern restaurant. Every look must be unmistakably themed and still clearly different from the other two: dark or blood-red palettes (not airy beige or corporate navy), dripping or carnival display fonts (Creepster, Eater, Nosifer, Pirata One, New Rocker, Griffy; Special Elite for body if it fits), themed hero imagery (jars, carnival tents, footlights, curiosities — still no invented facts), and copy that uses their actual offer (eyeballs, brains, a freak show, whatever they wrote) as the attraction. Do not sanitize it into a generic bistro. Keep text readable (WCAG AA).`;
}

/** The owner's request plus the theme directive (for prompts that take one request string). */
export function withTheme(request: string | undefined, facts: RequestFacts): string {
  const theme = themeDirective(facts);
  return [request ?? "", theme].filter(Boolean).join(" ").slice(0, 1800);
}

function alreadyThemed(d: DesignDirection): boolean {
  const blob = `${d.mood} ${d.imagery ?? ""} ${d.headline ?? ""} ${d.heroSubject ?? ""}`.toLowerCase();
  return /\b(horror|macabre|sideshow|carnival|eyeball|brains?|freak|creepy|scary|scarry|drip|haunt|gore|blood|cabinet|curiosity|unsettling|midnight)\b/.test(blob);
}

/**
 * Nudge the three looks toward the theme when the AI played it too safe
 * (light palettes, polite serifs, generic restaurant mood). Each look gets a
 * different variant so they stay distinct. Skipped when no theme is detected.
 * Palettes and fonts are left alone when the direction already has an era tag
 * (period look wins visually).
 */
export function applyTheme(directions: DesignDirection[], facts: RequestFacts): DesignDirection[] {
  const theme = detectTheme(facts);
  if (!theme || theme.id !== "horror") return directions;
  return directions.map((d, i) => {
    const v = HORROR_VARIANTS[i % 3]!;
    const era = Boolean(d.era);
    const lean = alreadyThemed(d);
    return {
      ...d,
      mood: lean && d.mood ? d.mood : v.mood,
      ...(era
        ? {}
        : {
            palette: { ...v.palette },
            fonts: { heading: v.heading, body: v.body },
            motifs: v.motifs,
            radius: "sharp" as const,
            buttons: i === 1 ? ("outline" as const) : ("square" as const),
          }),
      imagery: d.imagery && lean ? d.imagery : v.mood,
    };
  });
}
