/**
 * The section library: polished, pre-designed blocks the AI (or the mock
 * composer) picks from and fills with text. The AI never writes HTML — it
 * returns JSON, which is validated here and rendered by trusted templates
 * that escape every string. That keeps pages beautiful and safe:
 *   - no scripts, styles, or arbitrary markup from the model
 *   - phone/email/address only from scraped facts (invented ones are scrubbed)
 *   - reviews only quote real testimonials, stats only use numbers found in the facts
 *   - images only from the site's own stored image set
 */
import { escapeHtml, pageSlugFor, scrubInventedContacts } from "./sanitize.ts";
import { SECTION_TYPES, type DesignDirection, type PlanPage, type Section, type SectionItem, type SectionType, type SiteFacts, type SitePlan } from "./types.ts";

// ---------------------------------------------------------------- icons (trusted, inline SVG)

const ICON_PATHS: Record<string, string> = {
  wrench: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  drop: "M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z",
  flame: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  bolt: "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
  home: "M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  star: "m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  leaf: "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10zM2 21c0-3 1.85-5.36 5.08-6",
  sparkle: "M12 3l1.9 5.8L20 10.7l-6.1 1.9L12 18.5l-1.9-5.9L4 10.7l6.1-1.9zM19 3v4M21 5h-4",
  heart: "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  truck: "M10 17h4V5H2v12h3M14 9h4l4 4v4h-3M7.5 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM16.5 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  check: "M20 6 9 17l-5-5",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  pin: "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  phone:
    "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6",
  cup: "M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v2M10 2v2M14 2v2",
  scissors: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12",
  camera: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
  thermo: "M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z",
  arrow: "M5 12h14M12 5l7 7-7 7",
};

export const ICON_NAMES = Object.keys(ICON_PATHS);

export function icon(name: string, cls = "ico"): string {
  const path = ICON_PATHS[name] ?? ICON_PATHS.sparkle!;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

const ICON_HINTS: [RegExp, string][] = [
  [/drain|pipe|plumb|leak|water|sewer|faucet|toilet|rooter|hydro/i, "drop"],
  [/gas|heat|furnace|fire|boiler|grill|bbq|oven/i, "flame"],
  [/electric|power|wiring|panel|solar|energy/i, "bolt"],
  [/emergency|24|same.day|fast|quick/i, "clock"],
  [/inspect|camera|detect|locat|diagnos|audit/i, "search"],
  [/clean|detail|polish|sparkl/i, "sparkle"],
  [/lawn|garden|landscap|tree|eco|green|organic/i, "leaf"],
  [/coffee|cafe|tea|espresso|drink|bar/i, "cup"],
  [/hair|salon|cut|barber|groom/i, "scissors"],
  [/photo|video|film/i, "camera"],
  [/warrant|insur|guarantee|protect|safe|secur|licens/i, "shield"],
  [/deliver|shipping|moving|haul/i, "truck"],
  [/hvac|air|cool|temperature|thermostat/i, "thermo"],
  [/home|house|residential|remodel|roof|kitchen|bath/i, "home"],
  [/commercial|business|team|staff|family/i, "users"],
  [/schedule|book|appointment|event|calendar/i, "calendar"],
  [/consult|advice|talk|support|chat/i, "chat"],
  [/love|care|pet|health|wellness/i, "heart"],
  [/repair|fix|install|replace|service|maint/i, "wrench"],
];

export function iconFor(title: string, index: number): string {
  for (const [pattern, name] of ICON_HINTS) if (pattern.test(title)) return name;
  return ["sparkle", "star", "check", "shield", "heart", "wrench"][index % 6]!;
}

// ---------------------------------------------------------------- normalize AI output

export type NormalizeContext = {
  slugs: string[];
  phone: string;
  email: string;
  /** Image names available to this site (generated + stored photos). */
  images: string[];
  testimonials: { quote: string; author: string }[];
  /** All known text about the business — numbers in stats must appear here. */
  corpus: string;
  page: string;
};

const ALIASES: Record<string, SectionType> = {
  hero: "hero-split",
  "hero-image": "hero-photo",
  "hero-typographic": "hero-type",
  "inner-hero": "page-hero",
  stats: "stat-bar",
  "stat-band": "stat-bar",
  ticker: "marquee",
  services: "services-grid",
  "service-grid": "services-grid",
  features: "services-grid",
  feature: "feature-split",
  split: "feature-split",
  about: "feature-split",
  steps: "process",
  "how-it-works": "process",
  testimonials: "reviews",
  "review-carousel": "reviews",
  "before-after-compare": "before-after",
  photos: "gallery",
  quote: "statement",
  manifesto: "statement",
  "pull-quote": "statement",
  accordion: "faq",
  cta: "cta-band",
  "gradient-cta": "cta-band",
  contact: "contact-block",
  "map-contact": "contact-block",
  text: "rich-text",
  prose: "rich-text",
};

const HERO_TYPES = new Set<SectionType>(["hero-split", "hero-photo", "hero-type", "page-hero"]);

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "";
}

