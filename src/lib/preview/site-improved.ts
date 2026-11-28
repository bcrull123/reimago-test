/**
 * Round 16 — “Your Site, Improved” (card 1) and “Sunlit Cut” (card 3).
 * Improved is a faithful refresh of the current site; Sunlit Cut is the
 * creative light look (oversized bleed photo, color-blocked highlights, short type).
 */
import { finalizeBlurb } from "./blurb.ts";
import { isFoodSite, type GuardFacts } from "./copy-guard.ts";
import { luminance } from "./design.ts";
import { businessWhere } from "./look-diversity.ts";
import { detectTheme } from "./theme-lean.ts";
import {
  IMPROVED_NAME,
  SUNLIT_NAME,
  brandColorWord,
  improvedCtas,
  improvedFonts,
  improvedHeadline,
  improvedMood,
  improvedPalette,
} from "./site-brand.ts";
import type { DesignDirection, PlanPage, Section, SiteFacts, SitePlan } from "./types.ts";
import type { ComposeImages } from "./sections.ts";
import { scrubCopy } from "./site-copy.ts";

export { IMPROVED_NAME, SUNLIT_NAME };

export function isImprovedLook(d: Pick<DesignDirection, "name" | "improved"> | undefined): boolean {
  return Boolean(d?.improved) || d?.name === IMPROVED_NAME;
}

export function isSunlitLook(d: Pick<DesignDirection, "name" | "heroStyle"> | undefined): boolean {
  return d?.name === SUNLIT_NAME || d?.heroStyle === "bleed";
}

function firstSentences(text: string, count: number, max = 320): string {
  text = scrubCopy(text || "");
  if (!text) return "";
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, count).join(" ").slice(0, max);
}

function lead(facts: SiteFacts): string {
  return firstSentences(facts.description || facts.about || facts.tagline, 2) || `${facts.name}${facts.industry ? ` · ${facts.industry}` : ""}`;
}

function keepThemeSkin(facts: SiteFacts, seed?: DesignDirection): boolean {
  return detectTheme(facts)?.id === "horror" || Boolean(seed?.era);
}

/** Build the Improved direction from the scraped brand. `seed` may carry a theme skin on a new-site create. */
export function asImprovedDirection(facts: SiteFacts, seed?: DesignDirection, index = 0): DesignDirection {
  const palette =
    facts.mode === "create" && !facts.sourceUrl && seed?.palette && (facts.colors?.length ?? 0) === 0 && (facts.inks?.length ?? 0) === 0
      ? seed.palette
      : improvedPalette(facts);
  const fonts = facts.fonts?.length ? improvedFonts(facts) : seed?.fonts && facts.mode === "create" && !facts.sourceUrl ? seed.fonts : improvedFonts(facts);
  const dark = luminance(palette.background) < 0.28;
  const food = isFoodSite(facts as GuardFacts);
  const ctas = improvedCtas(facts);
  const base: DesignDirection = seed
    ? { ...seed }
    : {
        id: `look-${index + 1}`,
        name: IMPROVED_NAME,
        mood: "",
        archetype: dark ? "dark-premium" : "warm-craft",
        palette,
        fonts,
        imagery: "",
        heroSubject: "",
        motifs: dark ? ["thin-rules", "grain"] : ["thin-rules", "underline-marks"],
        radius: "sharp",
        buttons: "square",
        hero: "photo",
        header: dark ? "dark" : "light",
        footer: "columns",
        headline: "",
        rationale: "",
      };
  return {
    ...base,
    id: `look-${index + 1}`,
    name: IMPROVED_NAME,
    improved: true,
    custom: undefined,
    palette,
    fonts,
    archetype: dark ? "dark-premium" : "warm-craft",
    hero: "photo",
    heroStyle: "improved",
    layout: "showcase",
    header: dark ? "dark" : "light",
    buttons: "square",
    radius: "sharp",
    footer: "columns",
    motifs: dark ? ["thin-rules", "grain"] : ["thin-rules", "underline-marks"],
    headline: improvedHeadline(facts),
    mood: improvedMood(facts),
    heroSubject: food ? "A close, appetizing photograph of the restaurant’s real food, no typography or logos in the frame." : "The business’s best real photograph, shown large, with no typography or logos in the frame.",
    imagery: dark
      ? "Keep the current dark brand. Lead with a real photograph (food, when this is a restaurant), generous type, and a clear button."
      : "Keep the current brand colors and type feel. Lead with a real photograph and a clear button.",
    rationale: `A recognizable refresh of ${facts.name || "the current site"}: same brand, better photos, a clearer ${ctas.primary.label} button.`,
  };
}

const SUNLIT_PALETTE = {
  primary: "#9a3412",
  accent: "#c45c26",
  background: "#f6efe4",
  surface: "#efe4d4",
  text: "#1a120c",
  muted: "#5c4a3d",
};

