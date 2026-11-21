/**
 * Round 12 — leads: the pure shapes and helpers shared by the browser, the server and the tests.
 * One lead = one visit to the form. Every "Choose this look" from the same visit is a pick on that one lead.
 */
export const LEAD_STATUSES = ["new", "contacted", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadMode = "reimagine" | "new_site";

export type LeadPick = {
  look_id: string;
  look: string;
  preview_url: string;
  pages: string[];
  picked_at: string;
  /** Formcarry's HTTP status for this pick's submission ("" = not reported yet; "failed" = no answer). */
  formcarry_status: string;
  /** Reply webhook (Email Bot) outcome for this pick ("" = not reported; "sent" / "failed 500" / "skipped"). */
  webhook_status: string;
};

export type LeadLook = { look_id: string; name: string; url: string };
export type LeadNote = { at: string; text: string };

export type Lead = {
  id: string;
  created_at: string;
  updated_at: string;
  mode: LeadMode;
  name: string;
  email: string;
  phone: string;
  /** Reimagine: the site address. New site: the business name. */
  source: string;
  what: string;
  location: string;
  style: string;
  domain_choice: string;
  chosen_domain: string;
  domain_status: string;
  logo_source: string;
  logo_url: string;
  change_requests: string[];
  looks: LeadLook[];
  picks: LeadPick[];
  extras: Record<string, string>;
  attribution: Record<string, string>;
  user_agent: string;
  country: string;
  formcarry_status: string;
  webhook_status: string;
  lead_status: LeadStatus;
  notes: LeadNote[];
};

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, " ").trim().slice(0, max) : "");
/** Only http(s) links (or this site's own /made/… paths) are kept: they are shown as links in the admin panel. */
export const safeUrl = (v: unknown): string => {
  const s = str(v, 600);
  return /^(https?:\/\/|\/made\/)[^\s<>"']+$/i.test(s) ? s : "";
};
const list = (v: unknown, n: number, each: number): string[] => (Array.isArray(v) ? v.map((x) => str(x, each)).filter(Boolean).slice(0, n) : []);
const record = (v: unknown, n: number, keyOk: RegExp, each: number): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (!keyOk.test(k) || Object.keys(out).length >= n) continue;
      const s = Array.isArray(val) ? val.map((x) => str(x, 300)).filter(Boolean).join("\n").slice(0, each) : str(val, each);
      if (s) out[k] = s;
    }
  }
  return out;
};

export type LeadInput = Pick<Lead, "id" | "mode" | "name" | "email" | "phone" | "source" | "what" | "location" | "style" | "domain_choice" | "chosen_domain" | "domain_status" | "logo_source" | "logo_url" | "change_requests" | "looks" | "extras" | "attribution"> & { pick: LeadPick };

export function newLeadId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whatever the browser sent -> a clean, size-limited LeadInput (never trusts a field). */
export function cleanLeadInput(raw: unknown): LeadInput {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = /^[a-f0-9]{24}$/.test(str(r.id, 40)) ? str(r.id, 40) : newLeadId();
  const pickRaw = (r.pick && typeof r.pick === "object" ? r.pick : {}) as Record<string, unknown>;
  const mode: LeadMode = r.mode === "new_site" ? "new_site" : "reimagine";
  const email = str(r.email, 200).toLowerCase();
  const chosenDomain = /^[a-z0-9-]+\.[a-z]{2,24}$/.test(str(r.chosen_domain, 80).toLowerCase()) ? str(r.chosen_domain, 80).toLowerCase() : "";
  return {
    id,
    mode,
    name: str(r.name, 120),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    phone: str(r.phone, 40),
    source: str(r.source, 300),
    what: str(r.what, 600),
    location: str(r.location, 120),
    style: str(r.style, 400),
    domain_choice: str(r.domain_choice, 40),
    chosen_domain: chosenDomain,
    domain_status: ["selected_not_registered", "not_selected", "owned"].includes(str(r.domain_status, 40)) ? str(r.domain_status, 40) : "",
    logo_source: ["upload", "ai"].includes(str(r.logo_source, 10)) ? str(r.logo_source, 10) : "",
    logo_url: safeUrl(r.logo_url),
    change_requests: list(r.change_requests, 6, 400),
    looks: (Array.isArray(r.looks) ? r.looks : [])
      .slice(0, 6)
      .map((l) => {
        const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
        return { look_id: /^[a-f0-9]{16}$/.test(str(o.look_id, 20)) ? str(o.look_id, 20) : "", name: str(o.name, 80), url: safeUrl(o.url) };
      })
      .filter((l) => l.name),
    extras: record(r.extras, 30, /^[a-z0-9_]{1,40}$/, 1500),
    attribution: record(r.attribution, 12, /^[a-z0-9_]{1,30}$/, 300),
    pick: {
      look_id: /^[a-f0-9]{16}$/.test(str(pickRaw.look_id, 20)) ? str(pickRaw.look_id, 20) : "",
      look: str(pickRaw.look, 120),
      preview_url: safeUrl(pickRaw.preview_url),
      pages: list(pickRaw.pages, 14, 300),
      picked_at: new Date().toISOString(),
      formcarry_status: "",
      webhook_status: "",
    },
  };
}