function cleanText(value: unknown, max: number, ctx: NormalizeContext): string {
  return scrubInventedContacts(clip(value, max).replace(/<[^>]*>/g, ""), ctx);
}

function imageName(value: unknown, ctx: NormalizeContext): string | undefined {
  const raw = clip(value, 80).replace(/^@img:/, "");
  return ctx.images.includes(raw) ? raw : undefined;
}

function pageLink(value: unknown, ctx: NormalizeContext): string {
  const raw = clip(value, 80).replace(/^@page:/, "");
  if (ctx.slugs.includes(raw)) return raw;
  return pageSlugFor(raw.startsWith("/") ? raw : `/${raw}`, ctx.slugs);
}

const normQuote = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Numbers in a stat must come from the facts ("25+ years" is fine only if "25" is in the facts). */
export function statIsReal(title: string, corpus: string): boolean {
  const numbers = title.match(/\d[\d,.]*/g);
  if (!numbers) return false;
  const digits = corpus.replace(/,/g, "");
  return numbers.every((n) => new RegExp(`(^|[^\\d])${n.replace(/,/g, "").replace(/\./g, "\\.")}([^\\d]|$)`).test(digits));
}

export function normalizeSection(raw: unknown, ctx: NormalizeContext): Section | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const typeRaw = clip(r.type, 40).toLowerCase().replace(/[\s_]+/g, "-");
  const type = ((SECTION_TYPES as readonly string[]).includes(typeRaw) ? typeRaw : ALIASES[typeRaw]) as SectionType | undefined;
  if (!type) return undefined;
  const tone = (["light", "tint", "dark", "brand"] as const).find((t) => t === r.tone) ?? "light";
  const items: SectionItem[] = (Array.isArray(r.items) ? r.items : [])
    .map((it) => {
      if (typeof it === "string") return { title: cleanText(it, 120, ctx), text: "" };
      if (!it || typeof it !== "object") return undefined;
      const o = it as Record<string, unknown>;
      const item: SectionItem = { title: cleanText(o.title ?? o.label ?? o.name ?? o.question ?? o.value, 140, ctx), text: cleanText(o.text ?? o.body ?? o.answer ?? o.description, 600, ctx) };
      const img = imageName(o.image, ctx);
      if (img) item.image = img;
      const ic = clip(o.icon, 20).toLowerCase();
      if (ICON_NAMES.includes(ic)) item.icon = ic;
      return item;
    })
    .filter((it): it is SectionItem => Boolean(it && (it.title || it.text || it.image)))
    .slice(0, 9);
  const cta = r.cta && typeof r.cta === "object" ? (r.cta as Record<string, unknown>) : undefined;
  const secondary = r.secondary && typeof r.secondary === "object" ? (r.secondary as Record<string, unknown>) : undefined;
  const section: Section = {
    type,
    tone,
    variant: clip(r.variant, 20).toLowerCase() || undefined,
    eyebrow: cleanText(r.eyebrow, 60, ctx) || undefined,
    heading: cleanText(r.heading, 160, ctx) || undefined,
    text: cleanText(r.text, 1400, ctx) || undefined,
    items: items.length ? items : undefined,
    image: imageName(r.image, ctx),
    cta: cta && clip(cta.label, 40) ? { label: cleanText(cta.label, 40, ctx), page: pageLink(cta.page ?? cta.slug, ctx) } : undefined,
    secondary: secondary && clip(secondary.label, 40) ? { label: cleanText(secondary.label, 40, ctx), page: pageLink(secondary.page ?? secondary.slug, ctx) } : undefined,
    call: r.call === true && Boolean(ctx.phone),
    align: r.align === "center" ? "center" : "left",
    reverse: r.reverse === true,
  };
  // Content guarantees per type.
  if (type === "stat-bar") {
    section.items = (section.items ?? []).filter((it) => statIsReal(it.title, ctx.corpus)).slice(0, 4);
    if (section.items.length < 2) return undefined;
  }
  if (type === "reviews") {
    if (!ctx.testimonials.length) return undefined;
    const matched = (section.items ?? [])
      .map((it) => {
        const probe = normQuote(it.text || it.title).slice(0, 60);
        return ctx.testimonials.find((t) => probe && (normQuote(t.quote).includes(probe.slice(0, 40)) || probe.includes(normQuote(t.quote).slice(0, 40))));
      })
      .filter((t): t is { quote: string; author: string } => Boolean(t));
    const unique = [...new Set(matched.length ? matched : ctx.testimonials)];
    section.items = unique.map((t) => ({ title: t.author, text: t.quote }));
  }
  if (type === "gallery") {
    section.items = (section.items ?? []).filter((it) => it.image);
    if (section.items.length < 3) return undefined;
  }
  if (type === "before-after" && (section.items ?? []).length < 2) return undefined;
  if (["services-grid", "process", "faq", "marquee"].includes(type) && !(section.items ?? []).length) return undefined;
  if (type === "faq") section.items = section.items!.filter((it) => it.title && it.text);
  return section;
}

