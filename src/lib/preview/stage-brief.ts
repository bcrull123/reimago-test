/**
 * Round 15 — compact art-direction brief handed to later specialist steps.
 * Built from the existing direction (theme-lean, era-style, look-variety) so
 * mock mode and already-planned looks still get a structured brief.
 */
import { typoGlossFor, detectTheme } from "./theme-lean.ts";
import type { DesignDirection, SitePalette } from "./types.ts";

export type ArtDirectionBrief = {
  name: string;
  mood: string;
  archetype: DesignDirection["archetype"];
  layout?: DesignDirection["layout"];
  heroStyle?: DesignDirection["heroStyle"];
  palette: SitePalette;
  fonts: { heading: string; body: string };
  motifs: DesignDirection["motifs"];
  radius: DesignDirection["radius"];
  buttons: DesignDirection["buttons"];
  hero: DesignDirection["hero"];
  header: DesignDirection["header"];
  footer: DesignDirection["footer"];
  imagery: string;
  heroSubject: string;
  headline: string;
  era?: DesignDirection["era"];
  theme?: string;
  styleWords?: string[];
  differsHow?: string;
};

export type BriefFacts = {
  notes?: string;
  feedback?: string[];
  description?: string;
  name?: string;
  tagline?: string;
  brief?: string;
  about?: string;
};

/** Stable key order so the same brief serializes the same way for prompt caching. */
export function briefFromDirection(d: DesignDirection, facts?: BriefFacts, differsHow?: string): ArtDirectionBrief {
  const theme = facts ? detectTheme(facts) : undefined;
  const gloss = facts ? typoGlossFor(facts) : [];
  const styleWords = gloss.map((g) => g.replace(/^"([^"]+)" is read as "([^"]+)"$/, "$1→$2")).filter(Boolean);
  return {
    name: d.name,
    mood: d.mood,
    archetype: d.archetype,
    layout: d.layout,
    heroStyle: d.heroStyle,
    palette: { ...d.palette },
    fonts: { heading: d.fonts.heading, body: d.fonts.body },
    motifs: [...d.motifs],
    radius: d.radius,
    buttons: d.buttons,
    hero: d.hero,
    header: d.header,
    footer: d.footer,
    imagery: d.imagery,
    heroSubject: d.heroSubject,
    headline: d.headline,
    ...(d.era ? { era: d.era } : {}),
    ...(theme ? { theme: theme.id } : {}),
    ...(styleWords.length ? { styleWords } : {}),
    ...(differsHow ? { differsHow } : {}),
  };
}

export function briefJson(brief: ArtDirectionBrief): string {
  return JSON.stringify(brief);
}

export function differsHowFor(directions: DesignDirection[], index: number): string {
  const names = directions.map((d, i) => (i === index ? null : `“${d.name}” (${d.archetype}/${d.heroStyle ?? d.hero})`)).filter(Boolean);
  return names.length ? `Must stay visually distinct from ${names.join(" and ")}.` : "";
}
