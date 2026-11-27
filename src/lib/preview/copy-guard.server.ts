/**
 * Round 15c — server wrapper around the denylist guard, plus a model check
 * for double entendres the list might miss (food / healthcare, or a denylist hit).
 */
import { aiAvailable, chatJson, isMockMode } from "@/lib/ai-provider.server";
import {
  findUnfortunatePhrasing,
  guardHtmlCopy,
  guardSections,
  isFoodSite,
  isHealthSite,
  logCopyGuard,
  type GuardFacts,
  type GuardRewrite,
  type GuardedSection,
} from "@/lib/preview/copy-guard";

export async function guardCopyWithModel<T extends GuardedSection>(
  sections: T[],
  facts: GuardFacts | undefined,
  lookName: string,
  opts: { ai?: boolean; budgetMs?: number } = {},
): Promise<{ sections: T[]; rewrites: GuardRewrite[] }> {
  const first = guardSections(sections, facts, lookName);
  if (first.rewrites.length) logCopyGuard(lookName, first.rewrites, "denylist");
  const wantModel =
    opts.ai !== false &&
    !isMockMode() &&
    aiAvailable() &&
    (opts.budgetMs ?? 12_000) >= 8_000 &&
    (first.rewrites.length > 0 || isFoodSite(facts) || isHealthSite(facts));
  if (!wantModel) return first;

  const lines = first.sections
    .flatMap((s, i) => [
      s.heading ? { i, field: "heading" as const, text: s.heading } : undefined,
      s.text ? { i, field: "text" as const, text: s.text } : undefined,
    ])
    .filter((x): x is { i: number; field: "heading" | "text"; text: string } => Boolean(x));
  if (!lines.length) return first;
  try {
    const raw = await chatJson<{ rewrites?: { from?: unknown; to?: unknown; reason?: unknown }[] }>({
      temperature: 0,
      maxTokens: 800,
      timeoutMs: Math.min(8_000, Math.max(4_000, (opts.budgetMs ?? 8_000) - 500)),
      retry: false,
      reasoningEffort: "low",
      messages: [
        {
          role: "system",
          content:
            `You check homepage copy for double entendres and off-putting wording, especially around food, smell, or the body (linger/gas/moist/aftertaste, bathroom words, “to die for” in healthcare). If a line could be read that way, rewrite it so the meaning stays and the off reading is gone. Return ONLY JSON: {"rewrites":[{"from":"exact current line","to":"safer line","reason":"short"}]}. If everything is fine, {"rewrites":[]}.`,
        },
        { role: "user", content: JSON.stringify({ look: lookName, facts: { name: facts?.name, industry: facts?.industry }, lines: lines.map((l) => l.text) }) },
      ],
    });
    const model: GuardRewrite[] = [];
    let next = first.sections;
    for (const r of raw.rewrites ?? []) {
      const from = typeof r.from === "string" ? r.from.trim() : "";
      const to = typeof r.to === "string" ? r.to.replace(/\s+/g, " ").trim() : "";
      if (!from || !to || from === to) continue;
      next = next.map((s) => ({
        ...s,
        heading: s.heading === from ? to : s.heading,
        text: s.text === from ? to : s.text,
      }));
      model.push({ from, to, reason: typeof r.reason === "string" ? r.reason : "model" });
    }
    if (model.length) logCopyGuard(lookName, model, "model");
    // Denylist wins if the model introduced a new hit.
    const cleaned = guardSections(next, facts, lookName);
    if (cleaned.rewrites.length) logCopyGuard(lookName, cleaned.rewrites, "denylist");
    return { sections: cleaned.sections, rewrites: [...first.rewrites, ...model, ...cleaned.rewrites] };
  } catch (error) {
    console.warn(`[copy-guard] “${lookName}” model check failed`, error instanceof Error ? error.message.slice(0, 120) : "");
    return first;
  }
}

export function applyHtmlCopyGuard(html: string, facts: GuardFacts | undefined, lookName: string): string {
  const { html: next, rewrites } = guardHtmlCopy(html, facts);
  if (rewrites.length) logCopyGuard(lookName, rewrites, "denylist");
  return next;
}

export function phrasingMisses(text: string, facts?: GuardFacts): string[] {
  return findUnfortunatePhrasing(text, facts).map((h) => `unfortunate phrasing: “${h.excerpt}” (${h.reason})`);
}
