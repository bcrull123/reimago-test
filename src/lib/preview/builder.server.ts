/**
 * The live preview pipeline after the site has been read:
 *   1. planSite         — pages + nav + CTA (one AI call)
 *   2. directionsFor    — three bold design directions ("looks"), one AI call, in parallel with 1
 *   3. buildLook        — per look: images (real photos first, generated for gaps) + homepage sections
 *   4. finishSite       — for the chosen look: remaining pages + service images + critique/revise of the homepage
 *
 * AI calls go through src/lib/ai-provider.server.ts. When the AI is not
 * available (no key, PREVIEW_MOCK=1, or an error), deterministic builders
 * assemble the same structure from the scraped facts so the preview always
 * renders — and they never invent contact details.
 */
import { aiAvailable, aiFallbackModel, aiModel, chatJson, isMockMode } from "@/lib/ai-provider.server";
import { BODY_FONTS, HEADING_FONTS, defaultPalette, hashString, safeFont, safePalette } from "@/lib/preview/theme";
import { ARCHETYPES, type DesignDirection, type PlanPage, type PlanSection, type Section, type SiteFacts, type SitePlan, type StoredImage, type AiDebug } from "@/lib/preview/types";
import { lookName } from "@/lib/preview/archetype-label";
import { briefQueries, heroBrief } from "@/lib/preview/hero-brief";
import { PRESETS, archetypesFor, mockDirections, normalizeDirection, HEADING_FONTS as DISPLAY_FONTS, BODY_FONTS as TEXT_FONTS } from "@/lib/preview/design";
import { SECTION_GUIDE, checkSections, composeImages, composeMockPage, corpusFor, type NormalizeContext } from "@/lib/preview/sections";
import { redact } from "@/lib/ai-json";
import { cleanSubject, hasOwnerRequest, plannedFromOwner, ownerRequestRule, ownerRequests, requestedPhoto, requestedScene, wantsBackground, wantsNewPhotos } from "@/lib/preview/owner-request";
import { heroSuitability, matchScraped, placeOf, webQueries, type PhotoCredit } from "@/lib/preview/web-photo";
import { findGooglePhotos, photoSearchEnabled } from "@/lib/preview/google-photo.server";
import { cleanImageQueries, defaultImageQueries } from "@/lib/preview/photo-queries";
import type { TemporaryPhoto } from "@/lib/preview/google-photo";
import { arrangeSections, diversifyDirections, lookSignature, photoRank } from "@/lib/preview/look-variety";
import { findWebPhotos, webPhotosEnabled } from "@/lib/preview/web-photo.server";
import type { Photo } from "@/lib/preview/images.server";
import { imagePrompt, isCivic, sceneFor } from "@/lib/preview/image-prompts";
import type { Archetype, ImageTrace, PreviewTrace, PreviousRound } from "@/lib/preview/types";
import { fromOklch, oklch, toOklab } from "@/lib/preview/look-edit";

/** The owner's note + feedback rounds as a high-priority block at the end of a system prompt. */
function requestBlock(facts: SiteFacts): string {
  const rule = ownerRequestRule(facts);
  return rule ? `\n\n${rule}` : "";
}
import type { StoredPage, StoredSite } from "@/lib/preview/render";

