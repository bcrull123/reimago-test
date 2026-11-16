/**
 * Steps 2 and 3 of the live preview: plan the site, then write every page.
 *
 * AI calls go through src/lib/ai-provider.server.ts. When the AI is not
 * available (no key, PREVIEW_MOCK=1, or an error), a deterministic builder
 * assembles the same structure from the scraped facts so the preview always
 * renders — and it never invents contact details.
 */
import { aiAvailable, chatJson, chatText, isMockMode } from "@/lib/ai-provider.server";
import { escapeHtml, sanitizeHtml, type SanitizeContext } from "@/lib/preview/sanitize";
import { BODY_FONTS, HEADING_FONTS, defaultPalette, hashString, safeFont, safePalette } from "@/lib/preview/theme";
import type { StoredPage, StoredSite } from "@/lib/preview/render";
import type { PlanPage, PlanSection, SiteFacts, SitePlan } from "@/lib/preview/types";

const MAX_PAGES = 6;

const CLASS_GUIDE = `Available CSS classes (a shared stylesheet already exists; do NOT write <style> or style="" attributes):
- <section class="section"> (also "section alt" for tinted background, "section dark" for brand-color background), "hero" for the home hero, "page-hero" for the top of inner pages
- <div class="container"> inside every section
- layout: "hero-grid" (2 columns: copy + media), "split" / "split reverse" (text + media), "grid-2", "grid-3", "grid-4", "center"
- text: "eyebrow" (small label above a heading), "lead" (intro paragraph), "muted"
- buttons: <a class="btn primary">, <a class="btn accent">, <a class="btn ghost">, wrap buttons in <div class="actions">
- "card" (boxes in grids; optional <span class="icon">1</span>), "quote" (<blockquote class="quote"><p>…</p><cite>…</cite></blockquote>)
- "list-check" (<ul> with check marks), "stats" + "stat" (<div class="stat"><strong>…</strong>label</div>) — only with real numbers from the facts
- "cta-band" (a call-to-action box inside a container), "info-list" (<dl> for hours/contact details), "faq" (<div class="faq"><details><summary>Q</summary><p>A</p></details></div>)
- images: <div class="media"><img src="EXACT URL FROM THE IMAGES LIST" alt="…"></div>; when there is no suitable image use <div class="media"><div class="ph"></div></div> (also "ph ph-2", "ph ph-3")`;

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
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
    if (!slug || /about|service|menu|contact|home|index/.test(slug) || pages.some((p) => p.slug === slug)) continue;
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
    pages.push({ slug, title, navLabel: clip(p.navLabel, 22) || title.slice(0, 22), purpose: clip(p.purpose, 200), sections });
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
 "palette": {"primary": "#hex", "accent": "#hex", "background": "#hex", "surface": "#hex", "text": "#hex", "muted": "#hex"},
 "fonts": {"heading": one of ${JSON.stringify(HEADING_FONTS)}, "body": one of ${JSON.stringify(BODY_FONTS)}},
 "cta": {"label": string (max 24 chars), "slug": page slug},
 "pages": [{"slug": "home"|lowercase-hyphenated, "title": string, "navLabel": string (max 18 chars), "purpose": string, "sections": [{"kind": "hero|services|about|testimonials|gallery|faq|hours|cta|text|team|pricing|contact-info", "heading": string, "brief": string}]}]}
Rules:
- 3 to ${MAX_PAGES} pages. The first page is "home". Always include "contact". Mirror the real pages the business already has (about, services, menu, etc.).
- Use ONLY facts provided. Never invent phone numbers, emails, street addresses, prices, awards, years in business, staff names, statistics, or reviews.
- Keep the business name exactly as given. Base the palette on the brand colors when provided; ensure strong text contrast.
- Respect the requested changes when present.${variation ? `\n- Variation ${variation}: choose a clearly different visual direction (palette, fonts, section order) from a typical first attempt.` : ""}`,
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

// ---------------------------------------------------------------- deterministic page bodies

function paragraphsHtml(text: string, max = 4): string {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, max)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
}

function media(facts: SiteFacts, index: number, alt: string): string {
  const src = facts.images[index];
  return src
    ? `<div class="media"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"></div>`
    : `<div class="media"><div class="ph ph-${(index % 3) + 1}"></div></div>`;
}

function callButtons(facts: SiteFacts, plan: SitePlan): string {
  const call = facts.phone ? `<a class="btn accent" href="tel:${facts.phone.replace(/\D/g, "")}">Call ${escapeHtml(facts.phone)}</a>` : "";
  return `<div class="actions"><a class="btn primary" href="@page:${plan.cta.slug}">${escapeHtml(plan.cta.label)}</a>${call}</div>`;
}

