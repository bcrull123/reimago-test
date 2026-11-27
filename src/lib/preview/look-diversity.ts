/**
 * Round 15b — hard diversity across the three looks, not just adjectives.
 * Each look is assigned a distinct axis set (base, headline font category, layout,
 * accent hue family, tone of voice). A programmatic check then rewrites the weaker
 * look if two are still too close. Theme-lean (horror) and era palettes/fonts are
 * preserved; only colliding layouts are nudged in those cases.
 */
import { luminance, readablePalette } from "./design.ts";
import type { DesignDirection, SitePalette } from "./types.ts";
import { detectTheme } from "./theme-lean.ts";

export type FontCategory = "serif-display" | "geometric-sans" | "condensed-display" | "novelty-display";
export type BaseFamily = "light" | "dark" | "saturated";
export type LayoutAxis = "split" | "full-bleed" | "bento" | "big-type";
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

const LIGHT: SitePalette = readablePalette({ primary: "#1b365d", accent: "#0f7a6b", background: "#f7f4ee", surface: "#efe8dc", text: "#16181d", muted: "#4f5661" }, { primary: "#1b365d", accent: "#0f7a6b", background: "#f7f4ee", surface: "#efe8dc", text: "#16181d", muted: "#4f5661" });
const DARK: SitePalette = readablePalette({ primary: "#8cb4ff", accent: "#e8b86d", background: "#0e1628", surface: "#182234", text: "#f3efe6", muted: "#b9b5ad" }, { primary: "#8cb4ff", accent: "#e8b86d", background: "#0e1628", surface: "#182234", text: "#f3efe6", muted: "#b9b5ad" });
const SATURATED: SitePalette = readablePalette({ primary: "#9f1239", accent: "#1d4ed8", background: "#f97316", surface: "#fb923c", text: "#1c0a06", muted: "#4a1d0e" }, { primary: "#9f1239", accent: "#1d4ed8", background: "#f97316", surface: "#fb923c", text: "#1c0a06", muted: "#4a1d0e" });

/** Fixed matrix for the three cards: light+serif+split, dark+geometric+full-bleed, saturated+condensed+bento. */
export const DIVERSITY_MATRIX: DiversitySlot[] = [
  {
    base: "light",
    font: "serif-display",
    heading: "Playfair Display",
    body: "Source Sans 3",
    layout: "split",
    hero: "split",
    heroStyle: "caption",
    recipe: "editorial",
    hue: "cool",
    voice: "Clear and civic, like a well-made local magazine: confident restraint, generous margins, no filler slogans.",
    palette: LIGHT,
  },
  {
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
  },
  {
    base: "saturated",
    font: "condensed-display",
    heading: "Oswald",
    body: "Work Sans",
    layout: "bento",
    hero: "split",
    heroStyle: "collage",
    recipe: "bold",
    hue: "vivid",
    voice: "Bold, graphic, and colorful — not a cream letterhead. Direct and neighborly, with big type and a loud, clear call to action.",
    palette: SATURATED,
  },
];

export type DiversityIssue = { i: number; j: number; reasons: string[] };