/** Validate a page worth of AI sections; guarantee a hero first and sensible length. */
export function normalizeSections(raw: unknown, ctx: NormalizeContext): Section[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { sections?: unknown }).sections) ? (raw as { sections: unknown[] }).sections : [];
  const out: Section[] = [];
  for (const item of list) {
    const section = normalizeSection(item, ctx);
    if (!section) continue;
    if (HERO_TYPES.has(section.type) && out.some((s) => HERO_TYPES.has(s.type))) continue;
    if (section.type === "contact-block" && out.some((s) => s.type === "contact-block")) continue;
    out.push(section);
    if (out.length >= 9) break;
  }
  const heroIndex = out.findIndex((s) => HERO_TYPES.has(s.type));
  if (heroIndex > 0) out.unshift(...out.splice(heroIndex, 1));
  if (ctx.page !== "home" && out[0] && ["hero-split", "hero-photo", "hero-type"].includes(out[0].type)) out[0].type = "page-hero";
  return out;
}

export function corpusFor(facts: SiteFacts): string {
  return [
    facts.name,
    facts.tagline,
    facts.description,
    facts.about,
    facts.services.join(" "),
    facts.hours.join(" "),
    facts.address,
    facts.brief ?? "",
    facts.notes,
    ...facts.pages.map((p) => `${p.title} ${p.headings.join(" ")} ${p.text}`),
    ...facts.testimonials.map((t) => t.quote),
  ].join(" \n ");
}

// ---------------------------------------------------------------- deterministic composer (mock mode / AI fallback)

function emphasize(headline: string): string {
  if (headline.includes("*")) return headline;
  const words = headline.trim().split(/\s+/);
  if (words.length < 3) return headline;
  const last = words.pop()!;
  const trail = last.match(/[.!?]+$/)?.[0] ?? "";
  return `${words.join(" ")} *${last.slice(0, last.length - trail.length)}*${trail}`;
}

/** Short, fact-free headline for mock mode (long scraped taglines make poor heroes). */
function mockHeadline(facts: SiteFacts, plan: SitePlan, a: DesignDirection["archetype"]): string {
  const own = plan.tagline || facts.tagline;
  if (own && own.length <= 56) return own;
  const kind = (facts.industry || facts.services[0] || "").toLowerCase().replace(/\s+services?$/, "");
  const Kind = kind ? kind[0]!.toUpperCase() + kind.slice(1) : "";
  switch (a) {
    case "bold-photo":
      return Kind ? `${Kind} done *right*.` : "Done *right*, start to finish.";
    case "warm-craft":
      return "Honest work, *done well*.";
    case "dark-premium":
      return Kind ? `${Kind}, *elevated*.` : "Beautifully *simple*.";
    case "editorial":
      return Kind ? `Good ${kind} starts with *listening*.` : "It starts with *listening*.";
    case "playful":
      return "Let's make it *happen*!";
    case "minimal-luxury":
      return Kind ? `${Kind}, *considered*.` : "Simply *considered*.";
  }
}

function firstSentences(text: string, count: number, max = 320): string {
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, count).join(" ").slice(0, max);
}

function serviceItems(facts: SiteFacts, max: number, withImages: string[] = []): SectionItem[] {
  return facts.services.slice(0, max).map((title, i) => {
    const item: SectionItem = { title, text: "", icon: iconFor(title, i) };
    if (withImages[i]) item.image = withImages[i];
    return item;
  });
}

export type ComposeImages = { hero?: string; feature?: string; services: string[]; photos: string[] };

/**
 * Build a page from the section library without AI. Different archetypes pick
 * different compositions so the three mock looks feel genuinely different.
 */
