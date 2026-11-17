/**
 * The from-scratch look ("Custom Design"): Grok writes a creative brief, then the whole homepage as freeform
 * HTML + CSS; we sanitize and validate it, give Grok one repair pass, and fall back to the template look when it
 * is still broken. Logs start with [design]. Pure parts (prompts, sanitizer, validator): custom-design.ts.
 */
import { aiAvailable, aiModel, chatJson, isMockMode } from "@/lib/ai-provider.server";
import {
  CUSTOM_NAME,
  briefPrompt,
  cleanBrief,
  cleanFontName,
  designPrompt,
  editPrompt,
  fallbackBrief,
  repairPrompt,
  sanitizeCss,
  sanitizeCustomHtml,
  validateCustom,
  type CustomBrief,
  type CustomContext,
  type CustomDesign,
} from "./custom-design.ts";
import { BODY_FONTS, HEADING_FONTS, readablePalette, safeFont } from "./design.ts";
import { heroBrief } from "./hero-brief.ts";
import { realServices } from "./image-prompts.ts";
import { latestRequest } from "./owner-request.ts";
import type { StoredSite } from "./render.ts";
import type { DesignDirection, SiteFacts, SitePalette } from "./types.ts";

export { CUSTOM_NAME };

/** On unless PREVIEW_CUSTOM_LOOK=0; needs a real model (mock mode / no key: three template looks as before). */
export function customLookEnabled(): boolean {
  if ((process.env.PREVIEW_CUSTOM_LOOK ?? "1").trim() === "0") return false;
  return !isMockMode() && aiAvailable();
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Step 1: the creative brief (runs in the directions step, alongside the template directions). */
export async function creativeBrief(facts: SiteFacts, palette: SitePalette, deadline: number): Promise<CustomBrief> {
  const hb = heroBrief(facts);
  const fallback = fallbackBrief(hb.category, facts.name, palette);
  const started = Date.now();
  try {
    const raw = await chatJson<Record<string, unknown>>({
      model: aiModel(),
      temperature: 0.9,
      maxTokens: 1500,
      timeoutMs: Math.max(5000, Math.min(30_000, deadline - Date.now())),
      deadline,
      retry: false,
      messages: [
        { role: "system", content: "You are the creative director of a top web design agency. Answer only JSON." },
        { role: "user", content: briefPrompt({ name: facts.name, tagline: facts.tagline, description: facts.description, services: realServices(facts), category: hb.category, kind: hb.kind, request: latestRequest(facts) }) },
      ],
    });
    const brief = cleanBrief(raw, fallback);
    console.info(`[design] brief (${hb.category}: ${hb.kind}) by ${brief.by === "ai" ? "Grok" : "fallback"} in ${secs(Date.now() - started)}: “${brief.concept}” · ${brief.metaphor} · fonts ${brief.typography.heading} / ${brief.typography.body} · ${brief.palette.primary} on ${brief.palette.background}`);
    return brief;
  } catch (error) {
    console.info(`[design] brief failed (${error instanceof Error ? error.message.slice(0, 120) : "error"}); using the built-in “${fallback.concept}” brief for ${hb.category}`);
    return fallback;
  }
}

/** What the generator may use, read from the stored look (server-side facts, never the browser's copy). */
export function customContext(site: StoredSite): CustomContext {
  const facts = site.facts;
  const hb = facts ? heroBrief(facts) : undefined;
  const images = Object.values(site.images ?? {})
    .filter((i) => i.name === "hero" || i.name === "feature" || /^photo-\d+$/.test(i.name))
    .map((i) => ({
      name: i.name,
      alt: i.alt || i.name,
      width: i.width,
      height: i.height,
      kind: i.kept ? ("owner's art (keep)" as const) : i.source === "generated" ? ("ai photo" as const) : ("photo" as const),
      cutout: i.cutout,
    }));
  const hero = site.images?.hero;
  return {
    name: site.name,
    tagline: site.tagline,
    description: facts?.description ?? "",
    services: facts ? realServices(facts) : [],
    phone: site.phone,
    email: site.email,
    address: site.address,
    hours: site.hours,
    social: site.social,
    pages: site.pages.map((p) => ({ slug: p.slug, label: p.navLabel || p.title })),
    cta: { label: site.cta.label || "Contact us", slug: site.pages.some((p) => p.slug === site.cta.slug) ? site.cta.slug : site.pages.at(-1)!.slug },
    images,
    keep: hero?.kept ? hero.alt || "the owner's picture" : undefined,
    request: facts ? latestRequest(facts) || undefined : undefined,
    category: hb?.category ?? "general",
    kind: hb?.kind ?? site.industry ?? "",
    hasLogo: Boolean(site.logo) && !site.logoMeta?.wordmark,
  };
}

type Draft = { css: string; html: string };

function readDraft(raw: unknown): Draft {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { css: typeof r.css === "string" ? r.css : "", html: typeof r.html === "string" ? r.html : "" };
}

function check(ctx: CustomContext, palette: SitePalette, draft: Draft) {
  const images = ctx.images.map((i) => i.name);
  const sctx = { pages: ctx.pages.map((p) => p.slug), cta: ctx.cta.slug, images, social: ctx.social, phone: ctx.phone, email: ctx.email };
  const stripped: string[] = [];
  const cleanHtml = sanitizeCustomHtml(draft.html, sctx);
  const css = `${sanitizeCss(draft.css, sctx, stripped)}\n${cleanHtml.css}`;
  const problems = validateCustom(cleanHtml.html, css, { ...sctx, name: ctx.name, keep: Boolean(ctx.keep), heroImage: images.includes("hero"), palette });
  return { html: cleanHtml.html, css, stripped: [...stripped, ...cleanHtml.stripped], problems };
}

/**
 * Step 2 (its own request, after the look's template build): the homepage from scratch, validated, one repair
 * pass. Undefined (with the reason) when it can't be used: the look keeps its template homepage.
 */
export async function designCustom(site: StoredSite, deadline: number): Promise<{ design?: CustomDesign; reason?: string }> {
  const brief = site.design?.custom?.brief;
  if (!brief) return { reason: "no creative brief" };
  const ctx = customContext(site);
  const palette = site.palette;
  const fonts = { heading: cleanFontName(brief.typography.heading, site.fonts.heading), body: cleanFontName(brief.typography.body, site.fonts.body) };
  const started = Date.now();
  const ask = async (prompt: { system: string; user: string }, label: string): Promise<Draft | undefined> => {
    const left = deadline - Date.now();
    if (left < 12_000) {
      console.info(`[design] ${label}: skipped, only ${secs(left)} left in this step`);
      return undefined;
    }
    const t = Date.now();
    try {
      const raw = await chatJson<Record<string, unknown>>({
        model: aiModel(),
        temperature: 0.8,
        maxTokens: 16_000,
        timeoutMs: Math.min(75_000, left - 4000),
        deadline,
        retry: false,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      });
      const draft = readDraft(raw);
      console.info(`[design] ${label}: ${draft.html.length} chars html + ${draft.css.length} chars css in ${secs(Date.now() - t)}`);
      return draft;
    } catch (error) {
      console.info(`[design] ${label} failed after ${secs(Date.now() - t)}: ${error instanceof Error ? error.message.slice(0, 160) : "error"}`);
      return undefined;
    }
  };
  const first = await ask(designPrompt(ctx, brief), `“${brief.concept}” draft`);
  if (!first) return { reason: "Grok did not return a page in time" };
  let result = check(ctx, palette, first);
  console.info(`[design] checks “${brief.concept}”: ${result.problems.length ? `${result.problems.length} problem(s): ${result.problems.join(" | ").slice(0, 600)}` : "pass"}${result.stripped.length ? ` · sanitized: ${result.stripped.join(", ").slice(0, 300)}` : ""}`);
  let repaired: string[] | undefined;
  if (result.problems.length) {
    repaired = result.problems;
    const fixed = await ask(repairPrompt(ctx, brief, first, result.problems), "repair pass");
    if (!fixed) return { reason: `the draft failed checks (${result.problems[0]}) and the repair pass did not return in time` };
    const again = check(ctx, palette, fixed);
    console.info(`[design] checks after repair: ${again.problems.length ? `${again.problems.length} problem(s): ${again.problems.join(" | ").slice(0, 600)}` : "pass"}${again.stripped.length ? ` · sanitized: ${again.stripped.join(", ").slice(0, 300)}` : ""}`);
    if (again.problems.length) return { reason: `still failing after the repair pass: ${again.problems.slice(0, 2).join(" ")}` };
    result = { ...again, stripped: [...result.stripped, ...again.stripped] };
  }
  const design: CustomDesign = { brief, css: result.css, html: result.html, fonts, status: repaired ? "repaired" : "ok", stripped: result.stripped, repaired, ms: Date.now() - started };
  console.info(`[design] “${brief.concept}” ready (${design.status}) in ${secs(design.ms!)} · ${design.html.length} chars html · images ${[...new Set([...design.html.matchAll(/@img:([a-z0-9-]+)/g)].map((m) => m[1]))].join(", ") || "none"}${ctx.keep ? " · kept picture shown" : ""}`);
  return { design };
}

/**
 * Targeted refine of the custom look ("make the custom one darker"): Grok edits its own HTML/CSS in place. The
 * palette variables are retuned deterministically first, so the change happens even if the AI edit fails.
 */
export async function editCustom(site: StoredSite, palette: SitePalette, request: string, adjustments: string[], useAi: boolean): Promise<{ design: CustomDesign; palette: SitePalette; how: string }> {
  const current = site.custom!;
  const base: CustomDesign = { ...current, brief: { ...current.brief, palette }, edits: [...(current.edits ?? []), request.slice(0, 120)] };
  if (!useAi) return { design: base, palette, how: "colors retuned (no AI)" };
  const ctx = customContext(site);
  const deadline = Date.now() + 80_000;
  const t = Date.now();
  try {
    const raw = await chatJson<Record<string, unknown>>({
      model: aiModel(),
      temperature: 0.4,
      maxTokens: 16_000,
      timeoutMs: 75_000,
      deadline,
      retry: false,
      messages: (() => {
        const p = editPrompt(ctx, base, request, adjustments);
        return [
          { role: "system" as const, content: p.system },
          { role: "user" as const, content: p.user },
        ];
      })(),
    });
    const draft = readDraft(raw);
    const nextPalette = raw.palette && typeof raw.palette === "object" ? readablePalette(raw.palette as Partial<SitePalette>, palette) : palette;
    const result = check(ctx, nextPalette, draft.html ? draft : { css: current.css, html: current.html });
    if (result.problems.length) {
      console.info(`[design] edit “${request.slice(0, 80)}”: Grok's edit failed checks (${result.problems[0]}); kept the page and retuned the colors`);
      return { design: base, palette, how: "colors retuned (the AI edit failed checks)" };
    }
    console.info(`[design] edit “${request.slice(0, 80)}” by Grok in ${secs(Date.now() - t)}: ${draft.html ? "html+css" : "palette only"}${nextPalette.background !== site.palette.background ? ` · background ${site.palette.background} -> ${nextPalette.background}` : ""}`);
    return { design: { ...base, css: result.css, html: result.html, brief: { ...base.brief, palette: nextPalette }, stripped: [...base.stripped, ...result.stripped] }, palette: nextPalette, how: "edited by Grok" };
  } catch (error) {
    console.info(`[design] edit failed (${error instanceof Error ? error.message.slice(0, 120) : "error"}); colors retuned only`);
    return { design: base, palette, how: "colors retuned (the AI edit failed)" };
  }
}

/** Turn one template direction into the from-scratch look: one name, the brief's palette and (curated) fonts. */
export function asCustomDirection(d: DesignDirection, brief: CustomBrief): DesignDirection {
  const palette = brief.by === "ai" ? brief.palette : d.palette;
  const fonts = { heading: safeFont(brief.typography.heading, HEADING_FONTS, d.fonts.heading), body: safeFont(brief.typography.body, BODY_FONTS, d.fonts.body) };
  console.info(`[design] look 3 is the from-scratch “${CUSTOM_NAME}”: concept “${brief.concept}” (${brief.by === "ai" ? "Grok brief" : "fallback brief"}); its sub-pages and fallback use the ${d.archetype} template with the brief's colors`);
  return { ...d, name: CUSTOM_NAME, palette, fonts, mood: brief.mood || d.mood, headline: brief.headline || d.headline, custom: { brief: { ...brief, palette } } };
}
