import { createServerFn } from "@tanstack/react-start";
import { clampFacts, clampPlanInput } from "@/lib/preview/clamp";
import type { ReimagineOk } from "@/lib/reimagine-types";
import type { PreviewStepResult, SiteFacts, SitePlan } from "@/lib/preview/types";

/** Step 1 — read the visitor's site (homepage + up to 8 linked pages). */
export const previewRead = createServerFn({ method: "POST" })
  .validator((input: { url?: string; notes?: string }) => {
    const url = typeof input?.url === "string" ? input.url.trim() : "";
    const notes = typeof input?.notes === "string" ? input.notes.trim().slice(0, 800) : "";
    if (!url || url.length > 300) throw new Error("Enter a website address.");
    return { url, notes };
  })
  .handler(async ({ data }): Promise<PreviewStepResult<{ facts: SiteFacts }>> => {
    const { rateLimited, requestIp } = await import("./reimagine.server");
    if (rateLimited(requestIp())) {
      return { ok: false, error: "Too many previews from this network in the last hour. Try again shortly." };
    }
    try {
      const { scrapeSite } = await import("./preview/scrape.server");
      return { ok: true, facts: await scrapeSite(data.url, data.notes) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "That site could not be read.";
      if (/fetch failed|aborted|timeout|Timeout/i.test(message)) {
        return { ok: false, error: "That site did not respond in time. Check the address and try again." };
      }
      return { ok: false, error: message };
    }
  });

/** Step 1 for the Create a New Site wizard — facts come from the brief, nothing is scraped. */
export const previewFromBrief = createServerFn({ method: "POST" })
  .validator((input: { brief?: Record<string, unknown> }) => {
    if (!input?.brief || typeof input.brief !== "object") throw new Error("The brief is missing.");
    return { brief: input.brief };
  })
  .handler(async ({ data }): Promise<PreviewStepResult<{ facts: SiteFacts }>> => {
    const { rateLimited, requestIp } = await import("./reimagine.server");
    if (rateLimited(requestIp())) {
      return { ok: false, error: "Too many drafts from this network in the last hour. Try again shortly." };
    }
    const { factsFromBrief } = await import("./preview/scrape.server");
    return { ok: true, facts: factsFromBrief(data.brief) };
  });

/** Step 2 — one AI call returns the site plan (pages, nav, palette, fonts). */
export const previewPlan = createServerFn({ method: "POST" })
  .validator((input: { facts?: unknown; variation?: number }) => ({
    facts: clampFacts(input?.facts),
    variation: typeof input?.variation === "number" ? Math.max(0, Math.min(20, Math.floor(input.variation))) : 0,
  }))
  .handler(async ({ data }): Promise<PreviewStepResult<{ plan: SitePlan; note?: string }>> => {
    try {
      const { planSite } = await import("./preview/builder.server");
      const { plan, note } = await planSite(data.facts, data.variation);
      return { ok: true, plan, note };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "The site could not be planned." };
    }
  });

/** Step 3 — write every page in parallel, sanitize, save, and return the live preview links. */
export const previewBuild = createServerFn({ method: "POST" })
  .validator((input: { facts?: unknown; plan?: unknown; variation?: number }) => ({
    facts: clampFacts(input?.facts),
    plan: clampPlanInput(input?.plan),
    variation: typeof input?.variation === "number" ? Math.max(0, Math.min(20, Math.floor(input.variation))) : 0,
  }))
  .handler(async ({ data }): Promise<PreviewStepResult<{ result: ReimagineOk }>> => {
    try {
      const { normalizePlan, buildSite } = await import("./preview/builder.server");
      const { newPageId, saveSite } = await import("./pages.server");
      const { publicBase } = await import("./publish.server");
      const { isMockMode } = await import("./ai-provider.server");
      const rawPlan = data.plan as SitePlan | null;
      const plan = normalizePlan(rawPlan, data.facts, data.variation);
      if (rawPlan && typeof rawPlan === "object" && rawPlan.mock) plan.mock = true;
      const id = newPageId();
      const { site, mock, note } = await buildSite(id, data.facts, plan, data.variation);
      await saveSite(site);
      const base = `${publicBase()}/made/${id}`;
      const facts = data.facts;
      const result: ReimagineOk = {
        ok: true,
        source: mock ? "crawl" : "grok",
        live: facts.mode === "reimagine" && !facts.note,
        finalUrl: facts.sourceUrl,
        host: facts.host,
        foundTitle: facts.name,
        foundDescription: facts.description,
        diagnosis: plan.summary,
        honored: plan.changes,
        draft: {
          name: facts.name,
          kicker: plan.tagline,
          headline: plan.tagline,
          subhead: facts.description,
          action: plan.cta.label,
          nav: site.pages.map((p) => p.navLabel),
          palette: "harbor",
          points: facts.services.slice(0, 3).map((s) => ({ title: s, body: "" })),
          bandTitle: "",
          bandBody: "",
          close: "",
          logo: facts.logo || undefined,
          template: "yours",
          change: facts.notes || undefined,
        },
        layout: {
          submitted: facts.sourceUrl,
          url: facts.sourceUrl,
          title: facts.name,
          description: facts.description,
          nav: facts.nav.map((n) => n.label).slice(0, 8),
          headings: facts.pages.flatMap((p) => p.headings).slice(0, 16),
          text: facts.pages.map((p) => p.text).join("\n").slice(0, 2500),
        },
        note: [facts.note, note, isMockMode() ? "Mock mode (PREVIEW_MOCK=1): this preview was assembled without AI." : ""]
          .filter(Boolean)
          .join(" ") || undefined,
        pageUrl: base,
        preview: {
          id,
          url: base,
          mock: site.mock,
          pages: site.pages.map((p) => ({ slug: p.slug, title: p.navLabel || p.title, url: p.slug === "home" ? base : `${base}/${p.slug}` })),
        },
      };
      return { ok: true, result };
    } catch (error) {
      console.error("[preview] build failed", error instanceof Error ? error.message : error);
      return { ok: false, error: error instanceof Error ? error.message : "The preview could not be built." };
    }
  });

/** Whether the server can launch a Cursor cloud agent (CURSOR_API_KEY set). */
export const cursorStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { cursorConfigured } = await import("./reimagine.server");
  return { api: cursorConfigured() };
});