const MAX_PAGES = 6;

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Nav labels: at most 22 chars, cut on a word boundary. */
function shortLabel(label: string): string {
  if (label.length <= 22) return label;
  const cut = label.slice(0, 23).replace(/\s+\S*$/, "");
  return cut || label.slice(0, 22);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function factsForPrompt(facts: SiteFacts) {
  return {
    business_name: facts.name,
    source_url: facts.sourceUrl,
    tagline: facts.tagline,
    description: facts.description,
    industry: facts.industry,
    phone: facts.phone || null,
    email: facts.email || null,
    address: facts.address || null,
    hours: facts.hours,
    services_or_products: facts.services,
    about: facts.about,
    testimonials: facts.testimonials,
    images: facts.images,
    logo: facts.logo || null,
    brand_colors: facts.colors,
    current_navigation: facts.nav.map((n) => n.label),
    pages_read: facts.pages.map((p) => ({ title: p.title, url: p.url, headings: p.headings.slice(0, 10), text: p.text.slice(0, 1200) })),
    owner_brief: facts.brief ?? null,
    requested_changes: ownerRequests(facts).note || null,
    change_requests: ownerRequests(facts).feedback.length ? ownerRequests(facts).feedback : null,
    sites_to_emulate: facts.inspiration?.length ? facts.inspiration : null,
  };
}

// ---------------------------------------------------------------- plan

function mockPlan(facts: SiteFacts, variation: number): SitePlan {
  const restaurant = /restaurant|cafe|bakery|bar|food|menu/i.test(`${facts.industry} ${facts.nav.map((n) => n.label).join(" ")}`);
  const pages: PlanPage[] = [
    { slug: "home", title: "Home", navLabel: "Home", purpose: "Introduce the business and route visitors.", sections: [] },
  ];
  if (facts.about || facts.mode === "create") {
    pages.push({ slug: "about", title: `About ${facts.name}`, navLabel: "About", purpose: "Who they are.", sections: [] });
  }
  if (facts.services.length >= 2 || facts.mode === "create") {
    const label = restaurant ? "Menu" : "Services";
    pages.push({ slug: slugify(label), title: label, navLabel: label, purpose: "What they offer.", sections: [] });
  }
  for (const page of facts.pages.slice(1)) {
    if (pages.length >= MAX_PAGES - 1) break;
    let path = "";
    try {
      path = new URL(page.url).pathname;
    } catch {
      continue;
    }
    const slug = slugify(path.split("/").filter(Boolean).pop() ?? "");
    if (!slug || slug === "img" || /about|service|menu|contact|home|index/.test(slug) || pages.some((p) => p.slug === slug)) continue;
    if (page.text.length < 120) continue;
    const label = slug
      .split("-")
      .filter(Boolean)
      .map((word) => (word === "and" ? "&" : word[0]!.toUpperCase() + word.slice(1)))
      .join(" ")
      .slice(0, 22);
    pages.push({ slug, title: label, navLabel: label, purpose: "Carried over from the current site.", sections: [] });
  }
  pages.push({ slug: "contact", title: "Contact", navLabel: "Contact", purpose: "How to reach them.", sections: [] });
  return {
    name: facts.name,
    tagline: facts.tagline || facts.description.split(/(?<=[.!?])\s/)[0]?.slice(0, 120) || facts.name,
    summary:
      facts.mode === "create"
        ? `A new ${pages.length}-page site for ${facts.name}, built from the brief.`
        : `We read ${facts.pages.length} page${facts.pages.length === 1 ? "" : "s"} of ${facts.host} and rebuilt them as a cleaner ${pages.length}-page site.`,
    changes: [
      "Clear navigation with every page one click away",
      facts.phone ? "Tap-to-call phone number in every footer and on the contact page" : "A contact form on the contact page",
      "Mobile-friendly layout with one clear call to action",
    ],
    palette: defaultPalette(`${facts.host}:${variation}`, facts.colors),
    fonts: {
      heading: HEADING_FONTS[(hashString(facts.host) + variation) % 6]!,
      body: BODY_FONTS[(hashString(facts.name) + variation) % BODY_FONTS.length]!,
    },
    cta: { label: facts.phone ? "Call or message us" : "Get in touch", slug: "contact" },
    pages,
    imageQueries: defaultImageQueries(facts),
    mock: true,
  };
}

/** Earlier rounds' photo keys / hashes, as passed back by the browser (only ever used to skip photos). */
function cleanAvoid(raw: unknown): SitePlan["avoidPhotos"] {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { keys?: unknown; hashes?: unknown };
  const keys = (Array.isArray(r.keys) ? r.keys : []).filter((k): k is string => typeof k === "string" && /^https?:\/\//.test(k) && k.length < 600).slice(0, 40);
  const hashes = (Array.isArray(r.hashes) ? r.hashes : []).filter((h): h is string => typeof h === "string" && /^[0-9a-f]{16}$/.test(h)).slice(0, 40);
  return keys.length || hashes.length ? { keys, hashes } : undefined;
}

export function normalizePlan(raw: unknown, facts: SiteFacts, variation: number): SitePlan {
  const fallback = mockPlan(facts, variation);
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const pagesRaw = Array.isArray(r.pages) ? r.pages : [];
  const pages: PlanPage[] = [];
  for (const item of pagesRaw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    let slug = slugify(clip(p.slug, 40) || clip(p.title, 40));
    if (!slug || slug === "index") slug = "home";
    if (slug === "img") slug = "images";
    if (pages.some((existing) => existing.slug === slug)) continue;
    const sections: PlanSection[] = (Array.isArray(p.sections) ? p.sections : [])
      .map((s) => {
        if (!s || typeof s !== "object") return null;
        const sec = s as Record<string, unknown>;
        return { kind: clip(sec.kind, 30) || "section", heading: clip(sec.heading, 100), brief: clip(sec.brief, 300) };
      })
      .filter((s): s is PlanSection => Boolean(s))
      .slice(0, 7);
    const title = clip(p.title, 60) || slug;
    pages.push({ slug, title, navLabel: shortLabel(clip(p.navLabel, 60) || title), purpose: clip(p.purpose, 200), sections });
  }
  if (!pages.length) return fallback;
  if (pages[0]!.slug !== "home") {
    const existing = pages.findIndex((p) => p.slug === "home");
    if (existing > 0) pages.unshift(...pages.splice(existing, 1));
    else pages.unshift({ ...fallback.pages[0]!, sections: [] });
  }
  if (!pages.some((p) => p.slug === "contact")) pages.push(fallback.pages.at(-1)!);
  const trimmed = pages.slice(0, MAX_PAGES);
  if (!trimmed.some((p) => p.slug === "contact")) trimmed[trimmed.length - 1] = fallback.pages.at(-1)!;
  const fonts = (r.fonts && typeof r.fonts === "object" ? r.fonts : {}) as Record<string, unknown>;
  const cta = (r.cta && typeof r.cta === "object" ? r.cta : {}) as Record<string, unknown>;
  const ctaSlug = slugify(clip(cta.slug, 40));
  const changes = (Array.isArray(r.changes) ? r.changes : []).map((c) => clip(c, 180)).filter(Boolean).slice(0, 4);
  return {
    name: facts.name,
    tagline: clip(r.tagline, 120) || fallback.tagline,
    summary: clip(r.summary, 500) || fallback.summary,
    changes: changes.length ? changes : fallback.changes,
    palette: safePalette(r.palette as Record<string, string> | undefined, fallback.palette),
    fonts: {
      heading: safeFont(fonts.heading, HEADING_FONTS, fallback.fonts.heading),
      body: safeFont(fonts.body, BODY_FONTS, fallback.fonts.body),
    },
    cta: { label: clip(cta.label, 28) || fallback.cta.label, slug: trimmed.some((p) => p.slug === ctaSlug) ? ctaSlug : "contact" },
    pages: trimmed,
    photoSubject: cleanSubject(r.photoSubject ?? r.photo_subject) || undefined,
    photoIntent: ((v) => (v === "keep" || v === "find" || v === "none" ? v : undefined))(String(r.photoIntent ?? r.photo_intent ?? "").toLowerCase().trim()),
    imageQueries: ((q) => (q.length ? q : fallback.imageQueries))(cleanImageQueries(r.imageQueries ?? r.image_queries)),
    avoidPhotos: cleanAvoid(r.avoidPhotos),
  };
}

/** The planner's reading of the photo subject travels with the plan; looks read it through the facts. */
export function withPlanSubject(facts: SiteFacts, plan: SitePlan): SiteFacts {
  const subject = cleanSubject(plan.photoSubject);
  if (!subject || facts.photoSubject || !plannedFromOwner(facts, subject)) return facts;
  return { ...facts, photoSubject: subject, photoIntent: plan.photoIntent === "keep" ? "keep" : "find" };
}

/**
 * Round 1 needs no note: when photo search is configured and the owner named no photo subject (and asked to keep
 * nothing), the planner's imageQueries are searched right after the plan, while the looks are being designed.
 * Each look build then reads the stored ranking (plannedPhotos). Returns undefined when it doesn't apply.
 */
export async function prefetchForPlan(rawFacts: SiteFacts, plan: SitePlan, deadline: number, archetypes?: Promise<(Archetype | undefined)[] | undefined>) {
  const facts = withPlanSubject(rawFacts, plan);
  // Round 9b: also without Google Images (no SERPER_API_KEY): the site's own photos are rated and assigned.
  if (requestedPhoto(facts).intent !== "none") return undefined;
  const { prefetchPlannedPhotos } = await import("@/lib/preview/google-photo.server");
  return prefetchPlannedPhotos(facts, proactiveQueries(facts, plan), !isMockMode() && aiAvailable(), deadline, { archetypes, site: !wantsNewPhotos(facts), avoid: plan.avoidPhotos }).catch(() => undefined);
}

/**
 * The planner's queries plus two more from the business type's brief (hero-brief.ts: a town -> its downtown
 * historic main street, landmark, aerial view…; a restaurant -> plated dishes, its dining room; a plumber ->
 * finished work, a technician at work…), so the quality gate has good photos to choose from. A regenerated round
 * rotates to other scenes.
 */
export function proactiveQueries(facts: SiteFacts, plan: Pick<SitePlan, "imageQueries" | "avoidPhotos">): string[] {
  const base = (plan.imageQueries ?? []).slice(0, 3);
  if (!base.length) return base;
  const extra = briefQueries(facts, heroBrief(facts)).filter((q) => !base.some((b) => b.toLowerCase() === q.toLowerCase()));
  if (!extra.length) return base;
  const avoid = plan.avoidPhotos;
  const start = avoid ? (avoid.keys.length + avoid.hashes.length) % extra.length : 0;
  return [...new Set([...base, extra[start]!, extra[(start + 1) % extra.length]!])];
}

export async function planSite(facts: SiteFacts, variation = 0): Promise<{ plan: SitePlan; note?: string }> {
  if (isMockMode() || !aiAvailable()) {
    return {
      plan: mockPlan(facts, variation),
      note: isMockMode() ? "Mock mode (PREVIEW_MOCK=1): the plan was assembled without AI." : "AI is not configured, so the plan was assembled from the page text.",
    };
  }
  try {
    const raw = await chatJson({
      temperature: variation ? 0.8 : 0.5,
      maxTokens: 8000,
      timeoutMs: 45_000,
      messages: [
        {
          role: "system",
          content: `You are a senior web designer planning a clean, modern small-business website that will be built as real HTML pages.
Return ONLY one JSON object, no markdown:
{"tagline": string, "summary": string (1-2 sentences: what the current site does poorly and what the new site fixes), "changes": [3 short strings],
 "photoSubject": string (what the owner's request asks to SHOW in the hero/background photo, in 2-6 plain words with the place if known, e.g. "red brick streets downtown"; "" when the request names no photo subject — colors, fonts and layout wishes are not photo subjects),
 "photoIntent": "keep" | "find" | "none" ("keep" when the owner wants to keep or reuse a picture that is already on their site — "keep the rocket", "don't lose our mascot", "use the same truck photo", "our storefront"; "find" when they want a photo of something new to be found or made — "a picture of the red bricks"; "none" when photoSubject is ""),
 "imageQueries": [2-3 strings] (Google Images searches for real photos that make THIS place or business look its best as a wide website hero, even when the owner asked for nothing. Search for the best-looking SCENES, not the name: a town or city -> its downtown, main street, historic district, best-known landmark, courthouse, skyline or an aerial view, e.g. "downtown Pauls Valley Oklahoma", "Pauls Valley historic district", "Pauls Valley Oklahoma main street"; a business -> its work, product, storefront or team in its setting, e.g. a plumber -> "plumber fixing pipes under sink", "plumbing van Oklahoma City"; a bakery -> "fresh bread bakery counter", a restaurant -> its signature dish or dining room. Never queries that return signs, welcome signs, city-limit signs, logos, seals, maps or text (no "welcome to X", no bare name searches). Concrete and photographable, with the town and state when known; no people's names, no search operators),
 "cta": {"label": string (max 24 chars), "slug": page slug},
 "pages": [{"slug": "home"|lowercase-hyphenated, "title": string, "navLabel": string (max 18 chars), "purpose": string, "sections": [{"kind": "hero|services|about|testimonials|gallery|faq|hours|cta|text|team|pricing|contact-info", "heading": string, "brief": string}]}]}
Rules:
- 3 to ${MAX_PAGES} pages. The first page is "home". Always include "contact". Mirror the real pages the business already has (about, services, menu, etc.).
- Use ONLY facts provided. Never invent phone numbers, emails, street addresses, prices, awards, years in business, staff names, statistics, or reviews.
- Keep the business name exactly as given. (Visual design is decided separately — plan structure and content only.)
- Respect the requested changes when present: add, drop or reorder pages and sections the owner asks for.${variation ? `\n- Variation ${variation}: choose a clearly different structure and emphasis from a typical first attempt.` : ""}${requestBlock(facts)}`,
        },
        { role: "user", content: JSON.stringify(factsForPrompt(facts)) },
      ],
    });
    return { plan: normalizePlan(raw, facts, variation) };
  } catch (error) {
    console.error("[preview] plan failed", error instanceof Error ? error.message : error);
    return { plan: mockPlan(facts, variation), note: `The AI planner failed (${reasonOf(error)}), so the plan was assembled from the page text.` };
  }
}


// ---------------------------------------------------------------- design directions ("looks")

const ARCHETYPE_GUIDE = `Archetypes (each look must use a different one):
- "editorial": magazine feel, big serif headlines, cream paper, thin rules, numbered lists
- "dark-premium": dark background, warm metallic accent, cinematic photography, refined serif or light sans
- "bold-photo": full-bleed photography, heavy condensed or black sans type, one loud accent color
- "playful": rounded shapes, cheerful saturated colors, chunky offset shadows, friendly grotesque type
- "minimal-luxury": lots of white space, fine serif, restrained neutral palette, hairline details
- "warm-craft": earthy warm palette, tactile textures, stamp badges, approachable serif + clean sans`;

/** Three looks that differ in more than wording: hero treatment, header, buttons, footer and section order (look-variety.ts). */
export async function directionsFor(
  facts: SiteFacts,
  variation = 0,
  opts: { seed?: number; previous?: PreviousRound } = {},
): Promise<{ directions: DesignDirection[]; note?: string; mock: boolean }> {
  const result = await rawDirections(facts, variation, opts);
  const prev = opts.previous;
  let directions = result.directions;
  if (prev?.names.length) directions = directions.map((d) => freshenDirection(d, prev));
  // One name per look: its style ("Dark Premium"), the same on the card, the banner and in refine requests.
  directions = directions.map((d) => ({ ...d, name: lookName(d.archetype) }));
  directions = diversifyDirections(directions, opts.seed ?? 0, prev?.heroStyles ?? []);
  console.info(`[looks] round${prev?.names.length ? " (regenerated)" : ""}: ${directions.map((d) => `“${d.name}” ${d.archetype}/${d.heroStyle}`).join(" · ")}${prev?.names.length ? ` · previous round: ${prev.names.map((n, i) => `“${n}” ${prev.archetypes[i] ?? ""}/${prev.heroStyles[i] ?? ""}`).join(" · ")}` : ""}`);
  return { ...result, directions };
}

/** A regenerated look must not come back with (nearly) the same palette. */
function freshenDirection(d: DesignDirection, prev: PreviousRound): DesignDirection {
  let out = d;
  const near = prev.palettes.some((p) => colorDistance(p.primary, d.palette.primary) < 0.09 && colorDistance(p.background, d.palette.background) < 0.06);
  if (near) {
    const turn = (hex: string, deg: number) => {
      const c = oklch(hex);
      return c.c < 0.03 ? hex : fromOklch(c.l, c.c, (c.h + deg) % 360);
    };
    const palette = { ...d.palette, primary: turn(d.palette.primary, 55), accent: turn(d.palette.accent, 55) };
    out = { ...out, palette };
  }
  return out;
}

function colorDistance(a: string, b: string): number {
  try {
    const x = toOklab(a);
    const y = toOklab(b);
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  } catch {
    return 1;
  }
}

async function rawDirections(facts: SiteFacts, variation = 0, opts: { seed?: number; previous?: PreviousRound } = {}): Promise<{ directions: DesignDirection[]; note?: string; mock: boolean }> {
  const avoid = { seed: opts.seed, archetypes: opts.previous?.archetypes, names: opts.previous?.names };
  if (isMockMode() || !aiAvailable()) {
    return {
      directions: mockDirections(facts, variation, avoid),
      mock: true,
      note: isMockMode() ? "Mock mode (PREVIEW_MOCK=1): looks were picked from presets." : "AI is not configured, so looks were picked from presets.",
    };
  }
  const suggested = archetypesFor(facts, variation, avoid);
  const prev = opts.previous;
  const previousBlock = prev?.names.length
    ? `\n- The owner already saw (and asked to change) these looks: ${prev.names.map((n, i) => `"${n}" (${prev.archetypes[i] ?? "?"}, ${prev.heroStyles[i] ?? "?"} hero, ${prev.palettes[i]?.primary ?? ""} on ${prev.palettes[i]?.background ?? ""})`).join("; ")}. This round must look VISIBLY different: mostly different archetypes, different hero treatments, clearly different palettes and type. Keep honoring the owner's note and feedback.`
    : "";
  try {
    const raw = await chatJson<{ looks?: unknown[] }>({
      temperature: variation ? 0.95 : 0.85,
      maxTokens: 10_000,
      timeoutMs: 45_000,
      messages: [
        {
          role: "system",
          content: `You are an award-winning creative director. Propose THREE bold, distinctive, clearly different design directions ("looks") for this business's new website. Avoid generic template looks: each must have a strong concept a client would remember.
Return ONLY JSON: {"looks": [{
 "name": the archetype in plain words (the look is shown under its style name only),
 "mood": 1-2 sentences on how the site should feel,
 "rationale": 1 sentence on why it fits this business and its customers,
 "archetype": one of ${JSON.stringify(ARCHETYPES)},
 "palette": {"primary": "#hex", "accent": "#hex", "background": "#hex", "surface": "#hex", "text": "#hex", "muted": "#hex"},
 "fonts": {"heading": one of ${JSON.stringify(DISPLAY_FONTS)}, "body": one of ${JSON.stringify(TEXT_FONTS)}},
 "imagery": art direction for photography (light, lens, color grade, subjects) in one sentence,
 "heroSubject": what the hero photograph shows, concretely (no text, signage, logos or brand names in the scene),
 "featureScene": what a second, supporting photograph shows, concretely (same rules),
 "motifs": 1-3 of ["grain","thin-rules","oversized-numbers","diagonal-cuts","soft-blobs","underline-marks","grid-lines","glow","outlined-type","stamp-badges"],
 "radius": "sharp"|"soft"|"round", "buttons": "pill"|"square"|"outline",
 "heroStyle": "caption" (split hero: text on a light panel, photo with a caption) | "cinematic" (full-bleed photo, strong side overlay) | "collage" (photo in a tilted rounded frame on color blocks, with a stamp) | "poster" (full-bleed photo, giant centered headline at the bottom) | "panorama" (big type first, a wide panoramic photo strip under it) | "framed" (large photo left, copy on a card overlapping it) — each look a DIFFERENT one, and don't default to the obvious one for the archetype,
 "hero": "split"|"photo"|"type", "header": "light"|"dark"|"overlay"|"center" (overlay only with hero "photo"; center = centered logo), "footer": "columns"|"minimal"|"statement",
 "headline": a bold hero headline, max 9 words, may emphasize ONE word with *asterisks*
}]}
${ARCHETYPE_GUIDE}
Rules:
- Three different archetypes; good starting points for this business: ${suggested.join(", ")}. Palettes must be clearly different from each other and readable (strong text contrast).
- Respect the brand: if brand colors are given, at least one look keeps them prominent, and every look should feel compatible with the logo.
- If "sites_to_emulate" are given, let at least one look borrow their vibe (palette, type, mood) without copying them.
- Headlines must not invent facts: no years, awards, prices, guarantees, statistics, or claims not in the facts.
- Photos: if the owner's request names a scene, subject or place (e.g. "use the brick streets"), EVERY look's "heroSubject" must depict exactly that as the main subject (styled for the look), not generic tools or equipment of the trade. Use "featureScene" for a second, related scene.
- The three looks must differ in layout, not just wording and colors: different "heroStyle", "header", "buttons" and "footer" for each look. When the owner asks for a photo or background, honor it in each look in a different way (e.g. editorial split with a captioned photo, cinematic full-bleed, playful framed collage), and vary the camera angle / framing in "heroSubject".
- Respect the owner's requested changes and style notes when present: requested colors go into the palettes, requested moods/styles shape the archetypes and fonts, and feedback on earlier looks means these three must be clearly different from what they rejected.${variation ? `\n- This is attempt ${variation + 1}: go somewhere new compared with an obvious first attempt.` : ""}${previousBlock}${requestBlock(facts)}`,
        },
        { role: "user", content: JSON.stringify(factsForPrompt(facts)) },
      ],
    });
    const looks = Array.isArray(raw.looks) ? raw.looks.slice(0, 3) : [];
    if (!looks.length) throw new Error("No looks in the answer.");
    const directions: DesignDirection[] = looks.map((look, i) => ({ ...normalizeDirection(look, i, facts), ai: true }));
    // Guarantee three different archetypes.
    const used = new Set<string>();
    for (let i = 0; i < directions.length; i += 1) {
      if (used.has(directions[i]!.archetype)) {
        const replacement = [...suggested, ...ARCHETYPES].find((a) => !used.has(a))!;
        directions[i] = { ...directions[i]!, ...PRESETS[replacement], palette: { ...PRESETS[replacement].palette }, archetype: replacement };
      }
      used.add(directions[i]!.archetype);
    }
    const fallback = mockDirections(facts, variation, avoid);
    while (directions.length < 3) {
      const next = fallback.find((d) => !used.has(d.archetype)) ?? fallback[directions.length]!;
      used.add(next.archetype);
      directions.push({ ...next, id: `look-${directions.length + 1}` });
    }
    return { directions, mock: false };
  } catch (error) {
    console.error("[preview] directions failed", error instanceof Error ? error.message : error);
    return { directions: mockDirections(facts, variation, avoid), mock: true, note: `The AI art director failed (${reasonOf(error)}), so looks were picked from presets.` };
  }
}

// ---------------------------------------------------------------- page sections

type ImageInfo = { name: string; describe: string };

function imageList(images: Record<string, StoredImage>, pending: ImageInfo[] = []): ImageInfo[] {
  // The logo is shown by the header/footer only; never offered as a section photo.
  const stored = Object.values(images).filter((i) => !i.name.startsWith("logo")).map((i) => ({
    name: i.name,
    describe: i.source === "photo" ? `real photo from their current site (${i.width ?? "?"}x${i.height ?? "?"})` : `generated photo: ${i.alt}`,
  }));
  return [...stored, ...pending.filter((p) => !images[p.name])];
}

function normalizeContext(facts: SiteFacts, plan: SitePlan, page: string, images: string[]): NormalizeContext {
  return {
    slugs: plan.pages.map((p) => p.slug),
    phone: facts.phone,
    email: facts.email,
    images,
    testimonials: facts.testimonials,
    corpus: corpusFor(facts),
    page,
  };
}

function reasonOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 240);
}

