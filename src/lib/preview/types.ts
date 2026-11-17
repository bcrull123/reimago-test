/** Shared (client + server) shapes for the live multi-page preview. */
import type { PhotoCredit } from "./web-photo.ts";

export type SiteNavLink = { label: string; url: string };

export type ScrapedPage = {
  url: string;
  title: string;
  headings: string[];
  /** Visible paragraph text, clipped. */
  text: string;
};

export type Testimonial = { quote: string; author: string };

/** Everything we know for sure about the business. Nothing in here is invented. */
export type SiteFacts = {
  mode: "reimagine" | "create";
  sourceUrl: string;
  host: string;
  name: string;
  tagline: string;
  description: string;
  logo: string;
  colors: string[];
  phone: string;
  email: string;
  address: string;
  hours: string[];
  services: string[];
  about: string;
  testimonials: Testimonial[];
  images: string[];
  /** Alt/title text of scraped images, by URL (used to find a photo the owner asked for). */
  imageText?: Record<string, string>;
  nav: SiteNavLink[];
  pages: ScrapedPage[];
  social: string[];
  industry: string;
  /** What the visitor asked to change (the form's note). */
  notes: string;
  /** "Not quite right?" feedback rounds from the looks picker, oldest first (max 5). */
  feedback?: string[];
  /** Extra brief details from the Create a New Site wizard. */
  brief?: string;
  /** Set when the live site could not be read and on-file copy was used. */
  note?: string;
  /** Sites the owner wants to emulate (wizard), lightly scanned for colors, fonts and tone. */
  inspiration?: Inspiration[];
};

export type Inspiration = {
  url: string;
  title: string;
  description: string;
  colors: string[];
  fonts: string[];
  headings: string[];
  /** What the owner said they like about it (wizard "emulate_likes" / note). */
  likes: string;
};

// ---------------------------------------------------------------- design directions ("looks")