function pageHero(title: string, lead: string, eyebrow: string): string {
  return `<section class="page-hero"><div class="container"><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1>${
    lead ? `<p class="lead">${escapeHtml(lead)}</p>` : ""
  }</div></section>`;
}

function serviceCards(facts: SiteFacts, max: number): string {
  return facts.services
    .slice(0, max)
    .map((s, i) => `<div class="card"><span class="icon">${i + 1}</span><h3>${escapeHtml(s)}</h3></div>`)
    .join("");
}

function ctaBand(facts: SiteFacts, plan: SitePlan): string {
  return `<section class="section"><div class="container"><div class="cta-band"><div><h2>Ready when you are</h2><p>${
    facts.phone ? `Call ${escapeHtml(facts.phone)} or send a message.` : "Send a message and we will get back to you."
  }</p></div><a class="btn accent" href="@page:${plan.cta.slug}">${escapeHtml(plan.cta.label)}</a></div></div></section>`;
}

export function mockPageBody(page: PlanPage, facts: SiteFacts, plan: SitePlan): string {
  const servicesSlug = plan.pages.find((p) => /service|menu|product/.test(p.slug))?.slug;
  const aboutSlug = plan.pages.find((p) => p.slug === "about")?.slug;
  if (page.slug === "home") {
    const services = facts.services.length
      ? `<section class="section alt"><div class="container"><span class="eyebrow">What we do</span><h2>${
          servicesSlug ? escapeHtml(plan.pages.find((p) => p.slug === servicesSlug)!.title) : "Services"
        }</h2><div class="grid-3">${serviceCards(facts, 6)}</div>${
          servicesSlug ? `<div class="actions"><a class="btn ghost" href="@page:${servicesSlug}">See everything we offer</a></div>` : ""
        }</div></section>`
      : "";
    const about = facts.about
      ? `<section class="section"><div class="container split"><div><span class="eyebrow">About us</span><h2>${escapeHtml(
          `About ${facts.name}`,
        )}</h2>${paragraphsHtml(facts.about, 2)}${
          aboutSlug ? `<div class="actions"><a class="btn ghost" href="@page:${aboutSlug}">Our story</a></div>` : ""
        }</div>${media(facts, 1, facts.name)}</div></section>`
      : "";
    const quotes = facts.testimonials.length
      ? `<section class="section alt"><div class="container"><span class="eyebrow">Reviews</span><h2>What customers say</h2><div class="grid-2">${facts.testimonials
          .slice(0, 4)
          .map((t) => `<blockquote class="quote"><p>${escapeHtml(t.quote)}</p>${t.author ? `<cite>${escapeHtml(t.author)}</cite>` : ""}</blockquote>`)
          .join("")}</div></div></section>`
      : "";
    const eyebrow = facts.industry;
    return `<section class="hero"><div class="container hero-grid"><div>${eyebrow ? `<span class="eyebrow">${escapeHtml(eyebrow)}</span>` : ""}<h1>${escapeHtml(plan.tagline || facts.name)}</h1><p class="lead">${escapeHtml(
      facts.description || facts.about.slice(0, 220),
    )}</p>${callButtons(facts, plan)}</div>${media(facts, 0, facts.name)}</div></section>${services}${about}${quotes}${ctaBand(facts, plan)}`;
  }
  if (page.slug === "contact") {
    const rows = [
      facts.phone ? `<dt>Phone</dt><dd><a href="tel:${facts.phone.replace(/\D/g, "")}">${escapeHtml(facts.phone)}</a></dd>` : "",
      facts.email ? `<dt>Email</dt><dd><a href="mailto:${escapeHtml(facts.email)}">${escapeHtml(facts.email)}</a></dd>` : "",
      facts.address ? `<dt>Address</dt><dd>${escapeHtml(facts.address)}</dd>` : "",
      facts.hours.length ? `<dt>Hours</dt>${facts.hours.map((h) => `<dd>${escapeHtml(h)}</dd>`).join("")}` : "",
    ].join("");
    return `${pageHero("Contact us", `We would love to hear from you. Reach ${facts.name} using the details below or the form.`, "Contact")}${
      rows ? `<section class="section"><div class="container split"><dl class="info-list">${rows}</dl>${media(facts, 2, facts.name)}</div></section>` : ""
    }`;
  }
  if (page.slug === "about") {
    return `${pageHero(page.title, facts.tagline, "About")}<section class="section"><div class="container split"><div>${
      paragraphsHtml(facts.about, 5) || `<p>${escapeHtml(facts.description)}</p>`
    }</div>${media(facts, 1, facts.name)}</div></section>${ctaBand(facts, plan)}`;
  }
  if (/service|menu|product/.test(page.slug)) {
    return `${pageHero(page.title, facts.description, page.navLabel)}<section class="section"><div class="container"><div class="grid-3">${serviceCards(
      facts,
      12,
    )}</div></div></section>${ctaBand(facts, plan)}`;
  }
  const source = facts.pages.find((p) => {
    try {
      return slugify(new URL(p.url).pathname.split("/").filter(Boolean).pop() ?? "") === page.slug;
    } catch {
      return false;
    }
  });
  return `${pageHero(page.title, "", page.navLabel)}<section class="section"><div class="container split"><div>${
    source ? paragraphsHtml(source.text, 6) : `<p>${escapeHtml(page.purpose)}</p>`
  }</div>${media(facts, 3, page.title)}</div></section>${ctaBand(facts, plan)}`;
}

