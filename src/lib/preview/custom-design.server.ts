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
  fidelityScore,
  mockupColors,
  mockupColorsText,
  type MockupColors,
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
  const sig = await prepareSignature(site);
  const images = site.images ?? {};
  const scene = site.trace?.images?.find((t) => t.name === "hero" && t.scene)?.scene?.replace(/…$/, "").trim();
  const generic = (alt?: string) => !alt || alt === site.name || alt.trim().length < 12;
  if (images.hero) {
    if (scene && generic(images.hero.alt)) {
      images.hero = { ...images.hero, alt: scene };
      return true;
    }
    return sig;
  }
  const first = site.pages[0]?.sections?.[0];
  const from = first?.type.startsWith("hero") && first.image ? images[first.image] : undefined;
  if (!from || from.name === "logo") return sig;
  const { readImage, saveImage } = await import("@/lib/pages.server");
  const img = await readImage(site.id, from.name).catch(() => undefined);
  if (!img) return sig;
  await saveImage(site.id, "hero", img.type, img.bytes);
  site.images = { ...images, hero: { ...from, name: "hero", alt: scene && generic(from.alt) ? scene : from.alt, heroOf: from.name } };
  return true;
}

/**
 * The site's signature brand graphic (bob.me's "Blast off" rocket; any site's mascot / illustration: a transparent
 * PNG/WebP or SVG of 200px+, placed in the page, not the logo or an icon), stored as "brand-art". Even with no note
 * and no passing photo it is a site asset: Imagine designs around it and the built page uses the real file.
 */
async function prepareSignature(site: StoredSite): Promise<boolean> {
  if (!site.facts || site.images?.["brand-art"] || site.images?.hero?.kept) return false;
  const { signatureArt } = await import("./keep-art.server");
  const art = await signatureArt(site.facts).catch(() => undefined);
  if (!art) return false;
  const { saveImage } = await import("@/lib/pages.server");
  await saveImage(site.id, "brand-art", art.type, art.bytes);
  const label = art.art.label.replace(/\b(transparent|bg|png|svg|img|image)\b/gi, " ").replace(/\s+/g, " ").trim();
  const words = [...new Set(label.split(" "))].join(" ").slice(0, 60) || `${site.name} brand graphic`;
  site.images = { ...(site.images ?? {}), "brand-art": { name: "brand-art", type: art.type, source: "photo", alt: words, width: art.width, height: art.height, cutout: true, signature: true } };
  console.info(`[design] signature graphic on the site: “${words}” (${art.type}${art.width ? `, ${art.width}x${art.height}` : ""}) · ${art.how}`);
  return true;
}

