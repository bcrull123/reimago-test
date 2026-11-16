import { createServerFn } from "@tanstack/react-start";
import { clampFacts, clampPlanInput } from "@/lib/preview/clamp";
import type { ReimagineOk } from "@/lib/reimagine-types";
import type { DesignDirection, LookInfo, PreviewStepResult, SiteFacts, SitePlan } from "@/lib/preview/types";

/*
 * The live preview runs as short browser-orchestrated steps instead of one long
 * request, so each serverless call stays well under host time limits and the
 * visitor sees real progress:
 *   previewRead / previewFromBrief  → facts            ("Reading your site…")
 *   previewDirections               → plan + 3 looks   ("Dreaming up looks…")
 *   previewLook  x3 (parallel)      → homepage per look ("Painting images…")
 *   previewFinish (chosen look)     → all pages + polished homepage ("Building pages… Polishing…")
 * Facts, plan and design are stored with each look server-side, so the finish
 * step only needs the look id and never trusts browser-edited data.
 */

const variationOf = (value: unknown) => (typeof value === "number" ? Math.max(0, Math.min(20, Math.floor(value))) : 0);

async function limited(prefix: string, max: number): Promise<boolean> {
  const { rateLimited, requestIp } = await import("./reimagine.server");
  return rateLimited(`${prefix}:${requestIp()}`, max);
}

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

/** Step 1 for the Create a New Site wizard — facts come from the brief; "sites to emulate" are lightly scanned. */
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
    const { factsFromBrief, scanInspiration } = await import("./preview/scrape.server");
    const facts = factsFromBrief(data.brief);
    const s = (key: string) => (typeof data.brief[key] === "string" ? (data.brief[key] as string).trim() : "");
    const likes = [Array.isArray(data.brief.emulate_likes) ? (data.brief.emulate_likes as unknown[]).map(String).join(", ") : "", s("emulate_note")]
      .filter(Boolean)
      .join(". ");
    const urls = [s("emulate_url_1"), s("emulate_url_2"), s("emulate_url_3")].filter(Boolean);
    if (urls.length) facts.inspiration = await scanInspiration(urls, likes);
    else if (likes) facts.inspiration = [{ url: "", title: "", description: "", colors: [], fonts: [], headings: [], likes: likes.slice(0, 300) }];
    return { ok: true, facts };
  });

/** Step 2 — plan the pages and dream up three design directions (two AI calls in parallel). */
export const previewDirections = createServerFn({ method: "POST" })
  .validator((input: { facts?: unknown; variation?: number }) => ({ facts: clampFacts(input?.facts), variation: variationOf(input?.variation) }))
  .handler(async ({ data }): Promise<PreviewStepResult<{ plan: SitePlan; directions: DesignDirection[]; note?: string }>> => {
    if (await limited("dir", 20)) return { ok: false, error: "Too many previews from this network in the last hour. Try again shortly." };
    try {
      const { planSite, directionsFor } = await import("./preview/builder.server");
      const [planned, looks] = await Promise.all([planSite(data.facts, data.variation), directionsFor(data.facts, data.variation)]);
      const note = [planned.note, looks.note].filter(Boolean).join(" ") || undefined;
      return { ok: true, plan: planned.plan, directions: looks.directions, note };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "The looks could not be planned." };
    }
  });

/** Step 3 — build one look: its images and its homepage. The browser runs the three looks in parallel. */
export const previewLook = createServerFn({ method: "POST" })
  .validator((input: { facts?: unknown; plan?: unknown; direction?: unknown; index?: number; variation?: number }) => ({
    facts: clampFacts(input?.facts),
    plan: clampPlanInput(input?.plan),
    direction: clampPlanInput(input?.direction),
    index: typeof input?.index === "number" ? Math.max(0, Math.min(2, Math.floor(input.index))) : 0,
    variation: variationOf(input?.variation),
  }))
  .handler(async ({ data }): Promise<PreviewStepResult<{ look: LookInfo; note?: string }>> => {
    if (await limited("look", 45)) return { ok: false, error: "Too many previews from this network in the last hour. Try again shortly." };
    try {
      const { normalizePlan, buildLook } = await import("./preview/builder.server");
      const { normalizeDirection } = await import("./preview/design");
      const { newPageId, saveSite } = await import("./pages.server");
      const { publicBase } = await import("./publish.server");
      const rawPlan = data.plan as SitePlan | null;
      const plan = normalizePlan(rawPlan, data.facts, data.variation);
      if (rawPlan && typeof rawPlan === "object" && rawPlan.mock) plan.mock = true;
      const direction = normalizeDirection(data.direction, data.index, data.facts);
      const id = newPageId();
      const { site, ai, aiError, generated, photos } = await buildLook(id, data.facts, plan, direction, data.index);
      await saveSite(site);
      const look: LookInfo = {
        id,
        url: `${publicBase()}/made/${id}`,
        index: data.index,
        name: direction.name,
        mood: direction.mood,
        archetype: direction.archetype,
        palette: direction.palette,
        fonts: direction.fonts,
        images: { generated, photos },
        mock: site.mock,
        aiError: ai || site.mock ? undefined : aiError ?? "AI is not configured on this server",
      };
      return { ok: true, look, note: look.aiError ? aiFallbackNote(look.aiError) : undefined };
    } catch (error) {
      console.error("[preview] look failed", error instanceof Error ? error.message : error);
      return { ok: false, error: error instanceof Error ? error.message : "This look could not be built." };
    }
  });