export function sunlitMood(facts: SiteFacts): string {
  const who = businessWhere(facts);
  if (isFoodSite(facts as GuardFacts)) {
    return finalizeBlurb(`A sunlit, appetite-first look for ${who} — an oversized food photo that spills off the page, a bold color-blocked menu strip, and a short, hungry headline.`);
  }
  return finalizeBlurb(`A sunlit, photo-forward look for ${who} — an oversized picture that spills off the page, a bold color-blocked highlight strip, and a short, expressive headline.`);
}

export function sunlitHeadline(facts: SiteFacts): string {
  if (isFoodSite(facts as GuardFacts)) return "Come hungry.";
  const place = (facts.address ?? "").replace(/\s+/g, " ").trim();
  if (/\bValley\b|\bCity\b|\bTown\b/i.test(facts.name) || place) return "See it up close.";
  return "Look closer.";
}

export function asSunlitCut(facts: SiteFacts, seed?: DesignDirection, index = 2): DesignDirection {
  const base = seed ?? asImprovedDirection(facts, undefined, index);
  const keepSkin = keepThemeSkin(facts, seed);
  return {
    ...base,
    id: `look-${index + 1}`,
    name: SUNLIT_NAME,
    improved: undefined,
    custom: undefined,
    archetype: "editorial",
    palette: keepSkin && seed?.palette ? seed.palette : { ...SUNLIT_PALETTE },
    fonts: keepSkin && seed?.fonts ? seed.fonts : { heading: "Fraunces", body: "Source Sans 3" },
    hero: "split",
    heroStyle: "bleed",
    layout: "bold",
    header: "light",
    buttons: "square",
    radius: "sharp",
    footer: "minimal",
    motifs: ["grain", "diagonal-cuts", "oversized-numbers"],
    headline: sunlitHeadline(facts),
    mood: sunlitMood(facts),
    heroSubject: isFoodSite(facts as GuardFacts)
      ? "An oversized, tightly cropped photograph of real food, filling the frame and bleeding off one edge. No typography, no logos."
      : "An oversized photograph of the place, tightly cropped and bleeding off one edge. No typography, no logos.",
    imagery: "Bright, warm daylight. Tight, unexpected crops. Real photographs shown larger than the frame. No typography in the picture.",
    rationale: `A creative light look for ${facts.name || "this business"}: a bleed photo, a color-blocked strip, and short expressive type.`,
  };
}

export function asDarkPremiumKeep(facts: SiteFacts, seed?: DesignDirection, index = 1): DesignDirection {
  const who = businessWhere(facts);
  const food = isFoodSite(facts as GuardFacts);
  const palette = {
    primary: "#e8d9c4",
    accent: "#e8b86d",
    background: "#12110f",
    surface: "#1c1a17",
    text: "#f3efe6",
    muted: "#b9b5ad",
  };
  const base = seed ?? ({ id: `look-${index + 1}` } as DesignDirection);
  const keepSkin = keepThemeSkin(facts, seed);
  return {
    ...base,
    id: `look-${index + 1}`,
    name: "Dark Premium",
    improved: undefined,
    custom: undefined,
    archetype: "dark-premium",
    palette: keepSkin && seed?.palette ? seed.palette : palette,
    fonts: keepSkin && seed?.fonts ? seed.fonts : { heading: "Space Grotesk", body: "Manrope" },
    hero: "photo",
    heroStyle: "cinematic",
    layout: "showcase",
    header: "overlay",
    buttons: "square",
    radius: "sharp",
    footer: "minimal",
    motifs: ["glow", "thin-rules", "grain"],
    headline: food ? "Tonight’s plates." : base.headline || "After dark.",
    mood: finalizeBlurb(`A cinematic after-dark look for ${who} — deep ground, warm metallic light, and photography that glows.`),
    heroSubject: food
      ? "Cinematic, low-key photograph of real food, warm highlights, no typography or logos."
      : base.heroSubject || "A cinematic photograph of the place at dusk, warm highlights, no typography or logos.",
    imagery: "Low-key lighting, deep shadows, warm gold highlights, rich textures, cinematic shallow depth of field.",
    rationale: `A cinematic dark look for ${facts.name || "this business"}, distinct from the current-site refresh.`,
  };
}

/**
 * Final card order: 1. Your Site, Improved  2. Dark Premium  3. Sunlit Cut.
 * Custom Design is never assigned as a look.
 */
