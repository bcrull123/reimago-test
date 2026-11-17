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
  .validator((input: { facts?: unknown; variation?: number; previous?: unknown; current?: unknown }) => ({
    facts: clampFacts(input?.facts),
    variation: variationOf(input?.variation),
    // Ids of the looks shown in earlier rounds of this session (oldest first); the server reads them itself.
    previous: (Array.isArray(input?.previous) ? input.previous : []).filter((x): x is string => typeof x === "string" && /^[a-f0-9]{16}$/.test(x)).slice(-12),
    // The looks on screen now (the round being replaced).
    current: (Array.isArray(input?.current) ? input.current : []).filter((x): x is string => typeof x === "string" && /^[a-f0-9]{16}$/.test(x)).slice(0, 3),
  }))
  .handler(async ({ data }): Promise<PreviewStepResult<{ plan: SitePlan; directions: DesignDirection[]; note?: string }>> => {
    if (await limited("dir", 20)) return { ok: false, error: "Too many previews from this network in the last hour. Try again shortly." };
    try {
      const { planSite, directionsFor, prefetchForPlan, stepBudgetMs } = await import("./preview/builder.server");
      const { previousRound } = await import("./preview/round-memory.server");
      const started = Date.now();
      const previous = data.previous.length || data.current.length ? await previousRound(data.previous, data.current).catch(() => undefined) : undefined;
      // A fresh random seed every round: archetypes, hero treatments and names are picked from a wider pool.
      const seed = 1 + Math.floor(Math.random() * 2_000_000_000);
      const planP = planSite(data.facts, data.variation).then((p) => {
        if (previous?.photoKeys.length || previous?.photoHashes.length) p.plan.avoidPhotos = { keys: previous.photoKeys, hashes: previous.photoHashes };
        return p;
      });
      const looksP = directionsFor(data.facts, data.variation, { seed, previous });
      // The from-scratch look's creative brief (Grok), alongside the template directions.
      const { creativeBrief, customLookEnabled, asCustomDirection } = await import("./preview/custom-design.server");
      const { PRESETS } = await import("./preview/design");
      const briefP = customLookEnabled() ? creativeBrief(data.facts, PRESETS.editorial.palette, started + 35_000) : undefined;
      // Proactive photo search (Serper) starts as soon as the plan's imageQueries exist, alongside the looks.
      // It also waits for the looks' archetypes, so each look's photo can suit its mood (dark premium: night, …).
      const archetypesP = looksP.then((l) => l.directions.map((d) => d.archetype)).catch(() => undefined);
      const prefetchP = planP.then((p) => prefetchForPlan(data.facts, p.plan, started + Math.max(20_000, stepBudgetMs() - 15_000), archetypesP));
      const [planned, looks] = await Promise.all([planP, looksP]);
      // Give a running search a few more seconds to finish and store its ranking (each look can redo it if not).
      await Promise.race([prefetchP, new Promise((r) => setTimeout(r, Math.max(0, Math.min(12_000, started + stepBudgetMs() - 10_000 - Date.now()))))]);
      const note = [planned.note, looks.note].filter(Boolean).join(" ") || undefined;
      let directions = looks.directions;
      if (briefP && directions.length >= 3) {
        // Bob: "Let's just do one design for now until we get it right and then expand." The third look is
        // designed from scratch; the other two stay template looks for comparison.
        const brief = await briefP;
        directions = directions.map((d, i) => (i === 2 ? asCustomDirection(d, brief) : d));
      }
      return { ok: true, plan: planned.plan, directions, note };
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
      const { site, ai, aiError, aiWarning, generated, photos } = await buildLook(id, data.facts, plan, direction, data.index);
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
        aiWarning,
      };
      const { latestRequest, requestHints } = await import("./preview/owner-request");
      const { photosLine } = await import("./preview/image-prompts");
      look.request = latestRequest(data.facts) || undefined;
      look.photos = photosLine(site.trace, photos);
      const { layoutLine } = await import("./preview/look-variety");
      look.layout = layoutLine(direction, site.trace?.layout?.hero);
      look.trace = site.trace;
      if (site.mock) {
        const applied = requestHints(data.facts).applied;
        if (applied.length) look.applied = applied;
      }
      return { ok: true, look, note: look.aiError ? aiFallbackNote(look.aiError) : undefined };
    } catch (error) {
      console.error("[preview] look failed", error instanceof Error ? error.message : error);
      return { ok: false, error: error instanceof Error ? error.message : "This look could not be built." };
    }
  });