export function diversityIssues(directions: DesignDirection[]): DiversityIssue[] {
  const out: DiversityIssue[] = [];
  for (let i = 0; i < directions.length; i += 1) {
    for (let j = i + 1; j < directions.length; j += 1) {
      const a = directions[i]!;
      const b = directions[j]!;
      const reasons: string[] = [];
      const fa = fontCategory(a.fonts.heading);
      const fb = fontCategory(b.fonts.heading);
      if (fa === fb && fa !== "novelty-display") reasons.push(`same heading category ${fa} (${a.fonts.heading} / ${b.fonts.heading})`);
      if (fa === "serif-display" && fb === "serif-display") reasons.push("two serif display headlines");
      const ba = baseFamily(a.palette);
      const bb = baseFamily(b.palette);
      if (ba === bb) reasons.push(`same base ${ba}`);
      if (layoutAxis(a) === layoutAxis(b)) reasons.push(`same layout ${layoutAxis(a)}`);
      if (paletteDistance(a.palette, b.palette) < 0.12) reasons.push(`palettes too close (${paletteDistance(a.palette, b.palette).toFixed(3)})`);
      if (Math.abs(luminance(a.palette.background) - luminance(b.palette.background)) < 0.12 && ba === bb) reasons.push("background lightness too close");
      const ha = accentHex(a.palette);
      const hb = accentHex(b.palette);
      if (approxChroma(ha) > 0.05 && approxChroma(hb) > 0.05 && hueDistance(ha, hb) < 40) reasons.push(`accent hues too close (${Math.round(hueDistance(ha, hb))}°)`);
      if (reasons.length) out.push({ i, j, reasons });
    }
  }
  return out;
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

export type EnforceOpts = { seed?: number; facts?: { notes?: string; feedback?: string[]; description?: string; name?: string; tagline?: string; brief?: string; about?: string } };

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

  // First assignment: each index gets its matrix slot (light / dark / saturated).
  for (let i = 0; i < Math.min(next.length, DIVERSITY_MATRIX.length); i += 1) {
    const slot = DIVERSITY_MATRIX[i]!;
    const d = next[i]!;
    const needPalette = !preserveSkin && baseFamily(d.palette) !== slot.base;
    const cat = fontCategory(d.fonts.heading);
    const needFont = !preserveSkin && cat !== slot.font && cat !== "novelty-display";
    const needLayout = layoutAxis(d) !== slot.layout;
    const needVoice = !preserveSkin && (!d.mood || d.mood === next[(i + 1) % next.length]?.mood);
    if (needPalette || needFont || needLayout || needVoice) {
      next[i] = applySlot(d, slot, { palette: needPalette || (!preserveSkin && paletteTooCloseToEarlier(next, i)), fonts: needFont, layout: needLayout, voice: needVoice || !preserveSkin });
      const applied: string[] = [];
      if (needPalette || (!preserveSkin && baseFamily(next[i]!.palette) === slot.base && baseFamily(d.palette) !== slot.base)) applied.push(`base=${slot.base}`);
      if (needFont) applied.push(`font=${slot.heading} (${slot.font})`);
      if (needLayout) applied.push(`layout=${slot.layout}/${slot.heroStyle}`);
      if (needVoice || !preserveSkin) applied.push("voice");
      if (applied.length) log.push(`“${next[i]!.name}” assigned ${applied.join(", ")}`);
    }
  }

  // Second pass: if anything still collides, rewrite the later look.
  let issues = diversityIssues(next);
  for (const issue of issues) {
    if (preserveSkin && issue.reasons.every((r) => /palette|base|accent|heading category|serif display|lightness/i.test(r))) {
      // Only layout collisions are auto-fixed when theme/era owns the skin.
      if (!issue.reasons.some((r) => /layout/.test(r))) continue;
    }
    const j = issue.j;
    const slot = DIVERSITY_MATRIX[Math.min(j, DIVERSITY_MATRIX.length - 1)]!;
    const before = next[j]!;
    const fixLayout = issue.reasons.some((r) => /layout/.test(r));
    const fixSkin = !preserveSkin && issue.reasons.some((r) => /palette|base|accent|heading|serif|lightness/.test(r));
    next[j] = applySlot(before, slot, { palette: fixSkin, fonts: fixSkin, layout: fixLayout, voice: fixSkin });
    log.push(`“${next[j]!.name}” too close to “${next[issue.i]!.name}” (${issue.reasons.join("; ")}); regenerated to ${slot.base}/${slot.font}/${slot.layout}`);
  }

  issues = diversityIssues(next).filter((iss) => !(preserveSkin && iss.reasons.every((r) => !/layout/.test(r))));
  if (issues.length && !preserveSkin) {
    next = next.map((d, i) => (i === 0 ? d : nudgeAwayFrom(d, next.slice(0, i))));
    issues = diversityIssues(next);
    if (issues.length) log.push(`nudged palettes; remaining: ${issues.map((iss) => iss.reasons.join(", ")).join(" | ")}`);
  }
  const bases = next.map((d) => baseFamily(d.palette)).join("/");
  const fonts = next.map((d) => fontCategory(d.fonts.heading)).join("/");
  const layouts = next.map((d) => layoutAxis(d)).join("/");
  const minP = minPair(next, (a, b) => paletteDistance(a.palette, b.palette));
  const minH = minPair(next, (a, b) => hueDistance(accentHex(a.palette), accentHex(b.palette)));
  log.push(`${issues.length ? "remaining issues" : "ok"}: bases ${bases}, fonts ${fonts}, layouts ${layouts}, min palette Δ=${minP.toFixed(3)}, min hue Δ=${Math.round(minH)}`);
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
    if (paletteDistance(p, o.palette) < 0.14) {
      // Push the background further from the earlier look (toward black or a vivid accent).
      const toward = luminance(o.palette.background) > 0.5 ? "#7c2d12" : "#ffedd5";
      p = readablePalette({ ...p, background: mixRgb(p.background, toward, 0.45), surface: mixRgb(p.surface, toward, 0.35) }, p);
    }
    const ha = accentHex(p);
    const hb = accentHex(o.palette);
    if (approxChroma(ha) > 0.05 && approxChroma(hb) > 0.05 && hueDistance(ha, hb) < 45) {
      // Rotate the accent ~90° in HSL.
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
    custom: {
      ...d.custom,
      brief: {
        ...brief,
        palette: d.palette,
        typography: { ...brief.typography, heading: d.fonts.heading, body: d.fonts.body },
        mood: d.mood || brief.mood,
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