export function arrangeLooks(raw: DesignDirection[], facts: SiteFacts): DesignDirection[] {
  const list = raw.slice(0, 3);
  const improvedSeed = list.find((d) => isImprovedLook(d)) ?? list[0];
  const darkSeed = list.find((d) => d.archetype === "dark-premium" && !isImprovedLook(d)) ?? list[1] ?? list[0];
  const sunlitSeed = list.find((d) => isSunlitLook(d)) ?? list[2] ?? list[0];
  return [asImprovedDirection(facts, improvedSeed, 0), asDarkPremiumKeep(facts, darkSeed, 1), asSunlitCut(facts, sunlitSeed, 2)];
}

function trustRow(facts: SiteFacts): Section | undefined {
  const items: { title: string; text: string }[] = [];
  if (facts.hours[0]) items.push({ title: facts.hours[0].slice(0, 42), text: "Hours" });
  if (facts.address) {
    const short = facts.address.replace(/\s+/g, " ").trim();
    const city = short.match(/([A-Za-z .']+,\s*[A-Z]{2})/)?.[1] ?? short.slice(0, 48);
    items.push({ title: city, text: "Find us" });
  }
  if (facts.phone) items.push({ title: facts.phone, text: "Call" });
  else if (facts.testimonials.length) items.push({ title: `${facts.testimonials.length} review${facts.testimonials.length === 1 ? "" : "s"}`, text: "From guests" });
  if (items.length < 2) return undefined;
  return { type: "stat-bar", variant: "trust", tone: "tint", items: items.map((it) => ({ title: it.title, text: it.text })) };
}

function highlightStrip(facts: SiteFacts, tone: Section["tone"], variant: string): Section | undefined {
  const labels = facts.services.slice(0, 6);
  if (labels.length < 2) return undefined;
  const food = isFoodSite(facts as GuardFacts);
  return {
    type: "services-grid",
    tone,
    variant,
    eyebrow: food ? "On the menu" : "Highlights",
    heading: food ? "Today’s plates" : "What we do",
    items: labels.map((title) => ({ title, text: "" })),
  };
}

export function composeImprovedPage(page: PlanPage, facts: SiteFacts, plan: SitePlan, images: ComposeImages): Section[] {
  const ctas = improvedCtas(facts);
  const menuPage = plan.pages.find((p) => p.slug === ctas.primary.page || /menu|service|product|what-we-do/.test(p.slug));
  const primary = { label: ctas.primary.label, page: menuPage?.slug ?? ctas.primary.page };
  const secondary = ctas.secondary ? { label: ctas.secondary.label, page: plan.pages.some((p) => p.slug === ctas.secondary!.page) ? ctas.secondary.page : "contact" } : undefined;
  const aboutSlug = plan.pages.find((p) => p.slug === "about")?.slug;
  const food = isFoodSite(facts as GuardFacts);
  const dark = luminance(improvedPalette(facts).background) < 0.28;
  if (page.slug !== "home") return composeInner(page, facts, plan, images, primary);
  const hero: Section = {
    type: "hero-photo",
    variant: "improved",
    tone: dark ? "dark" : "light",
    eyebrow: facts.industry || facts.name,
    heading: improvedHeadline(facts),
    text: lead(facts),
    image: images.hero ?? images.photos[0],
    cta: primary,
    secondary,
    call: Boolean(facts.phone) && primary.label !== "Call",
  };
  const trust = trustRow(facts);
  const strip = highlightStrip(facts, dark ? "brand" : "tint", food ? "blocks" : "images");
  const aboutText = firstSentences(facts.about || facts.description, 4, 700);
  const about: Section[] = aboutText
    ? [
        {
          type: "feature-split",
          tone: dark ? "tint" : "light",
          eyebrow: "About us",
          heading: `About *${facts.name}*`,
          text: aboutText,
          image: images.feature ?? images.photos[1],
          cta: aboutSlug ? { label: "Our story", page: aboutSlug } : undefined,
        },
      ]
    : [];
  const reviews: Section[] = facts.testimonials.length
    ? [{ type: "reviews", tone: "light", eyebrow: "Kind words", heading: "What guests say", items: facts.testimonials.map((t) => ({ title: t.author, text: t.quote })) }]
    : [];
  const gallery: Section[] =
    images.photos.length >= 3
      ? [{ type: "gallery", tone: dark ? "dark" : "light", eyebrow: food ? "From the kitchen" : "A look around", heading: food ? "The food, *up close*" : "A look *around*", items: images.photos.slice(0, 6).map((image, i) => ({ title: `Photo ${i + 1}`, text: "", image })) }]
      : [];
  const band: Section = {
    type: "cta-band",
    tone: "light",
    heading: `${primary.label} *today*`,
    text: facts.phone ? `Call ${facts.phone} or stop in — we’d love to see you.` : "Send a message and we’ll get back to you.",
    cta: primary,
    call: Boolean(facts.phone),
  };
  return [hero, ...(trust ? [trust] : []), ...(strip ? [strip] : []), ...about, ...reviews, ...gallery, band];
}

export function composeSunlitPage(page: PlanPage, facts: SiteFacts, plan: SitePlan, images: ComposeImages): Section[] {
  if (page.slug !== "home") return composeImprovedPage(page, facts, plan, images);
  const ctas = improvedCtas(facts);
  const menuPage = plan.pages.find((p) => p.slug === ctas.primary.page || /menu|service|product|what-we-do/.test(p.slug));
  const primary = { label: ctas.primary.label, page: menuPage?.slug ?? ctas.primary.page };
  const food = isFoodSite(facts as GuardFacts);
  const second = images.photos.find((p) => p && p !== (images.hero ?? images.photos[0]));
  const hero: Section = {
    type: "hero-split",
    variant: "bleed",
    tone: "light",
    eyebrow: food ? "On the boulevard" : facts.industry || facts.name,
    heading: sunlitHeadline(facts),
    text: food ? "Lunch, dinner, and everything in between — plated, not posted." : lead(facts).slice(0, 140),
    image: images.hero ?? images.photos[0],
    items: second ? [{ title: "", text: "", image: second }] : undefined,
    cta: primary,
    call: Boolean(facts.phone),
  };
  const strip = highlightStrip(facts, "brand", "blocks");
  const aboutText = firstSentences(facts.about || facts.description, 3, 500);
  const about: Section[] = aboutText
    ? [{ type: "feature-split", tone: "light", reverse: true, eyebrow: "The story", heading: `Inside *${facts.name}*`, text: aboutText, image: images.feature ?? images.photos[1] }]
    : [];
  const gallery: Section[] =
    images.photos.length >= 3
      ? [{ type: "gallery", tone: "tint", eyebrow: food ? "From the pass" : "Around town", heading: food ? "Plates, *close in*" : "A closer *look*", items: images.photos.slice(0, 6).map((image, i) => ({ title: `Photo ${i + 1}`, text: "", image })) }]
      : [];
  const reviews: Section[] = facts.testimonials.length
    ? [{ type: "reviews", tone: "light", eyebrow: "From the room", heading: "What people say", items: facts.testimonials.map((t) => ({ title: t.author, text: t.quote })) }]
    : [];
  const band: Section = {
    type: "cta-band",
    tone: "tint",
    heading: food ? "Grab a *table*" : "Let’s *talk*",
    text: facts.phone ? `Call ${facts.phone}.` : "Send a message and we’ll get back to you.",
    cta: primary,
    call: Boolean(facts.phone),
  };
  return [hero, ...(strip ? [strip] : []), ...about, ...gallery, ...reviews, band];
}

function composeInner(page: PlanPage, facts: SiteFacts, plan: SitePlan, images: ComposeImages, cta: { label: string; page: string }): Section[] {
  const band: Section = {
    type: "cta-band",
    tone: "light",
    heading: "Ready when *you* are",
    text: facts.phone ? `Call ${facts.phone} or send a message.` : "Send a message and we’ll get back to you.",
    cta,
    call: Boolean(facts.phone),
  };
  if (page.slug === "contact") {
    return [
      { type: "page-hero", tone: "tint", eyebrow: "Contact", heading: `Talk to *${facts.name}*`, text: "Reach us using the details below or send a message." },
      { type: "contact-block", tone: "light", heading: "Get in touch", text: facts.address ? `Find us at ${facts.address}.` : undefined },
    ];
  }
  if (page.slug === "about") {
    return [
      { type: "page-hero", tone: "tint", eyebrow: "About", heading: page.title, text: firstSentences(facts.description || facts.tagline, 1), image: images.feature ?? images.photos[1] },
      { type: "rich-text", tone: "light", heading: "Our story", text: facts.about || facts.description },
      band,
    ];
  }
  if (/service|menu|product|what-we-do/.test(page.slug)) {
    return [
      { type: "page-hero", tone: "tint", eyebrow: page.navLabel, heading: page.title, text: firstSentences(facts.description, 1) },
      ...(facts.services.length
        ? [{ type: "services-grid" as const, tone: "light" as const, variant: "blocks", heading: "Everything we do", items: facts.services.slice(0, 9).map((title) => ({ title, text: "" })) }]
        : []),
      band,
    ];
  }
  return [{ type: "page-hero", tone: "tint", eyebrow: page.navLabel, heading: page.title, text: page.purpose }, band];
}

export function improvedSiteCta(facts: SiteFacts, plan: SitePlan): { label: string; slug: string } {
  const { primary } = improvedCtas(facts);
  const slug = plan.pages.some((p) => p.slug === primary.page) ? primary.page : plan.pages.find((p) => /menu|service|product|what-we-do/.test(p.slug))?.slug ?? (plan.pages.some((p) => p.slug === "contact") ? "contact" : plan.pages[0]?.slug ?? "contact");
  return { label: primary.label, slug };
}
