/**
 * Design directions ("looks"): the curated font list, archetype presets, and
 * the normalizer that turns an AI concept into something the renderer can trust.
 * Shared by server code and node tests (relative imports only).
 */
import { cleanBrief, fallbackBrief } from "./custom-design.ts";
import { requestHints, sceneToFind } from "./owner-request.ts";
import { seeded } from "./look-variety.ts";
import { ARCHETYPE_LABEL } from "./archetype-label.ts";
import { ARCHETYPES, MOTIFS, type Archetype, type DesignDirection, type Motif, type SiteFacts, type SitePalette } from "./types.ts";

/** Curated Google Fonts with the exact axis spec that the css2 API accepts (all verified). */
export const FONT_SPECS: Record<string, string> = {
  // Display / heading faces
  "Playfair Display": "ital,wght@0,400;0,600;0,700;0,800;1,400",
  Fraunces: "ital,wght@0,400;0,600;0,700;0,800;1,400",
  "DM Serif Display": "ital@0;1",
  "Cormorant Garamond": "ital,wght@0,500;0,600;0,700;1,500",
  "Instrument Serif": "ital@0;1",
  "Libre Caslon Display": "",
  "EB Garamond": "ital,wght@0,400;0,500;1,400",
  Lora: "ital,wght@0,400;0,600;0,700;1,400",
  Merriweather: "wght@400;700;900",
  "Bricolage Grotesque": "wght@400;600;700;800",
  Syne: "wght@400;600;700;800",
  "Space Grotesk": "wght@400;500;600;700",
  "Archivo Black": "",
  Anton: "",
  "Big Shoulders Display": "wght@500;700;800",
  Oswald: "wght@400;500;600;700",
  Montserrat: "wght@400;600;700;800",
  Poppins: "wght@400;600;700;800",
  Unbounded: "wght@400;600;700",
  "Baloo 2": "wght@400;600;700;800",
  Fredoka: "wght@400;500;600;700",
  Archivo: "wght@400;600;700;800",
  "Work Sans": "wght@400;500;600;700;800",
  Inter: "wght@400;500;600;700;800",
  // Body faces
  "DM Sans": "wght@400;500;700",
  "Source Sans 3": "wght@400;500;700",
  "Nunito Sans": "wght@400;600;700",
  Nunito: "wght@400;600;700",
  Lato: "wght@400;700",
  "Open Sans": "wght@400;500;700",
  Karla: "wght@400;500;700",
  Manrope: "wght@400;500;700",
  Outfit: "wght@400;500;700",
  Figtree: "wght@400;500;700",
  Jost: "wght@400;500;700",
  "Libre Franklin": "wght@400;500;700",
};

export const HEADING_FONTS = [
  "Playfair Display",
  "Fraunces",
  "DM Serif Display",
  "Cormorant Garamond",
  "Instrument Serif",
  "Libre Caslon Display",
  "EB Garamond",
  "Lora",
  "Merriweather",
  "Bricolage Grotesque",
  "Syne",
  "Space Grotesk",
  "Archivo Black",
  "Anton",
  "Big Shoulders Display",
  "Oswald",
  "Montserrat",
  "Poppins",
  "Unbounded",
  "Baloo 2",
  "Fredoka",
  "Archivo",
  "Work Sans",
  "Inter",
];

export const BODY_FONTS = [
  "Inter",
  "DM Sans",
  "Source Sans 3",
  "Work Sans",
  "Nunito Sans",
  "Nunito",
  "Lato",
  "Open Sans",
  "Karla",
  "Manrope",
  "Outfit",
  "Figtree",
  "Jost",
  "Libre Franklin",
  "EB Garamond",
  "Lora",
];

/** Single-weight display faces: never use them for long text and never fake-bold them. */
export const SINGLE_WEIGHT = new Set(["DM Serif Display", "Instrument Serif", "Libre Caslon Display", "Archivo Black", "Anton"]);