/**
 * Step 3b — the from-scratch look: after its template build (images, sub-pages, fallback homepage), Grok designs
 * the homepage as freeform HTML/CSS (validated, one repair pass). On failure the template homepage stays and the
 * card says why. Its own request, so it has its own time budget.
 */
/**
 * The Custom Design look, step 1 of 2: Grok Imagine draws the homepage design mockup (the designer), from the
 * creative brief, the real content and the look's chosen photos. Its own request (≤60 s for the image).
 */
export const previewImagine = createServerFn({ method: "POST" })
  .validator((input: { id?: string }) => {
    const id = typeof input?.id === "string" ? input.id.trim() : "";
    if (!/^[a-f0-9]{16}$/.test(id)) throw new Error("That look was not found. Run the site again.");
    return { id };
  })
  .handler(async ({ data }): Promise<PreviewStepResult<{ mockupUrl?: string; note?: string }>> => {
    if (await limited("imagine", 30)) return { ok: false, error: "Too many previews from this network in the last hour. Try again shortly." };
    try {
      const { readSite, saveSite } = await import("./pages.server");
      const site = await readSite(data.id);
      if (!site || site.version !== 3 || !site.design?.custom) return { ok: false, error: "That look was not found on this server. Run the site again." };
      const { imagineMockup, customStepBudgetMs, prepareCustomPhotos } = await import("./preview/custom-design.server");
      // The template's hero (the business's own photo first) becomes the custom page's @img:hero.
      if (await prepareCustomPhotos(site)) await saveSite(site);
      const made = await imagineMockup(site, Date.now() + Math.min(customStepBudgetMs(), 75_000));
      if (!made.mockup) return { ok: true, note: made.reason };
      site.customMockup = made.mockup;
      await saveSite(site);
      const { publicBase } = await import("./publish.server");
      return { ok: true, mockupUrl: `${publicBase()}/made/${data.id}/img/mockup` };
    } catch (error) {
      console.error("[imagine] step failed", error instanceof Error ? error.message : error);
      return { ok: true, note: "Grok Imagine failed this time" };
    }
  });

/**
 * The Custom Design look, step 2 of 2: Grok builds the homepage (from the Imagine mockup when there is one, else
 * from the text brief), with checks, contrast auto-fix and one repair pass. Fallback chain: mockup build -> text-brief
 * design (when time is left) -> the template homepage.
 */
export const previewCustom = createServerFn({ method: "POST" })
  .validator((input: { id?: string }) => {
    const id = typeof input?.id === "string" ? input.id.trim() : "";
    if (!/^[a-f0-9]{16}$/.test(id)) throw new Error("That look was not found. Run the site again.");
    return { id };
  })
  .handler(async ({ data }): Promise<PreviewStepResult<{ custom: NonNullable<LookInfo["custom"]>; name: string; layout?: string }>> => {
    if (await limited("custom", 30)) return { ok: false, error: "Too many previews from this network in the last hour. Try again shortly." };
    try {
      const { readSite, saveSite, readImage } = await import("./pages.server");
      const site = await readSite(data.id);
      if (!site || site.version !== 3 || !site.design?.custom) return { ok: false, error: "That look was not found on this server. Run the site again." };
      const { designCustom, customStepBudgetMs, prepareCustomPhotos } = await import("./preview/custom-design.server");
      await prepareCustomPhotos(site);
      const { lookName } = await import("./preview/archetype-label");
      const { layoutLine } = await import("./preview/look-variety");
      const { customLayoutLine } = await import("./preview/custom-design");
      const { publicBase } = await import("./publish.server");
      const brief = site.design.custom.brief;
      const deadline = Date.now() + customStepBudgetMs();
      const stored = site.customMockup ? await readImage(data.id, "mockup").catch(() => undefined) : undefined;
      const mockupUrl = stored ? `${publicBase()}/made/${data.id}/img/mockup` : undefined;
      let made = await designCustom(site, deadline, stored && site.customMockup ? { mockup: site.customMockup, bytes: stored.bytes } : undefined);
      let imagineNote: string | undefined;
      if (!made.design && stored) {
        // The mockup build broke: the text-brief design next, when there is time; else the template.
        imagineNote = `the build from the Imagine mockup failed (${(made.reason ?? "").slice(0, 120)})`;
        if (deadline - Date.now() > 60_000) {
          console.info(`[design] ${imagineNote}; trying the text-brief design`);
          made = await designCustom(site, deadline);
        } else console.info(`[design] ${imagineNote}; no time left for the text-brief design`);
      } else if (!site.customMockup) imagineNote = "no Imagine mockup this time; designed from the text brief";
      if (made.design) {
        site.custom = made.design;
        await saveSite(site);
        const d = made.design;
        return {
          ok: true,
          name: site.design.name,
          layout: customLayoutLine(brief),
          custom: {
            concept: brief.concept,
            status: d.status,
            stripped: d.stripped.slice(0, 8),
            repaired: d.repaired?.slice(0, 6),
            source: d.source,
            mockupUrl: d.source === "imagine" ? mockupUrl : undefined,
            autofixed: d.autofixed?.length || undefined,
            imagineNote: d.source === "imagine" ? undefined : imagineNote,
          },
        };
      }
      // Fallback: the template homepage, under its style's name (one name per look).
      const name = lookName(site.design.archetype);
      const reason = made.reason ?? "failed";
      const shortReason = reason.length > 140 ? `${reason.slice(0, 137).replace(/\s+\S*$/, "")}…` : reason;
      site.design = { ...site.design, name, custom: { ...site.design.custom, failed: made.reason ?? "failed" } };
      await saveSite(site);
      console.info(`[design] fallback: look ${(site.lookIndex ?? 2) + 1} shows its template homepage as “${name}” (${made.reason})`);
      return { ok: true, name, layout: layoutLine(site.design, site.trace?.layout?.hero), custom: { concept: brief.concept, status: "fallback", mockupUrl, note: `The from-scratch design (“${brief.concept}”) had a structural problem our checks couldn't fix (${shortReason}), so this card shows the ${name} template look.` } };
    } catch (error) {
      console.error("[design] custom step failed", error instanceof Error ? error.message : error);
      return { ok: false, error: error instanceof Error ? error.message : "The custom design could not be built." };
    }
  });