// ---------------------------------------------------------------- AI page bodies

async function aiPageBody(page: PlanPage, facts: SiteFacts, plan: SitePlan, variation: number): Promise<string> {
  const slugs = plan.pages.map((p) => `"/${p.slug === "home" ? "" : p.slug}" (${p.navLabel})`).join(", ");
  const text = await chatText({
    temperature: variation ? 0.8 : 0.5,
    maxTokens: 4000,
    timeoutMs: 75_000,
    messages: [
      {
        role: "system",
        content: `You write the <main> content of ONE page of a real small-business website. Return ONLY HTML: a sequence of <section> elements. No markdown, no <html>, <head>, <body>, <header>, <nav>, <footer>, <form>, <script>, <style>, or style attributes — the site header, navigation, footer, and contact form are added automatically.
${CLASS_GUIDE}
Content rules:
- Use ONLY the facts provided. Rewrite and organize their real text so it is clear, warm, and persuasive.
- NEVER invent phone numbers, email addresses, street addresses, prices, statistics, awards, years in business, staff names, or testimonials. If a fact is missing, leave it out.
- Phone links must be href="tel:" with the exact phone provided; email links must be href="mailto:" with the exact email provided.
- Testimonials: only quote the provided testimonials, word for word.
- Images: only use exact URLs from the "images" list (logo excluded). Otherwise use the "ph" placeholder.
- Link to other pages of this site with these paths only: ${slugs}. Buttons should lead somewhere useful (usually the "${plan.cta.slug}" page).
- 3 to 6 sections. The first section of the home page is a "hero" section with an <h1>; inner pages start with a "page-hero" section with an <h1>.${
          page.slug === "contact" ? "\n- This is the contact page: show the real contact details and hours in an info-list; a contact form is appended automatically after your sections, so do not write one." : ""
        }`,
      },
      {
        role: "user",
        content: JSON.stringify({
          page,
          site_plan: { tagline: plan.tagline, cta: plan.cta, pages: plan.pages.map((p) => ({ slug: p.slug, title: p.title, purpose: p.purpose })) },
          facts: factsForPrompt(facts),
        }),
      },
    ],
  });
  if (!/<section\b/i.test(text)) throw new Error("The AI page had no sections.");
  return text;
}

// ---------------------------------------------------------------- assemble

export async function buildSite(
  id: string,
  facts: SiteFacts,
  plan: SitePlan,
  variation = 0,
): Promise<{ site: StoredSite; mock: boolean; note?: string }> {
  const useAi = !plan.mock && !isMockMode() && aiAvailable();
  const ctx: SanitizeContext = {
    slugs: plan.pages.map((p) => p.slug),
    phone: facts.phone,
    email: facts.email,
    images: facts.images,
    sourceHost: facts.host,
  };
  let failed = 0;
  const pages: StoredPage[] = await Promise.all(
    plan.pages.map(async (page) => {
      let raw = "";
      if (useAi) {
        try {
          raw = await aiPageBody(page, facts, plan, variation);
        } catch (error) {
          failed += 1;
          console.error(`[preview] page ${page.slug} failed`, error instanceof Error ? error.message : error);
        }
      }
      if (!raw) raw = mockPageBody(page, facts, plan);
      let body = sanitizeHtml(raw, ctx);
      if (!body.trim()) body = sanitizeHtml(mockPageBody(page, facts, plan), ctx);
      return { slug: page.slug, title: page.title, navLabel: page.navLabel, body };
    }),
  );
  const mock = !useAi || failed === plan.pages.length;
  const site: StoredSite = {
    version: 2,
    id,
    createdAt: new Date().toISOString(),
    mode: facts.mode,
    mock: mock && isMockMode(),
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
    palette: plan.palette,
    fonts: plan.fonts,
    cta: plan.cta,
    pages,
  };
  const note = !useAi
    ? undefined
    : failed
      ? `${failed} of ${plan.pages.length} pages were assembled from the page text because the AI did not answer.`
      : undefined;
  return { site, mock, note };
}
