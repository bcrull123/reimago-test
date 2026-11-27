/**
 * Round 15 — bounded self-check loop after a look is built.
 * Prefer a real screenshot + Grok vision when Chrome is available and time remains;
 * otherwise critique the rendered HTML/CSS structure. Keep the best-scoring version.
 * If the budget runs out, ship the best so far. Logs: [qa].
 */
import { chatText, isMockMode, aiAvailable, parseJsonObject, type ContentPart } from "@/lib/ai-provider.server";
import { env } from "@/lib/env.server";
import { chromePath, critiqueMode, screenshotHome } from "@/lib/preview/critique.server";
import { ownerRequestRule } from "@/lib/preview/owner-request";
import { renderSitePage, type PolishInfo, type StoredSite } from "@/lib/preview/render";
import { SECTION_GUIDE, normalizeSections, type NormalizeContext } from "@/lib/preview/sections";
import { briefFromDirection, type ArtDirectionBrief } from "@/lib/preview/stage-brief";
import { REIMAGO_SYSTEM } from "@/lib/preview/system-prompt";
import type { Section } from "@/lib/preview/types";
import { isBetter, mergeScores, parseAiScores, qaRoundsDefault, structuralMisses, structuralScore, type QaReport, type QaScores } from "@/lib/preview/qa";

export function qaRoundLimit(): number {
  const raw = Number(env("PREVIEW_QA_ROUNDS"));
  if (Number.isFinite(raw) && raw >= 0) return Math.min(3, Math.max(0, Math.round(raw)));
  return qaRoundsDefault();
}

function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/i, "")
    .replace(/\s+/g, " ")
    .slice(0, 12_000);
}

const QA_SPECIALIST = `${REIMAGO_SYSTEM}

You are the QA checker. Score the current homepage against the art-direction brief (0-100 on each dimension) and list only concrete misses. If there are misses, return a revised sections list that fixes ONLY those misses — do not restyle or rewrite what already works. Keep the hero type and the brief.
Return ONLY JSON: {"scores":{"hierarchy":n,"typeScale":n,"spacing":n,"contrast":n,"styleMatch":n,"mobile":n,"blandness":n},"critique":[short notes],"misses":[short misses],"sections":[...revised sections or omit if no change]}
blandness: 100 = distinctive, 0 = generic template copy. styleMatch: how well the look follows the brief and the owner's style words.`;

type Attempt = { sections: Section[]; scores: QaScores; notes: string[]; misses: string[]; method: "vision" | "html" };

function logQa(name: string, report: QaReport): void {
  const s = report.scores;
  console.info(
    `[qa] “${name}” mode=${report.mode} rounds=${report.rounds} score=${s.total} hierarchy=${s.hierarchy} typeScale=${s.typeScale} spacing=${s.spacing} contrast=${s.contrast} styleMatch=${s.styleMatch} mobile=${s.mobile} blandness=${s.blandness} kept=${report.kept} ${report.ms}ms`,
  );
}

/**
 * Critique the homepage up to N rounds, keep the best score, ship it if time runs out.
 * Never throws. Custom (from-scratch) HTML looks are scored only — not rewritten.
 */
