/**
 * Keeping the three looks visibly different (Bob: "these are all the same other than the wording").
 *
 * Each look gets its own hero treatment, header, button shape, footer and section order:
 * - caption   (editorial / minimal): split hero, text on a light panel, photo right with a caption; solid header bar;
 * - cinematic (dark premium):        full-bleed photo, strong side overlay, low focal point; transparent header;
 * - collage   (playful / bold):      color-block hero, photo in a tilted rounded frame (duotone), big stamp, a second
 *                                     photo tile; centered-logo header.
 * Below the fold each look has its own recipe (section order and section variants). `lookSignature` +
 * `similarities` check two looks; `diversifyDirections` re-rolls the options until no two looks share them.
 */
import type { Archetype, DesignDirection, Section, SectionType } from "./types.ts";

export const HERO_STYLES = ["caption", "cinematic", "collage", "poster", "panorama", "framed"] as const;
export type HeroStyle = (typeof HERO_STYLES)[number];
export type LayoutRecipe = "editorial" | "showcase" | "bold";

/**
 * Hero treatments each archetype can wear, most natural first. Any of the first four may be picked (seeded per
 * run), so an editorial look is not always the captioned split and a dark look is not always full-bleed.
 *   poster    full-bleed photo, centered giant headline at the bottom (light top, dark foot)
 *   panorama  big type first, then a wide panoramic photo strip under it
 *   framed    photo large on the left, the copy on a card overlapping its edge
 */
const PREFERRED: Record<Archetype, HeroStyle[]> = {
  editorial: ["caption", "panorama", "framed", "poster", "collage", "cinematic"],
  "dark-premium": ["cinematic", "poster", "framed", "panorama", "caption", "collage"],
  playful: ["collage", "framed", "poster", "panorama", "caption", "cinematic"],
  "warm-craft": ["framed", "collage", "caption", "panorama", "poster", "cinematic"],
  "bold-photo": ["poster", "cinematic", "collage", "panorama", "framed", "caption"],
  "minimal-luxury": ["panorama", "caption", "cinematic", "framed", "poster", "collage"],
};
const CLASSIC: HeroStyle[] = ["caption", "cinematic", "collage"];
const PRIORITY: Archetype[] = ["editorial", "dark-premium", "playful", "warm-craft", "bold-photo", "minimal-luxury"];

/** What each hero treatment means for the rest of the look. */
export const STYLE_PLAN: Record<HeroStyle, { hero: DesignDirection["hero"]; header: DesignDirection["header"]; layout: LayoutRecipe; buttons: DesignDirection["buttons"]; footer: DesignDirection["footer"] }> = {
  caption: { hero: "split", header: "light", layout: "editorial", buttons: "square", footer: "columns" },
  cinematic: { hero: "photo", header: "overlay", layout: "showcase", buttons: "outline", footer: "minimal" },
  collage: { hero: "split", header: "center", layout: "bold", buttons: "pill", footer: "statement" },
  poster: { hero: "photo", header: "overlay", layout: "bold", buttons: "pill", footer: "statement" },
  panorama: { hero: "type", header: "light", layout: "showcase", buttons: "square", footer: "columns" },
  framed: { hero: "split", header: "dark", layout: "editorial", buttons: "outline", footer: "minimal" },
};

function pickFree<T>(preferred: T, options: readonly T[], used: Set<T>): T {
  if (!used.has(preferred)) return preferred;
  return options.find((o) => !used.has(o)) ?? preferred;
}

/** Small deterministic PRNG (mulberry32) so a run's choices can be reproduced from its seed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Give every look a different hero treatment, header, button shape, footer and section recipe.
 * `seed` varies the choice per run (so two runs of the same site don't get the same three layouts); `avoid` are
 * the hero treatments of the previous round, used again only when nothing else fits.
 */
