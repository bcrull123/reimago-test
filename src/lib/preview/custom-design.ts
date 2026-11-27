/**
 * The from-scratch look ("Custom Design"), pure parts: the creative brief, the prompts, the sanitizer and the
 * validator. Bob, round 5: "These are basically the same as the other sites. We need to add something more creative
 * to our step." and "Let's just do one design for now until we get it right and then expand."
 *
 * One look per round is designed from scratch by Grok: first a short creative brief (concept, metaphor, mood,
 * composition, typography, motion), then the whole homepage as freeform HTML + CSS (no JavaScript; inline SVG and
 * Google Fonts allowed). The other two looks stay template looks for comparison. Everything Grok writes is
 * sanitized (no scripts, event handlers, external resources other than fonts and our own stored images) and
 * validated (business name, nav to every page, CTA links, phone, one h1, content, mobile rules, WCAG AA contrast of
 * the declared color pairs); one repair pass by Grok on failure, then the template look is used instead.
 */
import { contrast, isHex, luminance, mix, readablePalette } from "./design.ts";
import type { SitePalette } from "./types.ts";

export const CUSTOM_NAME = "Custom Design";

export type CustomBrief = {
  /** 2-4 words: "The Launchpad". */
  concept: string;
  /** The visual metaphor: "a launch countdown: the page climbs from ground to orbit". */
  metaphor: string;
  mood: string;
  /** How the page is composed (unusual grid, diagonal bands, a big SVG illustration...). */
  composition: string;
  typography: { heading: string; body: string; notes: string };
  /** One CSS-only motion idea (respecting prefers-reduced-motion). */
  motion: string;
  /** What to draw with CSS/SVG (shapes, illustrations). */
  illustration: string;
  headline: string;
  palette: SitePalette;
  /** Who wrote it: Grok, or the built-in fallback when the brief call failed. */
  by: "ai" | "fallback";
};

export type CustomDesign = {
  brief: CustomBrief;
  css: string;
  html: string;
  /** Google Fonts families the custom page loads (any family name; validated characters only). */
  fonts: { heading: string; body: string };
  /** "ok" first try, "repaired" after Grok's repair pass. */
  status: "ok" | "repaired";
  /** What the sanitizer removed (scripts, handlers, external URLs...). */
  stripped: string[];
  /** Problems the first draft had (fixed by the repair pass). */
  repaired?: string[];
  /** Edits applied by targeted refine ("darker"), newest last. */
  edits?: string[];
  ms?: number;
  /** "imagine": Grok built it from a Grok Imagine design mockup; "brief": from the text brief alone (Imagine failed / off). */
  source?: "imagine" | "brief";
  /** The Grok Imagine mockup it was built from (stored as the look's "mockup" image). */
  mockup?: CustomMockup;
  /** Extra Grok Imagine art made for decorative areas (stored as "art-1", "art-2"). */
  assets?: string[];
  /** Contrast pairs we fixed automatically ("..: background #e85d04 -> #b84a03 (4.6:1)"). */
  autofixed?: string[];
  /** The card's picture line ("Art: created by Grok Imagine for this design", "Photo: your site's own photo …"). */
  photoLine?: string;
  /** Site assets sent to Imagine as reference images (names), and the mockup fidelity score (0-100). */
  assetsSent?: string[];
  fidelity?: number;
};

/** A Grok Imagine homepage design mockup (the designer step for the Custom Design look). */
export type CustomMockup = {
  /** Stored image name on the look ("mockup"). */
  name: string;
  type: string;
  width?: number;
  height?: number;
  model: string;
  /** "generations" or "edits" (from the site's logo, like the original Imagine flow). */
  via?: string;
  ms: number;
  prompt: string;
  /** The mockup was made before a later edit of the built page ("make it darker"). */
  stale?: boolean;
};

/** What the custom generator knows about the site (built from the stored look). */
export type CustomContext = {
  name: string;
  tagline: string;
  description: string;
  services: string[];
  phone: string;
  email: string;
  address: string;
  hours: string[];
  social: string[];
  pages: { slug: string; label: string }[];
  cta: { label: string; slug: string };
  /** Stored images the page may use ("@img:hero"), with what they show. */
  images: { name: string; alt: string; width?: number; height?: number; kind: "the business's own photo" | "the business's own photo (secondary)" | "the business's signature graphic" | "photo" | "ai photo" | "owner's art (keep)" | "logo" | "imagine art"; cutout?: boolean }[];
  /** The owner asked to keep this picture ("Keep the rocket"): it is @img:hero and must be shown whole. */
  keep?: string;
  /** The owner's note / latest feedback. */
  request?: string;
  /** "town", "restaurant", "startup-community"... (hero-brief.ts). */
  category: string;
  kind: string;
  hasLogo: boolean;
};

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const FONT_NAME = /^[A-Za-z][A-Za-z0-9 ]{1,38}[A-Za-z0-9]$/;