function aiFallbackNote(reason: string): string {
  return `The AI homepage could not be used (${reason}), so this look was assembled from the section library. Use "Retry with AI" to run the AI again.`;
}

/** "Retry with AI" — re-run the AI for a look's homepage (and any fallback pages of a finished site). */
export const previewRetryAi = createServerFn({ method: "POST" })
  .validator((input: { id?: string }) => {
    const id = typeof input?.id === "string" ? input.id.trim() : "";
    if (!/^[a-f0-9]{16}$/.test(id)) throw new Error("That look was not found. Run the site again.");
    return { id };
  })
  .handler(async ({ data }): Promise<PreviewStepResult<{ fixed: string[]; errors: Record<string, string>; note?: string; result?: ReimagineOk }>> => {
    if (await limited("retry", 20)) return { ok: false, error: "Too many retries from this network in the last hour. Try again shortly." };
    try {
      const { readSite, saveSite } = await import("./pages.server");
      const { publicBase } = await import("./publish.server");
      const { retryAiPages } = await import("./preview/builder.server");
      const stored = await readSite(data.id);
      if (!stored || stored.version !== 3) return { ok: false, error: "That look was not found on this server. Run the site again." };
      const { site, fixed, errors } = await retryAiPages(stored);
      await saveSite(site);
      const first = Object.entries(errors)[0];
      const note = first ? `The AI still failed for ${first[0] === "home" ? "the homepage" : `the "${first[0]}" page`}: ${first[1]}` : undefined;
      const { resultFor } = await import("./preview/result");
      return { ok: true, fixed, errors, note, result: site.finished ? resultFor(site, `${publicBase()}/made/${site.id}`, note) : undefined };
    } catch (error) {
      console.error("[preview] retry failed", error instanceof Error ? error.message : error);
      return { ok: false, error: error instanceof Error ? error.message : "The AI retry failed." };
    }
  });

/** Step 4 — the visitor picked a look: build the remaining pages and polish the homepage. */
export const previewFinish = createServerFn({ method: "POST" })
  .validator((input: { id?: string }) => {
    const id = typeof input?.id === "string" ? input.id.trim() : "";
    if (!/^[a-f0-9]{16}$/.test(id)) throw new Error("That look was not found. Run the site again.");
    return { id };
  })
  .handler(async ({ data }): Promise<PreviewStepResult<{ result: ReimagineOk }>> => {
    try {
      const { readSite, saveSite } = await import("./pages.server");
      const { publicBase } = await import("./publish.server");
      const stored = await readSite(data.id);
      if (!stored || stored.version !== 3) return { ok: false, error: "That look was not found on this server. Run the site again." };
      let site = stored;
      let note: string | undefined;
      if (!site.finished) {
        if (await limited("finish", 20)) return { ok: false, error: "Too many previews from this network in the last hour. Try again shortly." };
        const { finishSite } = await import("./preview/builder.server");
        const finished = await finishSite(site);
        site = finished.site;
        note = finished.note;
        await saveSite(site);
      }
      const { resultFor } = await import("./preview/result");
      return { ok: true, result: resultFor(site, `${publicBase()}/made/${site.id}`, note) };
    } catch (error) {
      console.error("[preview] finish failed", error instanceof Error ? error.message : error);
      return { ok: false, error: error instanceof Error ? error.message : "The preview could not be built." };
    }
  });

/** Whether the server can launch a Cursor cloud agent (CURSOR_API_KEY set). */
export const cursorStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { cursorConfigured } = await import("./reimagine.server");
  return { api: cursorConfigured() };
});