/**
 * "Not quite right?" — first decide whether the feedback names one of the looks on screen. If it does
 * ("The Night Brick is best just a little too dark."), that look is edited (same name, layout, fonts, photo and
 * copy; only the requested change) into three close variations. If it names no look, the browser makes three new
 * looks as before (mode "new"). Never sends the form.
 */
export const previewRefine = createServerFn({ method: "POST" })
  .validator((input: { text?: string; ids?: unknown; focused?: string; feedback?: unknown }) => {
    const text = typeof input?.text === "string" ? input.text.replace(/\s+/g, " ").trim().slice(0, 400) : "";
    if (!text) throw new Error("Tell us what to change.");
    const ids = (Array.isArray(input?.ids) ? input.ids : []).map(String).filter((id) => /^[a-f0-9]{16}$/.test(id)).slice(0, 3);
    const focused = typeof input?.focused === "string" && /^[a-f0-9]{16}$/.test(input.focused) ? input.focused : undefined;
    const feedback = (Array.isArray(input?.feedback) ? input.feedback : []).map((f) => String(f).replace(/\s+/g, " ").trim().slice(0, 400)).filter(Boolean).slice(-5);
    return { text, ids, focused, feedback };
  })
  .handler(async ({ data }): Promise<PreviewStepResult<{ mode: "new" } | { mode: "none"; note: string } | { mode: "edit"; looks: LookInfo[]; target: string; targetId: string; how: string; note?: string }>> => {
    if (await limited("refine", 40)) return { ok: false, error: "Too many changes from this network in the last hour. Try again shortly." };
    try {
      const { readSite } = await import("./pages.server");
      const sites = (await Promise.all(data.ids.map((id) => readSite(id)))).filter((s): s is NonNullable<typeof s> => Boolean(s?.design && s.version === 3));
      if (!sites.length) return { ok: true, mode: "new" };
      const { lookRefs, planEdit, buildEdits } = await import("./preview/look-edit.server");
      const { aiAvailable, isMockMode } = await import("./ai-provider.server");
      const refs = lookRefs(sites);
      const edit = await planEdit(data.text, refs, data.focused, !isMockMode() && aiAvailable());
      const nameOf = (id: string | undefined) => refs.find((r) => r.id === id)?.name;
      console.info(
        `[refine] "${data.text.slice(0, 120)}" -> ${edit.targetId ? `edit ${nameOf(edit.targetId)} only (${edit.how}); unchanged: ${refs.filter((r) => r.id !== edit.targetId).map((r) => r.name).join(", ") || "none"}` : "no look named: 3 new looks"} · adjustments ${JSON.stringify(edit.adjustments)}${edit.copy ? " · copy" : ""}${edit.photo ? ` · photo "${edit.photo}"` : ""}${edit.borrow ? ` · borrow ${edit.borrow.assets.join("+")} from ${nameOf(edit.borrow.fromId)}` : ""} · read by ${edit.from}`,
      );
      if (!edit.targetId) return { ok: true, mode: "new" };
      const target = sites.find((s) => s.id === edit.targetId)!;
      const lender = edit.borrow ? sites.find((s) => s.id === edit.borrow!.fromId) : undefined;
      const name = nameOf(edit.targetId)!;
      if (!edit.adjustments.length && !edit.copy && !edit.photo && !lender) {
        return {
          ok: true,
          mode: "none",
          note: `We read that as about “${name}”, but couldn't tell what to change. Try e.g. “${name}, a little lighter”, “…more contrast”, “…bigger text”, “…less busy”, “…warmer”, or name a different photo. This didn't use up a round.`,
        };
      }
      const feedback = [...data.feedback, data.text].slice(-5);
      const edits = await buildEdits(target, edit, feedback, lender);
      const targetIndex = refs.find((r) => r.id === edit.targetId)?.index ?? 0;
      const { publicBase } = await import("./publish.server");
      const { photosLine } = await import("./preview/image-prompts");
      const { layoutLine } = await import("./preview/look-variety");
      const { customLayoutLine } = await import("./preview/custom-design");
      const looks: LookInfo[] = edits.map((e) => {
        const site = e.site;
        const design = site.design!;
        const images = Object.values(site.images ?? {});
        const photos = images.filter((img) => img.name.startsWith("photo-")).length;
        return {
          id: site.id,
          url: `${publicBase()}/made/${site.id}`,
          // Same card, same place, same name: only this look changes on screen.
          index: targetIndex,
          name,
          mood: design.mood,
          archetype: design.archetype,
          palette: site.palette,
          fonts: design.fonts,
          images: { generated: images.filter((img) => img.source === "generated").length, photos },
          mock: site.mock,
          request: data.text,
          photos: photosLine(site.trace, photos),
          layout: site.custom && !design.custom?.failed ? customLayoutLine(site.custom.brief) : layoutLine(design, site.trace?.layout?.hero),
          custom:
            site.custom && !design.custom?.failed
              ? {
                  concept: site.custom.brief.concept,
                  status: site.custom.status,
                  source: site.custom.source,
                  mockupUrl: site.custom.source === "imagine" && site.customMockup ? `${publicBase()}/made/${site.id}/img/mockup` : undefined,
                  mockupStale: Boolean(site.custom.mockup?.stale) || undefined,
                }
              : undefined,
          trace: site.trace,
          edit: { variant: e.variant, changed: e.changed, from: target.id, how: edit.how ?? "" },
        };
      });
      return { ok: true, mode: "edit", looks, target: name, targetId: target.id, how: edit.how ?? "" };
    } catch (error) {
      console.error("[refine] failed", error instanceof Error ? error.message : error);
      return { ok: false, error: error instanceof Error ? error.message : "That change could not be made." };
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

/**
 * Keep the browser-made screenshot of a look's homepage next to the preview, so the lead email can link it
 * (`picture_url`) as well as attach it. Optional: the form is sent with the attachment even if this fails.
 */
export const savePreviewPicture = createServerFn({ method: "POST" })
  .validator((input: { id?: string; png?: string }) => {
    const id = typeof input?.id === "string" ? input.id.trim() : "";
    if (!/^[a-f0-9]{16}$/.test(id)) throw new Error("That look was not found.");
    const png = typeof input?.png === "string" ? input.png.replace(/^data:image\/png;base64,/, "") : "";
    // Serverless request bodies are capped around 4.5 MB, so larger pictures are only attached, not stored.
    if (!png || png.length > 4_200_000 || !/^[A-Za-z0-9+/]+=*$/.test(png)) throw new Error("The picture is missing or too large to store.");
    return { id, png };
  })
  .handler(async ({ data }): Promise<PreviewStepResult<{ url: string }>> => {
    try {
      if (await limited("picture", 30)) return { ok: false, error: "Too many pictures from this network in the last hour." };
      const { readSite, saveImage } = await import("./pages.server");
      const { imageSize } = await import("./preview/images.server");
      const { publicBase } = await import("./publish.server");
      const site = await readSite(data.id);
      if (!site) return { ok: false, error: "That look was not found on this server." };
      const bytes = Buffer.from(data.png, "base64");
      const size = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? imageSize(bytes) : undefined;
      if (!size || size.width < 200 || size.width > 2600 || size.height < 100 || size.height > 5000) return { ok: false, error: "That is not a preview picture." };
      await saveImage(data.id, "capture", "image/png", bytes);
      return { ok: true, url: `${publicBase()}/made/${data.id}/img/capture` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "The picture could not be stored." };
    }
  });
