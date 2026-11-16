import { env } from "@/lib/env.server";
import type { DomainCheck, DomainOffer, DomainState } from "@/lib/logicboxes-types";

export type { DomainOffer };

const TLD_ORDER = ["com", "net", "org", "us", "info", "biz", "co", "io"] as const;
const DEFAULT_PROXY = "https://secure.webhero.com/api/logicboxes.php";

type ProxyBody = {
  ok?: boolean;
  status?: number;
  data?: unknown;
  error?: string;
};

export function secondLevel(input: string): string | null {
  let host = input.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, "");
  host = host.replace(/[/?#].*$/, "");
  host = host.replace(/:\d+$/, "");
  host = host.replace(/^www\./, "");
  if (!host || host.includes("..") || host.startsWith("-") || host.endsWith("-")) return null;
  const label = host.split(".")[0] ?? "";
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return null;
  return label;
}

export function classifyOffer(domain: string, value: unknown): DomainOffer {
  if (typeof value === "string") {
    const status = value.toLowerCase();
    if (status === "available") return { domain, state: "available" };
    if (status === "regthroughus" || status === "regthroughothers") return { domain, state: "taken" };
    return { domain, state: "unknown" };
  }
  if (!value || typeof value !== "object") return { domain, state: "unknown" };
  const row = value as { status?: unknown; costHash?: unknown };
  const status = typeof row.status === "string" ? row.status.toLowerCase() : "";
  if (status === "available" && row.costHash != null && typeof row.costHash === "object") {
    return { domain, state: "premium" };
  }
  if (status === "available") return { domain, state: "available" };
  if (status === "regthroughus" || status === "regthroughothers") return { domain, state: "taken" };
  return { domain, state: "unknown" };
}

function offersFromData(name: string, data: unknown): DomainOffer[] {
  const rows = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return TLD_ORDER.map((tld) => {
    const domain = `${name}.${tld}`;
    return classifyOffer(domain, rows[domain]);
  });
}

async function callProxy(token: string, params: Record<string, string[]>, attempts = 3, timeoutMs = 20000): Promise<unknown> {
  const url = env("LOGICBOXES_PROXY_URL") || DEFAULT_PROXY;
  let lastError = "The domain check did not answer.";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-API-Key": token,
        },
        body: JSON.stringify({
          env: "live",
          method: "GET",
          endpoint: "domains/available.json",
          params,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = (await response.json().catch(() => null)) as ProxyBody | null;
      if (response.status === 401) throw new Error("The domain check was refused.");
      if (response.status === 403) throw new Error("That domain check is not allowed.");
      if (response.status === 400) throw new Error("The domain check was rejected.");
      if (!response.ok || !json) {
        lastError = "The domain check did not answer.";
        continue;
      }
      const data = json.data;
      if (data && typeof data === "object" && "status" in data && (data as { status?: unknown }).status === "ERROR") {
        throw new Error("The registrar could not check that name.");
      }
      return data;
    } catch (error) {
      if (error instanceof Error && /refused|not allowed|rejected|could not check/.test(error.message)) throw error;
      lastError = "The domain check did not answer.";
    }
  }
  throw new Error(lastError);
}

function proxyToken(): string | undefined {
  const names = ["Onesite_Domains_API", "ONESITE_DOMAINS_API", "LOGICBOXES_PROXY_TOKEN"];
  for (const name of names) {
    const value = env(name);
    if (value) return value;
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (/onesite/i.test(name) && /domain/i.test(name) && value?.trim()) return value.trim();
  }
  return undefined;
}

function sampleCheck(name: string, note: string): DomainCheck {
  const sample: DomainState[] = ["taken", "available", "premium", "available", "taken", "available", "unknown", "available"];
  return {
    sample: true,
    note,
    offers: TLD_ORDER.map((tld, index) => ({ domain: `${name}.${tld}`, state: sample[index] ?? "unknown" })),
  };
}

/**
 * Availability for name.com/.net/... through the LogicBoxes proxy. Read-only: this never registers anything.
 * With `degrade` (the Create a New Site wizard), an unreachable proxy or PREVIEW_MOCK=1 returns a clearly
 * labelled sample instead of an error, after one quick attempt, so the wizard is never blocked.
 */
export async function checkDomainAvailability(raw: string, options: { degrade?: boolean } = {}): Promise<DomainCheck> {
  const name = secondLevel(raw);
  if (!name) throw new Error("Enter a domain name, like northline.com.");
  if (options.degrade && env("PREVIEW_MOCK") === "1") return sampleCheck(name, "Mock mode (PREVIEW_MOCK=1): this is a sample, not a live check.");
  const token = proxyToken();
  if (!token) return sampleCheck(name, "The token is not set. This is a sample, not a live check.");
  const params = { "domain-name": TLD_ORDER.map(() => name), tlds: [...TLD_ORDER] };
  if (!options.degrade) return { sample: false, note: "", offers: offersFromData(name, await callProxy(token, params)) };
  try {
    return { sample: false, note: "", offers: offersFromData(name, await callProxy(token, params, 2, 8000)) };
  } catch (error) {
    const why = error instanceof Error ? error.message : "The domain check did not answer.";
    return sampleCheck(name, `${why} This is a sample, not a live check — availability is confirmed at checkout.`);
  }
}