/** Smaller facts payload for page writing (the full crawl text makes the call slow). */
function leanFacts(facts: SiteFacts) {
  return {
    ...factsForPrompt(facts),
    images: undefined,
    logo: undefined,
    current_navigation: undefined,
    pages_read: facts.pages.slice(0, 6).map((p) => ({ title: p.title, url: p.url, headings: p.headings.slice(0, 8), text: p.text.slice(0, 600) })),
  };
}

const HERO_FOR: Record<DesignDirection["hero"], string> = { split: "hero-split", photo: "hero-photo", type: "hero-type" };

async function aiSections(
  page: PlanPage,
  facts: SiteFacts,
  plan: SitePlan,
  design: DesignDirection,
  images: ImageInfo[],
  timeoutMs: number,
  model?: string,
): Promise<unknown> {
  const slugs = plan.pages.map((p) => `"${p.slug}" (${p.navLabel})`).join(", ");
  const home = page.slug === "home";
  return chatJson({
    temperature: 0.75,
    // Reasoning models count thinking tokens against max_tokens; leave plenty of room for the JSON.
    maxTokens: 16_000,
    timeoutMs,
    model,
    retry: false,
    messages: [
      {
        role: "system",
        content: `You are a senior web designer and conversion copywriter at a top agency, composing ONE page of a small-business website from a library of beautifully pre-designed sections. You choose sections, order them for rhythm and persuasion, choose tones and variants that express the design direction, and write sharp, specific, warm copy.
Return ONLY JSON: {"sections": [ ... ]}
Design direction (follow it on every section — mood, boldness, headline voice): ${JSON.stringify({
          name: design.name,
          mood: design.mood,
          archetype: design.archetype,
          hero: design.hero,
          motifs: design.motifs,
          headline_idea: design.headline,
        })}
${SECTION_GUIDE.replace("{IMAGES}", images.length ? images.map((i) => `"${i.name}" (${i.describe})`).join("; ") : "(none — omit image fields; tasteful placeholders are used)")}
Page links: use only these page slugs: ${slugs}.
Content rules:
- Use ONLY facts provided. Rewrite their real text so it is clear, confident and specific; cut filler.
- NEVER invent phone numbers, email addresses, street addresses, prices, statistics, awards, years in business, staff names, guarantees, or testimonials. If a fact is missing, leave it out.
- ${home ? `This is the HOME page: 5-8 sections. The first section MUST be "${HERO_FOR[design.hero]}". Include proof (reviews if testimonials exist), what they do, and a strong closing "cta-band".` : `This is an inner page: the first section MUST be "page-hero", then 2-5 sections that fully cover the page's purpose.`}${
          page.slug === "contact" ? `\n- This is the contact page: include a "contact-block" (details fill in automatically). A contact form is appended automatically — do not describe one.` : ""
        }
- Prefer real photos of the business when available; vary images, do not repeat the same image twice on a page.${requestBlock(facts)}`,
      },
      {
        role: "user",
        content: JSON.stringify({
          page,
          site_plan: { tagline: plan.tagline, cta: plan.cta, pages: plan.pages.map((p) => ({ slug: p.slug, title: p.title, purpose: p.purpose })) },
          facts: leanFacts(facts),
        }),
      },
    ],
  });
}


export type SectionsResult = { sections: Section[]; ai: boolean; error?: string; model?: string; seconds?: number; debug?: AiDebug; ownerRequest?: boolean };

/** ~2 KB of the raw AI answer, secrets masked, for the preview record. */
export function rawSample(raw: unknown, max = 2000): string {
  let text = "";
  try {
    text = typeof raw === "string" ? raw : JSON.stringify(raw);
  } catch {
    text = String(raw);
  }
  text = redact(text ?? "");
  return text.length > max ? `${text.slice(0, max)}… (${text.length} chars)` : text;
}

/**
 * AI sections for a page, validated; falls back to the deterministic composer.
 * Tries the main model first, then (if time is left) one retry with a faster model.
 * Returns the reason when the AI could not be used, so the UI can show it.
 */
export async function sectionsFor(
  page: PlanPage,
  facts: SiteFacts,
  plan: SitePlan,
  design: DesignDirection,
  images: Record<string, StoredImage>,
  pending: ImageInfo[],
  useAi: boolean,
  budgetMs: number,
): Promise<SectionsResult> {
  const list = imageList(images, pending);
  const names = list.map((i) => i.name);
  const ctx = normalizeContext(facts, plan, page.slug, names);
  const fallback = () => composeMockPage(page, facts, plan, design, composeImages(names));
  if (!useAi) return { sections: fallback(), ai: false };
  // The OWNER'S REQUEST block is in this page's system prompt (see aiSections → requestBlock).
  const ownerRequest = Boolean(requestBlock(facts));
  const started = Date.now();
  const deadline = started + budgetMs;
  const home = page.slug === "home";
  const errors: string[] = [];
  let debug: AiDebug | undefined;
  const main = aiModel();
  const fast = aiFallbackModel();
  const attempts: { model: string; timeoutMs: number }[] = [
    // Leave the fast model ~25s when there is one.
    { model: main, timeoutMs: fast ? Math.max(20_000, budgetMs - 25_000) : budgetMs },
    ...(fast ? [{ model: fast, timeoutMs: budgetMs }] : []),
  ];
  for (const attempt of attempts) {
    const left = deadline - Date.now();
    if (left < 8000) break;
    const t0 = Date.now();
    try {
      const raw = await aiSections(page, facts, plan, design, list, Math.min(attempt.timeoutMs, left), attempt.model);
      const check = checkSections(raw, ctx);
      const sections = check.sections;
      if (check.rejected.length) {
        debug = { model: attempt.model, at: new Date().toISOString(), total: check.total, used: sections.length, rejected: check.rejected.slice(0, 12), sample: rawSample(raw) };
        console.error(`[preview] page ${page.slug}: ${attempt.model} sections dropped: ${check.rejected.slice(0, 5).join(" | ")}`);
      }
      // A homepage hero of the wrong kind is fixed, not rejected.
      if (home && sections[0]?.type === "page-hero") sections[0].type = HERO_FOR[design.hero] as Section["type"];
      if (home && sections[0] && !sections[0].type.startsWith("hero-")) sections.unshift({ ...fallback()[0]! });
      if (!home && sections[0]?.type !== "page-hero") sections.unshift({ type: "page-hero", tone: "tint", heading: page.title });
      const min = home ? 3 : 2;
      if (sections.length >= min) {
        if (page.slug === "contact" && !sections.some((s) => s.type === "contact-block")) sections.push({ type: "contact-block", tone: "light", heading: "Get in touch" });
        return { sections, ai: true, model: attempt.model, seconds: Math.round((Date.now() - started) / 1000), debug, ownerRequest };
      }
      const why = check.rejected.slice(0, 3).join("; ");
      errors.push(`${attempt.model} answered in ${Math.round((Date.now() - t0) / 1000)}s but only ${check.sections.length} of ${check.total} sections were usable${why ? ` (${why})` : ""}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message.includes(attempt.model) ? message : `${attempt.model}: ${message}`);
    }
    console.error(`[preview] page ${page.slug}: ${errors.at(-1)}`);
  }
  if (!errors.length) errors.push(`no time left in the ${Math.round(budgetMs / 1000)}s step budget`);
  return { sections: fallback(), ai: false, error: errors.join("; then "), debug, ownerRequest };
}