export function cleanFontName(v: unknown, fallback: string): string {
  const s = clip(v, 40).replace(/["';,]/g, "");
  return FONT_NAME.test(s) ? s : fallback;
}

/** A brief from raw model JSON (missing fields filled from the fallback). */
export function cleanBrief(raw: unknown, fallback: CustomBrief): CustomBrief {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const t = (r.typography && typeof r.typography === "object" ? r.typography : {}) as Record<string, unknown>;
  const p = (r.palette && typeof r.palette === "object" ? r.palette : {}) as Partial<SitePalette>;
  return {
    concept: clip(r.concept, 40) || fallback.concept,
    metaphor: clip(r.metaphor, 240) || fallback.metaphor,
    mood: clip(r.mood, 240) || fallback.mood,
    composition: clip(r.composition, 400) || fallback.composition,
    typography: { heading: cleanFontName(t.heading, fallback.typography.heading), body: cleanFontName(t.body, fallback.typography.body), notes: clip(t.notes, 200) || fallback.typography.notes },
    motion: clip(r.motion, 240) || fallback.motion,
    illustration: clip(r.illustration, 300) || fallback.illustration,
    headline: clip(r.headline, 110) || fallback.headline,
    palette: readablePalette(p, fallback.palette),
    by: raw && typeof raw === "object" && clip(r.concept, 40) ? "ai" : "fallback",
  };
}

const FALLBACK_CONCEPTS: Record<string, Omit<CustomBrief, "palette" | "by" | "headline">> = {
  town: {
    concept: "Main Street",
    metaphor: "the town as a wide main street: a strong photo of the place, big type, a clear invitation",
    mood: "bold, civic, graphic, and neighborly — not a cream letterhead",
    composition: "a full-bleed or large split hero of a real downtown/main-street photo, oversized condensed headline, a large tappable CTA, a bento grid of city services below",
    typography: { heading: "Oswald", body: "Work Sans", notes: "condensed display headline, generous and readable body" },
    motion: "the headline settles in once on load",
    illustration: "simple SVG street-grid rules and a stamped city seal, never as a substitute for the hero photo",
  },
  restaurant: {
    concept: "The Long Table",
    metaphor: "one long table where everyone is invited: the page reads like a menu laid on linen",
    mood: "appetizing, warm, candlelit, generous",
    composition: "a full-bleed plated photo, a menu-card column with dotted leaders, a ticket-stub reservation card",
    typography: { heading: "Playfair Display", body: "Karla", notes: "italic serif accents, small caps labels" },
    motion: "steam-like wisps drift up over the hero photo",
    illustration: "SVG steam wisps and a hand-drawn plate rim",
  },
  trades: {
    concept: "Blueprint",
    metaphor: "the job as a blueprint: precise lines, measured steps, a clean finish",
    mood: "trustworthy, precise, fast, clean",
    composition: "blueprint-grid background, a finished-work photo in a dimensioned frame, numbered steps on a ruler line",
    typography: { heading: "Space Grotesk", body: "Inter", notes: "technical labels in uppercase mono-like tracking" },
    motion: "dimension lines extend once on load",
    illustration: "SVG blueprint grid, dimension arrows and a wrench-and-drop mark",
  },
  "startup-community": {
    concept: "The Launchpad",
    metaphor: "a launchpad for founders: the page climbs from the ground (idea) to orbit (a running business)",
    mood: "optimistic, energetic, modern, friendly",
    composition: "a deep-space hero with an SVG rocket trail arcing across the headline, a countdown 3-2-1 steps band, orbit rings around the community stats",
    typography: { heading: "Space Grotesk", body: "Inter", notes: "huge tight headline, mono-style labels" },
    motion: "stars twinkle and the rocket trail draws once",
    illustration: "SVG rocket trail, planets and orbit rings",
  },
};

/** A designer-quality brief without AI (used when the brief call fails), by business type. */
export function fallbackBrief(category: string, name: string, palette: SitePalette): CustomBrief {
  const base = FALLBACK_CONCEPTS[category] ?? {
    concept: "Signature",
    metaphor: "the business as its own signature: one confident gesture that says who they are",
    mood: "confident, warm, modern",
    composition: "an oversized headline set against a bold color field, a photo in an organic SVG mask, an offset grid of services",
    typography: { heading: "Fraunces", body: "Inter", notes: "big expressive headline, calm body text" },
    motion: "the organic photo mask slowly breathes",
    illustration: "SVG blobs and a hand-drawn underline",
  };
  return { ...base, headline: name ? `${name}, at its best.` : "At its best.", palette, by: "fallback" };
}

// ------------------------------------------------------------------------------------------------ prompts

export const BRIEF_MARKER = "Write the CREATIVE BRIEF for ONE from-scratch homepage";
export const DESIGN_MARKER = "Design this homepage FROM SCRATCH as freeform HTML and CSS";
export const REPAIR_MARKER = "REPAIR this from-scratch homepage";
export const EDIT_MARKER = "EDIT this from-scratch homepage";

export function briefPrompt(ctx: Pick<CustomContext, "name" | "tagline" | "description" | "services" | "category" | "kind" | "request">): string {
  return `${BRIEF_MARKER} for this business, like a top agency art director would (not a template: a concept).
Business: ${JSON.stringify({ name: ctx.name, kind: ctx.kind, type: ctx.category, tagline: ctx.tagline, description: ctx.description.slice(0, 400), services: ctx.services.slice(0, 8), ownerRequest: ctx.request || undefined })}
Return ONLY JSON: {"concept": "2-4 words", "metaphor": "one sentence: the visual metaphor for THIS business", "mood": "...", "composition": "how the page is laid out: unusual, specific (shapes, grid, bands, overlaps)", "typography": {"heading": "a Google Fonts family", "body": "a Google Fonts family", "notes": "..."}, "motion": "one CSS-only motion idea", "illustration": "what to draw with inline SVG/CSS", "headline": "the hero headline (max 9 words)", "palette": {"primary": "#hex", "accent": "#hex", "background": "#hex", "surface": "#hex", "text": "#hex", "muted": "#hex"}}
Rules: the concept must come from what this business actually does (e.g. a startup community = a launchpad for founders; a town = its front porch; a plumber = a blueprint). Text colors must reach WCAG AA (4.5:1) on background and surface. Never use the business name as the metaphor.`;
}

function contextJson(ctx: CustomContext): string {
  return JSON.stringify({
    name: ctx.name,
    kind: ctx.kind,
    tagline: ctx.tagline,
    description: ctx.description.slice(0, 600),
    services: ctx.services.slice(0, 10),
    phone: ctx.phone || undefined,
    email: ctx.email || undefined,
    address: ctx.address || undefined,
    hours: ctx.hours.slice(0, 7),
    pages: ctx.pages.map((p) => ({ href: `@page:${p.slug}`, label: p.label })),
    cta: { label: ctx.cta.label, href: `@page:${ctx.cta.slug}` },
    images: ctx.images.map((i) => ({ src: `@img:${i.name}`, shows: i.alt.slice(0, 120), kind: i.kind, size: i.width && i.height ? `${i.width}x${i.height}` : undefined, cutout: i.cutout || undefined })),
    brand: ctx.hasLogo ? "write @brand:light where the logo sits on a light surface, @brand:dark on a dark surface (we insert the logo)" : "no logo: write @brand:light or @brand:dark (we insert the name as a wordmark)",
    ownerAskedToKeep: ctx.keep || undefined,
    ownerRequest: ctx.request || undefined,
  });
}

export function designPrompt(ctx: CustomContext, brief: CustomBrief): { system: string; user: string } {
  const system = `${DESIGN_MARKER}. You are an award-winning web designer. This is NOT a template: invent a unique layout from the creative brief, with bold art direction, custom shapes and inline SVG illustration (like a hand-built agency site). Use ONLY the business's real content given (never invent phone numbers, emails, prices, reviews, awards or statistics).
Return ONLY JSON: {"css": "...", "html": "..."}.
Technical contract (the page is rejected otherwise):
- "html" is the inside of <body> only: a <header> with the brand token (@brand:light or @brand:dark) and a <nav> linking EVERY page (href exactly "@page:<slug>" as given), then <main> with 5-8 <section>s (exactly one <h1>, in the hero), then a <footer> with the pages, the phone/email/address given, and the brand.
- Call-to-action buttons: <a class="..." href="@page:<cta slug>"> with the CTA label, one in the hero; a phone given = a <a href="tel:..."> link.
- Images: only the given "@img:<name>" sources (in <img src> or CSS url(@img:name)), with alt text. If the owner asked to keep a picture it is @img:hero: show it large and WHOLE (object-fit: contain, no crop, no filters). Otherwise use @img:hero in the hero. The business's own photos (kind "the business's own photo") go first, in the most prominent places. When photos are weak, lean on CSS/SVG illustration.
- No <script>, no on* attributes, no <form>/<input>, no iframes, no external URLs (no http links except the social links given), no @import, no @font-face (the heading and body Google Fonts are loaded for you: use font-family var(--font-heading) and var(--font-body)).
- Colors: use the CSS variables we define: var(--background), var(--surface), var(--text), var(--muted), var(--primary), var(--on-primary), var(--accent), var(--on-accent). Any other color you add must keep text at WCAG AA (4.5:1, 3:1 for headings over 24px) against what it sits on; declare color and background together on the same rule.
- Responsive: mobile-first or with @media (max-width: 720px) rules; on phones the nav stays reachable (wrap it under the brand, never display:none without a <details> menu); nothing wider than the screen (no fixed widths over 600px; use max-width, %, clamp(), grid/flex). Animations only with @keyframes inside @media (prefers-reduced-motion: no-preference).
- Keep it lean: html under 30000 characters, css under 18000.
- Hero quality: the <h1> must be large (clamp with a minimum of ~2.8rem). The hero CTA must be tappable (about 1rem type, ≥44px min-height). Do not leave a tall empty hero with tiny type in a corner. Do not crop the hero photo into a small arc/circle of sky or treetops — if the site has a strong photo of the place (street, building, people, landmark), use it large, full-bleed or a wide split, object-fit cover, object-position center.`;
  const user = `Creative brief: ${JSON.stringify({ concept: brief.concept, metaphor: brief.metaphor, mood: brief.mood, composition: brief.composition, typography: brief.typography, motion: brief.motion, illustration: brief.illustration, headline: brief.headline })}
Site: ${contextJson(ctx)}`;
  return { system, user };
}

export function repairPrompt(ctx: CustomContext, brief: CustomBrief, draft: { css: string; html: string }, problems: string[], fromMockup = false, colors?: string, artReady = false): { system: string; user: string } {
  const base = fromMockup ? mockupBuildPrompt(ctx, brief, colors, artReady) : designPrompt(ctx, brief);
  return {
    system: `${REPAIR_MARKER}: your draft failed our checks. Fix EVERY problem listed, keep the concept and everything else that worked, and return the complete corrected JSON {"css": "...", "html": "..."}.\n\n${base.system}`,
    user: `Problems:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nYour draft:\n${JSON.stringify({ css: draft.css.slice(0, 20000), html: draft.html.slice(0, 32000) })}\n\n${base.user}`,
  };
}

export function editPrompt(ctx: CustomContext, design: CustomDesign, request: string, adjustments: string[]): { system: string; user: string } {
  const base = designPrompt(ctx, design.brief);
  return {
    system: `${EDIT_MARKER} from the owner's feedback. Change ONLY what they ask (same concept, layout, copy and images unless the request is about them) and return the complete JSON {"css": "...", "html": "...", "palette": {...the CSS variable colors, changed only if the request is about color/lightness}}.\n\n${base.system}`,
    user: `Owner's request: ${JSON.stringify(request.slice(0, 400))}${adjustments.length ? ` (read as: ${adjustments.join(", ")})` : ""}\nCurrent palette: ${JSON.stringify(design.brief.palette)}\nCurrent page:\n${JSON.stringify({ css: design.css.slice(0, 20000), html: design.html.slice(0, 32000) })}\n\nSite: ${contextJson(ctx)}`,
  };
}

export const MOCKUP_MARKER = "Build this homepage to MATCH THE DESIGN MOCKUP";

/**
 * Grok Imagine prompt for the homepage design mockup (desktop, above the fold + the next sections), from the brief
 * and the real content. The site's own photos are described so the design is made around them (the built page
 * uses the real files in those slots, not the mockup's pixels).
 */
export function mockupPrompt(ctx: CustomContext, brief: CustomBrief, refs: string[] = []): string {
  const nav = ctx.pages.map((p) => p.label).slice(0, 6).join(", ");
  const photos = ctx.images.filter((i) => i.kind !== "logo" && i.kind !== "imagine art" && i.kind !== "the business's signature graphic");
  const hero = photos.find((i) => i.name === "hero");
  const own = photos.filter((i) => i.kind === "the business's own photo" || i.kind === "the business's own photo (secondary)");
  const signature = ctx.images.find((i) => i.kind === "the business's signature graphic");
  const photoLine = ctx.keep
    ? `The hero features the owner's own picture: ${ctx.keep} (${hero?.alt ?? ""}), large and WHOLE, exactly that picture, not redrawn as something else.`
    : hero && hero.kind === "the business's own photo"
    ? `The hero photo area shows ${hero.alt.slice(0, 120)} (the business's real photo, it will be placed exactly there).`
    : signature
    ? `The hero centerpiece is the business's signature graphic (${signature.alt.slice(0, 80)}), large, with supporting artwork in the same style around it (its world: trails, shapes, scenery, patterns).`
    : hero
    ? `The hero photo area shows ${hero.alt.slice(0, 120)}.`
    : "No photos: the hero is bold illustration and typography.";
  const refLine = refs.length
    ? `The attached reference images are the business's REAL assets: ${refs.map((r, i) => `<IMAGE_${i}> ${r}`).join("; ")}. Design the page AROUND them: creatively reinterpret and recompose them (collage, duotone, cutouts, framing, color treatments, scale) rather than replacing them with new pictures; keep the logo and any signature graphic recognizable.`
    : "";
  const more = own.filter((i) => i.name !== "hero").slice(0, 3).map((i) => i.alt.slice(0, 80));
  const services = ctx.services.slice(0, 4).join(" · ");
  const p = brief.palette;
  return [
    `A finished, high-end website homepage design, shown flat and full-frame as a desktop screenshot (no laptop, no device frame, no browser window, no wireframe).`,
    `Art direction: “${brief.concept}”: ${brief.metaphor}. Mood: ${brief.mood}. Composition: ${brief.composition}.`,
    `Typography: headings in the style of ${brief.typography.heading}, body text in the style of ${brief.typography.body}. ${brief.typography.notes}`.trim(),
    `Colors: background ${p.background}, surface ${p.surface}, text ${p.text}, primary ${p.primary}, accent ${p.accent}.`,
    `Top bar: the brand “${ctx.name}” at the left; menu: ${nav}; a “${ctx.cta.label}” button.`,
    `Hero headline exactly: “${brief.headline || ctx.tagline || ctx.name}”.${ctx.tagline ? ` Supporting line: “${ctx.tagline.slice(0, 120)}”.` : ""} Main button: “${ctx.cta.label}”.`,
    photoLine,
    refLine,
    more.length ? `Further down, sections use the business's real photos of: ${more.join("; ")}.` : "",
    services ? `Below the hero, a section with: ${services}.` : "",
    brief.illustration ? `Decorative illustration: ${brief.illustration}.` : "",
    ctx.request ? `The owner asked: “${ctx.request.slice(0, 200)}”: show that clearly in the design.` : "",
    `Show the top of the page and the start of the next two sections. Real words exactly as given, crisp and legible; no lorem ipsum; no watermark; no stock-photo site names; not a WordPress theme.`,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 3600);
}

/** Grok (vision) builds the page to match the mockup image (sent with this prompt), with the same contract as designPrompt. */
export function mockupBuildPrompt(ctx: CustomContext, brief: CustomBrief, colors?: string, artReady = false): { system: string; user: string } {
  const base = designPrompt(ctx, brief);
  const contract = base.system.slice(base.system.indexOf("Return ONLY JSON"));
  const system = `${MOCKUP_MARKER} image attached (made by our designer with Grok Imagine). You are a senior front-end developer: rebuild it as a real homepage, as close to the mockup as you can: the same layout and proportions, colors, typography feel (pick from the brief's fonts), shapes, decorative elements and section order. Draw illustrations and shapes with inline SVG / CSS. Use ONLY the business's real content given (never invent phone numbers, emails, prices, reviews, awards or statistics); fix any garbled words in the mockup to the real text.
Method: FIRST look at the mockup region by region, top to bottom (header, hero, each following band), and write that down in "regions": [{"name", "background": "#hex", "layout": "e.g. 2-column split, 3x2 photo collage grid, full-bleed", "elements": "headline scale, shapes, art, photos"}]. THEN build each region in that order so it matches: the same layout structure (grids, collages, overlaps), the same dark vs light color blocking and background colors, the same headline scale (a huge headline in the mockup is a huge clamp() font-size on the page), the same decorative elements.${colors ? `\n${colors}` : ""}
Pictures: put the REAL files given ("@img:<name>") into the mockup's picture areas: the business's own photos first and most prominent; its signature graphic (kind "the business's signature graphic", a transparent cutout) shown whole as the hero centerpiece when the mockup has it there; secondary own photos can be collage tiles or textures. Match the mockup's treatment with CSS (object-fit, clip-path, border-radius, mix-blend-mode, filter: grayscale/sepia/contrast, duotone overlays, rotations); never try to reproduce photo pixels from the mockup.${artReady ? ' Artwork made by Grok Imagine for this design is given as kind "imagine art" (e.g. @img:hero / @img:art-1): use it for the mockup\'s illustration areas; do not ask for more.' : ' If the mockup has illustration areas and no given picture fits, you may ask for up to 2 extra Grok Imagine artworks: add "assets": [{"name": "art-1", "prompt": "what to draw, style, colors (no text, no logos)", "aspect": "1:1" | "4:3" | "16:9" | "3:4"}] and use them as <img src="@img:art-1" alt="..."> (decorative art only, never instead of the business\'s own photos).'}
${contract.replace('Return ONLY JSON: {"css": "...", "html": "..."}.', 'Return ONLY JSON: {"regions": [...], "css": "...", "html": "...", "assets": [...optional]}.')}`;
  return { system, user: `${base.user}\nThe mockup is the attached image.` };
}

// ------------------------------------------------------------------------------------------------ CSS variables

/** The look's color/font variables, defined before Grok's CSS (edits retune them). */
/** White or black text, whichever reads better on this color (always ≥ 4.5:1 for one of them). */
export function onColor(bg: string): string {
  return contrast("#ffffff", bg) >= contrast("#000000", bg) ? "#ffffff" : "#000000";
}

export function paletteVars(p: SitePalette, fonts: { heading: string; body: string }): string {
  const on = onColor;
  return `:root{--background:${p.background};--surface:${p.surface};--text:${p.text};--muted:${p.muted};--primary:${p.primary};--on-primary:${on(p.primary)};--accent:${p.accent};--on-accent:${on(p.accent)};--font-heading:'${fonts.heading}',Georgia,serif;--font-body:'${fonts.body}',system-ui,sans-serif}`;
}

export function customFontsHref(fonts: { heading: string; body: string }): string {
  const fam = (f: string) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}`;
  // No weight axes: a family without the asked weights would make Google Fonts reject the whole request.
  return `https://fonts.googleapis.com/css2?${[...new Set([fonts.heading, fonts.body])].map(fam).join("&")}&display=swap`;
}

// ------------------------------------------------------------------------------------------------ sanitize

export type SanitizeCustomContext = { pages: string[]; cta: string; images: string[]; social: string[]; phone: string; email: string };

const DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "noscript", "template", "frameset", "frame", "applet", "audio", "video", "canvas", "foreignObject", "form", "select", "textarea", "math", "title", "head"];
const DROP_VOID = ["link", "meta", "base", "input", "param", "source", "track", "!doctype"];

