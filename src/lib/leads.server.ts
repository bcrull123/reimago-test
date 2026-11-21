/**
 * Round 12 — lead storage. Every "Choose this look" send is saved here (server-side) BEFORE Formcarry is called, so a
 * lead is never lost if Formcarry or the Email Bot webhook fails; both outcomes are recorded afterwards.
 *
 * Storage: the app's Postgres through `getSql()` — Neon when DATABASE_URL is set (the platform injects it on
 * deploy, so leads survive republishes), else the embedded PGLite (in memory: the live preview / local tests only).
 * The table is created on first use (same pattern as preview_sites / render_times). No other service, no new secret.
 */
import { env } from "@/lib/env.server";
import { cleanFilters, mergePicks, type Lead, type LeadFilters, type LeadInput, type LeadMode, type LeadNote, type LeadPick, type LeadStatus, LEAD_STATUSES } from "@/lib/leads";

export const hasDurableStore = () => Boolean(env("DATABASE_URL"));

let ready: Promise<void> | null = null;
async function table() {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  ready ??= (async () => {
    await sql.query(`create table if not exists leads (
      id text primary key,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      mode text not null,
      name text not null default '',
      email text not null default '',
      phone text not null default '',
      source text not null default '',
      what text not null default '',
      location text not null default '',
      style text not null default '',
      domain_choice text not null default '',
      chosen_domain text not null default '',
      domain_status text not null default '',
      logo_source text not null default '',
      logo_url text not null default '',
      change_requests jsonb not null default '[]'::jsonb,
      looks jsonb not null default '[]'::jsonb,
      picks jsonb not null default '[]'::jsonb,
      extras jsonb not null default '{}'::jsonb,
      attribution jsonb not null default '{}'::jsonb,
      user_agent text not null default '',
      country text not null default '',
      formcarry_status text not null default '',
      webhook_status text not null default '',
      lead_status text not null default 'new',
      notes jsonb not null default '[]'::jsonb
    )`);
    await sql.query("create index if not exists leads_created_idx on leads (created_at desc)");
  })().catch((error) => {
    ready = null;
    throw error;
  });
  await ready;
  return sql;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : typeof v === "string" ? new Date(v).toISOString() : "");
const json = <T,>(v: unknown, fallback: T): T => {
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return (v ?? fallback) as T;
};

function toLead(row: Record<string, unknown>): Lead {
  const s = (k: string) => String(row[k] ?? "");
  return {
    id: s("id"),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    mode: (s("mode") === "new_site" ? "new_site" : "reimagine") as LeadMode,
    name: s("name"),
    email: s("email"),
    phone: s("phone"),
    source: s("source"),
    what: s("what"),
    location: s("location"),
    style: s("style"),
    domain_choice: s("domain_choice"),
    chosen_domain: s("chosen_domain"),
    domain_status: s("domain_status"),
    logo_source: s("logo_source"),
    logo_url: s("logo_url"),
    change_requests: json(row.change_requests, []),
    looks: json(row.looks, []),
    picks: json(row.picks, []),
    extras: json(row.extras, {}),
    attribution: json(row.attribution, {}),
    user_agent: s("user_agent"),
    country: s("country"),
    formcarry_status: s("formcarry_status"),
    webhook_status: s("webhook_status"),
    lead_status: ((LEAD_STATUSES as readonly string[]).includes(s("lead_status")) ? s("lead_status") : "new") as LeadStatus,
    notes: json(row.notes, []),
  };
}

/** Save (or merge into) the lead for this visit. Returns the stored lead's id and its number of picks. */
export async function saveLead(input: LeadInput, ctx: { userAgent: string; country: string }): Promise<{ id: string; picks: number; created: boolean }> {
  const sql = await table();
  const { pick, ...fields } = input;
  const rows = await sql.query<Record<string, unknown>>("select * from leads where id = $1", [fields.id]);
  const existing = rows[0] ? toLead(rows[0]) : undefined;
  const picks = pick.look_id || pick.look ? mergePicks(existing?.picks ?? [], pick) : (existing?.picks ?? []);
  // The newest answers win; a field the browser did not send this time keeps what the visit already had.
  const empty = (v: unknown) => !v || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);
  const keep = <K extends keyof Lead>(k: K, v: Lead[K]): Lead[K] => (empty(v) && existing && !empty(existing[k]) ? existing[k] : v);
  const merged = {
    mode: fields.mode,
    name: keep("name", fields.name),
    email: keep("email", fields.email),
    phone: keep("phone", fields.phone),
    source: keep("source", fields.source),
    what: keep("what", fields.what),
    location: keep("location", fields.location),
    style: keep("style", fields.style),
    domain_choice: keep("domain_choice", fields.domain_choice),
    chosen_domain: fields.domain_choice.startsWith("get") ? fields.chosen_domain : keep("chosen_domain", fields.chosen_domain),
    domain_status: keep("domain_status", fields.domain_status),
    logo_source: keep("logo_source", fields.logo_source),
    logo_url: keep("logo_url", fields.logo_url),
    change_requests: fields.change_requests,
    looks: keep("looks", fields.looks),
    extras: keep("extras", fields.extras),
    attribution: existing && Object.keys(existing.attribution).length ? existing.attribution : fields.attribution,
  };
  if (existing) {
    await sql.query(
      `update leads set updated_at = now(), mode=$2, name=$3, email=$4, phone=$5, source=$6, what=$7, location=$8, style=$9, domain_choice=$10, chosen_domain=$11, domain_status=$12,
        logo_source=$13, logo_url=$14, change_requests=$15::jsonb, looks=$16::jsonb, picks=$17::jsonb, extras=$18::jsonb, attribution=$19::jsonb where id=$1`,
      [fields.id, merged.mode, merged.name, merged.email, merged.phone, merged.source, merged.what, merged.location, merged.style, merged.domain_choice, merged.chosen_domain, merged.domain_status, merged.logo_source, merged.logo_url, JSON.stringify(merged.change_requests), JSON.stringify(merged.looks), JSON.stringify(picks), JSON.stringify(merged.extras), JSON.stringify(merged.attribution)],
    );
  } else {
    await sql.query(
      `insert into leads (id, mode, name, email, phone, source, what, location, style, domain_choice, chosen_domain, domain_status, logo_source, logo_url, change_requests, looks, picks, extras, attribution, user_agent, country)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20,$21)`,
      [fields.id, merged.mode, merged.name, merged.email, merged.phone, merged.source, merged.what, merged.location, merged.style, merged.domain_choice, merged.chosen_domain, merged.domain_status, merged.logo_source, merged.logo_url, JSON.stringify(merged.change_requests), JSON.stringify(merged.looks), JSON.stringify(picks), JSON.stringify(merged.extras), JSON.stringify(merged.attribution), ctx.userAgent.slice(0, 300), ctx.country.slice(0, 2).toUpperCase()],
    );
  }
  console.info(`[lead] saved ${fields.id} mode=${fields.mode} picks=${picks.length}${existing ? " (merged into the earlier lead from this visit)" : ""} store=${hasDurableStore() ? "postgres" : "memory"}`);
  return { id: fields.id, picks: picks.length, created: !existing };
}