export function diversifyDirections(directions: DesignDirection[], seed = 0, avoid: HeroStyle[] = []): DesignDirection[] {
  const rand = seeded(seed);
  const styles = new Set<HeroStyle>();
  const chosen: HeroStyle[] = [];
  const avoided = new Set(avoid);
  // A style the AI art director asked for counts first (unless the previous round used it); then archetypes in
  // priority order take a free treatment from their natural ones, chosen at random among the first four.
  const order = directions
    .map((d, i) => i)
    .sort((x, y) => Number(!directions[y]!.heroStyle) - Number(!directions[x]!.heroStyle) || PRIORITY.indexOf(directions[x]!.archetype) - PRIORITY.indexOf(directions[y]!.archetype));
  for (const i of order) {
    const d = directions[i]!;
    const all = PREFERRED[d.archetype] ?? [...HERO_STYLES];
    // Unseeded (tests, fixed fallbacks): the three classic treatments first, as before.
    const natural = seed ? all : [...all.filter((x) => CLASSIC.includes(x)), ...all.filter((x) => !CLASSIC.includes(x))];
    // With a seed (every real round), the art director's pick is just one of the candidates: the AI tends to give
    // each archetype the same hero every time (editorial -> caption, dark -> cinematic, playful -> collage).
    const top = seed ? [...new Set([...(d.heroStyle ? [d.heroStyle] : []), ...natural.slice(0, 4)])] : natural.slice(0, 4);
    const shuffled = seed ? top.map((v) => ({ v, r: rand() })).sort((a, b) => a.r - b.r).map((x) => x.v) : top;
    const wants = [...(!seed && d.heroStyle && !avoided.has(d.heroStyle) ? [d.heroStyle] : []), ...shuffled.filter((w) => !avoided.has(w)), ...natural.filter((w) => !avoided.has(w)), ...natural];
    const style = wants.find((w) => !styles.has(w)) ?? HERO_STYLES.find((w) => !styles.has(w)) ?? "caption";
    styles.add(style);
    chosen[i] = style;
  }
  const buttons = new Set<DesignDirection["buttons"]>();
  const headers = new Set<DesignDirection["header"]>();
  const footers = new Set<DesignDirection["footer"]>();
  const layouts = new Set<LayoutRecipe>();
  return directions.map((d, i) => {
    const style = chosen[i]!;
    const plan = STYLE_PLAN[style];
    const layout = pickFree(plan.layout, ["editorial", "showcase", "bold"] as const, layouts);
    layouts.add(layout);
    const b = pickFree(plan.buttons, ["square", "outline", "pill"] as const, buttons);
    const h = pickFree(plan.header, ["light", "overlay", "center", "dark"] as const, headers);
    const f = pickFree(plan.footer, ["columns", "minimal", "statement"] as const, footers);
    buttons.add(b);
    headers.add(h);
    footers.add(f);
    const motifs = style === "collage" && !d.motifs.includes("stamp-badges") ? [...d.motifs.slice(0, 2), "stamp-badges" as const] : style === "caption" ? d.motifs.filter((m) => m !== "stamp-badges") : d.motifs;
    return { ...d, heroStyle: style, layout, hero: plan.hero, header: h, buttons: b, footer: f, motifs };
  });
}

// ---------------------------------------------------------------- sections

/** Below-the-fold order per recipe (types not listed keep their relative order at the end). */
const ORDER: Record<LayoutRecipe, SectionType[]> = {
  editorial: ["statement", "services-grid", "feature-split", "process", "reviews", "faq", "gallery", "stat-bar", "marquee", "before-after"],
  showcase: ["stat-bar", "gallery", "feature-split", "services-grid", "reviews", "statement", "process", "faq", "marquee", "before-after"],
  bold: ["marquee", "services-grid", "process", "gallery", "feature-split", "reviews", "stat-bar", "statement", "faq", "before-after"],
};
/** Service card style per recipe: editorial list, showcase photo cards (or a bento of up to 5), bold icon tiles. */
const GRID: Record<LayoutRecipe, string> = { editorial: "list", showcase: "images", bold: "icons" };

/** Which of the found photos of the requested scene a look shows: the best one goes full-bleed (cinematic). */
export function photoRank(_design: DesignDirection, index: number): number {
  // The look's position (0..2): always different across the three looks, whatever treatments they got.
  return index;
}