type Preset = Omit<DesignDirection, "id" | "name" | "mood" | "imagery" | "heroSubject" | "headline" | "rationale">;

/** Starting points per archetype. The AI overrides any of these; the mock builder uses them as-is. */
export const PRESETS: Record<Archetype, Preset> = {
  editorial: {
    archetype: "editorial",
    palette: { primary: "#1d3b2a", accent: "#c8553d", background: "#f6f1e7", surface: "#ece4d3", text: "#1a1a17", muted: "#5b574d" },
    fonts: { heading: "Fraunces", body: "Source Sans 3" },
    motifs: ["thin-rules", "oversized-numbers", "grain"],
    radius: "sharp",
    buttons: "square",
    hero: "type",
    header: "light",
    footer: "statement",
  },
  "dark-premium": {
    archetype: "dark-premium",
    palette: { primary: "#d4a35a", accent: "#e8c98f", background: "#0f1114", surface: "#181b20", text: "#f2efe8", muted: "#a7a39a" },
    fonts: { heading: "Cormorant Garamond", body: "Manrope" },
    motifs: ["glow", "thin-rules", "grain"],
    radius: "soft",
    buttons: "outline",
    hero: "photo",
    header: "overlay",
    footer: "minimal",
  },
  "bold-photo": {
    archetype: "bold-photo",
    palette: { primary: "#0b4dd8", accent: "#ffcc29", background: "#ffffff", surface: "#f1f4fa", text: "#0c1220", muted: "#4d5668" },
    fonts: { heading: "Archivo Black", body: "Archivo" },
    motifs: ["diagonal-cuts", "outlined-type", "stamp-badges"],
    radius: "sharp",
    buttons: "square",
    hero: "photo",
    header: "overlay",
    footer: "columns",
  },
  playful: {
    archetype: "playful",
    palette: { primary: "#5b3df5", accent: "#ff8a3d", background: "#fffaf2", surface: "#fff0dc", text: "#1f1640", muted: "#5e5675" },
    fonts: { heading: "Bricolage Grotesque", body: "Nunito" },
    motifs: ["soft-blobs", "underline-marks", "stamp-badges"],
    radius: "round",
    buttons: "pill",
    hero: "split",
    header: "light",
    footer: "columns",
  },
  "minimal-luxury": {
    archetype: "minimal-luxury",
    palette: { primary: "#2b2a28", accent: "#a88b5c", background: "#fbfaf7", surface: "#f1eee8", text: "#1c1b19", muted: "#6e6a62" },
    fonts: { heading: "Instrument Serif", body: "Jost" },
    motifs: ["thin-rules", "grid-lines"],
    radius: "sharp",
    buttons: "outline",
    hero: "type",
    header: "light",
    footer: "minimal",
  },
  "warm-craft": {
    archetype: "warm-craft",
    palette: { primary: "#8a3b12", accent: "#2f6f5e", background: "#fbf6ef", surface: "#f3e7d6", text: "#2a1d14", muted: "#6b5747" },
    fonts: { heading: "DM Serif Display", body: "DM Sans" },
    motifs: ["stamp-badges", "underline-marks", "grain"],
    radius: "soft",
    buttons: "pill",
    hero: "split",
    header: "dark",
    footer: "statement",
  },
};