/** Record how Formcarry / the reply webhook answered for one pick; the lead's headline status follows the newest. */
export async function recordDelivery(id: string, lookId: string, which: "formcarry" | "webhook", status: string): Promise<boolean> {
  const sql = await table();
  const rows = await sql.query<Record<string, unknown>>("select picks from leads where id = $1", [id]);
  if (!rows[0]) return false;
  const picks = json<LeadPick[]>(rows[0].picks, []);
  const i = picks.findIndex((p) => p.look_id === lookId);
  const target = i >= 0 ? i : picks.length - 1;
  if (target >= 0) picks[target] = { ...picks[target]!, [which === "formcarry" ? "formcarry_status" : "webhook_status"]: status };
  const column = which === "formcarry" ? "formcarry_status" : "webhook_status";
  await sql.query(`update leads set ${column} = $2, picks = $3::jsonb, updated_at = now() where id = $1`, [id, status, JSON.stringify(picks)]);
  console.info(`[lead] ${id} ${which}=${status}`);
  return true;
}

const LIST_COLUMNS = "*";
export async function listLeads(raw: LeadFilters & Record<string, unknown>): Promise<Lead[]> {
  const f = cleanFilters(raw);
  const sql = await table();
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace("?", `$${params.length}`));
  };
  if (f.mode) add("mode = ?", f.mode);
  if (f.status) add("lead_status = ?", f.status);
  if (f.from) add("(created_at at time zone 'America/Chicago')::date >= ?::date", f.from);
  if (f.to) add("(created_at at time zone 'America/Chicago')::date <= ?::date", f.to);
  if (f.q) {
    params.push(`%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    const p = `$${params.length}`;
    where.push(`(${["name", "email", "source", "what", "location", "chosen_domain", "phone", "picks::text", "extras::text", "notes::text"].map((c) => `${c} ilike ${p}`).join(" or ")})`);
  }
  const rows = await sql.query<Record<string, unknown>>(`select ${LIST_COLUMNS} from leads ${where.length ? `where ${where.join(" and ")}` : ""} order by created_at desc limit ${f.limit}`, params);
  return rows.map(toLead);
}

export async function getLead(id: string): Promise<Lead | undefined> {
  if (!/^[a-f0-9]{24}$/.test(id)) return undefined;
  const sql = await table();
  const rows = await sql.query<Record<string, unknown>>("select * from leads where id = $1", [id]);
  return rows[0] ? toLead(rows[0]) : undefined;
}

export async function updateLead(id: string, patch: { status?: string; note?: string }): Promise<Lead | undefined> {
  const lead = await getLead(id);
  if (!lead) return undefined;
  const sql = await table();
  const status = patch.status && (LEAD_STATUSES as readonly string[]).includes(patch.status) ? patch.status : lead.lead_status;
  const text = (patch.note ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, " ").trim().slice(0, 2000);
  const notes: LeadNote[] = text ? [...lead.notes, { at: new Date().toISOString(), text }].slice(-100) : lead.notes;
  await sql.query("update leads set lead_status = $2, notes = $3::jsonb, updated_at = now() where id = $1", [id, status, JSON.stringify(notes)]);
  console.info(`[admin] lead ${id}: ${status !== lead.lead_status ? `status ${lead.lead_status} -> ${status}` : "status unchanged"}${text ? ", note added" : ""}`);
  return getLead(id);
}

export async function countLeads(): Promise<number> {
  const sql = await table();
  const rows = await sql.query<{ n: number }>("select count(*) as n from leads");
  return Number(rows[0]?.n ?? 0);
}
