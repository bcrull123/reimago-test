/**
 * Round 11 — "Pick your domain" (New Site + "Get me a domain, email & hosting").
 *
 *   AI (Grok) ideas  ->  availability through the Webhero/LogicBoxes proxy (logicboxes.server.ts)  ->  the pop-up.
 *
 * READ-ONLY. Nothing here registers, reserves or buys a domain: the owner's pick is only recorded and sent with
 * the lead (`chosen_domain`, `domain_status=selected_not_registered`); the Webhero cart registers it at checkout.
 * Only endings in the allowed list (domain-config.ts / env DOMAIN_TLDS) are ever suggested or checked.
 * Log lines are `[domain] …` (counts, status codes, timing; never a key or the token).
 */
import { env } from "@/lib/env.server";
import { parseTldList } from "@/lib/domain-config";
import {
  cleanIdeas,
  fallbackIdeas,
  readTypedDomain,
  sortItems,
  splitDomain,
  type BusinessBrief,
  type DomainItem,
  type DomainState,
} from "@/lib/domain-ideas";

export function allowedTlds(): string[] {
  return parseTldList(env("DOMAIN_TLDS"));
}

export type DomainPickResult =
  | {
      ok: true;
      items: DomainItem[];
      tlds: string[];
      /** True when availability could not be checked (the pop-up says so). `reason` is the plain cause. */
      unchecked: boolean;
      reason: string;
      source: "ai" | "names";
      /** PREVIEW_MOCK=1 stand-in availability (never on the published app). */
      mock: boolean;
      note: string;
    }
  | { ok: false; error: string };

const mockMode = () => env("PREVIEW_MOCK") === "1";

/** Deterministic stand-in availability for PREVIEW_MOCK=1: about one in three is taken; known names are taken. */
export function mockState(domain: string): DomainState {
  const parts = splitDomain(domain);
  if (!parts) return "unknown";
  if (/(taken|google|example|amazon|reimago|webhero)$/.test(parts.label)) return "taken";
  let h = 0;
  for (const ch of domain) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 3 === 0 ? "taken" : "available";
}

/** Availability for these domains. Never throws: an unreachable check comes back as unchecked + reason. */
async function availability(domains: string[]): Promise<{ items: DomainItem[]; unchecked: boolean; reason: string; mock: boolean }> {
  if (!domains.length) return { items: [], unchecked: false, reason: "", mock: false };
  // PREVIEW_DOMAIN_MOCK=live (tests only) sends mock-mode availability through the real proxy code path.
  if (mockMode() && env("PREVIEW_DOMAIN_MOCK") !== "live") {
    if (env("PREVIEW_DOMAIN_MOCK") === "unavailable") {
      console.info("[domain] check unavailable: mock (PREVIEW_DOMAIN_MOCK=unavailable)");
      return { items: domains.map((domain) => ({ domain, state: "unknown" as const })), unchecked: true, reason: "mock: unavailable", mock: true };
    }
    const delay = Number(env("PREVIEW_DOMAIN_DELAY_MS")) || 0; // tests only: lets the screenshot catch the progress ring
    if (delay > 0) await new Promise((r) => setTimeout(r, Math.min(delay, 10_000)));
    console.info(`[domain] mock check of ${domains.length} name(s) (PREVIEW_MOCK=1)`);
    return { items: domains.map((domain) => ({ domain, state: mockState(domain) })), unchecked: false, reason: "", mock: true };
  }
  try {
    const { checkDomainList } = await import("./logicboxes.server");
    const offers = await checkDomainList(domains);
    const byDomain = new Map(offers.map((o) => [o.domain, o.state]));
    return { items: domains.map((domain) => ({ domain, state: byDomain.get(domain) ?? "unknown" })), unchecked: false, reason: "", mock: false };
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "no answer").replace(/[\r\n]+/g, " ").slice(0, 160);
    console.warn(`[domain] check unavailable: ${reason}`);
    return { items: domains.map((domain) => ({ domain, state: "unknown" as const })), unchecked: true, reason, mock: false };
  }
}