export function composeMockPage(page: PlanPage, facts: SiteFacts, plan: SitePlan, design: DesignDirection, images: ComposeImages): Section[] {
  const a = design.archetype;
  const servicesSlug = plan.pages.find((p) => /service|menu|product|what-we-do/.test(p.slug))?.slug;
  const aboutSlug = plan.pages.find((p) => p.slug === "about")?.slug;
  const cta = { label: plan.cta.label, page: plan.cta.slug };
  const call = Boolean(facts.phone);
  const tagline = design.headline || mockHeadline(facts, plan, a);
  const lead = firstSentences(facts.description || facts.about, 2) || `${facts.name}${facts.industry ? ` · ${facts.industry}` : ""}`;
  const quote = facts.testimonials.length ? [{ type: "reviews", tone: a === "dark-premium" ? "light" : "tint", eyebrow: "Kind words", heading: "What customers say", items: facts.testimonials.map((t) => ({ title: t.author, text: t.quote })) } as Section] : [];
  const servicesBlock = (tone: Section["tone"], variant: string, max = 6): Section[] =>
    facts.services.length >= 2
      ? [
          {
            type: "services-grid",
            tone,
            eyebrow: "What we do",
            heading: servicesSlug ? plan.pages.find((p) => p.slug === servicesSlug)!.title : "Services",
            variant: variant === "images" && !images.services.length ? "icons" : variant,
            items: serviceItems(facts, variant === "bento" ? Math.min(max, 5) : max, variant === "images" ? images.services : []),
            cta: servicesSlug && page.slug === "home" ? { label: "See all services", page: servicesSlug } : undefined,
          },
        ]
      : [];
  const aboutText = firstSentences(facts.about || facts.description, 4, 700);
  const feature = (tone: Section["tone"], reverse = false): Section[] =>
    aboutText
      ? [
          {
            type: "feature-split",
            tone,
            reverse,
            eyebrow: "About us",
            heading: `About *${facts.name}*`,
            text: aboutText,
            image: images.feature ?? images.photos[1],
            cta: aboutSlug && page.slug === "home" ? { label: "Our story", page: aboutSlug } : undefined,
          },
        ]
      : [];
  const ctaBand: Section = {
    type: "cta-band",
    tone: "light",
    heading: a === "playful" ? "Let's make it *happen*" : a === "editorial" ? "Ready when *you* are" : "Ready when you are",
    text: facts.phone ? `Call ${facts.phone} or send a message — we'll take it from there.` : "Send a message and we'll get back to you.",
    cta,
    call,
  };
  const process: Section = {
    type: "process",
    tone: a === "dark-premium" ? "tint" : "light",
    eyebrow: "How it works",
    heading: "Simple from the first *call*",
    items: [
      { title: "Reach out", text: facts.phone ? "Call or send a message with what you need." : "Send a message with what you need." },
      { title: "Talk it through", text: "We listen, answer your questions, and confirm the details." },
      { title: "Get it done", text: `${facts.name} gets to work and keeps you in the loop.` },
    ],
  };
  const marquee: Section[] = facts.services.length >= 3 ? [{ type: "marquee", tone: a === "bold-photo" ? "brand" : "light", items: facts.services.slice(0, 8).map((s) => ({ title: s, text: "" })) }] : [];
  const statement: Section[] = facts.description
    ? [{ type: "statement", tone: a === "dark-premium" ? "light" : "dark", align: a === "editorial" ? "left" : "center", text: emphasize(firstSentences(facts.description, 1, 220)), heading: undefined, eyebrow: "Our promise" }]
    : [];
  const gallery: Section[] =
    images.photos.length >= 3
      ? [{ type: "gallery", tone: "light", eyebrow: "Our work", heading: "A look *around*", items: images.photos.slice(0, 6).map((p, i) => ({ title: `Photo ${i + 1}`, text: "", image: p })) }]
      : [];

  if (page.slug === "home") {
    const heroType: Section["type"] = design.hero === "photo" ? "hero-photo" : design.hero === "type" ? "hero-type" : "hero-split";
    const hero: Section = {
      type: heroType,
      tone: "light",
      eyebrow: facts.industry || facts.name,
      heading: emphasize(tagline),
      text: lead,
      image: images.hero ?? images.photos[0],
      cta,
      secondary: !call && servicesSlug ? { label: "Our services", page: servicesSlug } : undefined,
      call,
    };
    switch (a) {
      case "editorial":
        return [hero, ...statement, ...servicesBlock("light", "list"), ...feature("tint"), ...quote, ctaBand];
      case "dark-premium":
        return [hero, ...servicesBlock("light", "images"), ...feature("tint", true), process, ...quote, ctaBand];
      case "bold-photo":
        return [hero, ...marquee, ...servicesBlock("light", "images"), ...feature("tint"), ...gallery, ...quote, ctaBand];
      case "playful":
        return [hero, ...servicesBlock("tint", "icons"), process, ...feature("light", true), ...quote, ctaBand];
      case "minimal-luxury":
        return [hero, ...feature("light"), ...servicesBlock("tint", "list"), ...statement, ...quote, ctaBand];
      case "warm-craft":
        return [hero, ...servicesBlock("tint", "bento"), ...feature("light"), process, ...quote, ctaBand];
    }
  }
  const pageHero = (eyebrow: string, title: string, text: string, image?: string): Section => ({ type: "page-hero", tone: a === "dark-premium" ? "light" : "tint", eyebrow, heading: title, text, image });
  if (page.slug === "contact") {
    return [pageHero("Contact", `Talk to *${facts.name}*`, `We'd love to hear from you. Reach us using the details below or send a message.`), { type: "contact-block", tone: "light", heading: "Get in touch", text: facts.address ? `Find us at ${facts.address}.` : undefined }];
  }
  if (page.slug === "about") {
    return [
      pageHero("About", page.title, firstSentences(facts.description || facts.tagline, 1), images.feature ?? images.photos[1]),
      { type: "rich-text", tone: "light", heading: "Our story", text: facts.about || facts.description },
      ...statement,
      ...quote,
      ctaBand,
    ];
  }
  if (/service|menu|product|what-we-do/.test(page.slug)) {
    return [
      pageHero(page.navLabel, page.title, firstSentences(facts.description, 1)),
      ...(facts.services.length
        ? [{ type: "services-grid", tone: "light", variant: images.services.length ? "images" : "icons", heading: "Everything we do", items: serviceItems(facts, 9, images.services) } as Section]
        : []),
      process,
      ctaBand,
    ];
  }
  const source = facts.pages.find((p) => {
    try {
      return new URL(p.url).pathname.toLowerCase().includes(page.slug);
    } catch {
      return false;
    }
  });
  return [
    pageHero(page.navLabel, page.title, page.purpose),
    { type: "rich-text", tone: "light", text: source?.text.slice(0, 1400) || page.purpose || facts.description },
    ctaBand,
  ];
}