export const ARCHETYPES = ["editorial", "dark-premium", "bold-photo", "playful", "minimal-luxury", "warm-craft"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export const MOTIFS = [
  "grain",
  "thin-rules",
  "oversized-numbers",
  "diagonal-cuts",
  "soft-blobs",
  "underline-marks",
  "grid-lines",
  "glow",
  "outlined-type",
  "stamp-badges",
] as const;
export type Motif = (typeof MOTIFS)[number];

export type DesignDirection = {
  /** Short id, e.g. "look-1". */
  id: string;
  /** Evocative concept name, e.g. "Copper & Steam". */
  name: string;
  /** One or two sentences: the feeling of the site. */
  mood: string;
  archetype: Archetype;
  palette: SitePalette;
  fonts: { heading: string; body: string };
  /** Art direction for photos: light, lens, color grade, subjects. Fed to image generation. */
  imagery: string;
  /** What the hero image should show (no text, no logos). */
  heroSubject: string;
  /** What the feature (secondary) photo should show; follows the owner's request when it names a scene. */
  featureScene?: string;
  /** Set when the AI art director made this direction (presets leave it unset); for the preview trace. */
  ai?: boolean;
  motifs: Motif[];
  radius: "sharp" | "soft" | "round";
  buttons: "pill" | "square" | "outline";
  hero: "split" | "photo" | "type";
  header: "light" | "dark" | "overlay";
  footer: "columns" | "minimal" | "statement";
  /** A bold headline idea for the hero. */
  headline: string;
  /** Why this direction fits the business. */
  rationale: string;
};

export const SECTION_TYPES = [
  "hero-split",
  "hero-photo",
  "hero-type",
  "page-hero",
  "stat-bar",
  "marquee",
  "services-grid",
  "feature-split",
  "process",
  "reviews",
  "before-after",
  "gallery",
  "statement",
  "faq",
  "cta-band",
  "contact-block",
  "rich-text",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export type SectionItem = { title: string; text: string; image?: string; icon?: string };

/** One block of a page, chosen from the section library and filled by the AI (or the mock composer). */
export type Section = {
  type: SectionType;
  /** Background treatment. */
  tone: "light" | "tint" | "dark" | "brand";
  variant?: string;
  eyebrow?: string;
  heading?: string;
  text?: string;
  items?: SectionItem[];
  /** Image token name (e.g. "hero", "photo-1", "service-2"). */
  image?: string;
  cta?: { label: string; page: string };
  secondary?: { label: string; page: string };
  /** Show the real tap-to-call button (only rendered when a phone number is known). */
  call?: boolean;
  align?: "left" | "center";
  reverse?: boolean;
};

export type StoredImage = {
  name: string;
  type: string;
  source: "generated" | "photo" | "web";
  alt: string;
  /** Who made a web photo and its license (shown as a credit line on the page). */
  credit?: PhotoCredit;
  width?: number;
  height?: number;
};

/** One image the build asked for: its prompt and what happened (no secrets; prompts never contain keys). */
export type ImageTrace = {
  name: string;
  slot: "hero" | "feature" | "service";
  scene: string;
  prompt: string;
  status: "generated" | "failed" | "not generated (mock mode / images off)" | "your site's photo" | "web photo" | "skipped";
  /** How the hero photo was found: the site's own matching photo, a web search, or AI. */
  source?: "your site" | "web search" | "AI";
  /** Web search words and what came back (no secrets). */
  search?: string;
  credit?: PhotoCredit;
};
/** Which AI steps ran with the OWNER'S REQUEST block, and the image prompts used. Stored with the preview. */
export type PreviewTrace = {
  request: { note: string; feedback: string[]; scene?: string };
  steps: { step: string; ai: boolean; ownerRequest: boolean }[];
  images: ImageTrace[];
};

/** What the browser gets back for each homepage look. */
export type LookInfo = {
  id: string;
  url: string;
  index: number;
  name: string;
  mood: string;
  archetype: Archetype;
  palette: SitePalette;
  fonts: { heading: string; body: string };
  images: { generated: number; photos: number };
  mock: boolean;
  /** The owner's latest request this look was built from (note or newest feedback), for the card. */
  request?: string;
  /** Mock mode: what was read from the request and applied (colors, backgrounds, tone, sections). */
  applied?: string[];
  /** One line about the photos, e.g. 'Photos: generated for “brick streets”'. */
  photos?: string;
  /** What this look's build recorded (see PreviewTrace): which AI steps got the owner's request, image prompts. */
  trace?: PreviewTrace;
  /** Why the AI homepage could not be used (the look then uses the section library). */
  aiError?: string;
  /** The AI homepage was used, but some of its sections were dropped (first reasons). */
  aiWarning?: string;
  /** Bumped after "Retry with AI" so thumbnails reload. */
  rev?: number;
};

/**
 * What we learned about the scraped logo, so it can be placed cleanly on light and dark surfaces.
 * - transparent: the file already has a transparent background
 * - cleared: it had a plain background box that we made transparent (stored as image "logo")
 * - solid: a plain background box we could not clear
 * - complex / unknown: a photo-like background, or a format we cannot read (SVG, WebP)
 */
export type LogoMeta = {
  image?: string;
  bg: "transparent" | "cleared" | "solid" | "complex" | "unknown";
  /** The logo's own background color (for "cleared"/"solid"). */
  bgColor?: string;
  /** Average color of the mark itself. */
  fg?: string;
  /** True when the mark is a single neutral color (it can be recolored white/black). */
  mono?: boolean;
  /** Stored reversed copies for dark / light surfaces (multi-color transparent logos). */
  darkImage?: string;
  lightImage?: string;
  /** Share of the mark's pixels (or SVG colors) that would be hard to see on a dark / a light surface. */
  poorOnDark?: number;
  poorOnLight?: number;
  /** One tone only (no dark-and-light mix), so a white/black knockout keeps it recognizable. */
  flat?: boolean;
  /** The logo is an SVG shown from its own URL (analysed from its colors, not pixels). */
  svg?: boolean;
  /** No usable logo image (it failed to load or can't be read safely): show the business name instead. */
  wordmark?: boolean;
};

export type PlanSection = { kind: string; heading: string; brief: string };

export type PlanPage = {
  slug: string;
  title: string;
  navLabel: string;
  purpose: string;
  sections: PlanSection[];
};

export type SitePalette = {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
};

export type SitePlan = {
  name: string;
  tagline: string;
  /** One or two sentences about the current site. */
  summary: string;
  /** What the new site changes. */
  changes: string[];
  palette: SitePalette;
  fonts: { heading: string; body: string };
  cta: { label: string; slug: string };
  pages: PlanPage[];
  /** True when the plan came from the deterministic mock/fallback, not the AI. */
  mock?: boolean;
};

export type PreviewPageLink = { slug: string; title: string; url: string };

export type PreviewInfo = {
  id: string;
  url: string;
  pages: PreviewPageLink[];
  mock: boolean;
  /** Name of the chosen look, when the site was built from looks. */
  look?: string;
  /** Designer critique notes from the polish pass. */
  polish?: { method: "vision" | "html" | "skipped"; notes: string[] };
  /** Pages the AI could not write (slug → reason); the UI offers "Retry with AI". */
  aiErrors?: Record<string, string>;
  /** Bumped after a retry so iframes reload. */
  rev?: number;
};

export type PreviewStepResult<T> = ({ ok: true } & T) | { ok: false; error: string };

/** What the AI sent when some of its sections were dropped: the reasons and a short, masked raw sample. */
export type AiDebug = { model: string; at: string; total: number; used: number; rejected: string[]; sample: string };
