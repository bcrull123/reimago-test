/**
 * Round 11 — pure helpers for the "Pick your domain" pop-up (no I/O, shared by the server and tests).
 * Nothing here registers or buys anything: a chosen domain is only recorded and sent with the lead
 * (`chosen_domain`, `domain_status=selected_not_registered`); it is reserved at checkout later.
 */
export type DomainState = "available" | "taken" | "premium" | "unknown";
export type DomainItem = { domain: string; state: DomainState };

export const SELECTED_NOT_REGISTERED = "selected_not_registered";

export type BusinessBrief = { business_name: string; what: string; location: string; style: string };

/** A name made of letters, digits and single hyphens, 2..40 chars. */
export function cleanLabel(raw: unknown): string {
  const text = String(raw ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return text.length >= 2 && text.length <= 40 ? text : "";
}

/** "Brightkettle.COM" -> {label, tld}; undefined unless it is one label + one simple ending. */
export function splitDomain(raw: unknown): { label: string; tld: string } | undefined {
  const m = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.([a-z]{2,24})$/.exec(String(raw ?? "").trim().toLowerCase());
  return m ? { label: m[1]!, tld: m[2]! } : undefined;
}

export type TypedDomain =
  | { kind: "ok"; domain: string; added: boolean }
  | { kind: "unsupported"; domain: string; tld: string; suggestion: string }
  | { kind: "error"; error: string };

/**
 * What the owner typed in "Have one in mind?": a bare name gets the first allowed ending (.com); a name with an
 * ending that is not in the allowed list is "not offered yet" with the .com version suggested.
 */
export function readTypedDomain(input: string, tlds: readonly string[]): TypedDomain {
  let host = String(input ?? "").trim().toLowerCase();
  if (!host) return { kind: "error", error: "Type the name you have in mind, like northlineplumbing or northline.com." };
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^[^@/]*@/, "").replace(/[/?#].*$/, "").replace(/:\d*$/, "").replace(/\.+$/, "").replace(/^www\./, "");
  if (/\s/.test(host)) {
    // "north line plumbing" -> northlineplumbing
    host = host.replace(/\s+/g, "");
  }
  if (host.length > 253) return { kind: "error", error: "That name is too long." };
  const first = tlds[0] ?? "com";
  const parts = host.split(".");
  if (parts.some((p) => !p) ) return { kind: "error", error: "That name has an empty part (two dots in a row)." };
  const labelOf = (p: string) => (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(p) && p.length <= 63 ? p : "");
  if (parts.length === 1) {
    const label = labelOf(parts[0]!);
    if (!label) return { kind: "error", error: "Use only letters, numbers and hyphens (not at the start or end)." };
    return { kind: "ok", domain: `${label}.${first}`, added: true };
  }
  const tld = parts.at(-1)!;
  const label = labelOf(parts.at(-2)!);
  if (!label || !/^[a-z]{2,24}$/.test(tld)) return { kind: "error", error: "Use only letters, numbers and hyphens, and a real ending like .com." };
  if (!tlds.includes(tld)) return { kind: "unsupported", domain: `${label}.${tld}`, tld, suggestion: `${label}.${first}` };
  return { kind: "ok", domain: `${label}.${tld}`, added: false };
}

/** AI (or fallback) candidates -> unique valid domains in the allowed endings, never one already shown. */
export function cleanIdeas(raw: unknown, tlds: readonly string[], exclude: Iterable<string> = [], max = 16): string[] {
  const seen = new Set<string>([...exclude].map((d) => String(d).toLowerCase()));
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const item of list) {
    let label = "";
    let tld = tlds[0] ?? "com";
    if (typeof item === "string") {
      const parts = splitDomain(item.trim().toLowerCase());
      label = cleanLabel(parts ? parts.label : item);
      if (parts) tld = parts.tld;
    } else if (item && typeof item === "object") {
      const row = item as { name?: unknown; domain?: unknown; tld?: unknown };
      const parts = splitDomain(row.domain);
      label = cleanLabel(parts ? parts.label : row.name);
      const t = String(parts ? parts.tld : (row.tld ?? "")).toLowerCase().replace(/^\./, "");
      if (t) tld = t;
    }
    if (!label || !tlds.includes(tld)) continue;
    const domain = `${label}.${tld}`;
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
    if (out.length >= max) break;
  }
  return out;
}

const STOP = new Set(["the", "and", "of", "a", "an", "llc", "inc", "co", "company", "corp", "ltd", "group"]);

/** Letters-only slug of the business name ("Riverside Plumbing Co." -> riversideplumbing). */
export function nameSlug(name: string, max = 22): string {
  const words = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
  return cleanLabel(words.join("").slice(0, max));
}

function placeWord(location: string): string {
  const first = location.split(",")[0]?.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 2).join("") ?? "";
  return cleanLabel(first.slice(0, 14));
}

/**
 * Name-based ideas with no AI (PREVIEW_MOCK=1, or the AI is unavailable): deterministic, rotating by `attempt`
 * so "Try again" gives different ones. Mixes endings from the allowed list, first ending most.
 */
export function fallbackIdeas(brief: BusinessBrief, attempt: number, tlds: readonly string[], exclude: Iterable<string> = [], count = 14): string[] {
  const slug = nameSlug(brief.business_name) || "mybusiness";
  const first = (brief.business_name.toLowerCase().match(/[a-z0-9]+/g) ?? []).find((w) => !STOP.has(w)) ?? slug;
  const kind = (brief.what.toLowerCase().match(/[a-z]{4,}/g) ?? []).find((w) => !STOP.has(w) && !["that", "with", "from", "this", "homeowners", "customers"].includes(w)) ?? "";
  const place = placeWord(brief.location);
  const bases = [
    slug,
    `get${slug}`,
    `${slug}hq`,
    `try${first}`,
    `${first}${place || "local"}`,
    `${slug}online`,
    `${first}${kind}`,
    `the${slug}`,
    `${first}and${kind || "co"}`,
    `${slug}now`,
    `my${slug}`,
    `${first}works`,
    `${first}studio`,
    `${slug}pro`,
    `${first}nest`,
    `${first}hub`,
    `${slug}team`,
    `go${first}`,
    `${first}house`,
    `${first}labs`,
    `${place || first}${kind || "pros"}`,
    `${first}${slug.length % 2 ? "ly" : "ify"}`,
  ];
  const rotated = bases.map((_, i) => bases[(i + attempt * 5) % bases.length]!);
  // Even positions get the first (preferred) ending, odd ones rotate through the rest.
  const items = rotated.map((base, i) => ({ name: base, tld: i % 2 === 0 ? (tlds[0] ?? "com") : (tlds[(i + attempt) % Math.max(1, tlds.length)] ?? "com") }));
  return cleanIdeas(items, tlds, exclude, count);
}

/** Order for display: available first (first-listed ending first within the same name order), then the rest. */
export function sortItems(items: DomainItem[], tlds: readonly string[]): DomainItem[] {
  const rank = (s: DomainState) => (s === "available" ? 0 : s === "unknown" ? 1 : 2);
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item.state) - rank(b.item.state) || (splitDomain(a.item.domain) ? tlds.indexOf(splitDomain(a.item.domain)!.tld) : 9) - (splitDomain(b.item.domain) ? tlds.indexOf(splitDomain(b.item.domain)!.tld) : 9) || a.i - b.i)
    .map((x) => x.item);
}
