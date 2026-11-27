/**
 * Round 15 — scored QA for a built look. Pure (no I/O) so node tests can run it.
 * Dimensions: hierarchy, type scale, spacing, contrast, style match, mobile, blandness.
 * Higher is better (0–100). blandness is inverted: 100 means not bland.
 */
import { contrast } from "./design.ts";
import { detectTheme, type ThemeId } from "./theme-lean.ts";
import type { DesignDirection, Section, SitePalette } from "./types.ts";

export const QA_DIMENSIONS = ["hierarchy", "typeScale", "spacing", "contrast", "styleMatch", "mobile", "blandness"] as const;
export type QaDimension = (typeof QA_DIMENSIONS)[number];

export type QaScores = { [K in QaDimension]: number } & { total: number };

export type QaReport = {
  rounds: number;
  mode: "vision" | "html" | "structural" | "skipped";
  scores: QaScores;
  kept: "latest" | "best-previous";
  ms: number;
  misses: string[];
};

const BLAND = /\b(welcome to|we are proud|one-stop shop|your trusted|quality (you can|you deserve)|we care about|look no further|serving the community)\b/i;

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function avg(parts: number[]): number {
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
}

function heroHeading(sections: Section[]): string {
  const hero = sections.find((s) => s.type.startsWith("hero-") || s.type === "page-hero");
  return (hero?.heading ?? "").replace(/\s+/g, " ").trim();
}

function allText(sections: Section[]): string {
  return sections
    .map((s) => [s.eyebrow, s.heading, s.text, s.cta?.label, s.secondary?.label, ...(s.items ?? []).flatMap((i) => [i.title, i.text])])
    .flat()
    .filter(Boolean)
    .join("\n");
}

function hasCta(sections: Section[]): boolean {
  if (sections.some((s) => s.type === "cta-band" || s.type === "contact-block")) return true;
  return sections.some((s) => Boolean(s.cta?.label?.trim()));
}

export function emptyScores(): QaScores {
  return { hierarchy: 0, typeScale: 0, spacing: 0, contrast: 0, styleMatch: 0, mobile: 0, blandness: 0, total: 0 };
}

export function withTotal(s: Omit<QaScores, "total">): QaScores {
  const total = clamp(avg(QA_DIMENSIONS.map((k) => s[k])));
  return { ...s, total };
}

/** Heuristic scores from the brief + sections (and palette contrast). Always available, including mock mode. */
export function structuralScore(input: {
  design: DesignDirection;
  sections: Section[];
  facts?: { notes?: string; feedback?: string[]; description?: string; name?: string; tagline?: string; brief?: string; about?: string };
}): QaScores {
  const { design, sections, facts } = input;
  const p: SitePalette = design.palette;
  const heading = heroHeading(sections);
  const text = allText(sections);
  const count = sections.length;

  const hierarchy = clamp(
    (heading.length >= 8 && heading.length <= 90 ? 70 : 35) +
      (heading && !/^(welcome|home|our story)$/i.test(heading) ? 15 : 0) +
      (sections[0]?.type.startsWith("hero-") ? 15 : 0),
  );

  const typeScale = clamp(design.fonts.heading && design.fonts.body && design.fonts.heading !== design.fonts.body ? 90 : 45);

  const spacing = clamp((count >= 5 && count <= 8 ? 70 : count >= 3 ? 50 : 30) + (design.radius ? 15 : 0) + (design.layout ? 10 : 0));

  let contrastScore = 50;
  try {
    const textC = contrast(p.text, p.background);
    const mutedC = contrast(p.muted, p.background);
    contrastScore = clamp(40 + Math.min(textC, 7) * 6 + (mutedC >= 4.5 ? 15 : 0));
  } catch {
    contrastScore = 40;
  }

  const theme = facts ? detectTheme(facts) : undefined;
  const styleMatch = styleMatchScore(design, theme?.id, p);

  const mobile = clamp((hasCta(sections) ? 50 : 20) + (heading.length > 0 && heading.length <= 70 ? 30 : 10) + (count <= 9 ? 20 : 0));

  const blandHits = text.match(new RegExp(BLAND.source, "gi"))?.length ?? 0;
  const blandness = clamp(90 - blandHits * 22 + (heading.length >= 12 ? 10 : 0));

  return withTotal({ hierarchy, typeScale, spacing, contrast: contrastScore, styleMatch, mobile, blandness });
}

function styleMatchScore(design: DesignDirection, theme: ThemeId | undefined, p: SitePalette): number {
  if (theme === "horror") {
    const dark = luminanceApprox(p.background) < 0.35;
    const themedFont = /creepster|eater|nosifer|pirata|new rocker|griffy|special elite/i.test(design.fonts.heading);
    const mood = /horror|macabre|sideshow|carnival|unsettling|midnight|cabinet/i.test(`${design.mood} ${design.imagery}`);
    return clamp((dark ? 40 : 10) + (themedFont ? 35 : 5) + (mood ? 25 : 5));
  }
  // No strong theme: a normal bakery/plumber look should not be forced dark or novelty.
  const novelty = /creepster|eater|nosifer/i.test(design.fonts.heading);
  return clamp(novelty ? 40 : 82);
}

function luminanceApprox(hex: string): number {
  const h = hex.replace("#", "");
  if (h.length < 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function parseAiScores(raw: unknown): Partial<QaScores> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const out: Partial<QaScores> = {};
  for (const k of QA_DIMENSIONS) {
    const n = Number(o[k]);
    if (Number.isFinite(n)) out[k] = clamp(n);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Prefer the model's scores when present, blended with the structural check so a wild model can't hide a WCAG miss. */
export function mergeScores(structural: QaScores, ai?: Partial<QaScores>): QaScores {
  if (!ai) return structural;
  const merged = { ...emptyScores() };
  for (const k of QA_DIMENSIONS) {
    const a = ai[k];
    merged[k] = typeof a === "number" ? clamp(a * 0.7 + structural[k] * 0.3) : structural[k];
  }
  return withTotal(merged);
}

export function isBetter(next: QaScores, prev: QaScores): boolean {
  if (next.total !== prev.total) return next.total > prev.total;
  return next.contrast + next.styleMatch + next.hierarchy >= prev.contrast + prev.styleMatch + prev.hierarchy;
}

const GENERIC_MISS: [RegExp, string][] = [
  [/welcome to our/i, "headline is generic"],
  [/one-stop shop/i, "copy is bland"],
];

export function structuralMisses(input: { design: DesignDirection; sections: Section[]; scores: QaScores }): string[] {
  const misses: string[] = [];
  const { design, sections, scores } = input;
  if (scores.contrast < 60) misses.push("text contrast against the background is weak");
  if (scores.hierarchy < 55) misses.push("hero headline is weak or missing");
  if (!sections.some((s) => s.type === "cta-band") && scores.mobile < 60) misses.push("no clear closing call to action");
  if (scores.blandness < 55) misses.push("copy leans on generic phrases");
  if (scores.styleMatch < 50) misses.push("look does not match the requested theme or style words");
  if (design.fonts.heading === design.fonts.body) misses.push("heading and body use the same font");
  const text = allText(sections);
  for (const [re, label] of GENERIC_MISS) if (re.test(text)) misses.push(label);
  return [...new Set(misses)].slice(0, 6);
}

export function qaRoundsDefault(): number {
  return 2;
}