/** Words that make a failed site photo unusable even as a collage tile or texture. */
// Round 9: blog / article cover graphics ("5 Keys to Choosing…", "How to…") are text cards, not photos.
const NEVER_SECONDARY = /\b(?:signs?|signage|lettering|logos?|documents?|maps?|screenshots?|charts?|menu\s+boards?|flyers?|posters?|forms?|watermark|infographics?|blog|cover image|keys to|steps to|ways to|how to|tips for|guide to)\b/i;

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
  const secondary = (i: { gate?: string; shows?: string; alt: string }) =>
    i.gate === "failed" && Boolean(i.shows) && !NEVER_SECONDARY.test(i.shows!) && !(hb?.offTopic.test(i.shows!) ?? false);
  const images = Object.values(site.images ?? {})
    .filter((i) => i.name === "hero" || i.name === "feature" || i.name === "brand-art" || /^photo-\d+$/.test(i.name) || /^art-\d$/.test(i.name))
    // Only photos the template homepage placed (gated); not the hero's own copy twice; a page with no placed photos
    // keeps every stored photo (older previews).
    // The business's own photos: those that passed the round's quality gate (else, with no gate verdict, the ones the
    // template homepage features), never the hero's own copy twice.
    // Photos that failed only the hero bar (not signs, documents or off-topic shots) come along as secondary
    // material (collage tiles, textures): Bob, "let Imagine be creative with what they have on their site first".
    .filter((i) => !/^photo-\d+$/.test(i.name) || (i.name !== heroOf && (i.gate === "passed" || (i.gate !== "failed" && placed.has(i.name)) || secondary(i))))
    .sort((a, b) => (a.name === "hero" ? -1 : b.name === "hero" ? 1 : 0))
    .map((i) => ({
      name: i.name,
      alt: (i.shows && (!i.alt || i.alt === site.name) ? i.shows : i.alt) || i.name,
      width: i.width,
      height: i.height,
      kind: i.kept
        ? ("owner's art (keep)" as const)
        : i.signature
        ? ("the business's signature graphic" as const)
        : /^art-\d$/.test(i.name) || i.imagine
        ? ("imagine art" as const)
        : /^photo-\d+$/.test(i.name) && secondary(i)
        ? ("the business's own photo (secondary)" as const)
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
  // The site's own assets go to Imagine as reference images (logo, signature graphic, photos; ≤5 per the API).
  const refs = await siteReferences(site, ctx);
  const prompt = mockupPrompt(ctx, brief, refs.labels);
  const info = imageModelInfo();
  const started = Date.now();
  const timeoutMs = Math.min(MOCKUP_MS(), deadline - Date.now() - 3000);
  if (timeoutMs < 8000) return { reason: "no time left for Imagine" };
  if (refs.names.length) console.info(`[imagine] site assets sent to Imagine (${refs.names.length} reference image${refs.names.length === 1 ? "" : "s"}, /images/edits): ${refs.names.map((n, i) => `${n} “${refs.labels[i]!.slice(0, 50)}”`).join(" · ")}`);
  else console.info(`[imagine] no site assets usable as Imagine references (no logo / signature graphic / own photo in PNG, JPEG or WebP): plain generation`);
  const resolution = /^(1k|1\.5k|2k)$/i.test(process.env.PREVIEW_IMAGINE_RESOLUTION ?? "") ? process.env.PREVIEW_IMAGINE_RESOLUTION!.toLowerCase() : "1k";
  const image = await generateImage({
    prompt: refs.names.includes("logo") ? `${prompt} Keep the real logo (<IMAGE_${refs.names.indexOf("logo")}>) exactly as it is in the top-left of the header; do not redraw or recolor it.` : prompt,
    aspect: "16:9",
    timeoutMs,
    guard: false,
    sourceImages: refs.urls,
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
  const mockup: CustomMockup = { name: "mockup", type: image.type, ...(size ?? {}), model: info.model, via: refs.names.length ? `edits (${refs.names.length} site asset${refs.names.length === 1 ? "" : "s"})` : "generations", ms, prompt: prompt.slice(0, 1200) };
  const own = ctx.images.filter((i) => i.kind === "the business's own photo").length;
  console.info(`[imagine] mockup for “${brief.concept}” by ${info.model} (${mockup.via}, 16:9, ${resolution}, quality low) in ${secs(ms)} · 1 image · ${Math.round(image.bytes.length / 1024)} KB${size ? ` · ${size.width}x${size.height}` : ""} · designed around ${own} of the site's own photos${ctx.keep ? ` · keep: ${ctx.keep}` : ""}${ctx.request ? ` · request: “${ctx.request.slice(0, 60)}”` : ""} · prompt ${prompt.length} chars`);
  return { mockup, bytes: image.bytes };
}

/**
 * The site's own assets for Imagine (data URIs, PNG/JPEG/WebP, at most 5): the logo, the signature graphic, the
 * hero photo, then other own photos (passing first, then secondary). PREVIEW_IMAGINE_REFS=0 sends none;
 * PREVIEW_IMAGINE_LOGO=0 leaves the logo out.
 */
async function siteReferences(site: StoredSite, ctx: CustomContext): Promise<{ urls: string[]; names: string[]; labels: string[] }> {
  const out = { urls: [] as string[], names: [] as string[], labels: [] as string[] };
  if ((process.env.PREVIEW_IMAGINE_REFS ?? "1") === "0") return out;
  const { readImage } = await import("@/lib/pages.server");
  const want: { name: string; label: string }[] = [];
  if (site.images?.logo && ctx.hasLogo && (process.env.PREVIEW_IMAGINE_LOGO ?? "1") !== "0") want.push({ name: "logo", label: `the business's logo` });
  for (const i of ctx.images) {
    if (i.kind === "the business's signature graphic") want.push({ name: i.name, label: `the business's signature graphic: ${i.alt} (a transparent cutout; make it the visual centerpiece)` });
  }
  for (const i of ctx.images) {
    if (i.kind === "owner's art (keep)") want.push({ name: i.name, label: `the owner's own picture to keep: ${i.alt} (show it whole)` });
    else if (i.kind === "the business's own photo") want.push({ name: i.name, label: `the business's real photo: ${i.alt}` });
  }
  for (const i of ctx.images) if (i.kind === "the business's own photo (secondary)") want.push({ name: i.name, label: `a secondary photo of the business (use creatively: collage, texture, duotone): ${i.alt}` });
  for (const w of want) {
    if (out.urls.length >= 5) break;
    const img = await readImage(site.id, w.name).catch(() => undefined);
    if (!img || !/^image\/(png|jpeg|webp)$/.test(img.type) || img.bytes.length > 3_500_000) continue;
    out.urls.push(`data:${img.type};base64,${img.bytes.toString("base64")}`);
    out.names.push(w.name);
    out.labels.push(w.label);
  }
  return out;
}

/** RGBA pixels of a PNG/JPEG (the mockup), for the color sampling. WebP: undefined (no decoder here). */
async function decodeRGBA(bytes: Buffer, type: string): Promise<{ data: Uint8Array; width: number; height: number } | undefined> {
  try {
    if (type === "image/png") {
      const { PNG } = await import("pngjs");
      const img = PNG.sync.read(bytes);
      return { data: img.data, width: img.width, height: img.height };
    }
    if (type === "image/jpeg") {
      const jpeg = (await import("jpeg-js")).default;
      const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 256 });
      return { data: img.data, width: img.width, height: img.height };
    }
  } catch {
    // undecodable: no color sampling
  }
  return undefined;
}

export const FIDELITY_MIN = () => Number(process.env.PREVIEW_FIDELITY_MIN) || 60;

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

type PlannedArt = { name: string; prompt: string; aspect: "1:1" | "4:3" | "16:9" | "3:4"; alt: string };

/**
 * Imagine art that fills the gaps the site's own assets leave (Bob: Imagine, not Google, for the Custom Design):
 * no own hero photo and no signature graphic -> a hero artwork + 3 supporting pieces; a signature graphic -> 2
 * pieces in its style (its world around it); own photos -> 1 decorative piece. At most 4. Each is drawn from the
 * mockup (and the signature graphic) as reference images, so it matches the design.
 */
function planArt(site: StoredSite, ctx: CustomContext, brief: CustomBrief): PlannedArt[] {
  const hero = site.images?.hero;
  const ownHero = Boolean(hero && (hero.kept || hero.source === "photo") && !hero.imagine);
  const sig = ctx.images.find((i) => i.kind === "the business's signature graphic");
  const ownPhotos = ctx.images.filter((i) => i.kind === "the business's own photo" || i.kind === "the business's own photo (secondary)").length;
  const request = ctx.request ? ` The owner asked: “${ctx.request.slice(0, 120)}”.` : "";
  const style = `Same style, colors (${brief.palette.primary}, ${brief.palette.accent}, ${brief.palette.background}) and mood (${brief.mood}) as the attached homepage design mockup.`;
  const out: PlannedArt[] = [];
  if (!ownHero && !sig) {
    out.push({ name: "hero", aspect: "16:9", alt: `${brief.concept}: ${brief.metaphor}`.slice(0, 120), prompt: `The hero artwork of the homepage design (the main picture area of the attached mockup), for ${ctx.name} (${ctx.kind}): ${brief.metaphor}. ${brief.illustration ?? ""}${request} ${style}` });
  }
  const themes = sig
    ? [`the world around the signature graphic (${sig.alt}): motion, trails, scenery and small elements from its story, without the graphic itself`, `a pattern / texture built from the signature graphic's shapes and colors`]
    : ownPhotos
      ? [`a decorative illustration of the concept “${brief.concept}”`]
      : [`a scene for the services (${ctx.services.slice(0, 3).join(", ") || ctx.kind})`, `an abstract texture / pattern in the palette for a section background`, `a detail illustration of “${brief.concept}”: ${brief.metaphor}`];
  themes.forEach((t, i) => out.push({ name: `art-${i + 1}`, aspect: i === 1 ? "4:3" : "1:1", alt: t.slice(0, 120), prompt: `Supporting artwork for a section of the homepage design: ${t}.${request} ${style}` }));
  return out.slice(0, 4);
}

/** Make the planned art with Imagine (parallel, bounded), from the mockup + signature graphic as references. */
async function makeArt(site: StoredSite, planned: PlannedArt[], refs: string[], deadline: number): Promise<string[]> {
  if (!planned.length || !imagineDesignEnabled()) return [];
  const left = Math.min(45_000, deadline - Date.now() - 20_000);
  if (left < 10_000) {
    console.info(`[imagine] ${planned.length} art piece(s) planned, skipped: only ${secs(deadline - Date.now())} left`);
    return [];
  }
  const t = Date.now();
  const { saveImage } = await import("@/lib/pages.server");
  const { imageSize } = await import("./images.server");
  const made = await Promise.all(
    planned.map(async (a) => {
      const image = await generateImage({ prompt: `${a.prompt} Illustration / artwork for a website section. No text, no letters, no logos, no watermark, no user interface.`, aspect: a.aspect, timeoutMs: left, guard: false, sourceImages: refs });
      if (!image || !/^image\/(png|jpeg|webp)$/.test(image.type)) return undefined;
      await saveImage(site.id, a.name, image.type, image.bytes);
      const size = imageSize(image.bytes);
      site.images = { ...(site.images ?? {}), [a.name]: { name: a.name, type: image.type, source: "generated", alt: a.alt, imagine: true, ...(size ?? {}) } };
      return a.name;
    }),
  );
  const ok = made.filter((x): x is string => Boolean(x));
  console.info(`[imagine] art for the custom page: ${ok.length}/${planned.length} made in ${secs(Date.now() - t)} (${imageModelInfo().model}, ${refs.length ? `edits from the mockup${refs.length > 1 ? " + the signature graphic" : ""}` : "generations"}) · ${planned.map((a) => `${a.name} ${a.aspect} “${a.alt.slice(0, 50)}”`).join(" · ")}`);
  return ok;
}

/** Google Images as the Custom Design's LAST resort (Imagine failed and the site has no usable picture). */
async function googleHero(site: StoredSite, deadline: number): Promise<boolean> {
  if (!site.facts) return false;
  const { findGooglePhotos, photoSearchEnabled } = await import("./google-photo.server.ts");
  if (!photoSearchEnabled()) return false;
  const g = await findGooglePhotos(undefined, site.facts, aiAvailable() && !isMockMode(), Math.min(deadline - 30_000, Date.now() + 20_000), 1).catch(() => undefined);
  const pick = g?.photos[0];
  if (!pick) {
    console.info("[photo] Custom Design: Grok Imagine art unavailable and the Google Images last resort found no usable photo: the page uses a typographic hero");
    return false;
  }
  const { saveImage } = await import("@/lib/pages.server");
  const { googleCredit } = await import("./builder.server.ts");
  await saveImage(site.id, "hero", pick.photo.type, pick.photo.bytes);
  site.images = { ...(site.images ?? {}), hero: { name: "hero", type: pick.photo.type, source: "web", alt: pick.temp.title, width: pick.photo.width, height: pick.photo.height, credit: googleCredit(pick.temp), temporary: pick.temp } };
  console.info(`[photo] Custom Design: Grok Imagine art unavailable, so the hero is a Google Images photo (last resort): “${pick.temp.title.slice(0, 60)}” (${pick.temp.domain})`);
  return true;
}

/** Remove references to art that was planned but not made (so no broken image shows). */
function dropMissing(d: Draft, missing: string[]): Draft {
  let { html, css } = d;
  for (const n of missing) {
    html = html.replace(new RegExp(`<img\\b[^>]*@img:${n}\\b[^>]*>`, "gi"), "");
    css = css.replace(new RegExp(`url\\(\\s*['"]?@img:${n}['"]?\\s*\\)`, "gi"), "none");
  }
  return { html, css };
}

/** The card's picture line for the custom page. */
function photoLineFor(site: StoredSite, html: string): string | undefined {
  const uses = (n: string) => new RegExp(`@img:${n}\\b`).test(html);
  const imgs = site.images ?? {};
  const art = Object.values(imgs).filter((i) => i.imagine && uses(i.name)).length;
  const own = Object.values(imgs).filter((i) => i.source === "photo" && !i.signature && i.name !== "logo" && uses(i.name)).length;
  if (imgs.hero?.kept && uses("hero")) return undefined; // "kept your rocket" from the template step stays
  const parts: string[] = [];
  if (imgs["brand-art"] && uses("brand-art")) parts.push(`Art: your site's own ${imgs["brand-art"].alt.slice(0, 40)}${art ? `, with ${art} piece${art === 1 ? "" : "s"} of art created by Grok Imagine for this design` : ""}`);
  else if (art && !(imgs.hero && !imgs.hero.imagine && uses("hero"))) parts.push("Art: created by Grok Imagine for this design");
  if (imgs.hero?.temporary && uses("hero")) parts.push("Photo: from Google Images (Grok Imagine was unavailable; preview only)");
  else if (own) parts.push(`Photo${own === 1 ? "" : "s"}: your site's own (${own})`);
  // the site's own photo leads, Imagine filled the gaps: say both
  if (art && !parts.some((p) => p.startsWith("Art:"))) parts.push(`Art: ${art} piece${art === 1 ? "" : "s"} created by Grok Imagine for this design`);
  return parts.join(" · ") || undefined;
}

/**
 * Step 2b (its own request, after the look's template build): the homepage from scratch, validated, one repair
 * pass. With an Imagine mockup, Grok (vision) builds it to match the mockup (region by region, with the mockup's
 * sampled colors), and the gaps the site's assets leave are filled with Imagine art made from the mockup.
 * Contrast is auto-fixed; low fidelity or structural breakage gets the one repair; only structural breakage falls
 * back (the look keeps its template homepage). Google Images only when Imagine failed and nothing else is there.
 */
export async function designCustom(site: StoredSite, deadline: number, mockup?: { mockup: CustomMockup; bytes: Buffer }): Promise<{ design?: CustomDesign; reason?: string }> {
  const brief = site.design?.custom?.brief;
  if (!brief) return { reason: "no creative brief" };
  const palette = site.palette;
  const fonts = { heading: cleanFontName(brief.typography.heading, site.fonts.heading), body: cleanFontName(brief.typography.body, site.fonts.body) };
  const started = Date.now();
  const fromMockup = Boolean(mockup);
  let ctx = customContext(site);
  const hasPicture = Boolean(site.images?.hero) || ctx.images.some((i) => i.kind === "the business's signature graphic" || i.kind === "the business's own photo" || i.kind === "the business's own photo (secondary)");
  // Imagine failed (no mockup) and the site has no usable picture: Google Images, the last resort.
  if (!fromMockup && !hasPicture && (await googleHero(site, deadline))) ctx = customContext(site);
  // Gap art (Imagine), started now and made while Grok builds; the build is told the names up front.
  const planned = fromMockup ? planArt(site, ctx, brief) : [];
  const sigRef = await (async () => {
    if (!planned.length || !site.images?.["brand-art"]) return undefined;
    const { readImage } = await import("@/lib/pages.server");
    const img = await readImage(site.id, "brand-art").catch(() => undefined);
    return img && /^image\/(png|webp)$/.test(img.type) ? `data:${img.type};base64,${img.bytes.toString("base64")}` : undefined;
  })();
  const mockupUri = mockup ? `data:${mockup.mockup.type};base64,${mockup.bytes.toString("base64")}` : undefined;
  const artJob = makeArt(site, planned, [mockupUri, sigRef].filter((x): x is string => Boolean(x)), deadline);
  if (planned.length) ctx = { ...ctx, images: [...ctx.images.filter((i) => !planned.some((p) => p.name === i.name)), ...planned.map((p) => ({ name: p.name, alt: p.alt, kind: "imagine art" as const }))] };
  const artReady = planned.length > 0;
  // The mockup's real colors (server-side pixel sampling) go into the prompt and the fidelity check.
  let colors: MockupColors | undefined;
  if (mockup) {
    const px = await decodeRGBA(mockup.bytes, mockup.mockup.type);
    if (px) colors = mockupColors(px.data, px.width, px.height);
  }
  const colorsText = colors ? mockupColorsText(colors) : undefined;
  const mockupPart: ContentPart | undefined = mockupUri ? { type: "image_url", image_url: { url: mockupUri, detail: "high" } } : undefined;
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
      const regions = raw && typeof raw === "object" && Array.isArray((raw as { regions?: unknown }).regions) ? (raw as { regions: unknown[] }).regions.length : 0;
      console.info(`[design] ${label}: ${draft.html.length} chars html + ${draft.css.length} chars css in ${secs(Date.now() - t)}${fromMockup ? ` · built from the Imagine mockup by ${process.env.PREVIEW_VISION_MODEL || aiModel()} (vision)${regions ? ` · ${regions} mockup regions described first` : ""}` : ""}`);
      return draft;
    } catch (error) {
      console.info(`[design] ${label} failed after ${secs(Date.now() - t)}: ${error instanceof Error ? error.message.slice(0, 160) : "error"}`);
      return undefined;
    }
  };
  let first = await ask(fromMockup ? mockupBuildPrompt(ctx, brief, colorsText, artReady) : designPrompt(ctx, brief), `“${brief.concept}” ${fromMockup ? "build from mockup" : "draft"}`);
  const madeArt = await artJob;
  if (!first) return { reason: "Grok did not return a page in time" };
  // Planned art that failed: its tags are dropped; a failed hero artwork -> Google Images, the last resort.
  const missing = planned.map((p) => p.name).filter((n) => !madeArt.includes(n));
  if (missing.includes("hero") && (await googleHero(site, deadline))) missing.splice(missing.indexOf("hero"), 1);
  if (missing.length) {
    first = dropMissing(first, missing);
    ctx = { ...ctx, images: ctx.images.filter((i) => !missing.includes(i.name)) };
  }
  // Extra art the build asked for (only when none was planned; ≤2): as before.
  const extra = artReady ? [] : await makeAssets(site, readAssets(rawAssets), deadline);
  const assets = [...madeArt, ...extra, ...(site.images?.hero && !ctx.images.some((i) => i.name === "hero") ? ["hero"] : [])];
  let result = check(ctx, palette, first, assets);
  const report = (r: typeof result) =>
    `${r.problems.length ? `${structural(r.problems).length} structural problem(s)${r.problems.length - structural(r.problems).length ? ` + ${r.problems.length - structural(r.problems).length} contrast` : ""}: ${r.problems.join(" | ").slice(0, 600)}` : "pass"}${r.autofixed.length ? ` · contrast auto-fixed (${r.autofixed.length}): ${r.autofixed.slice(0, 4).join("; ")}` : ""}${r.stripped.length ? ` · sanitized: ${r.stripped.join(", ").slice(0, 300)}` : ""}`;
  console.info(`[design] checks “${brief.concept}”: ${report(result)}`);
  const fid = (r: typeof result) => (colors ? fidelityScore(colors, r.html, r.css, palette) : undefined);
  let fidelity = fid(result);
  if (fidelity) console.info(`[design] fidelity ${fidelity.score}/100 vs the Imagine mockup (${fidelity.regions.join(" · ")} · ${fidelity.palette})${fidelity.score < FIDELITY_MIN() ? ` · below ${FIDELITY_MIN()}: one repair pass with the differences` : ""}`);
  else if (fromMockup) console.info(`[design] fidelity: not measured (mockup is ${mockup?.mockup.type}; PNG/JPEG only)`);
  let repaired: string[] | undefined;
  const lowFidelity = Boolean(fidelity && fidelity.score < FIDELITY_MIN());
  if (structural(result.problems).length || lowFidelity) {
    const asks = [...structural(result.problems), ...(lowFidelity ? fidelity!.diff.map((d) => `Mockup fidelity: ${d}`) : [])];
    repaired = asks;
    const fixed = await ask(repairPrompt(ctx, brief, first, asks, fromMockup, colorsText, artReady), "repair pass");
    if (!fixed) {
      if (structural(result.problems).length) return { reason: `the draft failed checks (${structural(result.problems)[0]}) and the repair pass did not return in time` };
      repaired = undefined; // fidelity-only repair timed out: keep the (valid) first build
    } else {
      const again = check(ctx, palette, missing.length ? dropMissing(fixed, missing) : fixed, assets);
      const fidAgain = fid(again);
      console.info(`[design] checks after repair: ${report(again)}${fidAgain ? ` · fidelity ${fidAgain.score}/100` : ""}`);
      if (structural(again.problems).length) {
        if (structural(result.problems).length) return { reason: `still failing after the repair pass: ${structural(again.problems).slice(0, 2).join(" ")}` };
        repaired = undefined; // the fidelity repair broke the page: keep the first build
      } else if (!structural(result.problems).length && fidAgain && fidelity && fidAgain.score < fidelity.score) {
        repaired = undefined; // the fidelity repair made it worse: keep the first build
      } else {
        result = { ...again, stripped: [...result.stripped, ...again.stripped], autofixed: [...result.autofixed, ...again.autofixed] };
        fidelity = fidAgain ?? fidelity;
      }
    }
  }
  const used = assets.filter((a) => a !== "hero" && new RegExp(`@img:${a}\\b`).test(result.html + result.css));
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
    photoLine: photoLineFor(site, result.html + result.css),
    fidelity: fidelity?.score,
  };
  const imgs = [...new Set([...(design.html + design.css).matchAll(/@img:([a-z0-9-]+)/g)].map((m) => m[1]!))];
  const own = imgs.filter((n) => /^the business's (own photo|signature graphic)/.test(ctx.images.find((i) => i.name === n)?.kind ?? ""));
  console.info(`[design] “${brief.concept}” ready (${design.status}${fromMockup ? ", from the Imagine mockup" : ", from the text brief"}) in ${secs(design.ms!)} · ${design.html.length} chars html · images ${imgs.join(", ") || "none"} (${own.length} of the site's own${site.images?.["brand-art"] && imgs.includes("brand-art") ? ", incl. its signature graphic" : ""})${used.length ? ` · Imagine art ${used.join(", ")}` : ""}${fidelity ? ` · fidelity ${fidelity.score}/100` : ""}${ctx.keep ? " · kept picture shown" : ""}${design.photoLine ? ` · card: ${design.photoLine}` : ""}`);
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