// ---------------------------------------------------------------- render

export type RenderContext = {
  name: string;
  industry: string;
  phone: string;
  email: string;
  address: string;
  hours: string[];
  /** Image names that exist for this site. */
  images: Set<string>;
  imageAlt: (name: string) => string;
  page: string;
};

const esc = escapeHtml;

/** Escape, then turn *word* into <em>word</em> (the only markup the AI may use). */
function rich(text: string | undefined): string {
  return esc(text ?? "").replace(/\*([^*]{1,80})\*/g, "<em>$1</em>");
}

function paragraphs(text: string | undefined, cls = ""): string {
  if (!text) return "";
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p${cls ? ` class="${cls}"` : ""}>${rich(p)}</p>`)
    .join("");
}

function telHref(phone: string): string {
  const d = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `tel:+1${d}` : `tel:${d}`;
}

let phSeq = 0;

function media(name: string | undefined, ctx: RenderContext, cls = "media", alt?: string): string {
  if (name && ctx.images.has(name)) {
    return `<div class="${cls}"><img src="@img:${esc(name)}" alt="${esc(alt ?? ctx.imageAlt(name))}" loading="lazy"></div>`;
  }
  phSeq = (phSeq % 3) + 1;
  return `<div class="${cls}"><div class="ph ph-${phSeq}" role="img" aria-label="Photo placeholder"></div></div>`;
}

function actions(section: Section, ctx: RenderContext): string {
  const parts: string[] = [];
  if (section.cta) parts.push(`<a class="btn primary" href="@page:${esc(section.cta.page)}">${esc(section.cta.label)} ${icon("arrow")}</a>`);
  if (section.call && ctx.phone) parts.push(`<a class="btn ghost" href="${telHref(ctx.phone)}">${icon("phone")} ${esc(ctx.phone)}</a>`);
  if (section.secondary) parts.push(`<a class="btn ghost" href="@page:${esc(section.secondary.page)}">${esc(section.secondary.label)}</a>`);
  return parts.length ? `<div class="actions">${parts.join("")}</div>` : "";
}

function head(section: Section, center = false, level: "h1" | "h2" = "h2"): string {
  if (!section.eyebrow && !section.heading && !section.text) return "";
  return `<div class="sec-head rv${center ? " center" : ""}">${section.eyebrow ? `<span class="eyebrow">${esc(section.eyebrow)}</span>` : ""}${
    section.heading ? `<${level}>${rich(section.heading)}</${level}>` : ""
  }${section.text ? paragraphs(section.text, "lead") : ""}</div>`;
}

function badge(ctx: RenderContext): string {
  const words = `${ctx.name} • ${ctx.industry || "Est. locally"} • `.toUpperCase().slice(0, 60);
  const initials = ctx.name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return `<div class="badge" aria-hidden="true"><svg viewBox="0 0 120 120"><defs><path id="bp" d="M60 60m-46 0a46 46 0 1 1 92 0a46 46 0 1 1-92 0"/></defs><text><textPath href="#bp">${esc(words)}</textPath></text></svg><span class="core">${esc(initials || "★")}</span></div>`;
}

export function renderSection(section: Section, ctx: RenderContext): string {
  const cls = `sec s-${section.type} t-${section.tone}${section.variant ? ` v-${esc(section.variant)}` : ""}${section.align === "center" ? " center" : ""}`;
  const open = `<section class="${cls}">`;
  const items = section.items ?? [];
  switch (section.type) {
    case "hero-split":
      return `${open}<div class="wrap grid"><div class="hero-copy">${section.eyebrow ? `<span class="eyebrow">${esc(section.eyebrow)}</span>` : ""}<h1>${rich(section.heading || ctx.name)}</h1>${paragraphs(section.text, "lead")}${actions(section, ctx)}</div><div class="frame rv">${badge(ctx)}${media(section.image, ctx)}</div></div></section>`;
    case "hero-photo":
      return `<section class="sec s-hero-photo t-dark"><div class="bgimg">${
        section.image && ctx.images.has(section.image) ? `<img src="@img:${esc(section.image)}" alt="${esc(ctx.imageAlt(section.image))}">` : `<div class="ph"></div>`
      }</div><div class="wrap"><div class="hero-copy">${section.eyebrow ? `<span class="eyebrow">${esc(section.eyebrow)}</span>` : ""}<h1>${rich(section.heading || ctx.name)}</h1>${paragraphs(section.text, "lead")}${actions(section, ctx)}</div></div></section>`;
    case "hero-type":
      return `${open}<div class="wrap"><div class="hero-copy">${section.eyebrow ? `<span class="eyebrow">${esc(section.eyebrow)}</span>` : ""}<h1>${rich(section.heading || ctx.name)}</h1><div class="row"><div>${paragraphs(section.text, "lead")}</div>${actions(section, ctx)}</div></div>${
        section.image ? `<div class="strip rv">${media(section.image, ctx)}</div>` : ""
      }</div></section>`;
    case "page-hero":
      return `${open}<div class="wrap${section.image ? " grid" : ""}"><div class="hero-copy">${section.eyebrow ? `<span class="eyebrow">${esc(section.eyebrow)}</span>` : ""}<h1>${rich(section.heading || ctx.name)}</h1>${paragraphs(section.text, "lead")}${actions(section, ctx)}</div>${
        section.image ? `<div class="rv">${media(section.image, ctx)}</div>` : ""
      }</div></section>`;
    case "stat-bar":
      return `${open}<div class="wrap">${head(section)}<div class="stats">${items.map((it) => `<div class="stat rv"><strong>${esc(it.title)}</strong><span>${esc(it.text)}</span></div>`).join("")}</div></div></section>`;
    case "marquee": {
      const run = items.map((it) => `<span>${esc(it.title)}</span>`).join("");
      return `${open}<div class="marquee" aria-label="${esc(items.map((i) => i.title).join(", "))}">${run}${run.replace(/<span>/g, '<span aria-hidden="true">')}</div></section>`;
    }
    case "services-grid": {
      let variant = section.variant ?? "icons";
      // Image cards that are mostly empty placeholders look unfinished: fall back to icon cards.
      const withImage = items.filter((it) => it.image && ctx.images.has(it.image)).length;
      if (variant === "images" && withImage * 2 < items.length) variant = "icons";
      if (variant === "bento" && items.length > 5) variant = "icons";
      let grid: string;
      if (variant === "list") {
        grid = `<div class="svc-list">${items
          .map((it, i) => `<div class="svc-row rv"><span class="n">${String(i + 1).padStart(2, "0")}</span><h3>${rich(it.title)}</h3><p>${esc(it.text)}</p></div>`)
          .join("")}</div>`;
      } else if (variant === "images") {
        grid = `<div class="cards${items.length % 2 === 0 && items.length <= 4 ? ` n${items.length}` : ""}">${items
          .map((it) => `<article class="card img rv">${media(it.image, ctx, "media", it.title)}<div class="body"><h3>${rich(it.title)}</h3>${it.text ? `<p>${esc(it.text)}</p>` : ""}</div></article>`)
          .join("")}</div>`;
      } else {
        grid = `<div class="${variant === "bento" ? "bento" : `cards${items.length === 4 || items.length === 2 ? ` n${items.length}` : ""}`}">${items
          .map(
            (it, i) =>
              `<article class="card rv"><span class="icon">${icon(it.icon || iconFor(it.title, i), "")}</span><h3>${rich(it.title)}</h3>${it.text ? `<p>${esc(it.text)}</p>` : ""}</article>`,
          )
          .join("")}</div>`;
      }
      return `${open}<div class="wrap">${head(section, section.align === "center")}${grid}${actions({ ...section, call: false, secondary: undefined }, ctx)}</div></section>`;
    }
    case "feature-split":
      return `${open}<div class="wrap split${section.reverse ? " reverse" : ""}"><div class="copy rv">${section.eyebrow ? `<span class="eyebrow">${esc(section.eyebrow)}</span>` : ""}${
        section.heading ? `<h2>${rich(section.heading)}</h2>` : ""
      }${paragraphs(section.text)}${items.length ? `<ul class="checks">${items.map((it) => `<li><span>${it.text ? `<strong>${esc(it.title)}</strong> ${esc(it.text)}` : esc(it.title)}</span></li>`).join("")}</ul>` : ""}${actions(
        section,
        ctx,
      )}</div><div class="rv">${media(section.image, ctx)}</div></div></section>`;
    case "process":
      return `${open}<div class="wrap">${head(section, section.align === "center")}<div class="steps">${items
        .map((it) => `<div class="step rv"><h3>${rich(it.title)}</h3>${it.text ? `<p>${esc(it.text)}</p>` : ""}</div>`)
        .join("")}</div>${actions({ ...section, secondary: undefined }, ctx)}</div></section>`;
    case "reviews":
      return `${open}<div class="wrap">${head(section, section.align === "center")}<div class="carousel${items.length <= 2 ? " few" : ""}" tabindex="0" aria-label="Customer reviews">${items
        .map((it) => `<blockquote class="review rv"><p>${esc(it.text)}</p>${it.title ? `<cite>${esc(it.title)}</cite>` : ""}</blockquote>`)
        .join("")}</div>${items.length > 2 ? `<p class="hint">Swipe or scroll for more →</p>` : ""}</div></section>`;
    case "before-after":
      return `${open}<div class="wrap">${head(section, section.align === "center")}<div class="ba">${items
        .slice(0, 2)
        .map(
          (it, i) =>
            `<figure class="rv"><span class="chip">${i === 0 ? "Before" : "After"}</span>${media(it.image, ctx, "media", it.title)}<figcaption>${it.title ? `<strong>${esc(it.title)}</strong>` : ""}${esc(it.text)}</figcaption></figure>`,
        )
        .join("")}</div></div></section>`;
    case "gallery":
      return `${open}<div class="wrap">${head(section, section.align === "center")}<div class="gallery">${items
        .slice(0, 6)
        .map((it, i) => media(it.image, ctx, `media g${i + 1} rv`, it.title))
        .join("")}</div></div></section>`;
    case "statement":
      return `${open}<div class="wrap">${section.eyebrow ? `<span class="eyebrow">${esc(section.eyebrow)}</span>` : ""}<p class="big rv">${rich(section.text || section.heading)}</p>${
        section.text && section.heading ? `<p class="by">${esc(section.heading)}</p>` : ""
      }${actions(section, ctx)}</div></section>`;
    case "faq":
      return `${open}<div class="wrap">${head(section, true)}<div class="faq">${items
        .map((it, i) => `<details${i === 0 ? " open" : ""}><summary>${esc(it.title)}</summary><p>${esc(it.text)}</p></details>`)
        .join("")}</div></div></section>`;
    case "cta-band":
      return `<section class="sec s-cta-band t-${section.tone === "tint" ? "tint" : "light"}"><div class="wrap"><div class="cta-band rv"><div><h2>${rich(section.heading || "Ready when you are")}</h2>${paragraphs(section.text)}</div>${actions(
        section,
        ctx,
      )}</div></div></section>`;
    case "contact-block": {
      const rows = [
        ctx.phone ? `<div class="row"><span class="icon">${icon("phone", "")}</span><dl><dt>Call</dt><dd><a href="${telHref(ctx.phone)}">${esc(ctx.phone)}</a></dd></dl></div>` : "",
        ctx.email ? `<div class="row"><span class="icon">${icon("mail", "")}</span><dl><dt>Email</dt><dd><a href="mailto:${esc(ctx.email)}">${esc(ctx.email)}</a></dd></dl></div>` : "",
        ctx.address ? `<div class="row"><span class="icon">${icon("pin", "")}</span><dl><dt>Visit</dt><dd>${esc(ctx.address)}</dd></dl></div>` : "",
        ctx.hours.length ? `<div class="row"><span class="icon">${icon("clock", "")}</span><dl><dt>Hours</dt>${ctx.hours.map((h) => `<dd>${esc(h)}</dd>`).join("")}</dl></div>` : "",
      ].join("");
      const map = ctx.address
        ? `<a class="map rv" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(ctx.address)}" target="_blank" rel="noopener noreferrer"><span class="pin" aria-hidden="true"></span><div><strong>Get directions</strong><span>${esc(ctx.address)}</span></div></a>`
        : `<a class="map rv" href="#contact-form"><span class="pin" aria-hidden="true"></span><div><strong>Send us a message</strong><span>Use the form below and we'll get back to you.</span></div></a>`;
      return `${open}<div class="wrap">${head(section)}<div class="contact-grid"><div class="info rv">${rows || `<div class="row"><span class="icon">${icon("chat", "")}</span><dl><dt>Message</dt><dd><a href="#contact-form">Use the form below</a></dd></dl></div>`}</div>${map}</div></div></section>`;
    }
    case "rich-text":
      return `${open}<div class="wrap">${section.eyebrow ? `<span class="eyebrow">${esc(section.eyebrow)}</span>` : ""}${section.heading ? `<h2 class="rv">${rich(section.heading)}</h2>` : ""}<div class="prose rv${
        (section.text ?? "").length > 900 ? " two" : ""
      }">${paragraphs(section.text)}</div>${actions(section, ctx)}</div></section>`;
  }
}

