/**
 * Round 15b — hard diversity across the three looks, not just adjectives.
 * Each look is assigned a distinct axis set (base, headline font category, layout,
 * accent hue family, tone of voice). A programmatic check then rewrites the weaker
 * look if two are still too close. Theme-lean (horror) and era palettes/fonts are
 * preserved; only colliding layouts are nudged in those cases.
 */
import { luminance, LOOK_MOODS, readablePalette } from "./design.ts";
import type { Archetype, DesignDirection, SitePalette } from "./types.ts";
import { detectTheme } from "./theme-lean.ts";
import { finalizeBlurb } from "./blurb.ts";
import { IMPROVED_NAME, SUNLIT_NAME } from "./site-brand.ts";

export type FontCategory = "serif-display" | "geometric-sans" | "condensed-display" | "novelty-display";
export type BaseFamily = "light" | "dark" | "saturated";
export type LayoutAxis = "split" | "full-bleed" | "bento" | "big-type" | "edge-bleed" | "site-refresh";
export type HueFamily = "cool" | "warm" | "vivid";

export type DiversitySlot = {
  base: BaseFamily;
  font: FontCategory;
  heading: string;
  body: string;
  layout: LayoutAxis;
  hero: DesignDirection["hero"];
  heroStyle: NonNullable<DesignDirection["heroStyle"]>;
  recipe: NonNullable<DesignDirection["layout"]>;
  hue: HueFamily;
  voice: string;
  palette: SitePalette;
  name: string;
  archetype: Archetype;
};

const SERIF = new Set(["Playfair Display", "Fraunces", "DM Serif Display", "Cormorant Garamond", "Instrument Serif", "Libre Caslon Display", "EB Garamond", "Lora", "Merriweather", "Pirata One"]);
const GEOMETRIC = new Set(["Bricolage Grotesque", "Syne", "Space Grotesk", "Montserrat", "Poppins", "Unbounded", "Work Sans", "Inter", "Archivo", "Fredoka", "Baloo 2"]);
const CONDENSED = new Set(["Archivo Black", "Anton", "Big Shoulders Display", "Oswald"]);
const NOVELTY = new Set(["Creepster", "Eater", "Nosifer", "New Rocker", "Griffy", "Special Elite"]);

export function fontCategory(name: string): FontCategory {
  if (NOVELTY.has(name)) return "novelty-display";
  if (CONDENSED.has(name)) return "condensed-display";
  if (GEOMETRIC.has(name)) return "geometric-sans";
  if (SERIF.has(name)) return "serif-display";
  // Unknown serifs (old-style names) vs default to geometric.
  if (/serif|garamond|caslon|bodoni|didot|times|georgia/i.test(name)) return "serif-display";
  return "geometric-sans";
}

export function baseFamily(palette: SitePalette): BaseFamily {
  const l = luminance(palette.background);
  if (l < 0.28) return "dark";
  const chroma = approxChroma(palette.background) + approxChroma(palette.primary) * 0.5 + approxChroma(palette.surface);
  // A tinted, clearly colorful ground (not cream/off-white or near-white).
  if (l >= 0.28 && l <= 0.92 && approxChroma(palette.background) >= 0.08) return "saturated";
  if (chroma >= 0.22 && l < 0.94 && approxChroma(palette.background) >= 0.05) return "saturated";
  return "light";
}

export function layoutAxis(d: DesignDirection): LayoutAxis {
  if (d.heroStyle === "improved" || d.improved) return "site-refresh";
  if (d.heroStyle === "bleed") return "edge-bleed";
  if (d.hero === "type" || d.heroStyle === "panorama") return "big-type";
  if (d.heroStyle === "collage") return "bento";
  if (d.hero === "photo" || d.heroStyle === "cinematic" || d.heroStyle === "poster") return "full-bleed";
  return "split";
}