/** Point image references at images that really exist (generation can fail): real photos first, else placeholder. */
function resolveImages(sections: Section[], available: string[]): Section[] {
  const photos = available.filter((n) => n.startsWith("photo-"));
  let next = 0;
  const swap = (name: string | undefined) => {
    if (!name || available.includes(name)) return name;
    const photo = photos.length ? photos[next++ % photos.length] : undefined;
    return photo;
  };
  return sections.map((s) => ({
    ...s,
    image: swap(s.image),
    items: s.items?.map((it) => ({ ...it, image: swap(it.image) })),
  }));
}

/**
 * One server log line per look saying where its hero photo came from and why, so the owner can confirm on the
 * host's logs that Google Images (Serper) is working: e.g.
 *   [photo] look 2 "Night Brick": hero = Google Images (commons.wikimedia.org) · query "downtown Pauls Valley Oklahoma" · Google Images “…”: 18 results, 5 usable
 */
function logHeroChoice(index: number, look: string, heroImage: string | undefined, images: Record<string, StoredImage>, trace: PreviewTrace, searchOn: boolean) {
  const hero = heroImage ? images[heroImage] : undefined;
  const entry = trace.images.find((i) => i.slot === "hero" && i.status !== "not found on your site") ?? trace.images.find((i) => i.slot === "hero");
  const source = !hero
    ? "none (no photo)"
    : hero.kept
      ? "kept from your site"
      : hero.temporary
        ? `Google Images (${hero.temporary.domain}) · query "${hero.temporary.query}" · picked by ${hero.temporary.pickedBy}`
        : hero.source === "web"
          ? `${hero.credit?.provider ?? "web"} (free license)`
          : hero.source === "generated"
            ? "AI image"
            : `your site (${heroImage})`;
  const why = [
    entry?.status ? `status: ${entry.status}` : "",
    entry?.search ?? "",
    searchOn ? "" : "Google Images off on this server (no SERPER_API_KEY or photo-search proxy)",
  ]
    .filter(Boolean)
    .join(" · ");
  console.info(`[photo] look ${index + 1} "${look}": hero = ${source}${why ? ` · ${why.slice(0, 1400)}` : ""}`);
}

/** The credit shape for a temporary Google Images photo (shown as "preview only" on the card and footer). */
export function googleCredit(t: TemporaryPhoto): PhotoCredit {
  return { title: t.title, author: t.domain, license: "preview only", licenseUrl: "", sourceUrl: t.sourcePage || t.imageUrl, provider: "Google Images" };
}

function googleSearchNote(g: { photos: unknown[]; queries: string[]; seen: number; rejected: Record<string, number>; ranking?: string }): string {
  const skipped = Object.entries(g.rejected).map(([why, n]) => `${n} ${why}`).join(", ");
  return `Google Images ${g.queries.map((q) => `“${q}”`).join(" / ")}: ${g.seen} results${skipped ? ` (skipped ${skipped})` : ""}, ${g.photos.length} usable${g.ranking ? ` · ${g.ranking}` : ""}`;
}

/** Put the owner's requested photo in the hero (as a full-bleed background when they said "background"). */
function heroForRequest(hero: Section, facts: SiteFacts, design: DesignDirection, haveHero: boolean, scene: string | undefined, fresh: boolean, ownHero?: string): Section {
  // No subject named: the hero is one of the site's photos that suits a homepage (never whichever the page writer grabbed).
  if (!scene && !fresh) return ownHero && !haveHero ? { ...hero, image: ownHero } : hero;
  // Looks with a hero treatment (look-variety.ts) each show the photo their own way; older looks use the full-bleed hero for "background".
  if (haveHero) return { ...hero, image: "hero", type: wantsBackground(facts) && !design.heroStyle ? "hero-photo" : hero.type };
  return scene ? { ...hero, image: undefined } : hero;
}

// ---------------------------------------------------------------- build a look (homepage) and finish the chosen one

export function stepBudgetMs(): number {
  const raw = Number(process.env.PREVIEW_STEP_BUDGET_MS);
  return Number.isFinite(raw) && raw >= 20_000 ? raw : 85_000;
}

/** Round 9: how many of the site's own photos each look stores (photo-1..n) for its hero and sections. */
const OWN_MAX = 8;

/** Homepage-only site for one direction. Images and homepage copy are produced in parallel. */
/** The from-scratch Custom Design is the third look (custom-design.server.ts asCustomDirection). */
const CUSTOM_LOOK = 2;