/** CSS from the model: no imports, no external URLs (only @img: tokens and inline SVG data), no script-ish values. */
export function sanitizeCss(css: string, ctx: Pick<SanitizeCustomContext, "images">, stripped: string[]): string {
  let out = css.replace(/<\/?style[^>]*>/gi, "");
  const count = (re: RegExp, label: string) => {
    const n = (out.match(re) ?? []).length;
    if (n) stripped.push(`${n} ${label}`);
    out = out.replace(re, "");
  };
  count(/@import[^;]*;?/gi, "CSS @import");
  count(/@font-face\s*\{[^}]*\}/gi, "@font-face (fonts come from Google Fonts)");
  count(/@(?:charset|namespace)[^;]*;/gi, "CSS @charset/@namespace");
  count(/expression\s*\([^)]*\)/gi, "CSS expression()");
  count(/(?:behavior|-moz-binding)\s*:[^;}]*/gi, "CSS behavior/binding");
  count(/javascript:/gi, "javascript: URL");
  out = out.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (all, _q, url: string) => {
    const u = url.trim();
    const img = u.match(/^@img:([a-z0-9-]+)$/);
    if (img && ctx.images.includes(img[1]!)) return `url(${u})`;
    if (/^data:image\/svg\+xml[,;]/i.test(u) && !/script|on\w+=|href=["']?(?:https?|javascript)/i.test(decodeSafe(u))) return all;
    if (/^#[\w-]+$/.test(u)) return all;
    stripped.push(`CSS url(${u.slice(0, 60)})`);
    return "none";
  });
  return out.slice(0, 40_000);
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** HTML from the model: our block list plus link/image rules (the page CSP also forbids every script). */
export function sanitizeCustomHtml(input: string, ctx: SanitizeCustomContext): { html: string; css: string; stripped: string[] } {
  const stripped: string[] = [];
  let html = input.replace(/<!--[\s\S]*?-->/g, "");
  let inlineCss = "";
  // <style> blocks inside the html: keep their CSS (sanitized), drop the tags.
  html = html.replace(/<style[^>]*>([\s\S]*?)<\/style\s*>/gi, (_, css: string) => {
    inlineCss += `\n${css}`;
    return "";
  });
  for (const tag of DROP_WITH_CONTENT) {
    const re = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    const n = (html.match(re) ?? []).length;
    if (n) stripped.push(`${n} <${tag}>`);
    html = html.replace(re, "");
    // An unclosed one: drop the opening tag.
    const open = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
    if (open.test(html)) {
      stripped.push(`stray <${tag}>`);
      html = html.replace(open, "");
    }
  }
  for (const tag of DROP_VOID) {
    const re = new RegExp(`<${tag.replace("!", "!")}\\b[^>]*>`, "gi");
    const n = (html.match(re) ?? []).length;
    if (n && tag !== "!doctype") stripped.push(`${n} <${tag}>`);
    html = html.replace(re, "");
  }
  html = html.replace(/<\/?(?:html|body)\b[^>]*>/gi, "");
  // Event handlers and other script-ish attributes.
  const handlers = html.match(/\s(?:on[a-z]+|formaction|srcdoc)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi) ?? [];
  if (handlers.length) stripped.push(`${handlers.length} event handler attribute${handlers.length > 1 ? "s" : ""}`);
  html = html.replace(/\s(?:on[a-z]+|formaction|srcdoc)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  html = html.replace(/\ssrcset\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");
  // Links.
  const social = ctx.social.map((s) => s.replace(/\/+$/, "").toLowerCase());
  html = html.replace(/(<a\b[^>]*?\s)href\s*=\s*(["'])(.*?)\2/gi, (all, pre: string, q: string, raw: string) => {
    const href = raw.trim();
    const page = href.match(/^@page:([a-z0-9-]+)(#[\w-]*)?$/);
    if (page) return ctx.pages.includes(page[1]!) ? all : `${pre}href=${q}@page:${ctx.cta}${q}`;
    if (/^#[\w-]*$/.test(href)) return all;
    if (/^tel:/i.test(href)) {
      const digits = href.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      const own = ctx.phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      if (own && digits === own) return all;
      stripped.push(`invented phone link ${href.slice(0, 30)}`);
      return `${pre}href=${q}@page:${ctx.cta}${q}`;
    }
    if (/^mailto:/i.test(href)) {
      if (ctx.email && href.slice(7).split("?")[0]!.toLowerCase() === ctx.email.toLowerCase()) return all;
      stripped.push(`invented email link ${href.slice(0, 40)}`);
      return `${pre}href=${q}@page:${ctx.cta}${q}`;
    }
    if (/^https?:\/\//i.test(href) && social.includes(href.replace(/\/+$/, "").toLowerCase())) return `${pre}href=${q}${href}${q} target="_blank" rel="noopener noreferrer"`;
    stripped.push(`link ${href.slice(0, 50)}`);
    return `${pre}href=${q}@page:${ctx.cta}${q}`;
  });
  // Any other href (svg <use>, <image>, <area>...): only #fragments and our image tokens.
  html = html.replace(/(<(?!a\b)[a-z][\w:-]*\b[^>]*?\s)(?:xlink:)?href\s*=\s*(["'])(.*?)\2/gi, (all, pre: string, q: string, raw: string) => {
    const v = raw.trim();
    const img = v.match(/^@img:([a-z0-9-]+)$/);
    if (/^#[\w-]+$/.test(v) || (img && ctx.images.includes(img[1]!))) return all;
    stripped.push(`href ${v.slice(0, 50)}`);
    return pre.trimEnd();
  });
  // Images: only our stored images; anything else is removed.
  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\ssrc\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim() ?? "";
    const img = src.match(/^@img:([a-z0-9-]+)$/);
    if (img && ctx.images.includes(img[1]!)) return /\salt\s*=/.test(tag) ? tag : tag.replace(/<img\b/i, '<img alt=""');
    stripped.push(`image ${src.slice(0, 60) || "(no src)"}`);
    return "";
  });
  // Inline styles: same rules as the stylesheet.
  html = html.replace(/\sstyle\s*=\s*(["'])(.*?)\1/gi, (_, q: string, css: string) => ` style=${q}${sanitizeCss(css, ctx, stripped).replace(new RegExp(q, "g"), "")}${q}`);
  // javascript:/data: anywhere else in attributes.
  html = html.replace(/\s([\w:-]+)\s*=\s*(["'])\s*(?:javascript|vbscript|data:text)[^"']*\2/gi, (_, attr: string) => {
    stripped.push(`${attr}=javascript:`);
    return "";
  });
  return { html: html.trim().slice(0, 80_000), css: inlineCss ? sanitizeCss(inlineCss, ctx, stripped) : "", stripped };
}

// ------------------------------------------------------------------------------------------------ validate

export type ValidateContext = SanitizeCustomContext & { name: string; keep: boolean; heroImage: boolean; palette: SitePalette };

const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000", red: "#ff0000", gray: "#808080", grey: "#808080", silver: "#c0c0c0", navy: "#000080", yellow: "#ffff00", orange: "#ffa500" };

function resolveColor(value: string, vars: Record<string, string>): string | undefined {
  const v = value.trim().replace(/\s*!important$/i, "").toLowerCase();
  const variable = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/);
  if (variable) return vars[variable[1]!] ?? (variable[2] ? resolveColor(variable[2], vars) : undefined);
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const rgb = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (rgb) {
    const alpha = rgb[4] ? (rgb[4].endsWith("%") ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4])) : 1;
    if (alpha < 0.95) return undefined; // translucent: depends on what is behind it
    return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("")}`;
  }
  return NAMED[v];
}

/** Rule blocks (selector + declarations) outside @keyframes, for the contrast check. */
function cssRules(css: string): { selector: string; decls: Record<string, string> }[] {
  const out: { selector: string; decls: Record<string, string> }[] = [];
  const flat = css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi, "");
  for (const m of flat.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const decls: Record<string, string> = {};
    for (const d of m[2]!.split(";")) {
      const i = d.indexOf(":");
      if (i > 0) decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
    }
    out.push({ selector: m[1]!.trim().replace(/\s+/g, " "), decls });
  }
  return out;
}

/** Every problem that makes the from-scratch page unusable (empty = passes). */
export function validateCustom(html: string, css: string, ctx: ValidateContext): string[] {
  const problems: string[] = [];
  const text = html
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/@brand:(?:light|dark)/.test(html) && !text.toLowerCase().includes(ctx.name.toLowerCase())) problems.push(`The business name "${ctx.name}" (or the @brand:light / @brand:dark token) is missing.`);
  if (!/<header\b/i.test(html) || !/<nav\b/i.test(html)) problems.push("There must be a <header> with a <nav>.");
  // The header's nav must reach every page (a footer-only link list doesn't count).
  const header = html.match(/<header\b[\s\S]*?<\/header>/i)?.[0] ?? "";
  const linked = new Set([...header.matchAll(/href\s*=\s*["']@page:([a-z0-9-]+)/gi)].map((m) => m[1]!));
  const missing = ctx.pages.filter((p) => !linked.has(p));
  if (missing.length) problems.push(`The header nav must link every page; missing: ${missing.map((p) => `@page:${p}`).join(", ")}.`);
  const ctaLinks = [...html.matchAll(new RegExp(`<a\\b[^>]*href\\s*=\\s*["']@page:${ctx.cta}["'][^>]*>`, "gi"))];
  if (!ctaLinks.length) problems.push(`There must be a call-to-action button linking to @page:${ctx.cta}.`);
  else {
    const mainAt = html.search(/<main\b/i);
    const h1At = html.search(/<h1\b/i);
    const heroEnd = h1At >= 0 ? html.indexOf("</section>", h1At) : -1;
    if (!ctaLinks.some((m) => m.index! > Math.max(mainAt, 0) && (heroEnd < 0 || m.index! < heroEnd))) problems.push(`The hero (the section with the <h1>) needs a call-to-action button linking to @page:${ctx.cta}.`);
  }
  if (ctx.phone && !/href\s*=\s*["']tel:/i.test(html)) problems.push(`The phone ${ctx.phone} must be a tel: link.`);
  const h1 = (html.match(/<h1\b/gi) ?? []).length;
  if (h1 !== 1) problems.push(`There must be exactly one <h1> (found ${h1}).`);
  if (text.length < 300) problems.push(`The page is nearly empty (${text.length} characters of text).`);
  if ((html.match(/<section\b/gi) ?? []).length < 3) problems.push("Use at least 3 <section>s inside <main>.");
  if (!/<footer\b/i.test(html)) problems.push("There must be a <footer>.");
  if (ctx.keep && !/@img:hero\b/.test(html)) problems.push("The owner asked to keep their picture: show @img:hero large and whole.");
  else if (ctx.heroImage && !/@img:hero\b/.test(html + css)) problems.push("Use the hero photo @img:hero (it passed our quality check).");
  // Responsive.
  if (!/@media[^{]*(?:max-width|min-width)/i.test(css) && !/@container/i.test(css)) problems.push("Add responsive rules (@media (max-width: 720px) {...}) so the page works on phones.");
  const outside = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi, "");
  const wide = [...outside.matchAll(/(?:^|[;{\s])(?:min-)?width\s*:\s*(\d{3,5})px/gi)].map((m) => Number(m[1])).filter((n) => n > 600);
  if (wide.length) problems.push(`Fixed widths over 600px break phones (${wide.slice(0, 3).map((n) => `${n}px`).join(", ")}): use max-width, %, clamp() or grid.`);
  // Contrast (WCAG AA) of the declared pairs (autoFixContrast fixes these before we get here).
  const p = ctx.palette;
  const low = contrastFailures(css, p).map((f) => `${f.selector.slice(0, 60)}: ${f.fg} on ${f.bg} = ${f.ratio.toFixed(2)}:1 (needs ${f.need}:1)`);
  if (low.length) problems.push(`Text contrast below WCAG AA: ${low.slice(0, 5).join("; ")}.`);
  for (const [a, b, label] of [
    [p.text, p.background, "--text on --background"],
    [p.text, p.surface, "--text on --surface"],
  ] as const) {
    if (isHex(a) && isHex(b) && contrast(a, b) < 4.5) problems.push(`Palette ${label} is ${contrast(a, b).toFixed(2)}:1 (needs 4.5:1).`);
  }
  if (html.length > 80_000) problems.push("The html is too long.");
  return problems;
}

// ------------------------------------------------------------------------------------------------ contrast

function contrastVars(css: string, p: SitePalette): Record<string, string> {
  const vars: Record<string, string> = { "--background": p.background, "--surface": p.surface, "--text": p.text, "--muted": p.muted, "--primary": p.primary, "--accent": p.accent };
  vars["--on-primary"] = onColor(p.primary);
  vars["--on-accent"] = onColor(p.accent);
  for (const r of cssRules(css)) {
    for (const [k, v] of Object.entries(r.decls)) if (k.startsWith("--")) {
      const c = resolveColor(v, vars);
      if (c) vars[k] = c;
    }
  }
  return vars;
}

type ContrastFailure = { selector: string; fg: string; bg: string; ratio: number; need: number; ownBg: boolean };

/**
 * Text/background pairs below WCAG AA, rule by rule: same-rule pairs need 4.5:1 (3:1 for headline-ish selectors);
 * a color-only rule is checked against its nearest ancestor rule's background (".steps li b" -> ".steps li") at 3:1.
 */
function contrastFailures(css: string, p: SitePalette): ContrastFailure[] {
  const vars = contrastVars(css, p);
  const rules = cssRules(css);
  const out: ContrastFailure[] = [];
  for (const r of rules) {
    const fg = r.decls.color ? resolveColor(r.decls.color, vars) : undefined;
    if (!fg) continue;
    const own = ruleBg(r, vars);
    const bg = own === undefined ? inheritedBg(r.selector, rules, vars) : own;
    if (!bg) continue;
    const large = own === undefined || /\bh1\b|\bh2\b|display|headline|hero-title|big|huge|mega/i.test(r.selector);
    const need = large ? 3 : 4.5;
    const ratio = contrast(fg, bg);
    if (ratio < need) out.push({ selector: r.selector, fg, bg, ratio, need, ownBg: own !== undefined });
  }
  return out;
}

function ruleBg(r: { decls: Record<string, string> }, vars: Record<string, string>): string | undefined | null {
  const raw = r.decls["background-color"] ?? r.decls.background;
  if (!raw) return undefined;
  if (/url\(|gradient/i.test(raw)) return null; // a photo/gradient: can't tell statically
  return resolveColor(raw.split(/\s+(?![^(]*\))/)[0]!, vars) ?? null;
}

// The background a color-only rule sits on: the nearest ancestor rule by selector prefix (".steps li b" ->
// ".steps li" -> ".steps"). No ancestor in the selector: the element may sit in any section (the browser check measures it).
function inheritedBg(selector: string, rules: { selector: string; decls: Record<string, string> }[], vars: Record<string, string>): string | null {
  const parts = selector.split(",")[0]!.trim().split(" ");
  for (let n = parts.length - 1; n >= 1; n -= 1) {
    const prefix = parts.slice(0, n).join(" ");
    for (const r of rules) {
      if (!r.selector.split(",").map((x) => x.trim()).includes(prefix)) continue;
      const bg = ruleBg(r, vars);
      if (bg !== undefined) return bg;
    }
  }
  return null;
}

/** Move a color toward black or white (same hue) until it reaches `need` against `other`; undefined if it can't. */
function shiftFor(color: string, other: string, need: number): string | undefined {
  const toward = contrast("#000000", other) >= contrast("#ffffff", other) ? "#000000" : "#ffffff";
  for (let t = 0.04; t <= 1.0001; t += 0.04) {
    const c = mix(color, toward, Math.min(1, t));
    if (contrast(c, other) >= need + 0.05) return c;
  }
  return undefined;
}

/**
 * Deterministic WCAG AA fix (before any repair pass; Bob, round 2: a page fell back to a template over a 3.5:1
 * button). Rule by rule: a button-like pair (own background) keeps its text and darkens / lightens its background,
 * same hue; a color-only rule moves its text color instead. Returns the fixed CSS and what changed.
 */
export function autoFixContrast(css: string, p: SitePalette): { css: string; fixes: string[] } {
  const fixes: string[] = [];
  let current = css;
  // A selector can appear more than once (base + @media): a few passes fix each occurrence.
  for (let pass = 0; pass < 4; pass += 1) {
    const r = fixOnce(current, p);
    if (!r.fixes.length) break;
    fixes.push(...r.fixes);
    current = r.css;
  }
  return { css: current, fixes };
}

function fixOnce(css: string, p: SitePalette): { css: string; fixes: string[] } {
  const failing = contrastFailures(css, p);
  if (!failing.length) return { css, fixes: [] };
  const vars = contrastVars(css, p);
  const bySelector = new Map(failing.map((f) => [f.selector, f]));
  const fixes: string[] = [];
  const fixed = css.replace(/([^{}@;]+)\{([^{}]*)\}/g, (whole, sel: string, body: string) => {
    const f = bySelector.get(sel.trim().replace(/\s+/g, " "));
    if (!f) return whole;
    // This occurrence must be the failing one (a selector can repeat: base rule + @media).
    const own: Record<string, string> = {};
    for (const d of body.split(";")) {
      const i = d.indexOf(":");
      if (i > 0) own[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
    }
    const ownFg = own.color ? resolveColor(own.color, vars) : undefined;
    const ownBg = ruleBg({ decls: own }, vars);
    if (ownFg !== f.fg || (f.ownBg ? ownBg !== f.bg : ownBg !== undefined)) return whole;
    bySelector.delete(f.selector);
    const decls = body.split(";");
    const setDecl = (key: RegExp, value: string) => decls.map((d) => (key.test(d.slice(0, Math.max(0, d.indexOf(":"))).trim()) ? `${d.slice(0, d.indexOf(":"))}:${value}${/!important/i.test(d) ? " !important" : ""}` : d));
    let next: string[] | undefined;
    if (f.ownBg) {
      const bg = shiftFor(f.bg, f.fg, f.need);
      if (bg) {
        next = setDecl(/^background(-color)?$/i, bg);
        fixes.push(`${f.selector.slice(0, 50)}: background ${f.bg} -> ${bg} (${contrast(f.fg, bg).toFixed(2)}:1)`);
      }
    }
    if (!next) {
      const fg = shiftFor(f.fg, f.bg, f.need) ?? onColor(f.bg);
      next = setDecl(/^color$/i, fg);
      fixes.push(`${f.selector.slice(0, 50)}: text ${f.fg} -> ${fg} (${contrast(fg, f.bg).toFixed(2)}:1)`);
    }
    return `${sel}{${next.join(";")}}`;
  });
  return { css: fixed, fixes };
}

/** Contrast problems are fixed automatically and never make us drop the page; everything else is structural. */
export function isStructuralProblem(problem: string): boolean {
  return !/^(Text contrast below WCAG AA|Palette --)/.test(problem);
}

/** "Layout: designed from scratch · concept “The Launchpad”" for the card. */
export function customLayoutLine(brief: CustomBrief): string {
  return `Layout: designed from scratch · concept “${brief.concept}” · ${brief.metaphor.slice(0, 90)}`;
}

// ------------------------------------------------------------------------------------------------ mockup fidelity

/** What the mockup looks like, sampled from its pixels (server side): bands top to bottom and its main colors. */
export type MockupColors = {
  /** Horizontal bands: header (top 10%), hero (10-70%), below (70-100%), each its dominant color. */
  bands: { name: "header" | "hero" | "below"; hex: string; tone: Tone }[];
  /** The main colors of the whole mockup with their share of the pixels (≥4%). */
  palette: { hex: string; share: number }[];
};
type Tone = "dark" | "mid" | "light";

export const toneOf = (hex: string): Tone => {
  const l = luminance(hex);
  return l < 0.12 ? "dark" : l > 0.45 ? "light" : "mid";
};

const hex2 = (r: number, g: number, b: number) => `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("")}`;
const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const dist = (a: string, b: string) => {
  const [x, y] = [rgbOf(a), rgbOf(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

/** Dominant colors of an RGBA pixel buffer: 32-level buckets, each bucket's mean color, by share. */
function dominant(data: Uint8Array, width: number, y0: number, y1: number, step: number): { hex: string; share: number }[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3]! < 128) continue;
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n += 1; e.r += r; e.g += g; e.b += b;
      buckets.set(key, e);
      total += 1;
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .map((e) => ({ hex: hex2(e.r / e.n, e.g / e.n, e.b / e.n), share: total ? e.n / total : 0 }));
}

/** Sample the mockup's pixels (RGBA): its header / hero / below bands and its main colors. */
export function mockupColors(data: Uint8Array, width: number, height: number): MockupColors {
  const step = Math.max(1, Math.round(Math.min(width, height) / 180));
  const band = (name: MockupColors["bands"][number]["name"], a: number, b: number) => {
    const top = dominant(data, width, Math.floor(height * a), Math.max(Math.floor(height * a) + 1, Math.floor(height * b)), step)[0];
    const hex = top?.hex ?? "#ffffff";
    return { name, hex, tone: toneOf(hex) };
  };
  const merged: { hex: string; share: number }[] = [];
  for (const c of dominant(data, width, 0, height, step)) {
    const near = merged.find((m) => dist(m.hex, c.hex) < 40);
    if (near) near.share += c.share;
    else merged.push({ ...c });
  }
  return {
    bands: [band("header", 0, 0.1), band("hero", 0.1, 0.7), band("below", 0.7, 1)],
    palette: merged.filter((c) => c.share >= 0.04).sort((a, b) => b.share - a.share).slice(0, 6).map((c) => ({ hex: c.hex, share: Math.round(c.share * 100) / 100 })),
  };
}

/** The sampled colors as prompt text for the vision build. */
export function mockupColorsText(m: MockupColors): string {
  return `Colors sampled from the mockup's pixels (match them): ${m.bands.map((b) => `${b.name} area ${b.hex} (${b.tone})`).join(", ")}; main colors ${m.palette.map((c) => `${c.hex} ${Math.round(c.share * 100)}%`).join(", ")}.`;
}

type Region = { tag: string; cls: string; bg: string | "image" | undefined };

/** The built page's regions in order (header, sections, footer) with the background each declares (or inherits). */
export function declaredRegions(html: string, css: string, p: SitePalette): Region[] {
  const vars = contrastVars(css, p);
  const rules = cssRules(css);
  const page = (() => {
    for (const r of rules) if (/(^|,)\s*(body|html|:root|\.page|main)\s*(,|$)/.test(r.selector)) {
      const bg = ruleBg(r, vars);
      if (bg) return bg;
    }
    return p.background;
  })();
  const out: Region[] = [];
  for (const m of html.matchAll(/<(header|section|footer)\b([^>]*)>/gi)) {
    const attrs = m[2] ?? "";
    const cls = (attrs.match(/class\s*=\s*"([^"]*)"/i)?.[1] ?? "").trim();
    const id = attrs.match(/id\s*=\s*"([^"]*)"/i)?.[1] ?? "";
    const tag = m[1]!.toLowerCase();
    const inline = attrs.match(/style\s*=\s*"[^"]*background(?:-color)?\s*:\s*([^;"]+)/i)?.[1];
    const names = [tag, ...cls.split(/\s+/).filter(Boolean).map((c) => `.${c}`), ...(id ? [`#${id}`] : [])];
    let bg: Region["bg"];
    if (inline) bg = /url\(|@img:/i.test(inline) ? "image" : resolveColor(inline.split(/\s+(?![^(]*\))/)[0]!, vars);
    for (const r of rules) {
      if (bg) break;
      const hit = r.selector.split(",").some((sel) => {
        const last = sel.trim().split(/\s+|>/).filter(Boolean).pop() ?? "";
        if (/::?(before|after|hover|focus)/.test(last)) return false;
        const parts = last.match(/(^[a-z][\w-]*|[.#][\w-]+)/gi) ?? [];
        return parts.length > 0 && parts.every((x) => names.includes(x.toLowerCase().startsWith(".") || x.startsWith("#") ? x : x.toLowerCase()));
      });
      if (!hit) continue;
      const raw = r.decls["background-color"] ?? r.decls.background ?? r.decls["background-image"];
      if (!raw) continue;
      if (/url\(|@img:/i.test(raw)) bg = "image";
      else if (/gradient/i.test(raw)) {
        const c = raw.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|var\(--[\w-]+\)|rgba?\([^)]*\)/i)?.[0];
        bg = c ? resolveColor(c, vars) : undefined;
      } else bg = resolveColor(raw.split(/\s+(?![^(]*\))/)[0]!, vars);
    }
    out.push({ tag, cls, bg: bg ?? page });
  }
  return out;
}

export type Fidelity = { score: number; regions: string[]; palette: string; diff: string[] };

/**
 * Render-free fidelity check: does the built page's color blocking follow the mockup? Header / hero / the next
 * section's declared backgrounds vs the mockup's sampled bands (tone + color), plus how many of the mockup's main
 * colors appear in the CSS. 0-100; under 60 gets one repair pass with the differences.
 */
export function fidelityScore(m: MockupColors, html: string, css: string, p: SitePalette): Fidelity {
  const regions = declaredRegions(html, css, p);
  const header = regions.find((r) => r.tag === "header");
  const sections = regions.filter((r) => r.tag === "section");
  const pairs: [MockupColors["bands"][number], Region | undefined][] = [
    [m.bands[0]!, header],
    [m.bands[1]!, sections[0]],
    [m.bands[2]!, sections[1]],
  ];
  const diff: string[] = [];
  const lines: string[] = [];
  let sum = 0;
  for (const [band, region] of pairs) {
    if (!region) {
      sum += 0.5;
      lines.push(`${band.name} ?`);
      continue;
    }
    if (region.bg === "image") {
      sum += 0.8;
      lines.push(`${band.name} photo`);
      continue;
    }
    const bg = region.bg ?? p.background;
    const same = toneOf(bg) === band.tone;
    const close = dist(bg, band.hex) < 90;
    const s = same && close ? 1 : same ? 0.7 : close ? 0.5 : 0;
    sum += s;
    lines.push(`${band.name} ${s >= 0.7 ? "✓" : "✗"} ${band.tone} ${band.hex} vs ${bg}`);
    if (s < 0.7) diff.push(`The mockup's ${band.name} area is ${band.tone} (${band.hex}) but your ${region.tag}${region.cls ? `.${region.cls.split(/\s+/)[0]}` : ""} background is ${toneOf(bg)} (${bg}): use ${band.hex} (or the closest palette color) there.`);
  }
  const used = [...new Set([...(css.match(/#[0-9a-f]{6}\b/gi) ?? []).map((c) => c.toLowerCase()), ...Object.values(contrastVars(css, p))])];
  const main = m.palette.filter((c) => c.share >= 0.06);
  const missing = main.filter((c) => !used.some((u) => /^#[0-9a-f]{6}$/.test(u) && dist(u, c.hex) < 60));
  const coverage = main.length ? (main.length - missing.length) / main.length : 1;
  if (missing.length) diff.push(`Main mockup colors missing from your CSS: ${missing.map((c) => `${c.hex} (${Math.round(c.share * 100)}% of the mockup)`).join(", ")}.`);
  const score = Math.round(100 * (0.6 * (sum / pairs.length) + 0.4 * coverage));
  return { score, regions: lines, palette: `${main.length - missing.length}/${main.length} main colors`, diff };
}