/** Add a pick, or replace the one for the same look (a re-send); newest last. */
export function mergePicks(existing: LeadPick[], next: LeadPick): LeadPick[] {
  const i = existing.findIndex((p) => p.look_id && p.look_id === next.look_id);
  if (i < 0) return [...existing, next];
  const copy = existing.slice();
  copy[i] = { ...next, picked_at: existing[i]!.picked_at, formcarry_status: next.formcarry_status || existing[i]!.formcarry_status, webhook_status: next.webhook_status || existing[i]!.webhook_status };
  return copy;
}

/** The leads list's "picked looks" cell: "Dark Premium, Editorial". */
export const pickNames = (lead: Pick<Lead, "picks">): string => [...new Set(lead.picks.map((p) => p.look).filter(Boolean))].join(", ");

export type LeadFilters = { q?: string; mode?: string; status?: string; from?: string; to?: string; limit?: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function cleanFilters(raw: Record<string, unknown>): Required<Pick<LeadFilters, "q" | "mode" | "status" | "from" | "to">> & { limit: number } {
  const get = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string).trim() : "");
  const limit = Number(raw.limit);
  return {
    q: get("q").slice(0, 100),
    mode: get("mode") === "new_site" || get("mode") === "reimagine" ? get("mode") : "",
    status: (LEAD_STATUSES as readonly string[]).includes(get("status")) ? get("status") : "",
    from: DATE_RE.test(get("from")) ? get("from") : "",
    to: DATE_RE.test(get("to")) ? get("to") : "",
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(2000, Math.floor(limit))) : 500,
  };
}

// ----------------------------------------------------------------------------------------------- CSV

/** Excel/Sheets run a cell that starts with = + - @ as a formula: prefix those with an apostrophe. */
export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const TZ = "America/Chicago";
export function chicagoTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}
/** Table cells: "Nov 20, 8:32 PM" (the year only when it is not this year). */
export function chicagoShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const year = (x: Date) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric" }).format(x);
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...(year(d) === year(new Date()) ? {} : { year: "numeric" }), month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}
function chicagoIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

export const CSV_COLUMNS = ["id", "created_at_chicago", "mode", "status", "name", "email", "phone", "site_or_business", "what", "location", "style", "picked_looks", "preview_urls", "all_looks", "change_requests", "chosen_domain", "domain_status", "domain_choice", "logo_source", "logo_url", "formcarry", "reply_webhook", "utm_source", "utm_medium", "utm_campaign", "ref", "country", "notes", "extras"] as const;

export function leadsToCsv(leads: Lead[]): string {
  const rows = leads.map((l) => [
    l.id,
    chicagoIso(l.created_at),
    l.mode,
    l.lead_status,
    l.name,
    l.email,
    l.phone,
    l.source,
    l.what,
    l.location,
    l.style,
    pickNames(l),
    l.picks.map((p) => p.preview_url).filter(Boolean).join(" "),
    l.looks.map((x) => `${x.name}: ${x.url}`).join(" | "),
    l.change_requests.map((c, i) => `${i + 1}. ${c}`).join(" | "),
    l.chosen_domain,
    l.domain_status,
    l.domain_choice,
    l.logo_source,
    l.logo_url,
    l.formcarry_status,
    l.webhook_status,
    l.attribution.utm_source ?? "",
    l.attribution.utm_medium ?? "",
    l.attribution.utm_campaign ?? "",
    l.attribution.ref ?? "",
    l.country,
    l.notes.map((n) => `${chicagoIso(n.at)} ${n.text}`).join(" | "),
    Object.entries(l.extras).map(([k, v]) => `${k}: ${v.replace(/\s*\n\s*/g, "; ")}`).join(" | "),
  ]);
  return "\uFEFF" + [CSV_COLUMNS.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}