/** Hero treatment + section order + section variants for one look. Uses only what is already on the page (no new copy or facts). */
export function arrangeSections(sections: Section[], design: DesignDirection, available: string[], services: string[] = [], cutout = false): Section[] {
  const style = design.heroStyle;
  const recipe = design.layout;
  if (!style || !recipe || !sections.length) return sections;
  const out = sections.map((s) => ({ ...s }));
  const first = out[0]!;
  const photos = available.filter((n) => n.startsWith("photo-") || n === "feature");
  if (first.type.startsWith("hero-")) {
    const image = first.image && available.includes(first.image) ? first.image : undefined;
    if (!image) {
      // No photo for the hero: the typographic hero, still shaped per look.
      out[0] = { ...first, type: "hero-type", variant: style === "panorama" ? "plain" : style, tone: style === "cinematic" || style === "poster" ? "dark" : style === "collage" ? "brand" : "tint" };
    } else if (cutout) {
      // Kept illustration / transparent art: shown whole on a color panel in every treatment (a full-bleed crop
      // or a duotone would ruin a drawing). Cinematic: dark stage with a glow; caption: light panel; collage: brand.
      const cut = style === "poster" ? "cinematic" : style === "panorama" || style === "framed" ? "caption" : style;
      const tone = cut === "cinematic" ? "dark" : cut === "collage" ? "brand" : "light";
      out[0] = { ...first, type: "hero-split", variant: cut, tone, fit: "cutout", reverse: false, items: cut === "collage" ? [] : first.items };
    } else if (style === "cinematic" || style === "poster") {
      out[0] = { ...first, type: "hero-photo", variant: style, tone: "dark" };
    } else if (style === "panorama") {
      out[0] = { ...first, type: "hero-type", variant: "panorama", tone: "light", image };
    } else if (style === "framed") {
      out[0] = { ...first, type: "hero-split", variant: "framed", tone: "tint", reverse: false };
    } else if (style === "caption") {
      out[0] = { ...first, type: "hero-split", variant: "caption", tone: "light", reverse: false };
    } else {
      const second = photos.find((p) => p !== image);
      out[0] = { ...first, type: "hero-split", variant: "collage", tone: "brand", items: second ? [{ title: "", text: "", image: second }] : first.items };
    }
  }
  const last = out.length > 1 && out.at(-1)!.type === "cta-band" ? out.pop()! : undefined;
  const head = out.shift()!;
  const rank = (t: SectionType) => {
    const i = ORDER[recipe].indexOf(t);
    return i < 0 ? 99 : i;
  };
  let middle = out.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s.type) - rank(b.s.type) || a.i - b.i).map((x) => x.s);
  middle = middle.map((s) => {
    if (s.type === "services-grid") {
      const withImages = (s.items ?? []).filter((it) => it.image && available.includes(it.image)).length;
      const variant = GRID[recipe];
      // Without photos for most cards, the showcase look uses a bento grid (homepage shows 5; the services page has all).
      if (variant === "images" && withImages * 2 < (s.items?.length ?? 0)) return { ...s, variant: "bento", items: s.items?.slice(0, 5) };
      return { ...s, variant };
    }
    if (s.type === "feature-split") return { ...s, reverse: recipe === "bold" ? true : recipe === "showcase" ? false : s.reverse };
    return s;
  });
  // Section types that make the difference visible, from facts already on the page.
  if (recipe === "showcase" && !middle.some((s) => s.type === "gallery") && photos.length >= 3) {
    middle.splice(1, 0, { type: "gallery", tone: "dark", items: photos.slice(0, 5).map((image) => ({ title: "", text: "", image })) });
  }
  if (recipe === "bold" && !middle.some((s) => s.type === "marquee") && services.length >= 3) {
    middle.unshift({ type: "marquee", tone: "brand", items: services.slice(0, 8).map((title) => ({ title, text: "" })) });
  }
  return [head, ...middle, ...(last ? [last] : [])];
}

// ---------------------------------------------------------------- distinctness check

export type LookSignature = { hero: string; header: string; buttons: string; footer: string; sections: string; photo: string };

export function lookSignature(design: DesignDirection, sections: Section[], heroImage?: string): LookSignature {
  const hero = sections[0] ? `${sections[0].type}/${sections[0].variant ?? ""}${sections[0].fit === "cutout" ? "/cutout" : ""}` : "none";
  return {
    hero,
    header: design.header,
    buttons: design.buttons,
    footer: design.footer,
    sections: sections
      .slice(1)
      .map((s) => `${s.type}${s.variant ? `/${s.variant}` : ""}`)
      .join(">"),
    photo: `${design.heroStyle ?? "plain"}:${heroImage ?? ""}`,
  };
}

/** Which parts two looks share (empty = clearly different). */
export function similarities(a: LookSignature, b: LookSignature): string[] {
  const shared: string[] = (["hero", "header", "buttons", "sections"] as const).filter((k) => a[k] === b[k]);
  if (a.photo === b.photo) shared.push("photo treatment");
  return shared;
}

/** "Layout: full-bleed cinematic hero · transparent header · outline buttons" for the look card (from what was built). */
export function layoutLine(design: DesignDirection, builtHero?: string): string | undefined {
  if (design.custom && !design.custom.failed) return `Layout: designed from scratch · concept “${design.custom.brief.concept}”`;
  if (!design.heroStyle) return undefined;
  // A panorama hero is a type hero WITH a photo strip; without a photo it is built as "hero-type/plain".
  const noPhoto = builtHero?.startsWith("hero-type") && builtHero !== "hero-type/panorama";
  const cutout = builtHero?.endsWith("/cutout");
  const hero = cutout
    ? { caption: "split hero with your art shown whole on a light panel", cinematic: "dark stage hero with your art shown whole", collage: "color-block hero with your art shown whole", poster: "dark stage hero with your art shown whole", panorama: "split hero with your art shown whole on a light panel", framed: "split hero with your art shown whole on a light panel" }[design.heroStyle]
    : noPhoto
    ? { caption: "type-only hero on a light panel (no photo)", cinematic: "dark type-only hero (no photo)", collage: "color-block type hero (no photo)", poster: "dark poster type hero (no photo)", panorama: "big type hero (no photo)", framed: "type-only hero on a tinted panel (no photo)" }[design.heroStyle]
    : { caption: "split hero with a captioned photo", cinematic: "full-bleed cinematic hero", collage: "collage hero with a tilted duotone photo", poster: "full-bleed poster hero with a centered headline", panorama: "big-type hero over a panoramic photo strip", framed: "framed photo hero with an overlapping copy card" }[design.heroStyle];
  const header = (noPhoto || cutout) && design.header === "overlay" ? "dark header" : { light: "solid header", overlay: "transparent header", center: "centered-logo header", dark: "dark header" }[design.header];
  return `Layout: ${hero} · ${header} · ${design.buttons} buttons`;
}