function rgbSafe(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  if (h.length < 6 || Number.isNaN(parseInt(h.slice(0, 2), 16))) return [0, 0, 0];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Rough 0–1 chroma (distance from gray). */
function approxChroma(hex: string): number {
  const [r, g, b] = rgbSafe(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / 255;
}

export function hueDeg(hex: string): number {
  const [r0, g0, b0] = rgbSafe(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r0, g0, b0);
  const min = Math.min(r0, g0, b0);
  const d = max - min;
  if (d < 1e-6) return 0;
  let h = 0;
  if (max === r0) h = ((g0 - b0) / d) % 6;
  else if (max === g0) h = (b0 - r0) / d + 2;
  else h = (r0 - g0) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

export function hueDistance(a: string, b: string): number {
  const d = Math.abs(hueDeg(a) - hueDeg(b));
  return Math.min(d, 360 - d);
}

export function paletteDistance(a: SitePalette, b: SitePalette): number {
  const dist = (x: string, y: string) => {
    const [p, q] = [rgbSafe(x), rgbSafe(y)];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 441.67;
  };
  const dl = Math.abs(luminance(a.background) - luminance(b.background));
  return dl * 0.55 + dist(a.background, b.background) * 0.25 + dist(a.accent, b.accent) * 0.2;
}

export function accentHex(p: SitePalette): string {
  return approxChroma(p.accent) >= approxChroma(p.primary) ? p.accent : p.primary;
}

const LIGHT: SitePalette = readablePalette({ primary: "#9a3412", accent: "#c45c26", background: "#f6efe4", surface: "#efe4d4", text: "#1a120c", muted: "#5c4a3d" }, { primary: "#9a3412", accent: "#c45c26", background: "#f6efe4", surface: "#efe4d4", text: "#1a120c", muted: "#5c4a3d" });
const DARK: SitePalette = readablePalette({ primary: "#e8d9c4", accent: "#e8b86d", background: "#12110f", surface: "#1c1a17", text: "#f3efe6", muted: "#b9b5ad" }, { primary: "#e8d9c4", accent: "#e8b86d", background: "#12110f", surface: "#1c1a17", text: "#f3efe6", muted: "#b9b5ad" });
const SATURATED: SitePalette = readablePalette({ primary: "#9f1239", accent: "#1d4ed8", background: "#f97316", surface: "#fb923c", text: "#1c0a06", muted: "#4a1d0e" }, { primary: "#9f1239", accent: "#1d4ed8", background: "#f97316", surface: "#fb923c", text: "#1c0a06", muted: "#4a1d0e" });

/** Creative looks only (cards 2 and 3). Card 1 is “Your Site, Improved” and is exempt. */
export const DARK_PREMIUM_SLOT: DiversitySlot = {
  base: "dark",
  font: "geometric-sans",
  heading: "Space Grotesk",
  body: "Manrope",
  layout: "full-bleed",
  hero: "photo",
  heroStyle: "cinematic",
  recipe: "showcase",
  hue: "warm",
  voice: "Cinematic and confident after dark: deep ground, warm metallic light, photography that glows, short punchy lines.",
  palette: DARK,
  name: "Dark Premium",
  archetype: "dark-premium",
};
export const SUNLIT_CUT_SLOT: DiversitySlot = {
  base: "light",
  font: "serif-display",
  heading: "Fraunces",
  body: "Source Sans 3",
  layout: "edge-bleed",
  hero: "split",
  heroStyle: "bleed",
  recipe: "bold",
  hue: "warm",
  voice: "Sunlit and appetite-first: an oversized photo that spills off the page, a bold color-blocked strip, and a short expressive headline.",
  palette: LIGHT,
  name: SUNLIT_NAME,
  archetype: "editorial",
};
/** Fixed matrix for the two creative cards, in grid order after Improved: Dark Premium, Sunlit Cut. */
export const DIVERSITY_MATRIX: DiversitySlot[] = [DARK_PREMIUM_SLOT, SUNLIT_CUT_SLOT];

export type DiversityIssue = { i: number; j: number; reasons: string[] };

export function isImprovedLookName(d: Pick<DesignDirection, "name" | "improved">): boolean {
  return Boolean(d.improved) || d.name === IMPROVED_NAME;
}

export function diversityIssues(directions: DesignDirection[]): DiversityIssue[] {
  const out: DiversityIssue[] = [];
  for (let i = 0; i < directions.length; i += 1) {
    for (let j = i + 1; j < directions.length; j += 1) {
      const a = directions[i]!;
      const b = directions[j]!;
      const reasons: string[] = [];
      const improvedPair = isImprovedLookName(a) || isImprovedLookName(b);
      const fa = fontCategory(a.fonts.heading);
      const fb = fontCategory(b.fonts.heading);
      if (fa === fb && fa !== "novelty-display") reasons.push(`same heading category ${fa} (${a.fonts.heading} / ${b.fonts.heading})`);
      if (fa === "serif-display" && fb === "serif-display") reasons.push("two serif display headlines");
      const ba = baseFamily(a.palette);
      const bb = baseFamily(b.palette);
      // Improved is exempt from the light/dark/saturated slot, so it may share a dark (or light) base
      // with a creative look — Cafe 501 stays black, Dark Premium stays cinematic dark.
      if (ba === bb && !improvedPair) reasons.push(`same base ${ba}`);
      if (layoutAxis(a) === layoutAxis(b)) reasons.push(`same layout ${layoutAxis(a)}`);
      if (!improvedPair && paletteDistance(a.palette, b.palette) < 0.12) reasons.push(`palettes too close (${paletteDistance(a.palette, b.palette).toFixed(3)})`);
      if (!improvedPair && Math.abs(luminance(a.palette.background) - luminance(b.palette.background)) < 0.12 && ba === bb) reasons.push("background lightness too close");
      const ha = accentHex(a.palette);
      const hb = accentHex(b.palette);
      // A dark-gold accent and a light-terracotta accent can sit near each other on the wheel
      // without looking like the same look; rotating one produced icy/lime swatches (r15c).
      if (!improvedPair && ba === bb && approxChroma(ha) > 0.05 && approxChroma(hb) > 0.05 && hueDistance(ha, hb) < 40) reasons.push(`accent hues too close (${Math.round(hueDistance(ha, hb))}°)`);
      if (reasons.length) out.push({ i, j, reasons });
    }
  }
  return out;
}


export function isCustomLook(d: Pick<DesignDirection, "name" | "custom">): boolean {
  return Boolean(d.custom?.brief) || d.name === "Custom Design";
}

/** Card blurb for Custom Design: the concept, not a leftover slot voice. */
export function customLookMood(brief?: { concept?: string; metaphor?: string; mood?: string }): string {
  const concept = (brief?.concept ?? "").replace(/\s+/g, " ").trim();
  const metaphor = (brief?.metaphor ?? "").replace(/\s+/g, " ").trim();
  if (concept && metaphor) {
    const m = metaphor.charAt(0).toUpperCase() + metaphor.slice(1);
    const ended = /[.!?]$/.test(m) ? m : `${m}.`;
    return `${concept}. ${ended}`;
  }
  if (concept) return concept;
  return (brief?.mood ?? "").replace(/\s+/g, " ").trim() || "Designed from scratch for this business.";
}

function preferredSlot(d: DesignDirection): number | undefined {
  if (isImprovedLookName(d)) return undefined;
  if (d.name === "Dark Premium" || d.archetype === "dark-premium" || d.heroStyle === "cinematic") return 0;
  if (d.name === SUNLIT_NAME || d.heroStyle === "bleed") return 1;
  return undefined;
}

/** Which matrix slot each look should get, honoring existing names/archetypes when they don't collide. */
export function slotOrder(directions: DesignDirection[]): number[] {
  const n = Math.min(directions.length, DIVERSITY_MATRIX.length);
  const assigned = Array.from({ length: n }, () => -1);
  const used = new Set<number>();
  for (let i = 0; i < n; i += 1) {
    const pref = preferredSlot(directions[i]!);
    if (pref != null && pref < n && !used.has(pref)) {
      assigned[i] = pref;
      used.add(pref);
    }
  }
  let nextFree = 0;
  for (let i = 0; i < n; i += 1) {
    if (assigned[i]! >= 0) continue;
    while (used.has(nextFree)) nextFree += 1;
    assigned[i] = nextFree;
    used.add(nextFree);
  }
  return assigned;
}

/** True when a blurb is a leftover style-template voice, not a brief for this business. */
export function isTemplateMood(mood: string | undefined): boolean {
  const t = (mood ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!t) return true;
  if (/not a cream letterhead|do not use|don't use |never use |avoid using/.test(t)) return true;
  const templates = DIVERSITY_MATRIX.map((s) => s.voice.replace(/\s+/g, " ").trim().toLowerCase());
  if (templates.some((v) => t === v || (v.length > 40 && t.includes(v.slice(0, 48))))) return true;
  if (/^cinematic and confident after dark/.test(t)) return true;
  if (/^clear and civic, like a well-made local magazine/.test(t)) return true;
  if (/^bold, graphic, and colorful/.test(t)) return true;
  if (/^sunlit and appetite-first/.test(t)) return true;
  const stock = Object.values(LOOK_MOODS).map((v) => v.replace(/\s+/g, " ").trim().toLowerCase());
  if (stock.some((v) => t === v || (v.length > 30 && t.startsWith(v.slice(0, 36))))) return true;
  return false;
}

export function placeFromFacts(facts?: CardFacts): string {
  const addr = (facts?.address ?? "").replace(/\s+/g, " ").trim();
  const matches = [...addr.matchAll(/([A-Za-z][A-Za-z .']+),\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?/g)];
  const m = matches.at(-1);
  if (!m) return "";
  const raw = m[1]!.trim();
  const city = raw.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})$/)?.[1] ?? raw;
  return `${city}, ${m[2]}`;
}

export function businessWhere(facts?: CardFacts): string {
  const name = (facts?.name ?? "").replace(/\s+/g, " ").trim();
  const place = placeFromFacts(facts);
  const city = place.split(",")[0]?.trim() ?? "";
  if (name && city && !name.toLowerCase().includes(city.toLowerCase())) return `${name} in ${place}`;
  if (name) return name;
  return "this business";
}

function stripInternalPhrases(mood: string): string {
  return mood
    .replace(/\s*[—–-]\s*not a cream letterhead\.?/gi, "")
    .replace(/\bnot a cream letterhead\b[.!]?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,])/g, "$1")
    .trim();
}

function writeSiteSpecificMood(d: DesignDirection, facts: CardFacts | undefined, slot: DiversitySlot): string {
  const who = businessWhere(facts);
  if (slot.name === SUNLIT_NAME || slot.heroStyle === "bleed") {
    return `A sunlit, photo-forward look for ${who} — an oversized picture that spills off the page, a bold color-blocked strip, and a short expressive headline.`;
  }
  switch (slot.archetype) {
    case "editorial":
      return `A clear, civic magazine look for ${who} — confident restraint, generous margins, and a calm, readable page.`;
    case "dark-premium":
      return `A cinematic after-dark look for ${who} — deep ground, warm metallic light, and photography that glows.`;
    case "playful":
      return `A bold, graphic look for ${who} — big type, vivid color, and a clear call to action.`;
    case "minimal-luxury":
      return `A quiet, precise look for ${who} — generous space, soft light, and considered type.`;
    case "bold-photo":
      return `A photo-forward look for ${who} — big pictures, short lines, and a confident headline.`;
    case "warm-craft":
      return `A warm, handmade look for ${who} — tactile type, soft color, and a neighborly voice.`;
    default:
      return `A distinct look for ${who}.`;
  }
}

/**
 * Card blurb from this look's brief for this business — never a leftover
 * style-template voice, and never an internal instruction like “not a cream letterhead”.
 */
export function lookCardDescription(
  d: DesignDirection,
  facts: CardFacts | undefined,
  slot: DiversitySlot,
  before?: { mood?: string; archetype?: string; name?: string },
): string {
  if (isImprovedLookName(d)) {
    const existing = stripInternalPhrases((before?.mood ?? d.mood ?? "").replace(/\s+/g, " ").trim());
    if (existing && !isTemplateMood(existing)) return finalizeBlurb(existing);
    const who = businessWhere(facts);
    return finalizeBlurb(`Your current ${who} look, refreshed: same brand, your best photos up front, and a clear call to action.`);
  }
  if (isCustomLook(d)) {
    const fromBrief = customLookMood(d.custom?.brief);
    if (fromBrief && !isTemplateMood(fromBrief) && fromBrief !== "Designed from scratch for this business.") return stripInternalPhrases(fromBrief);
    const concept = (d.custom?.brief?.concept ?? "").replace(/\s+/g, " ").trim();
    if (concept) return concept;
    return `Designed from scratch for ${businessWhere(facts)}.`;
  }
  const existing = stripInternalPhrases((before?.mood ?? d.mood ?? "").replace(/\s+/g, " ").trim());
  const styleHeld = !before || before.archetype === slot.archetype || before.name === slot.name;
  if (existing && styleHeld && !isTemplateMood(existing) && existing.length >= 40) return existing;
  return writeSiteSpecificMood(d, facts, slot);
}

/** Name, mood, and archetype come from the same final look after diversity. */
export function alignLookIdentity(
  d: DesignDirection,
  slot: DiversitySlot,
  facts?: CardFacts,
  before?: { mood?: string; archetype?: string; name?: string },
): DesignDirection {
  if (isImprovedLookName(d)) return { ...d, name: IMPROVED_NAME, improved: true, custom: undefined, mood: lookCardDescription({ ...d, name: IMPROVED_NAME, improved: true }, facts, slot, before) };
  if (isCustomLook(d)) return { ...d, name: "Custom Design", mood: lookCardDescription(d, facts, slot, before) };
  const next = { ...d, name: slot.name, archetype: slot.archetype };
  return { ...next, mood: lookCardDescription(next, facts, slot, before) };
}

function applySlot(d: DesignDirection, slot: DiversitySlot, opts: { palette: boolean; fonts: boolean; layout: boolean; voice: boolean }): DesignDirection {
  const next: DesignDirection = { ...d };
  if (opts.palette) next.palette = { ...slot.palette };
  if (opts.fonts) next.fonts = { heading: slot.heading, body: slot.body === d.fonts.body && slot.heading === d.fonts.heading ? "Libre Franklin" : slot.body };
  if (opts.layout) {
    next.hero = slot.hero;
    next.heroStyle = slot.heroStyle;
    next.layout = slot.recipe;
  }
  if (opts.voice) next.mood = slot.voice;
  return next;
}

export type CardFacts = { name?: string; tagline?: string; description?: string; about?: string; address?: string; industry?: string; host?: string; services?: string[]; notes?: string; feedback?: string[]; brief?: string };
export type EnforceOpts = { seed?: number; facts?: CardFacts };

/**
 * Assign the three looks to the fixed matrix and rewrite any look that still collides.
 * Returns a new array. Logs nothing; the caller logs `[diversity]`.
 */
export function enforceDiversity(directions: DesignDirection[], facts?: EnforceOpts["facts"], _opts: { seed?: number } = {}): { directions: DesignDirection[]; log: string[] } {
  const log: string[] = [];
  if (directions.length < 2) return { directions, log };
  const theme = facts ? detectTheme(facts) : undefined;
  const eraLocked = directions.some((d) => Boolean(d.era));
  const preserveSkin = theme?.id === "horror" || eraLocked;
  if (preserveSkin) {
    log.push(theme?.id === "horror" ? "theme=horror palettes/fonts preserved" : "era palettes/fonts preserved");
  }

  let next = directions.map((d) => ({ ...d, palette: { ...d.palette }, fonts: { ...d.fonts } }));
  const originals = next.map((d) => ({ mood: d.mood, archetype: d.archetype, name: d.name }));

  // Round 16: Improved (usually index 0) is exempt. The other two always get Dark Premium then Sunlit Cut.
  const improvedAt = next.findIndex((d) => isImprovedLookName(d));
  const creativeIdx = next.map((_, i) => i).filter((i) => i !== improvedAt);
  const creativeSlots = creativeIdx.map((i, n) => [i, DIVERSITY_MATRIX[Math.min(n, DIVERSITY_MATRIX.length - 1)]!] as const);

  for (const [i, slot] of creativeSlots) {
    const d = next[i]!;
    // Always apply the creative slot palette so swatches match the look (no leftover icy blue on Dark Premium).
    const needPalette = !preserveSkin;
    const cat = fontCategory(d.fonts.heading);
    const needFont = !preserveSkin && cat !== slot.font && cat !== "novelty-display";
    const needLayout = layoutAxis(d) !== slot.layout;
    next[i] = applySlot(d, slot, { palette: needPalette, fonts: needFont || needPalette, layout: true, voice: false });
    log.push(`“${next[i]!.name}” assigned ${slot.name} ${slot.base}/${slot.font}/${slot.layout}`);
  }

  let issues = diversityIssues(next);
  for (const issue of issues) {
    if (isImprovedLookName(next[issue.i]!) && !issue.reasons.some((r) => /layout|heading category|serif/.test(r))) {
      // Same-base / close palette with Improved is acceptable; only fix typography/layout on the creative look.
      if (!issue.reasons.some((r) => /layout|heading category|serif/.test(r))) continue;
    }
    if (preserveSkin && issue.reasons.every((r) => /palette|base|accent|heading category|serif display|lightness/i.test(r))) {
      if (!issue.reasons.some((r) => /layout/.test(r))) continue;
    }
    const j = isImprovedLookName(next[issue.j]!) ? issue.i : issue.j;
    if (isImprovedLookName(next[j]!)) continue;
    const slot = creativeSlots.find(([idx]) => idx === j)?.[1] ?? DIVERSITY_MATRIX[Math.min(j, DIVERSITY_MATRIX.length - 1)]!;
    const before = next[j]!;
    const fixLayout = issue.reasons.some((r) => /layout/.test(r));
    const fixSkin = !preserveSkin && issue.reasons.some((r) => /palette|base|accent|heading|serif|lightness/.test(r));
    next[j] = applySlot(before, slot, { palette: fixSkin, fonts: fixSkin, layout: fixLayout || true, voice: false });
    log.push(`“${next[j]!.name}” too close to “${next[issue.i]!.name}” (${issue.reasons.join("; ")}); kept ${slot.name}`);
  }

  issues = diversityIssues(next).filter((iss) => !(preserveSkin && iss.reasons.every((r) => !/layout/.test(r))));
  if (issues.length && !preserveSkin) {
    next = next.map((d, i) => {
      if (isImprovedLookName(d)) return d;
      // Never bleach a creative look's ground just because Improved shares a dark (or light) brand.
      const peers = next.filter((x, k) => k < i && !isImprovedLookName(x));
      return peers.length ? nudgeAwayFrom(d, peers) : d;
    });
    issues = diversityIssues(next);
    if (issues.length) log.push(`nudged palettes; remaining: ${issues.map((iss) => iss.reasons.join(", ")).join(" | ")}`);
  }
  const bases = next.map((d) => baseFamily(d.palette)).join("/");
  const fonts = next.map((d) => fontCategory(d.fonts.heading)).join("/");
  const layouts = next.map((d) => layoutAxis(d)).join("/");
  const minP = minPair(next, (a, b) => paletteDistance(a.palette, b.palette));
  const minH = minPair(next, (a, b) => hueDistance(accentHex(a.palette), accentHex(b.palette)));
  log.push(`${issues.length ? "remaining issues" : "ok"}: bases ${bases}, fonts ${fonts}, layouts ${layouts}, min palette Δ=${minP.toFixed(3)}, min hue Δ=${Math.round(minH)}`);
  next = next.map((d, i) => {
    if (isImprovedLookName(d)) return alignLookIdentity(d, DARK_PREMIUM_SLOT, facts, originals[i]);
    const slot = creativeSlots.find(([idx]) => idx === i)?.[1] ?? DIVERSITY_MATRIX[0]!;
    if (preserveSkin) return { ...d, name: slot.name, mood: lookCardDescription({ ...d, name: slot.name }, facts, slot, originals[i]) };
    return alignLookIdentity(d, slot, facts, originals[i]);
  });
  log.push(`identity: ${next.map((d) => `“${d.name}” ${d.archetype}`).join(" · ")}`);
  return { directions: next, log };
}

function mixRgb(a: string, b: string, t: number): string {
  const x = rgbSafe(a);
  const y = rgbSafe(b);
  return `#${x.map((c, i) => Math.round(c + (y[i]! - c) * t).toString(16).padStart(2, "0")).join("")}`;
}

function nudgeAwayFrom(d: DesignDirection, earlier: DesignDirection[]): DesignDirection {
  let p = { ...d.palette };
  for (const o of earlier) {
    if (isImprovedLookName(o)) continue;
    const sameBase = baseFamily(p) === baseFamily(o.palette);
    if (sameBase && paletteDistance(p, o.palette) < 0.14) {
      const toward = luminance(o.palette.background) > 0.5 ? "#7c2d12" : "#ffedd5";
      p = readablePalette({ ...p, background: mixRgb(p.background, toward, 0.45), surface: mixRgb(p.surface, toward, 0.35) }, p);
    }
    const ha = accentHex(p);
    const hb = accentHex(o.palette);
    if (sameBase && approxChroma(ha) > 0.05 && approxChroma(hb) > 0.05 && hueDistance(ha, hb) < 45) {
      const h = (hueDeg(ha) + 90) % 360;
      p = readablePalette({ ...p, accent: hslToHex(h, 0.7, luminance(p.background) < 0.3 ? 0.62 : 0.42) }, p);
    }
  }
  return { ...d, palette: p };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function paletteTooCloseToEarlier(dirs: DesignDirection[], i: number): boolean {
  const d = dirs[i]!;
  return dirs.slice(0, i).some((o) => paletteDistance(o.palette, d.palette) < 0.12 || baseFamily(o.palette) === baseFamily(d.palette));
}

function minPair(dirs: DesignDirection[], fn: (a: DesignDirection, b: DesignDirection) => number): number {
  let min = Infinity;
  for (let i = 0; i < dirs.length; i += 1) {
    for (let j = i + 1; j < dirs.length; j += 1) min = Math.min(min, fn(dirs[i]!, dirs[j]!));
  }
  return Number.isFinite(min) ? min : 0;
}

/** Keep a Custom Design brief's typography and palette in sync after diversity is enforced. */
export function syncCustomBrief(d: DesignDirection): DesignDirection {
  if (!d.custom?.brief) return d;
  const brief = d.custom.brief;
  return {
    ...d,
    name: "Custom Design",
    mood: customLookMood(brief),
    custom: {
      ...d.custom,
      brief: {
        ...brief,
        palette: d.palette,
        typography: { ...brief.typography, heading: d.fonts.heading, body: d.fonts.body },
      },
    },
  };
}

/** 0–100, 100 = clearly distinct from every sibling. Neutral 80 when there are no siblings. */
export function distinctnessScore(design: DesignDirection, siblings?: DesignDirection[]): number {
  if (!siblings?.length) return 80;
  let score = 100;
  for (const s of siblings) {
    const fa = fontCategory(design.fonts.heading);
    const fb = fontCategory(s.fonts.heading);
    if (fa === fb && fa !== "novelty-display") score -= 22;
    if (baseFamily(design.palette) === baseFamily(s.palette)) score -= 28;
    if (layoutAxis(design) === layoutAxis(s)) score -= 18;
    if (paletteDistance(design.palette, s.palette) < 0.12) score -= 18;
  }
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}
