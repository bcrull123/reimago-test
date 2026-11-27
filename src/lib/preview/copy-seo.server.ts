/**
 * Round 15 — specialist copy / SEO / conversion pass.
 * Receives only the art-direction brief and the current sections (no prior reasoning).
 * Unique H1, meta description, clear CTA, mobile tap-target reminder. Low reasoning effort.
 */
import { aiAvailable, chatJson, isMockMode } from "@/lib/ai-provider.server";
import { ownerRequestRule } from "@/lib/preview/owner-request";
import { normalizeSections, type NormalizeContext } from "@/lib/preview/sections";
import { briefFromDirection } from "@/lib/preview/stage-brief";
import { REIMAGO_SYSTEM } from "@/lib/preview/system-prompt";
import type { Section } from "@/lib/preview/types";
import type { StoredSite } from "@/lib/preview/render";

export type CopySeoResult = { sections: Section[]; metaDescription?: string; headline?: string; ms: number; ran: boolean };

const COPY_SPECIALIST = `${REIMAGO_SYSTEM}

You are the copy, SEO and conversion specialist. Improve the current homepage sections using only the art-direction brief and the sections themselves.
Return ONLY JSON: {"sections":[...],"headline":"unique H1","metaDescription":"one sentence, max 160 chars","ctaLabel":"short CTA"}
Rules:
- The H1 (hero heading) must be unique and specific to this business — not "Welcome" or a generic slogan.
- metaDescription is a single factual sentence (no invented claims).
- CTA must be clear and tappable (2–5 words). There must be a closing cta-band.
- Fix weak copy only; do not change the hero type, palette, or section count by more than one.
- Headings and buttons should stay short enough for a mobile screen (hero heading ideally under 70 characters).`;

export async function copySeoPass(site: StoredSite, ctx: NormalizeContext, budgetMs: number): Promise<CopySeoResult> {
  const started = Date.now();
  const home = site.pages.find((p) => p.slug === "home");
  const sections = home?.sections ?? [];
  const design = site.design;
  if (!home || !sections.length || !design) return { sections, ms: 0, ran: false };
  if (site.custom && !site.design?.custom?.failed) return { sections, ms: Date.now() - started, ran: false };
  if (isMockMode() || !aiAvailable() || budgetMs < 12_000) {
    console.info(`[stage] copy “${design.name}” skipped (${isMockMode() ? "mock" : budgetMs < 12_000 ? "no time" : "no AI"}) ${Date.now() - started}ms`);
    return { sections, ms: Date.now() - started, ran: false };
  }
  try {
    const brief = briefFromDirection(design, site.facts);
    const raw = await chatJson<{ sections?: unknown; headline?: unknown; metaDescription?: unknown; ctaLabel?: unknown }>({
      temperature: 0.4,
      maxTokens: 10_000,
      timeoutMs: Math.max(8000, budgetMs - 1000),
      retry: false,
      reasoningEffort: "low",
      messages: [
        {
          role: "system",
          content: `${COPY_SPECIALIST}${site.facts && ownerRequestRule(site.facts) ? `\n\n${ownerRequestRule(site.facts)}` : ""}`,
        },
        { role: "user", content: JSON.stringify({ brief, current_sections: sections, facts: { name: site.facts?.name, description: site.facts?.description, services: site.facts?.services?.slice(0, 6), cta: site.plan?.cta } }) },
      ],
    });
    const revised = raw.sections ? normalizeSections(raw.sections, ctx) : [];
    const heroOk = revised[0] && revised[0].type === sections[0]?.type;
    const next = revised.length >= 3 && heroOk ? revised : sections;
    if (typeof raw.headline === "string" && raw.headline.trim() && next[0]) {
      next[0] = { ...next[0], heading: raw.headline.replace(/\s+/g, " ").trim().slice(0, 90) };
    }
    const meta = typeof raw.metaDescription === "string" ? raw.metaDescription.replace(/\s+/g, " ").trim().slice(0, 160) : undefined;
    const ms = Date.now() - started;
    console.info(`[stage] copy “${design.name}” ${ms}ms${meta ? ` meta=${meta.length}c` : ""}`);
    return { sections: next, metaDescription: meta, headline: next[0]?.heading, ms, ran: true };
  } catch (error) {
    console.error(`[stage] copy “${design.name}” failed`, error instanceof Error ? error.message : error);
    return { sections, ms: Date.now() - started, ran: false };
  }
}