/** Grok's creative, brandable ideas. Returns [] when the AI is not available or fails (the caller falls back). */
async function aiIdeas(brief: BusinessBrief, tlds: string[], exclude: string[], count: number, extra = ""): Promise<{ list: string[]; why: string }> {
  const { aiAvailable, chatJson } = await import("@/lib/ai-provider.server");
  if (mockMode() || !aiAvailable()) return { list: [], why: mockMode() ? "mock mode" : "AI key not set" };
  const t0 = Date.now();
  try {
    const raw = await chatJson<{ ideas?: unknown }>({
      timeoutMs: 20_000,
      temperature: 1,
      maxTokens: 900,
      messages: [
        {
          role: "system",
          content:
            `You invent short, memorable, brandable domain names for a small business. Return ONLY JSON: {"ideas":[{"name":"brightkettle","tld":"com"}, …]}. ` +
            `Give exactly ${count} ideas. "name" is just the part before the dot: lowercase letters and digits only (a hyphen only if it really helps), 4 to 14 characters, easy to say and spell, no spaces. ` +
            `Be creative: coined words, friendly compounds, a hint of what they do or where they are; some can use the business name, most should be fresh. ` +
            `"tld" must be one of: ${tlds.join(", ")}. Use "${tlds[0]}" for most (about 2 in 3) and spread the rest across the other endings. ` +
            `Never use a famous brand or trademark. Do not claim any name is available.${extra ? ` ${extra}` : ""}`,
        },
        {
          role: "user",
          content:
            `Business: ${brief.business_name || "(not given)"}\nWhat it does: ${brief.what || "(not given)"}\nArea: ${brief.location || "(not given)"}\nStyle: ${brief.style || "(not given)"}` +
            (exclude.length ? `\nAlready shown (do not repeat): ${exclude.slice(-60).join(", ")}` : ""),
        },
      ],
    });
    const list = cleanIdeas(raw.ideas, tlds, exclude, count + 4);
    console.info(`[domain] AI ideas: ${list.length} valid of ${Array.isArray(raw.ideas) ? raw.ideas.length : 0} in ${Date.now() - t0}ms`);
    return { list, why: "" };
  } catch (error) {
    const why = error instanceof Error ? error.message.slice(0, 100) : "failed";
    console.warn(`[domain] AI ideas failed after ${Date.now() - t0}ms: ${why}`);
    return { list: [], why };
  }
}

async function ideasFor(brief: BusinessBrief, tlds: string[], exclude: string[], attempt: number, count: number, extra = ""): Promise<{ list: string[]; source: "ai" | "names" }> {
  const ai = await aiIdeas(brief, tlds, exclude, count, extra);
  let list = ai.list;
  let source: "ai" | "names" = "ai";
  if (list.length < Math.min(6, count)) {
    // Top up (or replace) with name-based ideas so the pop-up is never empty.
    const more = fallbackIdeas(brief, attempt, tlds, [...exclude, ...list], count);
    console.info(`[domain] ideas: ${list.length} from AI${ai.why ? ` (${ai.why})` : ""} + ${more.length} name-based`);
    list = [...list, ...more];
    if (!ai.list.length) source = "names";
  }
  return { list: list.slice(0, count + 4), source };
}

/** The pop-up's first batch / "Try again": ~12-14 ideas, checked in one call. `exclude` = everything already shown. */
export async function pickDomains(brief: BusinessBrief, exclude: string[], attempt: number): Promise<DomainPickResult> {
  const tlds = allowedTlds();
  const t0 = Date.now();
  const { list, source } = await ideasFor(brief, tlds, exclude, attempt, 14);
  if (!list.length) return { ok: false, error: "No domain ideas could be made this time. Try again, or type one you have in mind." };
  const checked = await availability(list);
  const items = sortItems(checked.items, tlds);
  console.info(`[domain] batch ${attempt}: ${items.length} ideas (${source}), ${items.filter((i) => i.state === "available").length} available, ${Date.now() - t0}ms total`);
  return {
    ok: true,
    items,
    tlds,
    unchecked: checked.unchecked,
    reason: checked.reason,
    source,
    mock: checked.mock,
    note: "",
  };
}

/**
 * "Have one in mind? Type it": a bare name gets the first allowed ending; an ending that is not live yet is
 * "not offered yet" with the first-ending version checked instead; a taken name gets close AI variants.
 */
export async function checkTyped(
  text: string,
  brief: BusinessBrief,
  exclude: string[],
): Promise<(DomainPickResult & { ok: true; typed: DomainItem | null }) | { ok: false; error: string }> {
  const tlds = allowedTlds();
  const typed = readTypedDomain(text, tlds);
  if (typed.kind === "error") return { ok: false, error: typed.error };
  const t0 = Date.now();
  const target = typed.kind === "ok" ? typed.domain : typed.suggestion;
  const first = await availability([target]);
  const main: DomainItem = first.items[0]!;
  let variants: DomainItem[] = [];
  let unchecked = first.unchecked;
  let reason = first.reason;
  let mock = first.mock;
  let note = "";
  if (typed.kind === "unsupported") note = `.${typed.tld} isn't offered yet. Here's the .${tlds[0]} version.`;
  else if (typed.added) note = `We added .${tlds[0]}.`;
  if (!first.unchecked && main.state !== "available") {
    // Taken (or premium): offer close variants of the same name.
    const label = splitDomain(target)!.label;
    const { list } = await ideasFor({ ...brief, business_name: label }, tlds, [...exclude, target], 1, 8, `The owner wants "${label}" but it is taken: suggest close variations of "${label}" (add a short word, change an ending, blend it with the business).`);
    const checked = await availability(list.slice(0, 8));
    unchecked = checked.unchecked;
    reason = checked.reason || reason;
    mock = mock || checked.mock;
    variants = sortItems(checked.items, tlds);
    console.info(`[domain] typed "${target}" is ${main.state}; ${variants.filter((v) => v.state === "available").length} of ${variants.length} close variants available`);
  } else {
    console.info(`[domain] typed "${target}" is ${first.unchecked ? "unchecked" : main.state}`);
  }
  console.info(`[domain] typed check done in ${Date.now() - t0}ms`);
  return { ok: true, typed: main, items: variants, tlds, unchecked, reason, source: "ai", mock, note };
}