export async function polishAndQa(
  site: StoredSite,
  ctx: NormalizeContext,
  budgetMs: number,
  opts: { rewrite?: boolean } = {},
): Promise<{ sections: Section[]; polish: PolishInfo }> {
  const home = site.pages.find((p) => p.slug === "home");
  const original = home?.sections ?? [];
  const design = site.design;
  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);
  const rewrite = opts.rewrite !== false && !(site.custom && !site.design?.custom?.failed);
  const modePref = critiqueMode();
  const name = design?.name ?? site.name ?? "look";

  const structural = design
    ? structuralScore({ design, sections: original, facts: site.facts })
    : { hierarchy: 50, typeScale: 50, spacing: 50, contrast: 50, styleMatch: 50, mobile: 50, blandness: 50, total: 50 };
  const startMisses = design ? structuralMisses({ design, sections: original, scores: structural }) : [];

  if (!home || !original.length || !design) {
    const qa: QaReport = { rounds: 0, mode: "skipped", scores: structural, kept: "latest", ms: Date.now() - started, misses: startMisses };
    logQa(name, qa);
    return { sections: original, polish: { method: "skipped", notes: [], reason: "No homepage sections.", qa } };
  }
  if (modePref === "off") {
    const qa: QaReport = { rounds: 0, mode: "skipped", scores: structural, kept: "latest", ms: Date.now() - started, misses: startMisses };
    logQa(name, qa);
    return { sections: original, polish: { method: "skipped", notes: [], reason: "PREVIEW_CRITIQUE=off", qa } };
  }
  if (isMockMode() || !aiAvailable()) {
    const qa: QaReport = {
      rounds: 0,
      mode: "structural",
      scores: structural,
      kept: "latest",
      ms: Date.now() - started,
      misses: startMisses,
    };
    logQa(name, qa);
    return {
      sections: original,
      polish: { method: "skipped", notes: startMisses, reason: isMockMode() ? "Mock mode (PREVIEW_MOCK=1): structural QA only." : "AI is not configured: structural QA only.", qa },
    };
  }

  const brief: ArtDirectionBrief = briefFromDirection(design, site.facts);
  let shot: string | undefined;
  if (modePref !== "html") shot = await screenshotHome(site, Math.min(18_000, Math.max(0, left() - 20_000)));
  const haveChrome = Boolean(chromePath());
  const visionOk = Boolean(shot) && modePref !== "html";
  const method0: "vision" | "html" = visionOk ? "vision" : "html";
  if (modePref === "auto" || modePref === "vision") {
    console.info(`[qa] “${name}” screenshot path ${visionOk ? "on" : "off"} (chrome=${haveChrome ? "yes" : "no"}, mode=${modePref})`);
  }

  const limit = rewrite ? qaRoundLimit() : 1;
  let best: Attempt = { sections: original, scores: structural, notes: startMisses, misses: startMisses, method: method0 };
  let kept: QaReport["kept"] = "latest";
  let roundsRun = 0;
  let current = original;

  const runRound = async (method: "vision" | "html", sections: Section[], misses: string[]): Promise<Attempt | undefined> => {
    if (left() < 12_000) return undefined;
    const timeoutMs = Math.max(8000, left() - 2000);
    const payload = {
      brief,
      current_sections: sections,
      misses_to_fix: misses,
      available_images: Object.keys(site.images ?? {}).filter((n) => !n.startsWith("logo")),
    };
    const content: ContentPart[] =
      method === "vision" && shot
        ? [
            { type: "text", text: `Screenshot of the current homepage (desktop, 1280px) is attached. Brief and output (fix only the misses):\n${JSON.stringify(payload)}` },
            { type: "image_url", image_url: { url: shot, detail: "low" } },
          ]
        : [{ type: "text", text: `Rendered homepage text:\n${visibleText(renderSitePage({ ...site, pages: site.pages.map((p) => (p.slug === "home" ? { ...p, sections } : p)) }, "home", { ribbon: false }) ?? "")}\n\nBrief and output (fix only the misses):\n${JSON.stringify(payload)}` }];
    const text = await chatText({
      temperature: 0.3,
      maxTokens: 10_000,
      timeoutMs,
      retry: false,
      json: true,
      reasoningEffort: "low",
      model: env("CRITIQUE_MODEL"),
      messages: [
        {
          role: "system",
          content: `${QA_SPECIALIST}\n${SECTION_GUIDE}${site.facts && ownerRequestRule(site.facts) ? `\n\n${ownerRequestRule(site.facts)}` : ""}`,
        },
        { role: "user", content },
      ],
    });
    const json = parseJsonObject<{ scores?: unknown; critique?: unknown; misses?: unknown; sections?: unknown }>(text);
    const notes = (Array.isArray(json.critique) ? json.critique : [])
      .map((n) => (typeof n === "string" ? n.replace(/\s+/g, " ").trim().slice(0, 220) : ""))
      .filter(Boolean)
      .slice(0, 6);
    const listed = (Array.isArray(json.misses) ? json.misses : [])
      .map((n) => (typeof n === "string" ? n.replace(/\s+/g, " ").trim().slice(0, 180) : ""))
      .filter(Boolean)
      .slice(0, 6);
    let nextSections = sections;
    if (rewrite && json.sections) {
      const revised = normalizeSections(json.sections, ctx);
      const heroOk = revised[0] && revised[0].type === original[0]?.type;
      if (revised.length >= 3 && heroOk) nextSections = revised;
    }
    const struct = structuralScore({ design, sections: nextSections, facts: site.facts });
    const scores = mergeScores(struct, parseAiScores(json.scores));
    const nextMisses = listed.length ? listed : structuralMisses({ design, sections: nextSections, scores });
    return { sections: nextSections, scores, notes: notes.length ? notes : nextMisses, misses: nextMisses, method };
  };

  try {
    for (let i = 0; i < Math.max(1, limit); i += 1) {
      if (left() < 12_000) break;
      const method: "vision" | "html" = i === 0 && visionOk && left() > 18_000 ? "vision" : "html";
      try {
        const result = await runRound(method, current, best.misses);
        if (!result) break;
        roundsRun += 1;
        if (isBetter(result.scores, best.scores)) {
          best = result;
          kept = i === 0 ? "latest" : "latest";
        } else {
          kept = "best-previous";
        }
        current = result.sections;
        if (!result.misses.length || result.scores.total >= 88) break;
      } catch (error) {
        console.error(`[qa] “${name}” round ${i + 1} failed`, error instanceof Error ? error.message : error);
        if (method === "vision") {
          try {
            const result = await runRound("html", current, best.misses);
            if (result) {
              roundsRun += 1;
              if (isBetter(result.scores, best.scores)) best = result;
              current = result.sections;
            }
          } catch (inner) {
            console.error(`[qa] “${name}” html fallback failed`, inner instanceof Error ? inner.message : inner);
            break;
          }
        } else break;
      }
    }
  } catch (error) {
    console.error("[qa] loop failed", error instanceof Error ? error.message : error);
  }

  const qa: QaReport = {
    rounds: roundsRun,
    mode: roundsRun && (best.method === "vision" || shot) && best.method === "vision" ? "vision" : roundsRun ? "html" : "structural",
    scores: best.scores,
    kept,
    ms: Date.now() - started,
    misses: best.misses,
  };
  // If we never beat the starting structural score's sections but ran a round that didn't stick, still report the mode that ran.
  if (roundsRun && qa.mode === "structural") qa.mode = method0;
  logQa(name, qa);
  const method: PolishInfo["method"] = qa.mode === "vision" || qa.mode === "html" ? qa.mode : "skipped";
  return {
    sections: best.sections,
    polish: {
      method,
      notes: best.notes,
      reason: roundsRun === 0 ? "Out of time for this step, or the checker did not answer." : undefined,
      qa,
    },
  };
}
