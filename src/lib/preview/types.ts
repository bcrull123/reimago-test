/** Shared (client + server) shapes for the live multi-page preview. */
import type { PhotoCredit } from "./web-photo.ts";
import type { CustomBrief } from "./custom-design.ts";
import type { SiteArt } from "./site-art.ts";
import type { TemporaryPhoto } from "./google-photo.ts";
import type { LookTune } from "./look-edit.ts";

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
  /** Every picture on the site with the words that describe it (see site-art.ts); used to keep the owner's own art. */
  siteArt?: SiteArt[];
  /** The AI planner's reading of whether the photo subject is the owner's own ("keep") or one to find. */
  photoIntent?: "keep" | "find" | "none";
  nav: SiteNavLink[];
  pages: ScrapedPage[];
  social: string[];
  industry: string;
  /** What the visitor asked to change (the form's note). */
  notes: string;
  /** "Not quite right?" feedback rounds from the looks picker, oldest first (max 5). */
  feedback?: string[];
  /** The photo subject the AI planner read from the note/feedback (copied from the plan when a look is built). */
  photoSubject?: string;
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
  /** "center" = centered logo with the menu under it. */
  header: "light" | "dark" | "overlay" | "center";
  /** How the hero shows its photo; no two looks share one (see look-variety.ts). */
  heroStyle?: "caption" | "cinematic" | "collage" | "poster" | "panorama" | "framed";
  /** Below-the-fold section recipe; no two looks share one. */
  layout?: "editorial" | "showcase" | "bold";
  footer: "columns" | "minimal" | "statement";
  /** Set on a look edited from the owner's feedback ("Night Brick, lighter"): cumulative levels + original palette. */
  tune?: LookTune;
  /** A bold headline idea for the hero. */
  headline: string;
  /** Why this direction fits the business. */
  rationale: string;
  /** The from-scratch look ("Custom Design"): Grok's creative brief; its homepage is freeform HTML/CSS (custom-design.ts). */
  custom?: { brief: CustomBrief; failed?: string };
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
  /** "cutout": the image is an illustration / transparent art, shown whole on a color panel (no crop, no duotone). */
  fit?: "cutout";
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
  /** An illustration / transparent PNG / SVG: shown whole on a color panel, never cropped full-bleed or duotoned. */
  cutout?: boolean;
  /** Kept from the owner's site because they asked ("Keep the rocket"). */
  kept?: boolean;
  /** A Google Images photo shown in the preview only: where it came from, so the build step can replace it. */
  temporary?: TemporaryPhoto;
  /** The Custom Design's copy of the template's hero photo (e.g. "photo-3"): it is @img:hero on the custom page. */
  heroOf?: string;
  /** A site photo's verdict in the round's hero quality gate, and what it shows (the vision caption / alt text). */
  gate?: "passed" | "failed";
  shows?: string;
  /** The site's signature brand graphic (mascot / illustration, a transparent cutout), e.g. bob.me's rocket. */
  signature?: boolean;
  /** Made by Grok Imagine for the Custom Design (hero art, supporting art). */
  imagine?: boolean;
};

/** One image the build asked for: its prompt and what happened (no secrets; prompts never contain keys). */
export type ImageTrace = {
  name: string;
  slot: "hero" | "feature" | "service";
  scene: string;
  prompt: string;
  status: "generated" | "failed" | "not generated (mock mode / images off)" | "your site's photo" | "web photo" | "skipped" | "kept from your site" | "not found on your site" | "preview photo (Google Images)";
  /** How the hero photo was found: the site's own matching photo, a web search, or AI. */
  source?: "your site" | "web search" | "AI";
  /** Web search words and what came back (no secrets). */
  search?: string;
  credit?: PhotoCredit;
};
/** Which AI steps ran with the OWNER'S REQUEST block, and the image prompts used. Stored with the preview. */
export type PreviewTrace = {
  request: {
    note: string;
    feedback: string[];
    /** The photo subject the owner asked for, and who read it from their words. */
    scene?: string;
    subjectFrom?: "AI planner" | "note wording";
    /** No subject named and no suitable photo on the site: the hero shows the town instead. */
    autoScene?: string;
    /** "keep": the subject is the owner's own picture, taken only from their site; "find": search / generate it. */
    intent?: "keep" | "find";
  };
  steps: { step: string; ai: boolean; ownerRequest: boolean }[];
  images: ImageTrace[];
  /** What makes this look different from the other two (hero treatment, header, buttons, footer, section order, photo). */
  layout?: { hero: string; header: string; buttons: string; footer: string; sections: string; photo: string };
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
  /** e.g. "Layout: full-bleed cinematic hero · transparent header · outline buttons". */
  layout?: string;
  /** What this look's build recorded (see PreviewTrace): which AI steps got the owner's request, image prompts. */
  trace?: PreviewTrace;
  /** Why the AI homepage could not be used (the look then uses the section library). */
  aiError?: string;
  /** The AI homepage was used, but some of its sections were dropped (first reasons). */
  aiWarning?: string;
  /** The from-scratch look: its concept, and whether it passed (else the template look is shown and why). */
  custom?: {
    concept: string;
    status: "ok" | "repaired" | "fallback";
    note?: string;
    stripped?: string[];
    repaired?: string[];
    /** The Grok Imagine design mockup this page was built from (shown next to the built page on the card). */
    mockupUrl?: string;
    /** "imagine" = built from the mockup; "brief" = from the text brief (Imagine failed / off). */
    source?: "imagine" | "brief";
    /** Contrast pairs fixed automatically. */
    autofixed?: number;
    /** Why Imagine was skipped / failed (the text-brief design was used instead). */
    imagineNote?: string;
    /** The mockup shows the design before a later edit ("make it darker"). */
    mockupStale?: boolean;
    /** The card's picture line for the built custom page ("Art: created by Grok Imagine for this design"). */
    photoLine?: string;
    /** How closely the built page follows the mockup's color blocking (0-100, render-free check). */
    fidelity?: number;
  };
  /** Bumped after "Retry with AI" so thumbnails reload. */
  rev?: number;
  /** An edit of an earlier look ("Night Brick, lighter"): the look's unchanged name is `name`. */
  edit?: {
    /** "lighter", "a bit lighter still", "noticeably lighter". */
    variant: string;
    /** "Changed: lightened backgrounds and photo overlay (slight)". */
    changed: string;
    /** The look this was edited from (id) and how the feedback named it. */
    from: string;
    how: string;
    /** The three variations of this edit ("lighter" / "a bit lighter still" / "noticeably lighter"): the card swaps among them. */
    alternatives?: LookInfo[];
  };
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
  /** What the owner asked to see in the hero/background photo, as the AI planner read the note ("red brick streets"). */
  photoSubject?: string;
  /** "keep": the subject is a picture already on the owner's site (never searched for or generated). */
  photoIntent?: "keep" | "find" | "none";
  /** 2-3 Google Images searches for photos that fit this business/place (used proactively, even with no note). */
  imageQueries?: string[];
  /** Photos shown in earlier rounds of this session (image URLs / source pages and perceptual hashes): not reused when alternatives exist. */
  avoidPhotos?: { keys: string[]; hashes: string[] };
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

/** What the owner saw in earlier rounds of this session (read server-side from the stored looks). */
export type PreviousRound = {
  /** The last round's looks. */
  names: string[];
  archetypes: Archetype[];
  heroStyles: NonNullable<DesignDirection["heroStyle"]>[];
  palettes: { primary: string; background: string }[];
  /** Every earlier round's hero photos. */
  photoKeys: string[];
  photoHashes: string[];
};