export function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function rgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((c, i) => Math.round(c + (y[i]! - c) * t).toString(16).padStart(2, "0")).join("")}`;
}

export function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

/** Make any palette readable: text on background, muted text, primary/accent usable on the page background. */
export function readablePalette(raw: Partial<SitePalette> | undefined, fallback: SitePalette): SitePalette {
  const pick = (key: keyof SitePalette) => (isHex(raw?.[key]) ? (raw![key] as string).toLowerCase() : fallback[key]);
  const p: SitePalette = {
    primary: pick("primary"),
    accent: pick("accent"),
    background: pick("background"),
    surface: pick("surface"),
    text: pick("text"),
    muted: pick("muted"),
  };
  const dark = luminance(p.background) < 0.2;
  if (contrast(p.text, p.background) < 7) p.text = dark ? "#f3f1ec" : "#16181d";
  if (contrast(p.muted, p.background) < 4.5) p.muted = dark ? "#b9b5ad" : "#4f5661";
  if (contrast(p.text, p.surface) < 6) p.surface = dark ? mix(p.background, "#ffffff", 0.07) : mix(p.background, "#000000", 0.05);
  // Primary is used for links and eyebrows on the page background.
  for (let i = 0; i < 6 && contrast(p.primary, p.background) < 3; i += 1) p.primary = mix(p.primary, dark ? "#ffffff" : "#000000", 0.25);
  for (let i = 0; i < 6 && contrast(p.accent, p.background) < 1.8; i += 1) p.accent = mix(p.accent, dark ? "#ffffff" : "#000000", 0.2);
  return p;
}

export function safeFont(value: unknown, allowed: string[], fallback: string): string {
  if (typeof value !== "string") return fallback;
  const match = allowed.find((font) => font.toLowerCase() === value.trim().toLowerCase());
  return match ?? fallback;
}

export function fontsHref(fonts: { heading: string; body: string }): string {
  const families = [...new Set([fonts.heading, fonts.body])]
    .map((font) => {
      const spec = FONT_SPECS[font];
      const name = font.replace(/ /g, "+");
      return spec ? `family=${name}:${spec}` : `family=${name}`;
    })
    .join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const v = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s_]+/g, "-") : "";
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Brand colors (scraped or from the brief) bias the palette so looks still feel like the business. */
function brandPalette(base: SitePalette, colors: string[], archetype: Archetype): SitePalette {
  const brand = colors.find(isHex);
  if (!brand) return base;
  if (archetype === "dark-premium") return { ...base, accent: brand };
  if (archetype === "minimal-luxury") return { ...base, accent: brand };
  return { ...base, primary: brand };
}

/** Turn a raw AI concept into a safe, renderable direction. */
export function normalizeDirection(raw: unknown, index: number, facts: Pick<SiteFacts, "colors" | "name" | "industry">): DesignDirection {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const archetype = oneOf(r.archetype, ARCHETYPES, ARCHETYPES[index % ARCHETYPES.length]!);
  const preset = PRESETS[archetype];
  const fallbackPalette = brandPalette(preset.palette, facts.colors, archetype);
  const fonts = (r.fonts && typeof r.fonts === "object" ? r.fonts : {}) as Record<string, unknown>;
  let heading = safeFont(fonts.heading, HEADING_FONTS, preset.fonts.heading);
  let body = safeFont(fonts.body, BODY_FONTS, preset.fonts.body);
  if (SINGLE_WEIGHT.has(body)) body = preset.fonts.body;
  if (heading === body && !SINGLE_WEIGHT.has(heading)) heading = preset.fonts.heading;
  const motifs = (Array.isArray(r.motifs) ? r.motifs : [])
    .map((m) => oneOf<Motif | "">(m, MOTIFS, ""))
    .filter((m): m is Motif => Boolean(m));
  const unique = [...new Set(motifs)].slice(0, 3);
  return {
    id: `look-${index + 1}`,
    name: clip(r.name, 40) || `${archetype.replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase())}`,
    mood: clip(r.mood, 240),
    archetype,
    palette: readablePalette(r.palette as Partial<SitePalette> | undefined, fallbackPalette),
    fonts: { heading, body },
    imagery: clip(r.imagery, 400) || defaultImagery(archetype),
    heroSubject: clip(r.heroSubject ?? r.hero_subject, 300),
    featureScene: clip(r.featureScene ?? r.feature_scene, 300) || undefined,
    ai: r.ai === true ? true : undefined,
    motifs: unique.length ? unique : preset.motifs,
    radius: oneOf(r.radius, ["sharp", "soft", "round"] as const, preset.radius),
    buttons: oneOf(r.buttons, ["pill", "square", "outline"] as const, preset.buttons),
    hero: oneOf(r.hero, ["split", "photo", "type"] as const, preset.hero),
    header: oneOf(r.header, ["light", "dark", "overlay", "center"] as const, preset.header),
    heroStyle: oneOf<"caption" | "cinematic" | "collage" | "poster" | "panorama" | "framed" | "">(r.heroStyle, ["caption", "cinematic", "collage", "poster", "panorama", "framed"] as const, "") || undefined,
    layout: oneOf<"editorial" | "showcase" | "bold" | "">(r.layout, ["editorial", "showcase", "bold"] as const, "") || undefined,
    footer: oneOf(r.footer, ["columns", "minimal", "statement"] as const, preset.footer),
    headline: clip(r.headline, 110),
    rationale: clip(r.rationale, 300),
    custom: customOf(r.custom, clip(r.name, 40), readablePalette(r.palette as Partial<SitePalette> | undefined, fallbackPalette)),
  };
}

/** The from-scratch look's brief, carried through the browser between steps (re-cleaned on every read). */
function customOf(raw: unknown, name: string, palette: SitePalette): DesignDirection["custom"] {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as { brief?: unknown; failed?: unknown };
  if (!c.brief || typeof c.brief !== "object") return undefined;
  const brief = cleanBrief(c.brief, fallbackBrief("general", name, palette));
  const by = (c.brief as { by?: unknown }).by === "ai" ? "ai" : "fallback";
  return { brief: { ...brief, by }, failed: typeof c.failed === "string" ? c.failed.slice(0, 300) : undefined };
}

export function defaultImagery(archetype: Archetype): string {
  switch (archetype) {
    case "editorial":
      return "Natural window light, muted film tones, generous negative space, honest documentary framing.";
    case "dark-premium":
      return "Low-key lighting, deep shadows, warm highlights, rich textures, cinematic shallow depth of field.";
    case "bold-photo":
      return "Bright high-contrast daylight, saturated color, dynamic close angles, crisp detail.";
    case "playful":
      return "Cheerful bright light, pastel backgrounds, friendly candid moments, soft shadows.";
    case "minimal-luxury":
      return "Soft diffused light, neutral stone and linen tones, minimal composition, calm symmetry.";
    case "warm-craft":
      return "Golden-hour warmth, tactile materials and tools, hands at work, earthy tones.";
  }
}

/** What a new round should not repeat (read server-side from the looks shown in earlier rounds). */
export type RoundAvoid = { seed?: number; archetypes?: Archetype[]; names?: string[] };

/**
 * Three distinct archetypes for a business. Without a seed: deterministic (mock mode / tests). With a seed: picked
 * at random among the business's five best fits, and a new round prefers archetypes the previous round didn't use.
 */
export function archetypesFor(facts: Pick<SiteFacts, "industry" | "name" | "host" | "notes" | "brief">, variation: number, avoid: RoundAvoid = {}): Archetype[] {
  const order = archetypeOrder(facts);
  if (!avoid.seed && !avoid.archetypes?.length) {
    const shift = (variation * 3) % order.length;
    const rotated = [...order.slice(shift), ...order.slice(0, shift)];
    return rotated.slice(0, 3);
  }
  const rand = seeded(avoid.seed || variation + 1);
  const fresh = order.filter((a) => !avoid.archetypes?.includes(a));
  const pool = (fresh.length >= 3 ? fresh : [...fresh, ...order.filter((a) => !fresh.includes(a))]).slice(0, 5);
  return pool
    .map((a, i) => ({ a, r: rand() + i * 0.18 }))
    .sort((x, y) => x.r - y.r)
    .slice(0, 3)
    .map((x) => x.a);
}

function archetypeOrder(facts: Pick<SiteFacts, "industry" | "name" | "host" | "notes" | "brief">): Archetype[] {
  const text = `${facts.industry} ${facts.name} ${facts.notes} ${facts.brief ?? ""}`.toLowerCase();
  let order: Archetype[];
  if (/plumb|hvac|roof|electric|contract|repair|clean|landscap|auto|mechanic|construction|pest|rooter|drain/.test(text)) {
    order = ["bold-photo", "warm-craft", "dark-premium", "editorial", "playful", "minimal-luxury"];
  } else if (/restaurant|cafe|coffee|bakery|bar|food|kitchen|winery|brew/.test(text)) {
    order = ["editorial", "warm-craft", "dark-premium", "playful", "bold-photo", "minimal-luxury"];
  } else if (/law|legal|finance|account|consult|insur|advis|wealth/.test(text)) {
    order = ["minimal-luxury", "editorial", "dark-premium", "bold-photo", "warm-craft", "playful"];
  } else if (/kid|child|pet|groom|dog|cat|toy|school|daycare|party/.test(text)) {
    order = ["playful", "warm-craft", "bold-photo", "editorial", "minimal-luxury", "dark-premium"];
  } else if (/spa|salon|beauty|boutique|jewel|fashion|design|interior|photo|wedding/.test(text)) {
    order = ["minimal-luxury", "dark-premium", "editorial", "playful", "warm-craft", "bold-photo"];
  } else {
    order = ["editorial", "bold-photo", "dark-premium", "warm-craft", "minimal-luxury", "playful"];
  }
  return order;
}


const LOOK_MOODS: Record<Archetype, string> = {
  editorial: "Reads like a well-made local magazine: big serif headlines, calm cream paper, confident restraint.",
  "dark-premium": "Moody and premium: deep charcoal, warm metallic accents, and photography that glows.",
  "bold-photo": "Loud and clear: full-bleed photography, heavy type, and one bright accent that says call now.",
  playful: "Friendly and upbeat: rounded shapes, cheerful color, and copy that smiles back.",
  "minimal-luxury": "Quiet luxury: lots of air, fine serif type, and a restrained neutral palette.",
  "warm-craft": "Warm and hands-on: earthy tones, tactile textures, and the pride of good work.",
};

/** Deterministic looks for mock mode or when the AI is unavailable. */
export function mockDirections(facts: SiteFacts, variation: number, avoid: RoundAvoid = {}): DesignDirection[] {
  // The owner's request (note + feedback rounds) shapes the mock looks visibly: asked-for tones come first,
  // asked-for colors lead every palette, and "dark"/"light" sets the backgrounds.
  const hints = requestHints(facts);
  const scene = sceneToFind(facts);
  const base = archetypesFor(facts, variation, avoid);
  const pool = [...base, ...ARCHETYPES.filter((a) => !base.includes(a))].filter((a) => !(hints.scheme === "light" && a === "dark-premium"));
  const ordered = [...new Set([...hints.archetypes, ...pool])].slice(0, 3);
  return ordered.map((archetype, index) => {
    const preset = PRESETS[archetype];
    const palette: Partial<SitePalette> = { ...brandPalette(preset.palette, facts.colors, archetype) };
    if (hints.colors[0]) palette.primary = hints.colors[0].hex;
    if (hints.colors[1]) palette.accent = hints.colors[1].hex;
    else if (hints.colors[0] && archetype === "dark-premium") palette.accent = hints.colors[0].hex;
    if (hints.scheme === "dark" && archetype !== "dark-premium") Object.assign(palette, { background: "#141416", surface: "#1f1f24", text: "#f3f1ec", muted: "#b9b5ad" });
    return normalizeDirection(
      {
        archetype,
        name: ARCHETYPE_LABEL[archetype],
        mood: LOOK_MOODS[archetype],
        heroSubject: scene || (facts.services[0] ? `${facts.services[0]} for ${facts.name}` : `${facts.industry || "the business"} at work`),
        palette,
        fonts: preset.fonts,
      },
      index,
      facts,
    );
  });
}