export async function buildLook(
  id: string,
  rawFacts: SiteFacts,
  plan: SitePlan,
  design: DesignDirection,
  index: number,
): Promise<{ site: StoredSite; ai: boolean; aiError?: string; aiWarning?: string; generated: number; photos: number }> {
  // The AI planner's reading of the photo subject (if any) wins over the regex reading of the note.
  const facts = withPlanSubject(rawFacts, plan);
  const { goodPhotos, heroWorthy, storePhotos, imagesEnabled, generateAndStore, fetchPhoto } = await import("@/lib/preview/images.server");
  const { saveImage } = await import("@/lib/pages.server");
  const budget = stepBudgetMs();
  const stepStart = Date.now();
  const useAi = !isMockMode() && aiAvailable();
  // The site's own photos, best hero candidates first (alt text / file name / page URL cues), not just the biggest.
  // Documents, logos and headshots stay off the homepage; so do pipes and utility photos on a town's site.
  const civic = isCivic(facts);
  // Round 1 with no subject: the planner's proactive photo ranking (Google + the site's own photos, vision-rated
  // for THIS business type), prefetched by the plan step. Started first: its ratings order the site's photos too.
  const want0 = requestedPhoto(facts);
  const photoDeadline = stepStart + Math.max(10_000, Math.min(40_000, budget - 25_000));
  // Round 9b: runs without Google too (SERPER_API_KEY unset): the site's own photos are still vision-rated and shared
  // out between the looks.
  const prePromise = !(want0.subject && (want0.intent === "find" || want0.intent === "keep"))
    ? (await import("@/lib/preview/google-photo.server")).plannedPhotos(facts, proactiveQueries(facts, plan), useAi, photoDeadline, plan.avoidPhotos).catch(() => undefined)
    : Promise.resolve(undefined);
  const pre0 = await prePromise;
  const tPhotos = Date.now();
  // Round 9: the vision verdicts (appetizing dish, attractive scene… for this business type) order the site's own
  // photos for the hero AND the supporting sections; failed ones go last. Without ratings, the words decide.
  const rated = new Map((pre0?.site ?? []).map((c) => [c.id, c] as const));
  const failedIds = new Set(pre0?.bar?.failed ?? []);
  const verdict = (url: string) => (failedIds.has(url) ? -1 : (rated.get(url)?.appeal ?? 0));
  const scored = (await goodPhotos(facts, 14))
    .map((photo, i) => ({ photo, i, score: heroSuitability(photo.url, facts.imageText?.[photo.url] ?? "", civic) }))
    .filter((p) => p.score > -3 || (rated.get(p.photo.url)?.appeal ?? 0) >= 5)
    .sort((a, b) => verdict(b.photo.url) - verdict(a.photo.url) || b.score - a.score || a.i - b.i);
  const photos = scored.slice(0, OWN_MAX).map((p) => p.photo);
  const images: Record<string, StoredImage> = await storePhotos(id, photos, facts);
  console.info(`[timing] look ${index + 1} "${design.name}": site photos + vision gate ${tPhotos - stepStart}ms, ${photos.length} site photos stored by ${Date.now() - stepStart}ms`);
  // Suitable hero photos are photo-1..n (sorted above); each look leads with a different one when there are several.
  // Round 9: a hero needs a hero-sized photo that passed the vision gate (or, unrated, good words).
  const heroOk = (p: (typeof scored)[number]) => heroWorthy(p.photo) && !failedIds.has(p.photo.url) && (rated.has(p.photo.url) || p.score > 0);
  const suitable = scored.slice(0, OWN_MAX).map((p, i) => (heroOk(p) && images[`photo-${i + 1}`] ? `photo-${i + 1}` : "")).filter(Boolean);
  // Each look leads with its own site photo; with fewer photos than looks, a look gets the site's signature graphic
  // reimagined / Imagine art instead of repeating one (repeats only when AI images are off).
  const ownRank = photoRank(design, index);
  const ownHero = suitable.length && (ownRank < suitable.length || !imagesEnabled()) ? suitable[ownRank % suitable.length] : undefined;
  const pending: ImageInfo[] = [];
  const jobs: Promise<void>[] = [];
  // The owner's words decide the photos first: a named scene ("use the brick streets") or feedback about
  // photos means the hero is generated from that scene, even when the site has a usable photo of its own.
  // "Keep the rocket": the owner's own picture, from their site only (never a web search or an AI image).
  const want = requestedPhoto(facts);
  // The Custom Design look with Grok Imagine on: its imagery comes from the site's own assets (photos, signature
  // graphic, logo) recomposed by Imagine, then Imagine art; Google Images only as a last resort (previewCustom).
  // So this look takes the site's own passing photos here and nothing from Google, the web or a plain AI photo.
  const imagineFirst = Boolean(design.custom) && (await import("@/lib/preview/custom-design.server")).imagineDesignEnabled();
  const IMAGINE_NOTE = "Custom Design: Grok Imagine makes this look's imagery from your site's own assets (no Google Images)";
  const keepSubject = want.intent === "keep" ? want.subject : undefined;
  let kept: StoredImage | undefined;
  let keepEntry: ImageTrace | undefined;
  if (keepSubject) {
    const { keepFromSite } = await import("@/lib/preview/keep-art.server");
    const found = await keepFromSite(keepSubject, facts, useAi, stepStart + Math.min(25_000, budget / 3));
    keepEntry = { name: "hero", slot: "hero", scene: keepSubject, prompt: "", status: "not found on your site" };
    if (found.kept) {
      const k = found.kept;
      try {
        await saveImage(id, "hero", k.type, k.bytes);
        kept = { name: "hero", type: k.type, source: "photo", alt: k.art.label.split(/\s+/).slice(0, 8).join(" ") || keepSubject, width: k.width, height: k.height, cutout: k.cutout, kept: true };
        images.hero = kept;
        Object.assign(keepEntry, {
          status: "kept from your site",
          search: `${k.how} · ${k.art.kind === "svg" ? "inline SVG drawing" : k.art.kind === "css" ? "CSS background image" : k.art.kind === "og" ? "share image (og:image)" : k.art.kind === "logo" ? "logo" : "image"} on ${k.art.home ? "your homepage" : k.art.page}${k.cutout ? " · transparent art, shown whole on a color panel" : ""}`,
          credit: { title: keepSubject, author: "", license: "", licenseUrl: "", sourceUrl: k.art.url.startsWith("inline-svg:") ? k.art.page : k.art.url, provider: "your site" },
        } satisfies Partial<ImageTrace>);
      } catch {
        // Could not store it: reported as not found.
      }
    }
    if (!kept) keepEntry.search = `looked at ${found.looked} pictures on your site (${found.how}); no web or AI substitute is used for something you asked to keep`;
  }
  const asked0 = want.intent === "find" ? want.subject : undefined;
  // No subject named and none of the site's photos suits a hero (a town site with only utility shots): show the
  // town itself — a free-license photo of it, else an AI photo of it.
  const town = placeOf(facts);
  const bestOwn = scored[0];
  // Round 1 with no subject: the planner's proactive Google Images searches (prefetched by the plan step).
  const pre = !asked0 && !keepSubject ? pre0 : undefined;
  const autoScene = !pre?.photos.length && !asked0 && !keepSubject && !wantsNewPhotos(facts) && town?.city && (!bestOwn || bestOwn.score <= 0 || !heroWorthy(bestOwn.photo)) && civic ? `downtown ${town.city}` : undefined;
  const scene = asked0 ?? autoScene;
  // Image prompts read the subject from the facts; an automatic town subject is not the owner's request.
  const imgFacts: SiteFacts = autoScene ? { ...facts, photoSubject: autoScene, photoIntent: "find" } : facts;
  const freshPhotos = wantsNewPhotos(facts);
  const asked = hasOwnerRequest(facts);
  const trace: PreviewTrace = {
    request: { ...ownerRequests(facts), scene: want.subject, intent: want.subject ? (keepSubject ? "keep" : "find") : undefined, autoScene, subjectFrom: want.from },
    steps: [
      { step: "plan", ai: !plan.mock, ownerRequest: !plan.mock && asked },
      { step: "look directions", ai: Boolean(design.ai), ownerRequest: Boolean(design.ai) && asked },
    ],
    images: [],
  };
  const kind = facts.industry || "the business";
  const wantImage = (name: string, slot: ImageTrace["slot"], aspect: "16:9" | "4:3", describe: string, before?: () => Promise<boolean>, preset?: ImageTrace, aiFallback = true, lastResort?: () => Promise<boolean>) => {
    const shown = sceneFor(slot, imgFacts, design) || (slot === "hero" ? kind : `${kind} at work`);
    const prompt = imagePrompt(slot, imgFacts, design);
    const entry: ImageTrace = preset ?? { name, slot, scene: shown, prompt, status: "not generated (mock mode / images off)" };
    if (!preset) trace.images.push(entry);
    if (!imagesEnabled() && !before) return;
    pending.push({ name, describe });
    jobs.push(
      (async () => {
        // A matching real photo (the site's own, or a free-license web photo) beats an AI one.
        if (before && (await before())) return;
        if (!aiFallback) {
          entry.status = "skipped";
          entry.search = `${entry.search ? `${entry.search} · ` : ""}${IMAGINE_NOTE}`;
          return;
        }
        // Round 9: no site photo for this hero, but the site has a signature graphic (bob.me's rocket) or a logo:
        // Grok Imagine reimagines it into the hero art (the original file is the fallback). Before plain AI / Google.
        if (name === "hero" && !scene && !keepSubject && !freshPhotos && process.env.PREVIEW_SIGNATURE_HERO !== "0") {
          const { signatureHero } = await import("@/lib/preview/signature-hero.server");
          const sig = await signatureHero(id, facts, design, aspect === "4:3" ? "4:3" : "16:9", Math.min(50_000, budget - 10_000)).catch(() => undefined);
          if (sig) {
            images.hero = sig.image;
            Object.assign(entry, {
              status: sig.how === "reimagined" ? "signature reimagined" : "signature original",
              source: sig.how === "reimagined" ? "AI" : "your site",
              scene: sig.subject,
              signature: { subject: sig.subject, from: sig.from },
              search: `${entry.search ? `${entry.search} · ` : ""}${sig.how === "reimagined" ? `your ${sig.from} (${sig.subject}) sent to Grok Imagine as the reference and reimagined as the hero` : `your ${sig.from} (${sig.subject}) shown as the hero (Imagine ${imagesEnabled() ? "failed" : "is off"})`}`,
            } satisfies Partial<ImageTrace>);
            console.info(`[photo] look ${index + 1} "${design.name}": hero = your ${sig.from} “${sig.subject}” ${sig.how === "reimagined" ? "reimagined by Grok Imagine" : "(original file; Imagine unavailable)"} — no site photo for this hero`);
            return;
          }
        }
        if (!imagesEnabled()) return;
        entry.status = "failed";
        entry.source = "AI";
        const img = await generateAndStore(id, name, prompt, aspect, shown, Math.min(50_000, budget - 10_000));
        if (!img) {
          // Round 9: Google Images only as the last resort, after the site's photos and Grok Imagine.
          if (lastResort) await lastResort();
          return;
        }
        images[name] = img;
        entry.status = "generated";
      })(),
    );
  };
  if (keepEntry) trace.images.push(keepEntry);
  // Photo search shares the step budget with the page writer (they run in parallel): photoDeadline above.
  // A usable but weak own hero (small) is replaced by a Google Images one only when PHOTO_SEARCH_WEAK_HEROES=1.
  const weakHero = process.env.PHOTO_SEARCH_WEAK_HEROES === "1" && !scene && !kept && Boolean(photos[0]) && (photos[0]!.width < 1600 || (bestOwn?.score ?? 0) <= 0);
  let googleHero: string | undefined;
  let proactiveOwn: string | undefined;
  const heroAspect = design.heroStyle ? (["cinematic", "poster", "panorama"].includes(design.heroStyle) ? "16:9" : "4:3") : design.hero === "split" ? "4:3" : "16:9";
  if (scene) {
    // The owner named what the hero should show. Order: one of the site's own photos that shows it (alt text,
    // title or file name) -> a free-license web photo of it near the business -> an AI photo of it. Never just
    // the biggest scraped photo.
    const place = placeOf(facts);
    const entry: ImageTrace = { name: "hero", slot: "hero", scene, prompt: imagePrompt("hero", imgFacts, design), status: "not generated (mock mode / images off)" };
    trace.images.push(entry);
    // Up to three real photos of the scene (the site's own match first, then web photos); each look takes a
    // different one. With fewer photos than looks, a later look gets an AI photo (when images are on) or
    // shows the same photo in its own treatment.
    const findReal = async (): Promise<boolean> => {
      type Real = { photo: Photo; credit: PhotoCredit; source: "photo" | "web"; alt: string; temp?: TemporaryPhoto };
      const real: Real[] = [];
      const labels = facts.imageText ?? {};
      const own = matchScraped(scene, place, facts.images.map((url) => ({ url, label: labels[url] ?? "" })));
      if (own) {
        const photo = await fetchPhoto(own.url);
        if (photo && photo.width >= 1000 && photo.width / photo.height >= 1.2) {
          real.push({ photo, source: "photo", alt: own.label || scene, credit: { title: own.label || scene, author: "", license: "", licenseUrl: "", sourceUrl: own.url, provider: "your site" } });
        }
      }
      // Google Images (via Serper, when configured) before the free-license sites: temporary preview photos.
      // A regenerated round looks further down the results, so it can skip the photos earlier rounds showed.
      const avoid = plan.avoidPhotos;
      const want = avoid ? 6 : 3;
      if (real.length < want && photoSearchEnabled() && !imagineFirst) {
        const google = await findGooglePhotos(scene, facts, useAi, photoDeadline, want);
        for (const g of google.photos.slice(0, want - real.length)) real.push({ photo: g.photo, source: "web", alt: g.temp.title, credit: googleCredit(g.temp), temp: g.temp });
        entry.search = googleSearchNote(google);
      }
      // Round 9b: Google Images being off is a server log line only ("[photo-search] Google Images disabled…"), not UI.
      if (real.length < want && webPhotosEnabled() && !imagineFirst) {
        const web = await findWebPhotos(scene, place, 8_000, want - real.length).catch(() => []);
        entry.search = `${entry.search ? `${entry.search} · ` : ""}web search ${webQueries(scene, place).map((x) => `“${x.q}”`).join(" / ")} (Openverse, Wikimedia Commons; CC0 / public domain / CC BY / CC BY-SA): ${web.length ? `${web.length} matching photo${web.length > 1 ? "s" : ""}` : "no matching photo"}`;
        for (const w of web) real.push({ photo: w.photo, source: "web", alt: w.credit.title, credit: w.credit });
      }
      if (!real.length) return false;
      if (avoid) {
        const { measurePhoto } = await import("@/lib/preview/hero-pick.server");
        const { shownBefore } = await import("@/lib/preview/google-photo.server");
        const seen = real.map((r) => shownBefore(avoid, [r.temp?.imageUrl, r.temp?.sourcePage, r.credit.sourceUrl], measurePhoto(r.photo.bytes, r.photo.type)?.hash));
        const fresh = real.filter((_, i) => !seen[i]);
        const skipped = real.length - fresh.length;
        if (skipped && fresh.length) {
          // New photos first; the ones shown before only when there aren't enough new ones.
          real.splice(0, real.length, ...fresh, ...real.filter((_, i) => seen[i]));
          entry.search = `${entry.search ?? ""}${entry.search ? " · " : ""}${skipped} photo${skipped > 1 ? "s" : ""} shown in an earlier round moved to the back`;
          console.info(`[photo] look ${index + 1}: ${skipped} photo${skipped > 1 ? "s" : ""} shown in an earlier round moved behind ${fresh.length} new one${fresh.length > 1 ? "s" : ""}`);
        }
      }
      const rank = photoRank(design, index);
      let pick = real[rank];
      if (!pick && imagineFirst) pick = real[0];
      if (!pick) {
        if (imagesEnabled()) {
          entry.search = `${entry.search ?? ""}${entry.search ? " · " : ""}only ${real.length} real photo${real.length > 1 ? "s" : ""}, so this look gets an AI photo instead of repeating one`;
          return false;
        }
        pick = real[rank % real.length]!;
      }
      await saveImage(id, "hero", pick.photo.type, pick.photo.bytes);
      images.hero = { name: "hero", type: pick.photo.type, source: pick.source, alt: pick.alt, width: pick.photo.width, height: pick.photo.height, credit: pick.credit, temporary: pick.temp };
      Object.assign(
        entry,
        pick.temp
          ? { status: "preview photo (Google Images)", source: "web search", credit: pick.credit }
          : pick.source === "web"
            ? { status: "web photo", source: "web search", credit: pick.credit }
            : ({ status: "your site's photo", source: "your site", credit: pick.credit } satisfies Partial<ImageTrace>),
      );
      return true;
    };
    wantImage("hero", "hero", heroAspect, `photo of ${scene}: the owner asked for this, so use it as the hero background image`, findReal, entry, !imagineFirst);
  } else if (kept) {
    // The kept picture is the hero; nothing is generated in its place.
  } else if (pre?.photos.length) {
    // Proactive pick (no note needed): strong, relevant site photos first, then the ranked Google Images results,
    // then the site's weaker photos. Each look takes a different one (photoRank). "Asked for new photos" puts
    // Google first.
    const describe = (url: string) => {
      const cue = facts.imageText?.[url]?.trim();
      if (cue) return cue.length > 60 ? `${cue.slice(0, 60).replace(/\s+\S*$/, "")}…` : cue;
      const file = decodeURIComponent(url.split(/[?#]/)[0]!.split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "").replace(/[-_+]+/g, " ").trim();
      return file && /[a-z]{3}/i.test(file) && !/^(img|dsc|image|photo)?\s*\d+$/i.test(file) ? file.slice(0, 60) : "your homepage";
    };
    const strong = scored.slice(0, OWN_MAX).flatMap((p, i) => (p.score >= 2 && heroWorthy(p.photo) && images[`photo-${i + 1}`] ? [{ own: `photo-${i + 1}`, score: p.score, what: describe(p.photo.url) }] : []));
    const weak = suitable.filter((n) => !strong.some((x) => x.own === n)).map((own) => ({ own, score: 0, what: describe(scored[Number(own.slice(6)) - 1]?.photo.url ?? "") }));
    const google = pre.photos.map((g) => ({ g }));
    // The site's single best photo can still win one look; strong Google results take the others, then the rest.
    const pool: ({ own: string; score: number; what: string } | { g: (typeof pre.photos)[number] })[] = freshPhotos
      ? [...google, ...strong, ...weak]
      : [...strong, ...weak, ...google];
    const rank = photoRank(design, index);
    // The round's assignment (hero-pick.ts): one photo per look, no two of the same subject, each suiting its look's
    // mood, site photos only where they beat Google on the same score. Made once by the plan step when it knew the
    // three archetypes; recomputed the same way (without moods) when it didn't.
    const { assignHeroes } = await import("@/lib/preview/hero-pick");
    const stored = pre.assign && pre.assign.archetypes[index] === design.archetype ? pre.assign.picks : undefined;
    const cands = [...pre.photos.flatMap((p) => (p.candidate ? [p.candidate] : [])), ...(freshPhotos ? [] : (pre.site ?? [])), ...(pre.web ?? []).map((w) => w.candidate)];
    const allPicks = stored ?? (cands.length ? assignHeroes(cands, [undefined, undefined, undefined]) : []);
    const mine = allPicks.find((p) => p.index === index);
    type Option = { own: string; score: number; what: string } | { g: (typeof pre.photos)[number] } | { siteUrl: string; what: string } | { w: NonNullable<typeof pre.web>[number] };
    let first: Option | undefined;
    if (mine?.source === "web") {
      const w = pre.web?.find((p) => p.candidate.id === mine.id);
      if (w) first = { w };
    } else if (mine?.source === "google") {
      const g = pre.photos.find((p) => p.temp.imageUrl === mine.id);
      if (g) first = { g };
    } else if (mine?.source === "site") {
      const at = scored.slice(0, OWN_MAX).findIndex((p) => p.photo.url === mine.id);
      first = at >= 0 && images[`photo-${at + 1}`] ? { own: `photo-${at + 1}`, score: scored[at]!.score, what: describe(mine.id) } : { siteUrl: mine.id, what: describe(mine.id) };
    }
    const entry: ImageTrace = {
      name: "hero",
      slot: "hero",
      scene: pre.queries.join(" / "),
      prompt: "",
      status: "not generated (mock mode / images off)",
      search: `${photoSearchEnabled() ? "Google Images (proactive, from the plan)" : "Site photos (proactive)"} ${pre.queries.map((q) => `“${q}”`).join(" / ")}: ${pre.seen} results, ${pre.photos.length} usable${pre.ranking ? ` · ${pre.ranking}` : ""}${pre.bar ? ` · quality gate (${pre.bar.brief}; ${pre.bar.rated ? "vision-rated" : "rules"}): ${pre.bar.passed.length} passed, ${pre.bar.failed.length} failed` : ""}${Object.keys(pre.rejected).length ? ` (skipped ${Object.entries(pre.rejected).map(([w, n]) => `${n} ${w}`).join(", ")})` : ""} · ${strong.length} strong site photo${strong.length === 1 ? "" : "s"}`,
    };
    trace.images.push(entry);
    // The quality gate (hero-brief.ts / rateHeroes): a photo that failed it is never a fallback for this look.
    const failed = new Set(pre.bar?.failed ?? []);
    // Remember each site photo's gate verdict and what it shows: the Custom Design gets only the ones that passed.
    if (pre.bar)
      for (const [i, p] of scored.slice(0, OWN_MAX).entries()) {
        const im = images[`photo-${i + 1}`];
        if (!im) continue;
        im.gate = failed.has(p.photo.url) ? "failed" : pre.bar.passed.includes(p.photo.url) ? "passed" : undefined;
        const what = describe(p.photo.url);
        if (what !== "your homepage") im.shows = what;
      }
    // Nothing passed the gate for this look: an AI photo of a good scene beats an unappealing real one.
    if (mine && failed.has(mine.id) && imagesEnabled()) first = undefined;
    // Round 9: a photo another look already leads with is not repeated while Imagine can fill this look.
    // Round 9: the site's own photos first, then Grok Imagine art; Google Images only when both are unavailable.
    const imagineBeforeGoogle = imagesEnabled() && !freshPhotos && !imagineFirst && process.env.PREVIEW_GOOGLE_BEFORE_IMAGINE !== "1";
    const noRepeats = imagesEnabled() && !freshPhotos;
    if (mine && /reused:/.test(mine.reason) && noRepeats) first = undefined;
    const urlOf = (o: (typeof pool)[number]) => ("g" in o ? o.g.temp.imageUrl : (scored[Number(o.own.slice(6)) - 1]?.photo.url ?? ""));
    // Round 9: the site's passing photos are shared out between the template looks, one each (their assigned site
    // photo, else the next free one, best-rated first); a look never repeats another's while Imagine can fill it.
    // The from-scratch Custom Design (look 3) builds with Imagine from all the site's own assets, so its pick does not
    // take a photo away from a template look.
    const siteOwner = new Map<string, number>();
    if (noRepeats) {
      const templates = [0, 1, 2].filter((i) => i !== CUSTOM_LOOK);
      const free = (pre.site ?? [])
        .filter((c) => !failed.has(c.id))
        .sort((a, b) => (b.appeal ?? 0) - (a.appeal ?? 0))
        .map((c) => c.id);
      const owned = new Map<number, string>();
      for (const i of templates) {
        const p = allPicks.find((q) => q.index === i);
        if (p?.source === "site" && !/reused:/.test(p.reason) && !failed.has(p.id) && ![...owned.values()].includes(p.id)) owned.set(i, p.id);
      }
      for (const i of templates) {
        if (owned.has(i) || allPicks.find((q) => q.index === i && q.source !== "site" && !imagineBeforeGoogle)) continue;
        const next = free.find((id) => ![...owned.values()].includes(id));
        if (next) owned.set(i, next);
      }
      for (const [i, url] of owned) siteOwner.set(url, i);
      const mineSite = owned.get(index);
      if (mineSite && !design.custom) {
        const option = pool.find((o) => urlOf(o) === mineSite);
        if (option) first = option;
      }
    }
    const taken = (o: (typeof pool)[number]) => !design.custom && siteOwner.has(urlOf(o)) && siteOwner.get(urlOf(o)) !== index;
    const passing = pool.filter((o) => !failed.has(urlOf(o)) && !taken(o));
    const order: Option[] = [...(first ? [first] : []), ...passing.slice(rank), ...passing.slice(0, rank)].filter((o) => !imagineFirst || "own" in o || "siteUrl" in o);
    const picked = (option: Option) => (option === first && mine ? ` · picked for this look: ${mine.reason}` : first ? " · (assigned photo unavailable; next in the pool)" : "");
    const sitePassed = (pre.site ?? []).filter((c) => !failed.has(c.id)).length;
    const whyNoSite = () =>
      !(pre.site ?? []).length
        ? "no hero-sized photo on your site"
        : !sitePassed
          ? `none of your site's ${(pre.site ?? []).length} hero-sized photos passed the quality bar`
          : `all ${sitePassed} of your site's passing photos are used by the other looks`;
    let skippedGoogle: Option | undefined;
    const heroFromGoogle = async (option: Extract<Option, { g: unknown }>): Promise<boolean> => {
      const photo = await fetchPhoto(option.g.temp.imageUrl);
      if (!photo || photo.width < 1000) return false;
      await saveImage(id, "hero", photo.type, photo.bytes);
      images.hero = { name: "hero", type: photo.type, source: "web", alt: option.g.temp.title, width: photo.width, height: photo.height, credit: googleCredit(option.g.temp), temporary: option.g.temp };
      Object.assign(entry, { status: "preview photo (Google Images)", source: "web search", credit: googleCredit(option.g.temp), scene: option.g.temp.query, search: `${entry.search}${picked(option)}` } satisfies Partial<ImageTrace>);
      googleHero = option.g.temp.query;
      console.info(`[photo] look ${index + 1} "${design.name}": Google Images hero because ${whyNoSite()}${imagineBeforeGoogle ? " and Grok Imagine failed" : imagesEnabled() ? "" : " and AI images are off"}`);
      return true;
    };
    const choose = async (): Promise<boolean> => {
      for (const option of order) {
        if ("g" in option && imagineBeforeGoogle) {
          skippedGoogle = skippedGoogle ?? option;
          continue;
        }
        if ("siteUrl" in option) {
          const photo = await fetchPhoto(option.siteUrl);
          if (!photo || photo.width < 800) continue;
          await saveImage(id, "hero", photo.type, photo.bytes);
          images.hero = { name: "hero", type: photo.type, source: "photo", alt: (facts.imageText?.[option.siteUrl] ?? "").slice(0, 120) || facts.name, width: photo.width, height: photo.height, sourceUrl: option.siteUrl, credit: { title: option.what, author: "", license: "", licenseUrl: "", sourceUrl: option.siteUrl, provider: "your site" } };
          Object.assign(entry, { status: "your site's photo", source: "your site", scene: option.what, search: `${entry.search}${picked(option)}` } satisfies Partial<ImageTrace>);
          return true;
        }
        if ("w" in option) {
          const photo = await fetchPhoto(option.w.url);
          if (!photo || photo.width < 1000) continue;
          await saveImage(id, "hero", photo.type, photo.bytes);
          images.hero = { name: "hero", type: photo.type, source: "web", alt: option.w.credit.title, width: photo.width, height: photo.height, credit: option.w.credit };
          Object.assign(entry, { status: "web photo", source: "web search", credit: option.w.credit, scene: option.w.credit.title, search: `${entry.search}${picked(option)}` } satisfies Partial<ImageTrace>);
          return true;
        }
        if ("own" in option) {
          proactiveOwn = option.own;
          Object.assign(entry, { status: "your site's photo", source: "your site", scene: option.what, search: `${entry.search} · chose your site's photo${picked(option) || ` (relevance ${option.score})`}` } satisfies Partial<ImageTrace>);
          return true;
        }
        if ("g" in option) {
          if (await heroFromGoogle(option)) return true;
          continue;
        }
      }
      if (skippedGoogle) {
        console.info(`[photo] look ${index + 1} "${design.name}": no site photo for this look (${whyNoSite()}) → Grok Imagine art instead of Google Images (Google only if Imagine fails)`);
        entry.search = `${entry.search} · ${whyNoSite()}, so Grok Imagine makes this hero (Google Images only as a last resort)`;
      }
      return false;
    };
    const lastResort = async (): Promise<boolean> => {
      for (const option of order) if ("g" in option && (await heroFromGoogle(option))) return true;
      return false;
    };
    wantImage("hero", "hero", heroAspect, `generated hero photo: ${design.heroSubject || kind}`, choose, entry, !imagineFirst, imagineBeforeGoogle ? lastResort : undefined);
  } else if (!ownHero || freshPhotos || (weakHero && photoSearchEnabled())) {
    // No good hero photo on the site (or a weak one, with PHOTO_SEARCH_WEAK_HEROES=1): Google Images of the
    // business type in its town when photo search is on (each look a different one), else an AI photo.
    const tryGoogle = photoSearchEnabled() && !keepSubject && !imagineFirst
      ? async (): Promise<boolean> => {
          const google = await findGooglePhotos(undefined, facts, useAi, photoDeadline, 3);
          const entry = trace.images.find((i) => i.name === "hero" && i.slot === "hero" && i.status !== "not found on your site");
          if (entry) entry.search = googleSearchNote(google);
          const pick = google.photos[photoRank(design, index)] ?? (imagesEnabled() ? undefined : google.photos[0]);
          if (!pick) return false;
          await saveImage(id, "hero", pick.photo.type, pick.photo.bytes);
          images.hero = { name: "hero", type: pick.photo.type, source: "web", alt: pick.temp.title, width: pick.photo.width, height: pick.photo.height, credit: googleCredit(pick.temp), temporary: pick.temp };
          if (entry) Object.assign(entry, { status: "preview photo (Google Images)", source: "web search", credit: googleCredit(pick.temp), scene: pick.temp.query } satisfies Partial<ImageTrace>);
          trace.request.autoScene = trace.request.autoScene ?? pick.temp.query;
          googleHero = pick.temp.query;
          return true;
        }
      : undefined;
    if (imagineFirst) trace.images.push({ name: "hero", slot: "hero", scene: kind, prompt: "", status: "skipped", search: IMAGINE_NOTE });
    // Round 9b: no passing site photo for this look (also without Google): the signature graphic / Imagine art.
    else if (!ownHero || freshPhotos || tryGoogle) {
      // Round 9: no usable site photo for the hero → Grok Imagine first; Google Images only if Imagine fails.
      const imagineBeforeGoogle = imagesEnabled() && !freshPhotos && process.env.PREVIEW_GOOGLE_BEFORE_IMAGINE !== "1";
      if (imagineBeforeGoogle && tryGoogle) console.info(`[photo] look ${index + 1} "${design.name}": no hero-sized photo on your site → Grok Imagine art (Google Images only if Imagine fails)`);
      wantImage("hero", "hero", heroAspect, `generated hero photo: ${design.heroSubject || kind}`, imagineBeforeGoogle ? undefined : tryGoogle, undefined, true, imagineBeforeGoogle ? tryGoogle : undefined);
    }
  }
  if ((photos.length < 2 || freshPhotos) && !imagineFirst) {
    wantImage("feature", "feature", "4:3", `generated photo: ${design.featureScene || `${kind} work in progress`}`);
  }
  let logoMeta: StoredSite["logoMeta"];
  if (facts.logo) {
    const { prepareLogo } = await import("@/lib/preview/logo.server");
    jobs.push(
      prepareLogo(id, facts.logo, facts.name).then((logo) => {
        logoMeta = logo.meta;
        for (const image of logo.images ?? []) images[image.name] = image;
      }),
    );
  }
  const home = plan.pages[0]!;
  // The homepage AI call gets everything left in this request's budget (images run alongside it).
  const aiBudget = budget - (Date.now() - stepStart) - 5_000;
  const [result] = await Promise.all([sectionsFor(home, facts, plan, design, images, pending, useAi, aiBudget), ...jobs]);
  const available = Object.keys(images);
  const sections = resolveImages(result.sections, available);
  // The requested scene goes in the hero even if the page writer picked one of the site's own photos, and
  // "as background" means the full-bleed photo hero. With no photo of the scene, no unrelated photo is used.
  if (sections[0]?.type.startsWith("hero-")) sections[0] = heroForRequest(sections[0], facts, design, Boolean(images.hero), scene ?? (kept ? keepSubject : undefined) ?? googleHero, freshPhotos && !proactiveOwn, proactiveOwn ?? ownHero);
  if (proactiveOwn && sections[0]?.type.startsWith("hero-") && !images.hero) sections[0] = { ...sections[0], image: proactiveOwn };
  // Each look: its own hero treatment, section order and section variants (kept art shown whole, as a cutout).
  sections.splice(0, sections.length, ...arrangeSections(sections, design, available, facts.services, Boolean(images.hero?.cutout && sections[0]?.image === "hero")));
  // Round 9: a site photo under 1400px wide in the hero gets a treatment (tinted overlay / framed, not stretched).
  {
    const heroImg = sections[0]?.image ? images[sections[0].image] : undefined;
    if (sections[0]?.type.startsWith("hero-") && heroImg?.source === "photo" && !heroImg.cutout && sections[0].fit !== "cutout" && (heroImg.width ?? 9999) < 1400) sections[0] = { ...sections[0], fit: "small" };
    const used = new Set<string>();
    for (const s of sections) for (const n of [s.image, ...(s.items ?? []).map((it) => it.image)]) if (n && images[n]?.source === "photo") used.add(n === "hero" ? (images.hero?.credit?.sourceUrl ?? "hero") : n);
    const { scanSitePhotos } = await import("@/lib/preview/site-photos.server");
    const scan = await scanSitePhotos(facts).catch(() => undefined);
    trace.sitePhotos = { found: scan?.photos.length ?? photos.length, heroSized: scan?.photos.filter((p) => p.hero).length ?? 0, used: used.size, heroOwn: Boolean(sections[0]?.image && images[sections[0].image]?.source === "photo") };
    console.info(`[photo] look ${index + 1} "${design.name}": site photos ${trace.sitePhotos.found} found (${trace.sitePhotos.heroSized} hero-sized), ${used.size} used in this look${trace.sitePhotos.heroOwn ? `, hero = your site's “${(images[sections[0]!.image!]?.alt ?? "").slice(0, 60)}”${sections[0]?.fit === "small" ? " (small: tinted / framed treatment)" : ""}` : ""}`);
  }
  trace.layout = lookSignature(design, sections, images.hero?.credit?.sourceUrl ?? sections[0]?.image);
  logHeroChoice(index, design.name, sections[0]?.image, images, trace, photoSearchEnabled());
  trace.steps.push({ step: "homepage sections", ai: result.ai, ownerRequest: Boolean(result.ownerRequest) });
  const pages: StoredPage[] = plan.pages.map((p) =>
    p.slug === "home" ? { slug: p.slug, title: p.title, navLabel: p.navLabel, body: "", sections } : { slug: p.slug, title: p.title, navLabel: p.navLabel, body: "", pending: true },
  );
  const site: StoredSite = {
    version: 3,
    id,
    createdAt: new Date().toISOString(),
    mode: facts.mode,
    mock: isMockMode(),
    host: facts.host,
    sourceUrl: facts.sourceUrl,
    name: facts.name,
    tagline: plan.tagline,
    logo: facts.logo,
    phone: facts.phone,
    email: facts.email,
    address: facts.address,
    hours: facts.hours,
    social: facts.social,
    palette: design.palette,
    fonts: design.fonts,
    cta: plan.cta,
    pages,
    industry: facts.industry,
    design,
    images,
    facts,
    plan,
    lookIndex: index,
    finished: false,
    aiErrors: result.error ? { home: result.error } : undefined,
    aiDebug: result.debug ? { home: result.debug } : undefined,
    logoMeta,
    trace,
  };
  const generated = Object.values(images).filter((i) => i.source === "generated").length;
  const aiWarning = result.ai && result.debug ? skippedNote(result.debug) : undefined;
  return { site, ai: result.ai, aiError: result.error, aiWarning, generated, photos: photos.length };
}

/** Build every remaining page for the chosen look, add service images, and critique/revise the homepage. */
export async function finishSite(site: StoredSite): Promise<{ site: StoredSite; failed: number; note?: string }> {
  if (!site.facts || !site.plan || !site.design) throw new Error("This preview was made by an older version. Run the site again.");
  const { imagesEnabled, generateAndStore } = await import("@/lib/preview/images.server");
  const { polishHome } = await import("@/lib/preview/critique.server");
  const facts = site.facts;
  const plan = site.plan;
  const design = site.design;
  const budget = stepBudgetMs();
  const useAi = !isMockMode() && aiAvailable();
  const images: Record<string, StoredImage> = { ...(site.images ?? {}) };
  const pending: ImageInfo[] = [];
  const jobs: Promise<void>[] = [];
  const photoCount = Object.values(images).filter((i) => i.name.startsWith("photo-")).length;
  const trace: PreviewTrace = site.trace
    ? { ...site.trace, steps: [...site.trace.steps], images: [...site.trace.images] }
    : { request: { ...ownerRequests(facts), scene: requestedScene(facts) }, steps: [], images: [] };
  if (photoCount < 4) {
    facts.services.slice(0, 3).forEach((service, i) => {
      const name = `service-${i + 1}`;
      if (images[name]) return;
      const prompt = imagePrompt("service", facts, design, service);
      const entry: ImageTrace = { name, slot: "service", scene: service, prompt, status: "not generated (mock mode / images off)" };
      trace.images.push(entry);
      if (!imagesEnabled()) return;
      entry.status = "failed";
      pending.push({ name, describe: `generated photo for the service "${service}"` });
      jobs.push(
        generateAndStore(site.id, name, prompt, "4:3", service, Math.min(50_000, budget - 10_000)).then((img) => {
          if (!img) return;
          images[name] = img;
          entry.status = "generated";
        }),
      );
    });
  }
  let failed = 0;
  const aiErrors: Record<string, string> = {};
  const aiDebug: Record<string, AiDebug> = { ...(site.aiDebug ?? {}) };
  const stepStart = Date.now();
  const todo = site.pages.filter((p) => p.slug !== "home");
  const pagesJob = Promise.all(
    todo.map(async (page) => {
      const planned = plan.pages.find((p) => p.slug === page.slug) ?? { slug: page.slug, title: page.title, navLabel: page.navLabel, purpose: "", sections: [] };
      const result = await sectionsFor(planned, facts, plan, design, images, pending, useAi, budget - (Date.now() - stepStart) - 6_000);
      if (result.debug) aiDebug[page.slug] = result.debug;
      trace.steps.push({ step: `page ${page.slug}`, ai: result.ai, ownerRequest: Boolean(result.ownerRequest) });
      if (useAi && !result.ai) {
        failed += 1;
        if (result.error) aiErrors[page.slug] = result.error;
      }
      return { slug: page.slug, sections: result.sections };
    }),
  );
  const homeCtx = normalizeContext(facts, plan, "home", Object.keys(images).filter((n) => !n.startsWith("logo")));
  // The from-scratch homepage is Grok's own design (already validated): no critique pass on its template fallback.
  const polishJob =
    site.custom && !site.design?.custom?.failed
      ? Promise.resolve({ sections: site.pages.find((p) => p.slug === "home")?.sections ?? [], polish: { method: "skipped" as const, notes: [], reason: "Designed from scratch (custom look)." } })
      : polishHome(site, homeCtx, budget - 5_000);
  const [built, polished] = await Promise.all([pagesJob, polishJob, ...jobs]);
  const available = Object.keys(images);
  const pages = site.pages.map((page) => {
    if (page.slug === "home") {
      const home = resolveImages(polished.sections, available);
      // Keep the owner's requested scene in the hero after the critique pass.
      // (A subject to keep that wasn't found on the site leaves the hero as it was: no plain-background swap.)
      const heroScene = trace.request.intent === "keep" && !images.hero?.kept ? undefined : (trace.request.scene ?? trace.request.autoScene);
      if (home[0]?.type.startsWith("hero-")) home[0] = heroForRequest(home[0], facts, design, Boolean(images.hero), heroScene, wantsNewPhotos(facts));
      const arranged = arrangeSections(home, design, available, facts.services, Boolean(images.hero?.cutout && home[0]?.image === "hero"));
      trace.layout = lookSignature(design, arranged, images.hero?.credit?.sourceUrl ?? arranged[0]?.image);
      return { ...page, sections: arranged, pending: false };
    }
    const done = built.find((b) => b.slug === page.slug);
    return { ...page, sections: resolveImages(done?.sections ?? [], available), pending: false };
  });
  const mergedErrors = { ...(site.aiErrors?.home ? { home: site.aiErrors.home } : {}), ...aiErrors };
  trace.steps.push({ step: "homepage critique", ai: polished.polish.method !== "skipped", ownerRequest: polished.polish.method !== "skipped" && hasOwnerRequest(facts) });
  const next: StoredSite = { ...site, images, pages, finished: true, trace, polish: polished.polish, aiErrors: Object.keys(mergedErrors).length ? mergedErrors : undefined, aiDebug: Object.keys(aiDebug).length ? aiDebug : undefined };
  const first = Object.values(aiErrors)[0];
  const note = failed ? `${failed} of ${todo.length} pages were assembled from the section library because the AI failed${first ? `: ${first}` : ""}. Use "Retry with AI" to try again.` : undefined;
  return { site: next, failed, note };
}

export { hashString };

/** "AI homepage used; 2 of 8 sections skipped: …" — shown under a look that the AI built anyway. */
export function skippedNote(debug: AiDebug): string {
  return `${debug.total - debug.used > 0 ? `${debug.total - debug.used} of ${debug.total}` : "Some"} AI sections were skipped: ${debug.rejected.slice(0, 3).join("; ")}`;
}

/**
 * "Retry with AI": re-run the AI for the homepage (and, for a finished site, any page that fell back).
 * No images or critique — the whole step budget goes to the AI calls, run in parallel.
 */
export async function retryAiPages(site: StoredSite): Promise<{ site: StoredSite; fixed: string[]; errors: Record<string, string> }> {
  if (!site.facts || !site.plan || !site.design) throw new Error("This preview was made by an older version. Run the site again.");
  if (isMockMode() || !aiAvailable()) throw new Error(isMockMode() ? "AI is off (PREVIEW_MOCK=1)." : "AI is not configured on this server (XAI_API_KEY is missing).");
  const facts = site.facts;
  const plan = site.plan;
  const design = site.design;
  const budget = stepBudgetMs() - 6_000;
  const images = site.images ?? {};
  const slugs = Object.keys(site.aiErrors ?? {});
  const targets = (slugs.length ? slugs : ["home"]).filter((slug) => site.pages.some((p) => p.slug === slug && !p.pending));
  const results = await Promise.all(
    targets.map(async (slug) => {
      const planned = plan.pages.find((p) => p.slug === slug) ?? { slug, title: slug, navLabel: slug, purpose: "", sections: [] };
      return { slug, result: await sectionsFor(planned, facts, plan, design, images, [], true, budget) };
    }),
  );
  const available = Object.keys(images);
  const errors: Record<string, string> = {};
  const fixed: string[] = [];
  const aiDebug: Record<string, AiDebug> = { ...(site.aiDebug ?? {}) };
  const pages = site.pages.map((page) => {
    const hit = results.find((r) => r.slug === page.slug);
    if (!hit) return page;
    if (hit.result.debug) aiDebug[page.slug] = hit.result.debug;
    if (!hit.result.ai) {
      errors[page.slug] = hit.result.error ?? "the AI answer could not be used";
      return page;
    }
    fixed.push(page.slug);
    return { ...page, sections: resolveImages(hit.result.sections, available) };
  });
  const next: StoredSite = { ...site, pages, aiErrors: Object.keys(errors).length ? errors : undefined, aiDebug: Object.keys(aiDebug).length ? aiDebug : undefined };
  return { site: next, fixed, errors };
}
