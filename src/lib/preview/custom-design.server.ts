/**
 * The from-scratch look ("Custom Design"): Grok writes a creative brief, then the whole homepage as freeform
 * HTML + CSS; we sanitize and validate it, give Grok one repair pass, and fall back to the template look when it
 * is still broken. Logs start with [design]. Pure parts (prompts, sanitizer, validator): custom-design.ts.
 */
import { aiAvailable, aiModel, chatJson, generateImage, imageModelInfo, imageProvider, isMockMode, type ContentPart } from "@/lib/ai-provider.server";
import {
  CUSTOM_NAME,
  autoFixContrast,
  isStructuralProblem,
  mockupBuildPrompt,
  mockupPrompt,
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
  type CustomMockup,
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
/**
 * The photos the custom page gets: the ones the template homepage already placed (they went through the hero quality
 * gate / the builder's picks), never every scraped site photo (signs, the airport, utility shots). When the template's
 * hero is one of the business's own photos (photo-N), it is copied to "hero" so the mockup and the build put that real
 * photo in the hero, described by what the vision rating saw. Returns true when the site changed (save it).
 */
export async function prepareCustomPhotos(site: StoredSite): Promise<boolean> {
  const images = site.images ?? {};
  const scene = site.trace?.images?.find((t) => t.name === "hero" && t.scene)?.scene?.replace(/…$/, "").trim();
  const generic = (alt?: string) => !alt || alt === site.name || alt.trim().length < 12;
  if (images.hero) {
    if (scene && generic(images.hero.alt)) {
      images.hero = { ...images.hero, alt: scene };
      return true;
    }
    return false;
  }
  const first = site.pages[0]?.sections?.[0];
  const from = first?.type.startsWith("hero") && first.image ? images[first.image] : undefined;
  if (!from || from.name === "logo") return false;
  const { readImage, saveImage } = await import("@/lib/pages.server");
  const img = await readImage(site.id, from.name).catch(() => undefined);
  if (!img) return false;
  await saveImage(site.id, "hero", img.type, img.bytes);
  site.images = { ...images, hero: { ...from, name: "hero", alt: scene && generic(from.alt) ? scene : from.alt, heroOf: from.name } };
  return true;
}

/**
 * Names of the photos the template homepage features (a section's own photo: hero, feature split). Gallery items are
 * left out: the template's gallery shows every site photo, including ones that failed the hero gate.
 */
function placedImages(site: StoredSite): Set<string> {
  const out = new Set<string>();
  for (const sec of site.pages[0]?.sections ?? []) if (sec.image) out.add(sec.image);
  return out;
}

export function customContext(site: StoredSite): CustomContext {
  const facts = site.facts;
  const hb = facts ? heroBrief(facts) : undefined;
  const placed = placedImages(site);
  const heroOf = site.images?.hero?.heroOf;
  const images = Object.values(site.images ?? {})
    .filter((i) => i.name === "hero" || i.name === "feature" || /^photo-\d+$/.test(i.name) || /^art-\d$/.test(i.name))
    // Only photos the template homepage placed (gated); not the hero's own copy twice; a page with no placed photos
    // keeps every stored photo (older previews).
    // The business's own photos: those that passed the round's quality gate (else, with no gate verdict, the ones the
    // template homepage features), never the hero's own copy twice.
    .filter((i) => !/^photo-\d+$/.test(i.name) || (i.name !== heroOf && i.gate !== "failed" && (i.gate === "passed" || placed.has(i.name))))
    .sort((a, b) => (a.name === "hero" ? -1 : b.name === "hero" ? 1 : 0))
    .map((i) => ({
      name: i.name,
      alt: (i.shows && (!i.alt || i.alt === site.name) ? i.shows : i.alt) || i.name,
      width: i.width,
      height: i.height,
      kind: i.kept
        ? ("owner's art (keep)" as const)
        : /^art-\d$/.test(i.name)
        ? ("imagine art" as const)
        : i.source === "generated"
        ? ("ai photo" as const)
        : i.source === "photo"
        ? ("the business's own photo" as const)
        : ("photo" as const),
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

function check(ctx: CustomContext, palette: SitePalette, draft: Draft, extraImages: string[] = []) {
  const images = [...ctx.images.map((i) => i.name), ...extraImages];
  const sctx = { pages: ctx.pages.map((p) => p.slug), cta: ctx.cta.slug, images, social: ctx.social, phone: ctx.phone, email: ctx.email };
  const stripped: string[] = [];
  const cleanHtml = sanitizeCustomHtml(draft.html, sctx);
  // Contrast is fixed deterministically (same hue, darker/lighter) BEFORE we judge the page: never a repair or a
  // fallback over a 3.5:1 button.
  const fixed = autoFixContrast(`${sanitizeCss(draft.css, sctx, stripped)}\n${cleanHtml.css}`, palette);
  const css = fixed.css;
  const problems = validateCustom(cleanHtml.html, css, { ...sctx, name: ctx.name, keep: Boolean(ctx.keep), heroImage: images.includes("hero"), palette });
  return { html: cleanHtml.html, css, stripped: [...stripped, ...cleanHtml.stripped], problems, autofixed: fixed.fixes };
}

const structural = (problems: string[]) => problems.filter(isStructuralProblem);

/** Grok Imagine as the designer: on unless PREVIEW_IMAGINE_DESIGN=0 and when an image model is configured. */
export function imagineDesignEnabled(): boolean {
  if ((process.env.PREVIEW_IMAGINE_DESIGN ?? "1").trim() === "0") return false;
  return imageProvider() !== "none";
}

/** Time box for the custom page's own request (build + optional repair + art): default 150 s (set the host's function maxDuration above it). */
export function customStepBudgetMs(): number {
  const raw = Number(process.env.PREVIEW_CUSTOM_BUDGET_MS);
  return Number.isFinite(raw) && raw >= 30_000 ? raw : 150_000;
}

const MOCKUP_MS = () => Math.max(10_000, Number(process.env.PREVIEW_IMAGINE_TIMEOUT_MS) || 60_000);
const BUILD_MS = () => Math.max(20_000, Number(process.env.PREVIEW_CUSTOM_BUILD_TIMEOUT_MS) || 90_000);

/**
 * Step 2a (its own request): Grok Imagine draws the homepage design mockup from the brief and the real content,
 * around the look's chosen photos. Stored as the look's "mockup" image. Undefined (with the reason) on failure:
 * the build falls back to the text brief.
 */
export async function imagineMockup(site: StoredSite, deadline: number): Promise<{ mockup?: CustomMockup; bytes?: Buffer; reason?: string }> {
  const brief = site.design?.custom?.brief;
  if (!brief) return { reason: "no creative brief" };
  if (!imagineDesignEnabled()) return { reason: "Imagine is off (PREVIEW_IMAGINE_DESIGN=0 or no image model)" };
  const ctx = customContext(site);
  const prompt = mockupPrompt(ctx, brief);
  const info = imageModelInfo();
  const started = Date.now();
  const timeoutMs = Math.min(MOCKUP_MS(), deadline - Date.now() - 3000);
  if (timeoutMs < 8000) return { reason: "no time left for Imagine" };
  // Like the original Imagine flow: from the site's real logo (edits) when there is one, so the mark is kept.
  const logo = ctx.hasLogo && site.logo && /^https:\/\//.test(site.logo) && (process.env.PREVIEW_IMAGINE_LOGO ?? "1") !== "0" ? site.logo : undefined;
  const resolution = /^(1k|1\.5k|2k)$/i.test(process.env.PREVIEW_IMAGINE_RESOLUTION ?? "") ? process.env.PREVIEW_IMAGINE_RESOLUTION!.toLowerCase() : "1k";
  const image = await generateImage({
    prompt: logo ? `${prompt} The source image is the site's real logo: keep that logo exactly as it is in the top-left of the header; do not redraw or recolor it.` : prompt,
    aspect: "16:9",
    timeoutMs,
    guard: false,
    sourceImageUrl: logo,
    resolution,
  });
  const ms = Date.now() - started;
  if (!image || !/^image\/(png|jpeg|webp)$/.test(image.type)) {
    console.info(`[imagine] mockup for “${brief.concept}” failed after ${secs(ms)} (${info.model || "no image model"}): falling back to the text-brief design`);
    return { reason: `Grok Imagine did not return a mockup (${secs(ms)})` };
  }
  const { saveImage } = await import("@/lib/pages.server");
  const { imageSize } = await import("./images.server");
  await saveImage(site.id, "mockup", image.type, image.bytes);
  const size = imageSize(image.bytes);
  const mockup: CustomMockup = { name: "mockup", type: image.type, ...(size ?? {}), model: info.model, via: logo ? "edits (from the logo)" : "generations", ms, prompt: prompt.slice(0, 1200) };
  const own = ctx.images.filter((i) => i.kind === "the business's own photo").length;
  console.info(`[imagine] mockup for “${brief.concept}” by ${info.model} (${mockup.via}, 16:9, ${resolution}, quality low) in ${secs(ms)} · 1 image · ${Math.round(image.bytes.length / 1024)} KB${size ? ` · ${size.width}x${size.height}` : ""} · designed around ${own} of the site's own photos${ctx.keep ? ` · keep: ${ctx.keep}` : ""}${ctx.request ? ` · request: “${ctx.request.slice(0, 60)}”` : ""} · prompt ${prompt.length} chars`);
  return { mockup, bytes: image.bytes };
}

type Asset = { name: string; prompt: string; aspect: "1:1" | "4:3" | "16:9" | "3:4" };

function readAssets(raw: unknown): Asset[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { assets?: unknown }).assets) ? ((raw as { assets: unknown[] }).assets) : [];
  return list
    .map((a, i) => {
      const r = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
      const aspect = ["1:1", "4:3", "16:9", "3:4"].includes(String(r.aspect)) ? (String(r.aspect) as Asset["aspect"]) : "1:1";
      return { name: `art-${i + 1}`, prompt: typeof r.prompt === "string" ? r.prompt.replace(/\s+/g, " ").trim().slice(0, 600) : "", aspect, want: typeof r.name === "string" ? r.name : "" };
    })
    .filter((a) => a.prompt)
    .slice(0, 2)
    .map(({ want, ...a }) => ({ ...a, name: /^art-[12]$/.test(want) ? want : a.name }));
}

/**
 * Step 2b (its own request, after the look's template build): the homepage from scratch, validated, one repair
 * pass. With an Imagine mockup, Grok (vision) builds it to match the mockup; otherwise from the text brief.
 * Contrast is auto-fixed; only structural breakage falls back (the look keeps its template homepage).
 */
export async function designCustom(site: StoredSite, deadline: number, mockup?: { mockup: CustomMockup; bytes: Buffer }): Promise<{ design?: CustomDesign; reason?: string }> {
  const brief = site.design?.custom?.brief;
  if (!brief) return { reason: "no creative brief" };
  const ctx = customContext(site);
  const palette = site.palette;
  const fonts = { heading: cleanFontName(brief.typography.heading, site.fonts.heading), body: cleanFontName(brief.typography.body, site.fonts.body) };
  const started = Date.now();
  const fromMockup = Boolean(mockup);
  const mockupPart: ContentPart | undefined = mockup ? { type: "image_url", image_url: { url: `data:${mockup.mockup.type};base64,${mockup.bytes.toString("base64")}`, detail: "high" } } : undefined;
  let rawAssets: unknown;
  const ask = async (prompt: { system: string; user: string }, label: string): Promise<Draft | undefined> => {
    const left = deadline - Date.now();
    if (left < 12_000) {
      console.info(`[design] ${label}: skipped, only ${secs(left)} left in this step`);
      return undefined;
    }
    const t = Date.now();
    try {
      const raw = await chatJson<Record<string, unknown>>({
        model: fromMockup ? process.env.PREVIEW_VISION_MODEL || aiModel() : aiModel(),
        temperature: fromMockup ? 0.4 : 0.8,
        maxTokens: 16_000,
        timeoutMs: Math.min(fromMockup ? BUILD_MS() : 75_000, left - 4000),
        deadline,
        retry: false,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: mockupPart ? [{ type: "text", text: prompt.user }, mockupPart] : prompt.user },
        ],
      });
      const draft = readDraft(raw);
      if (raw && typeof raw === "object" && "assets" in raw) rawAssets = raw;
      console.info(`[design] ${label}: ${draft.html.length} chars html + ${draft.css.length} chars css in ${secs(Date.now() - t)}${fromMockup ? ` · built from the Imagine mockup by ${process.env.PREVIEW_VISION_MODEL || aiModel()} (vision)` : ""}`);
      return draft;
    } catch (error) {
      console.info(`[design] ${label} failed after ${secs(Date.now() - t)}: ${error instanceof Error ? error.message.slice(0, 160) : "error"}`);
      return undefined;
    }
  };
  const first = await ask(fromMockup ? mockupBuildPrompt(ctx, brief) : designPrompt(ctx, brief), `“${brief.concept}” ${fromMockup ? "build from mockup" : "draft"}`);
  if (!first) return { reason: "Grok did not return a page in time" };
  // Extra Imagine art for decorative areas (≤2, in parallel, bounded): stored like the look's other AI images.
  const assets = await makeAssets(site, readAssets(rawAssets), deadline);
  let result = check(ctx, palette, first, assets);
  const report = (r: typeof result) =>
    `${r.problems.length ? `${structural(r.problems).length} structural problem(s)${r.problems.length - structural(r.problems).length ? ` + ${r.problems.length - structural(r.problems).length} contrast` : ""}: ${r.problems.join(" | ").slice(0, 600)}` : "pass"}${r.autofixed.length ? ` · contrast auto-fixed (${r.autofixed.length}): ${r.autofixed.slice(0, 4).join("; ")}` : ""}${r.stripped.length ? ` · sanitized: ${r.stripped.join(", ").slice(0, 300)}` : ""}`;
  console.info(`[design] checks “${brief.concept}”: ${report(result)}`);
  let repaired: string[] | undefined;
  if (structural(result.problems).length) {
    repaired = result.problems;
    const fixed = await ask(repairPrompt(ctx, brief, first, structural(result.problems), fromMockup), "repair pass");
    if (!fixed) return { reason: `the draft failed checks (${structural(result.problems)[0]}) and the repair pass did not return in time` };
    const again = check(ctx, palette, fixed, assets);
    console.info(`[design] checks after repair: ${report(again)}`);
    if (structural(again.problems).length) return { reason: `still failing after the repair pass: ${structural(again.problems).slice(0, 2).join(" ")}` };
    result = { ...again, stripped: [...result.stripped, ...again.stripped], autofixed: [...result.autofixed, ...again.autofixed] };
  }
  const used = assets.filter((a) => new RegExp(`@img:${a}\\b`).test(result.html + result.css));
  const design: CustomDesign = {
    brief,
    css: result.css,
    html: result.html,
    fonts,
    status: repaired ? "repaired" : "ok",
    stripped: result.stripped,
    repaired,
    ms: Date.now() - started,
    source: fromMockup ? "imagine" : "brief",
    mockup: mockup?.mockup,
    assets: used.length ? used : undefined,
    autofixed: result.autofixed.length ? result.autofixed : undefined,
  };
  const imgs = [...new Set([...design.html.matchAll(/@img:([a-z0-9-]+)/g)].map((m) => m[1]!))];
  const own = imgs.filter((n) => ctx.images.find((i) => i.name === n)?.kind === "the business's own photo");
  console.info(`[design] “${brief.concept}” ready (${design.status}${fromMockup ? ", from the Imagine mockup" : ", from the text brief"}) in ${secs(design.ms!)} · ${design.html.length} chars html · images ${imgs.join(", ") || "none"} (${own.length} of the site's own)${used.length ? ` · Imagine art ${used.join(", ")}` : ""}${ctx.keep ? " · kept picture shown" : ""}`);
  return { design };
}

async function makeAssets(site: StoredSite, wanted: Asset[], deadline: number): Promise<string[]> {
  if (!wanted.length || !imagineDesignEnabled()) return [];
  const left = deadline - Date.now() - 25_000;
  if (left < 10_000) {
    console.info(`[imagine] ${wanted.length} art asset(s) asked for, skipped: only ${secs(deadline - Date.now())} left`);
    return [];
  }
  const t = Date.now();
  const { saveImage } = await import("@/lib/pages.server");
  const { imageSize } = await import("./images.server");
  const made = await Promise.all(
    wanted.map(async (a) => {
      const image = await generateImage({ prompt: `${a.prompt} Illustration / artwork for a website section. No text, no letters, no logos, no watermark.`, aspect: a.aspect, timeoutMs: Math.min(45_000, left), guard: false });
      if (!image || !/^image\/(png|jpeg|webp)$/.test(image.type)) return undefined;
      await saveImage(site.id, a.name, image.type, image.bytes);
      const size = imageSize(image.bytes);
      site.images = { ...(site.images ?? {}), [a.name]: { name: a.name, type: image.type, source: "generated", alt: a.prompt.slice(0, 120), ...(size ?? {}) } };
      return a.name;
    }),
  );
  const ok = made.filter((x): x is string => Boolean(x));
  console.info(`[imagine] art for the custom page: ${ok.length}/${wanted.length} made in ${secs(Date.now() - t)} (${imageModelInfo().model}) · ${wanted.map((a) => `${a.name} ${a.aspect} “${a.prompt.slice(0, 50)}”`).join(" · ")}`);
  return ok;
}

/**
 * Targeted refine of the custom look ("make the custom one darker"): Grok edits its own HTML/CSS in place. The
 * palette variables are retuned deterministically first, so the change happens even if the AI edit fails.
 */
export async function editCustom(site: StoredSite, palette: SitePalette, request: string, adjustments: string[], useAi: boolean): Promise<{ design: CustomDesign; palette: SitePalette; how: string }> {
  const current = site.custom!;
  // The retuned colors can break a literal color pair in Grok's CSS: auto-fixed for the new palette too.
  const retuned = autoFixContrast(current.css, palette);
  const base: CustomDesign = {
    ...current,
    css: retuned.css,
    brief: { ...current.brief, palette },
    edits: [...(current.edits ?? []), request.slice(0, 120)],
    // The Imagine mockup shows the design before this edit (the built page is what changed).
    mockup: current.mockup ? { ...current.mockup, stale: true } : undefined,
  };
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
    if (structural(result.problems).length) {
      console.info(`[design] edit “${request.slice(0, 80)}”: Grok's edit failed checks (${structural(result.problems)[0]}); kept the page and retuned the colors`);
      return { design: base, palette, how: "colors retuned (the AI edit failed checks)" };
    }
    console.info(`[design] edit “${request.slice(0, 80)}” by Grok in ${secs(Date.now() - t)}: ${draft.html ? "html+css" : "palette only"}${nextPalette.background !== site.palette.background ? ` · background ${site.palette.background} -> ${nextPalette.background}` : ""}${result.autofixed.length ? ` · contrast auto-fixed (${result.autofixed.length})` : ""} · edited in place${current.mockup ? " (the Imagine mockup is kept as the original design)" : ""}`);
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
