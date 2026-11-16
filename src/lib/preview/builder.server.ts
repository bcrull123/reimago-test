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
import { aiAvailable, chatJson, isMockMode } from "@/lib/ai-provider.server";
import { BODY_FONTS, HEADING_FONTS, defaultPalette, hashString, safeFont, safePalette } from "@/lib/preview/theme";
import { ARCHETYPES, type DesignDirection, type PlanPage, type PlanSection, type Section, type SiteFacts, type SitePlan, type StoredImage } from "@/lib/preview/types";
import { PRESETS, archetypesFor, mockDirections, normalizeDirection, HEADING_FONTS as DISPLAY_FONTS, BODY_FONTS as TEXT_FONTS } from "@/lib/preview/design";
import { SECTION_GUIDE, composeImages, composeMockPage, corpusFor, normalizeSections, type NormalizeContext } from "@/lib/preview/sections";
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
    requested_changes: facts.notes || null,
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
    mock: true,
  };
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
  };
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
      maxTokens: 2500,
      timeoutMs: 45_000,
      messages: [
        {
          role: "system",
          content: `You are a senior web designer planning a clean, modern small-business website that will be built as real HTML pages.
Return ONLY one JSON object, no markdown:
{"tagline": string, "summary": string (1-2 sentences: what the current site does poorly and what the new site fixes), "changes": [3 short strings],
 "cta": {"label": string (max 24 chars), "slug": page slug},
 "pages": [{"slug": "home"|lowercase-hyphenated, "title": string, "navLabel": string (max 18 chars), "purpose": string, "sections": [{"kind": "hero|services|about|testimonials|gallery|faq|hours|cta|text|team|pricing|contact-info", "heading": string, "brief": string}]}]}
Rules:
- 3 to ${MAX_PAGES} pages. The first page is "home". Always include "contact". Mirror the real pages the business already has (about, services, menu, etc.).
- Use ONLY facts provided. Never invent phone numbers, emails, street addresses, prices, awards, years in business, staff names, statistics, or reviews.
- Keep the business name exactly as given. (Visual design is decided separately — plan structure and content only.)
- Respect the requested changes when present.${variation ? `\n- Variation ${variation}: choose a clearly different structure and emphasis from a typical first attempt.` : ""}`,
        },
        { role: "user", content: JSON.stringify(factsForPrompt(facts)) },
      ],
    });
    return { plan: normalizePlan(raw, facts, variation) };
  } catch (error) {
    console.error("[preview] plan failed", error instanceof Error ? error.message : error);
    return { plan: mockPlan(facts, variation), note: "The AI planner did not answer, so the plan was assembled from the page text." };
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

export async function directionsFor(facts: SiteFacts, variation = 0): Promise<{ directions: DesignDirection[]; note?: string; mock: boolean }> {
  if (isMockMode() || !aiAvailable()) {
    return {
      directions: mockDirections(facts, variation),
      mock: true,
      note: isMockMode() ? "Mock mode (PREVIEW_MOCK=1): looks were picked from presets." : "AI is not configured, so looks were picked from presets.",
    };
  }
  const suggested = archetypesFor(facts, variation);
  try {
    const raw = await chatJson<{ looks?: unknown[] }>({
      temperature: variation ? 0.95 : 0.85,
      maxTokens: 3500,
      timeoutMs: 45_000,
      messages: [
        {
          role: "system",
          content: `You are an award-winning creative director. Propose THREE bold, distinctive, clearly different design directions ("looks") for this business's new website. Avoid generic template looks: each must have a strong concept a client would remember.
Return ONLY JSON: {"looks": [{
 "name": evocative 1-3 word concept name,
 "mood": 1-2 sentences on how the site should feel,
 "rationale": 1 sentence on why it fits this business and its customers,
 "archetype": one of ${JSON.stringify(ARCHETYPES)},
 "palette": {"primary": "#hex", "accent": "#hex", "background": "#hex", "surface": "#hex", "text": "#hex", "muted": "#hex"},
 "fonts": {"heading": one of ${JSON.stringify(DISPLAY_FONTS)}, "body": one of ${JSON.stringify(TEXT_FONTS)}},
 "imagery": art direction for photography (light, lens, color grade, subjects) in one sentence,
 "heroSubject": what the hero photograph shows, concretely (no text, signage, logos or brand names in the scene),
 "motifs": 1-3 of ["grain","thin-rules","oversized-numbers","diagonal-cuts","soft-blobs","underline-marks","grid-lines","glow","outlined-type","stamp-badges"],
 "radius": "sharp"|"soft"|"round", "buttons": "pill"|"square"|"outline",
 "hero": "split"|"photo"|"type", "header": "light"|"dark"|"overlay" (overlay only with hero "photo"), "footer": "columns"|"minimal"|"statement",
 "headline": a bold hero headline, max 9 words, may emphasize ONE word with *asterisks*
}]}
${ARCHETYPE_GUIDE}
Rules:
- Three different archetypes; good starting points for this business: ${suggested.join(", ")}. Palettes must be clearly different from each other and readable (strong text contrast).
- Respect the brand: if brand colors are given, at least one look keeps them prominent, and every look should feel compatible with the logo.
- If "sites_to_emulate" are given, let at least one look borrow their vibe (palette, type, mood) without copying them.
- Headlines must not invent facts: no years, awards, prices, guarantees, statistics, or claims not in the facts.
- Respect the owner's requested changes and style notes when present.${variation ? `\n- This is attempt ${variation + 1}: go somewhere new compared with an obvious first attempt.` : ""}`,
        },
        { role: "user", content: JSON.stringify(factsForPrompt(facts)) },
      ],
    });
    const looks = Array.isArray(raw.looks) ? raw.looks.slice(0, 3) : [];
    if (!looks.length) throw new Error("No looks in the answer.");
    const directions = looks.map((look, i) => normalizeDirection(look, i, facts));
    // Guarantee three different archetypes.
    const used = new Set<string>();
    for (let i = 0; i < directions.length; i += 1) {
      if (used.has(directions[i]!.archetype)) {
        const replacement = [...suggested, ...ARCHETYPES].find((a) => !used.has(a))!;
        directions[i] = { ...directions[i]!, ...PRESETS[replacement], palette: { ...PRESETS[replacement].palette }, archetype: replacement };
      }
      used.add(directions[i]!.archetype);
    }
    const fallback = mockDirections(facts, variation);
    while (directions.length < 3) {
      const next = fallback.find((d) => !used.has(d.archetype)) ?? fallback[directions.length]!;
      used.add(next.archetype);
      directions.push({ ...next, id: `look-${directions.length + 1}` });
    }
    return { directions, mock: false };
  } catch (error) {
    console.error("[preview] directions failed", error instanceof Error ? error.message : error);
    return { directions: mockDirections(facts, variation), mock: true, note: "The AI art director did not answer, so looks were picked from presets." };
  }
}

// ---------------------------------------------------------------- page sections

type ImageInfo = { name: string; describe: string };

function imageList(images: Record<string, StoredImage>, pending: ImageInfo[] = []): ImageInfo[] {
  const stored = Object.values(images).map((i) => ({
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

const HERO_FOR: Record<DesignDirection["hero"], string> = { split: "hero-split", photo: "hero-photo", type: "hero-type" };

async function aiSections(
  page: PlanPage,
  facts: SiteFacts,
  plan: SitePlan,
  design: DesignDirection,
  images: ImageInfo[],
  timeoutMs: number,
): Promise<unknown> {
  const slugs = plan.pages.map((p) => `"${p.slug}" (${p.navLabel})`).join(", ");
  const home = page.slug === "home";
  return chatJson({
    temperature: 0.75,
    maxTokens: 4500,
    timeoutMs,
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
- Prefer real photos of the business when available; vary images, do not repeat the same image twice on a page.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          page,
          site_plan: { tagline: plan.tagline, cta: plan.cta, pages: plan.pages.map((p) => ({ slug: p.slug, title: p.title, purpose: p.purpose })) },
          facts: { ...factsForPrompt(facts), images: undefined, logo: undefined },
        }),
      },
    ],
  });
}

/** AI sections for a page, validated; falls back to the deterministic composer. */
async function sectionsFor(
  page: PlanPage,
  facts: SiteFacts,
  plan: SitePlan,
  design: DesignDirection,
  images: Record<string, StoredImage>,
  pending: ImageInfo[],
  useAi: boolean,
  timeoutMs: number,
): Promise<{ sections: Section[]; ai: boolean }> {
  const list = imageList(images, pending);
  const names = list.map((i) => i.name);
  const ctx = normalizeContext(facts, plan, page.slug, names);
  if (useAi) {
    try {
      const raw = await aiSections(page, facts, plan, design, list, timeoutMs);
      const sections = normalizeSections(raw, ctx);
      const heroOk = page.slug === "home" ? sections[0] && sections[0].type.startsWith("hero-") : sections[0]?.type === "page-hero";
      if (sections.length >= (page.slug === "home" ? 3 : 2) && heroOk) {
        if (page.slug === "contact" && !sections.some((s) => s.type === "contact-block")) sections.push({ type: "contact-block", tone: "light", heading: "Get in touch" });
        return { sections, ai: true };
      }
      console.error(`[preview] page ${page.slug}: AI sections unusable (${sections.length})`);
    } catch (error) {
      console.error(`[preview] page ${page.slug} failed`, error instanceof Error ? error.message : error);
    }
  }
  return { sections: composeMockPage(page, facts, plan, design, composeImages(names)), ai: false };
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

// ---------------------------------------------------------------- build a look (homepage) and finish the chosen one

export function stepBudgetMs(): number {
  const raw = Number(process.env.PREVIEW_STEP_BUDGET_MS);
  return Number.isFinite(raw) && raw >= 20_000 ? raw : 85_000;
}

/** Homepage-only site for one direction. Images and homepage copy are produced in parallel. */
export async function buildLook(
  id: string,
  facts: SiteFacts,
  plan: SitePlan,
  design: DesignDirection,
  index: number,
): Promise<{ site: StoredSite; ai: boolean; generated: number; photos: number }> {
  const { goodPhotos, heroWorthy, storePhotos, imagesEnabled, imagePrompt, generateAndStore } = await import("@/lib/preview/images.server");
  const budget = stepBudgetMs();
  const useAi = !isMockMode() && aiAvailable();
  const photos = await goodPhotos(facts);
  const images: Record<string, StoredImage> = await storePhotos(id, photos, facts);
  const pending: ImageInfo[] = [];
  const jobs: Promise<void>[] = [];
  if (imagesEnabled()) {
    const wantHero = !heroWorthy(photos[0]);
    const wantFeature = photos.length < 2;
    const kind = facts.industry || "the business";
    if (wantHero) {
      pending.push({ name: "hero", describe: `generated hero photo: ${design.heroSubject || kind}` });
      jobs.push(
        generateAndStore(id, "hero", imagePrompt("hero", facts, design), design.hero === "split" ? "4:3" : "16:9", design.heroSubject || kind, Math.min(50_000, budget - 10_000)).then((img) => {
          if (img) images.hero = img;
        }),
      );
    }
    if (wantFeature) {
      pending.push({ name: "feature", describe: `generated photo of ${kind} work in progress` });
      jobs.push(
        generateAndStore(id, "feature", imagePrompt("feature", facts, design), "4:3", `${kind} at work`, Math.min(50_000, budget - 10_000)).then((img) => {
          if (img) images.feature = img;
        }),
      );
    }
  }
  const home = plan.pages[0]!;
  const [result] = await Promise.all([sectionsFor(home, facts, plan, design, images, pending, useAi, Math.min(75_000, budget - 8_000)), ...jobs]);
  const available = Object.keys(images);
  const sections = resolveImages(result.sections, available);
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
  };
  const generated = Object.values(images).filter((i) => i.source === "generated").length;
  return { site, ai: result.ai, generated, photos: photos.length };
}

/** Build every remaining page for the chosen look, add service images, and critique/revise the homepage. */
export async function finishSite(site: StoredSite): Promise<{ site: StoredSite; failed: number; note?: string }> {
  if (!site.facts || !site.plan || !site.design) throw new Error("This preview was made by an older version. Run the site again.");
  const { imagesEnabled, imagePrompt, generateAndStore } = await import("@/lib/preview/images.server");
  const { polishHome } = await import("@/lib/preview/critique.server");
  const facts = site.facts;
  const plan = site.plan;
  const design = site.design;
  const budget = stepBudgetMs();
  const useAi = !isMockMode() && aiAvailable();
  const images: Record<string, StoredImage> = { ...(site.images ?? {}) };
  const pending: ImageInfo[] = [];
  const jobs: Promise<void>[] = [];
  const photoCount = Object.values(images).filter((i) => i.source === "photo").length;
  if (imagesEnabled() && photoCount < 4) {
    facts.services.slice(0, 3).forEach((service, i) => {
      const name = `service-${i + 1}`;
      if (images[name]) return;
      pending.push({ name, describe: `generated photo for the service "${service}"` });
      jobs.push(
        generateAndStore(site.id, name, imagePrompt("service", facts, design, service), "4:3", service, Math.min(50_000, budget - 10_000)).then((img) => {
          if (img) images[name] = img;
        }),
      );
    });
  }
  let failed = 0;
  const todo = site.pages.filter((p) => p.slug !== "home");
  const pagesJob = Promise.all(
    todo.map(async (page) => {
      const planned = plan.pages.find((p) => p.slug === page.slug) ?? { slug: page.slug, title: page.title, navLabel: page.navLabel, purpose: "", sections: [] };
      const result = await sectionsFor(planned, facts, plan, design, images, pending, useAi, Math.min(75_000, budget - 8_000));
      if (useAi && !result.ai) failed += 1;
      return { slug: page.slug, sections: result.sections };
    }),
  );
  const homeCtx = normalizeContext(facts, plan, "home", Object.keys(images));
  const polishJob = polishHome(site, homeCtx, budget - 5_000);
  const [built, polished] = await Promise.all([pagesJob, polishJob, ...jobs]);
  const available = Object.keys(images);
  const pages = site.pages.map((page) => {
    if (page.slug === "home") return { ...page, sections: resolveImages(polished.sections, available), pending: false };
    const done = built.find((b) => b.slug === page.slug);
    return { ...page, sections: resolveImages(done?.sections ?? [], available), pending: false };
  });
  const next: StoredSite = { ...site, images, pages, finished: true, polish: polished.polish };
  const note = failed ? `${failed} of ${todo.length} pages were assembled from the section library because the AI did not answer.` : undefined;
  return { site: next, failed, note };
}

export { hashString };
