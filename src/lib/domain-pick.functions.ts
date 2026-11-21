import { createServerFn } from "@tanstack/react-start";
import type { DomainItem } from "@/lib/domain-ideas";
import type { DomainPickResult } from "@/lib/domain-pick.server";

/**
 * Round 11 — server functions for the "Pick your domain" pop-up. Read-only: they suggest and check names; nothing
 * is ever registered, reserved or bought here (that happens at checkout). The Webhero token stays on the server.
 */
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max) : "");

function readInput(input: Record<string, unknown>) {
  const brief = (input?.brief ?? {}) as Record<string, unknown>;
  const exclude = (Array.isArray(input?.exclude) ? input.exclude : [])
    .map((d) => str(d, 80).toLowerCase())
    .filter((d) => /^[a-z0-9-]+\.[a-z]{2,24}$/.test(d))
    .slice(-120);
  const attempt = Number(input?.attempt);
  return {
    brief: { business_name: str(brief.business_name, 80), what: str(brief.what, 400), location: str(brief.location, 80), style: str(brief.style, 200) },
    exclude,
    attempt: Number.isFinite(attempt) ? Math.max(0, Math.min(50, Math.floor(attempt))) : 0,
    text: str(input?.text, 120),
  };
}

export const domainIdeas = createServerFn({ method: "POST" })
  .validator((input: Record<string, unknown>) => readInput(input))
  .handler(async ({ data }): Promise<DomainPickResult> => {
    (await import("./env.server")).logKeyPresenceOnce();
    const { pickDomains } = await import("./domain-pick.server");
    return pickDomains(data.brief, data.exclude, data.attempt);
  });

export const domainCheckTyped = createServerFn({ method: "POST" })
  .validator((input: Record<string, unknown>) => readInput(input))
  .handler(async ({ data }): Promise<({ typed: DomainItem | null } & Extract<DomainPickResult, { ok: true }>) | { ok: false; error: string }> => {
    (await import("./env.server")).logKeyPresenceOnce();
    const { checkTyped } = await import("./domain-pick.server");
    return checkTyped(data.text, data.brief, data.exclude);
  });