/** Pick the right image names for the mock composer from what exists. */
export function composeImages(available: string[]): ComposeImages {
  const has = (n: string) => available.includes(n);
  return {
    hero: has("hero") ? "hero" : undefined,
    feature: has("feature") ? "feature" : undefined,
    services: available.filter((n) => n.startsWith("service-")).sort(),
    photos: available.filter((n) => n.startsWith("photo-")).sort(),
  };
}

/** A compact description of the section library for AI prompts. */
export const SECTION_GUIDE = `Section library (pick, order, and fill — you never write HTML):
- "hero-split": home hero, copy + tall image. fields: eyebrow, heading, text, image, cta, secondary, call
- "hero-photo": home hero, full-bleed photo with overlay text. fields: eyebrow, heading, text, image, cta, call
- "hero-type": home hero, giant typographic headline, optional wide image strip below. fields: eyebrow, heading, text, image, cta, call
- "page-hero": first section of every inner page. fields: eyebrow, heading, text, image (optional)
- "stat-bar": 2-4 big numbers. items [{title:"25+", text:"years in Tulsa"}]. ONLY numbers that appear in the facts; otherwise do not use this section
- "marquee": scrolling ribbon of short words. items [{title}] (services, neighborhoods)
- "services-grid": variant "icons" | "images" | "list" | "bento". items [{title, text, icon, image}]. icon one of: ${ICON_NAMES.join(", ")}
- "feature-split": text beside an image. fields: eyebrow, heading, text, items (short bullet points), image, reverse, cta
- "process": 3-4 numbered steps. items [{title, text}]
- "reviews": CSS carousel of testimonials. items [{title: author, text: exact quote}] — ONLY the provided testimonials, word for word
- "before-after": two images side by side. items [{title, text, image}] x2
- "gallery": 3-6 photos. items [{title, image}]
- "statement": one big sentence (a promise or manifesto) in "text"; optional eyebrow
- "faq": items [{title: question, text: answer}] — answers only from facts
- "cta-band": gradient call-to-action band. fields: heading, text, cta, call
- "contact-block": contact details + map/directions card (filled automatically from the real facts). fields: heading, text
- "rich-text": heading + paragraphs (use \\n between paragraphs)
Every section has "tone": "light" | "tint" | "dark" | "brand" (alternate tones for rhythm; never two "dark"/"brand" in a row) and optional "align": "center".
Headings may emphasize ONE word or short phrase with *asterisks* (rendered as the accent style).
Buttons: cta = {"label": short, "page": a page slug}. "call": true adds the real tap-to-call button (only if a phone is known).
Images: use ONLY these image names in "image" fields: {IMAGES}`;
