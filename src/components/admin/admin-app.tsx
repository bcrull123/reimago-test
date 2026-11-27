import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { BRAND } from "@/lib/brand";
import { chicagoShort, chicagoTime, LEAD_STATUSES, pickNames, type Lead, type LeadStatus } from "@/lib/leads";
import { AdminUrlCard } from "@/components/admin/admin-url";
import { MIN_PASSWORD } from "@/lib/admin-constants";

/**
 * Round 12 — the back-end control panel (admin). Mounted only at the secret ADMIN_PATH; every request here goes to
 * `/<ADMIN_PATH>/api/...` with the `rmg_admin` cookie. Sections other than Leads are greyed placeholders.
 * Colors come from the site's `--brand` variable (BRAND.color), so a clone's brand carries over.
 */
type Store = { store: "postgres" | "memory"; published: boolean; total: number; formcarry_backfill: boolean; reply_webhook?: { configured: boolean; problem?: string }; preview_store?: { durable: boolean; kind: "postgres" | "files"; problem?: string } };
type Filters = { q: string; mode: string; status: string; from: string; to: string };
const EMPTY: Filters = { q: "", mode: "", status: "", from: "", to: "" };

const STATUS_STYLE: Record<LeadStatus, string> = {
  new: "bg-brand-wash text-ink ring-brand",
  contacted: "bg-sky-50 text-sky-900 ring-sky-300",
  won: "bg-emerald-50 text-emerald-900 ring-emerald-300",
  lost: "bg-zinc-100 text-zinc-600 ring-zinc-300",
};
const MODE_LABEL = { reimagine: "Reimagine", new_site: "New site" } as const;

function useApi(cp: string) {
  const base = `/${cp}/api`;
  const call = useCallback(
    async <T,>(path: string, init?: { method?: string; body?: unknown }): Promise<{ ok: boolean; status: number; data: T }> => {
      const res = await fetch(`${base}/${path}`, {
        method: init?.method ?? "GET",
        credentials: "same-origin",
        headers: { "x-rmg-admin": "1", ...(init?.body ? { "content-type": "application/json" } : {}) },
        body: init?.body ? JSON.stringify(init.body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as T;
      return { ok: res.ok, status: res.status, data };
    },
    [base],
  );
  return { base, call };
}

const queryString = (f: Filters) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  return p.toString();
};

export function AdminApp({ cp, authed: startAuthed }: { cp: string; authed: boolean }) {
  const [authed, setAuthed] = useState(startAuthed);
  const { call } = useApi(cp);
  return (
    <div className="min-h-screen bg-surface-2/50 text-fg" style={{ ["--brand" as string]: BRAND.color } as CSSProperties} data-admin-root>
      {authed ? <Panel cp={cp} onSignedOut={() => setAuthed(false)} /> : <Login call={call} onDone={() => setAuthed(true)} />}
    </div>
  );
}

function Login({ call, onDone }: { call: ReturnType<typeof useApi>["call"]; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await call<{ error?: string }>("login", { method: "POST", body: { password } });
      if (res.ok) {
        setPassword("");
        onDone();
      } else setError(res.data.error ?? "Could not sign in.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <form onSubmit={submit} data-admin-login className="w-full max-w-sm rounded-xl border border-border bg-bg p-6 shadow-sm">
        <p className="text-sm font-semibold tracking-tight text-ink">
          {BRAND.name} <span className="text-faint">· control panel</span>
        </p>
        <h1 className="mt-4 font-display text-2xl text-ink">Sign in</h1>
        <label htmlFor="admin-password" className="mt-5 block text-sm font-medium text-ink">
          Admin password
        </label>
        <input id="admin-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 h-12 w-full rounded-md border border-border bg-bg px-3 text-base text-fg" />
        {error ? (
          <p role="alert" data-admin-error className="mt-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy || !password} className="mt-5 h-12 w-full rounded-md bg-brand text-sm font-semibold text-ink transition-transform hover:bg-brand-hover active:scale-[0.98] disabled:opacity-40">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

const NAV: { id: string; label: string; ready: boolean }[] = [
  { id: "leads", label: "Leads", ready: true },
  { id: "orders", label: "Orders", ready: false },
  { id: "domains", label: "Domains", ready: false },
  { id: "settings", label: "Settings", ready: true },
];

function Panel({ cp, onSignedOut }: { cp: string; onSignedOut: () => void }) {
  const { base, call } = useApi(cp);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [meta, setMeta] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");
  const [section, setSection] = useState("leads");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(
    async (f: Filters) => {
      setLoading(true);
      try {
        const res = await call<Store & { leads: Lead[]; error?: string }>(`leads?${queryString(f)}`);
        if (res.status === 401) return onSignedOut();
        if (!res.ok) throw new Error(res.data.error ?? "Could not load leads.");
        setLeads(res.data.leads);
        setMeta(res.data);
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load leads.");
      } finally {
        setLoading(false);
      }
    },
    [call, onSignedOut],
  );
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(filters), filters.q ? 250 : 0);
    return () => clearTimeout(timer.current);
  }, [filters, load]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = Object.values(filters).some(Boolean);
  const open = leads.find((l) => l.id === openId);

  async function signOut() {
    await call("logout", { method: "POST" }).catch(() => undefined);
    onSignedOut();
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="shrink-0 border-b border-white/10 bg-ink text-white md:w-56 md:border-b-0 md:border-r" data-admin-nav>
        <div className="flex items-center justify-between px-4 py-3 md:block md:px-5 md:py-5">
          <p className="text-base font-semibold tracking-tight">
            {BRAND.name}
            <span className="block text-xs font-normal text-white/60">control panel</span>
          </p>
          <button type="button" onClick={() => void signOut()} data-admin-signout className="rounded-md px-3 py-2 text-sm text-white/70 hover:text-white md:hidden">
            Sign out
          </button>
        </div>
        <nav aria-label="Control panel" className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1 md:px-3 md:pb-0">
          {NAV.map((item) =>
            item.ready ? (
              <button key={item.id} type="button" onClick={() => { setSection(item.id); setOpenId(""); }} aria-current={section === item.id ? "page" : undefined} data-admin-nav-item={item.id} className={`block shrink-0 rounded-md px-3 py-2 text-left text-sm font-medium ${section === item.id ? "bg-white/10 text-white ring-1 ring-brand/70" : "text-white/70 hover:bg-white/5 hover:text-white"}`}>
                {item.label}
              </button>
            ) : (
              <span key={item.id} aria-disabled="true" title="Coming soon" data-admin-nav-item={item.id} className="block shrink-0 cursor-not-allowed rounded-md px-3 py-2 text-sm text-white/35">
                {item.label} <span className="ml-1 text-[10px] uppercase tracking-wide">soon</span>
              </span>
            ),
          )}
        </nav>
        <button type="button" onClick={() => void signOut()} data-admin-signout className="mt-6 hidden w-full px-5 py-2 text-left text-sm text-white/60 hover:text-white md:block">
          Sign out
        </button>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6">
        {section === "settings" ? (
          <SettingsPanel cp={cp} onSignedOut={onSignedOut} />
        ) : (
        <>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-ink sm:text-3xl">Leads</h1>
            <p className="mt-1 text-sm text-muted" data-lead-count>
              {loading && !meta ? "Loading…" : `${leads.length}${filtered ? " matching" : ""} of ${meta?.total ?? leads.length} lead${(meta?.total ?? leads.length) === 1 ? "" : "s"} · times are America/Chicago`}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void load(filters)} className="h-10 rounded-md border border-border bg-bg px-4 text-sm font-medium text-fg hover:bg-surface">
              Refresh
            </button>
            <a href={`${base}/leads.csv?${queryString(filters)}`} download data-admin-csv className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-semibold text-ink hover:bg-brand-hover">
              Export CSV
            </a>
          </div>
        </div>

        {meta && !meta.published ? null : meta?.store === "memory" ? (
          <p role="alert" data-admin-warning className="mt-4 rounded-md border border-danger/40 bg-red-50 px-3 py-2 text-sm text-red-900">
            Leads are being kept in memory only (no DATABASE_URL on this app), so they will disappear on the next restart or republish.
          </p>
        ) : null}
        {meta?.reply_webhook && !meta.reply_webhook.configured ? (
          <p role="alert" data-admin-webhook-warning className="mt-4 rounded-md border border-danger/40 bg-red-50 px-3 py-2 text-sm text-red-900">
            Customer reply emails are OFF: the Email Bot webhook is not set up ({meta.reply_webhook.problem || "REPLY_WEBHOOK_URL / REPLY_WEBHOOK_KEY missing"}). Leads still arrive here and in Formcarry, but nobody is emailed back automatically. Add both secrets in the published environment and republish.
          </p>
        ) : null}
        {meta?.preview_store && !meta.preview_store.durable ? (
          <p role="alert" data-admin-preview-store-warning className="mt-4 rounded-md border border-danger/40 bg-red-50 px-3 py-2 text-sm text-red-900">
            {meta.preview_store.problem || "Preview sites (/made links) are not stored in the database, so they will disappear on the next deploy. Add DATABASE_URL to the published environment."}
          </p>
        ) : null}
        {meta && !meta.published && meta.store === "memory" ? <p className="mt-4 rounded-md border border-border bg-bg px-3 py-2 text-sm text-muted">Workspace preview: leads are kept in memory and reset when the preview restarts.</p> : null}

        <section aria-label="Filters" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-admin-filters>
          <input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search name, email, site, domain…" aria-label="Search leads" data-filter-q className="col-span-2 h-10 rounded-md border border-border bg-bg px-3 text-sm sm:col-span-3 lg:col-span-2" />
          <select value={filters.mode} onChange={(e) => set({ mode: e.target.value })} aria-label="Mode" data-filter-mode className="h-10 rounded-md border border-border bg-bg px-2 text-sm">
            <option value="">All modes</option>
            <option value="reimagine">Reimagine</option>
            <option value="new_site">New site</option>
          </select>
          <select value={filters.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status" data-filter-status className="h-10 rounded-md border border-border bg-bg px-2 text-sm">
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0]!.toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-muted">
            From
            <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} data-filter-from className="h-10 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-sm text-fg" />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            To
            <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} data-filter-to className="h-10 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-sm text-fg" />
          </label>
          {filtered ? (
            <button type="button" onClick={() => setFilters(EMPTY)} className="h-10 rounded-md px-3 text-sm text-primary hover:underline">
              Clear filters
            </button>
          ) : null}
        </section>

        {error ? (
          <p role="alert" className="mt-4 rounded-md border border-danger/40 bg-red-50 px-3 py-2 text-sm text-red-900">
            {error}
          </p>
        ) : null}

        <div className="mt-4 hidden overflow-x-auto rounded-xl border border-border bg-bg md:block">
          <table className="w-full min-w-[820px] text-left text-sm" data-leads-table>
            <thead className="border-b border-border bg-surface/60 text-xs uppercase tracking-wide text-faint">
              <tr>
                {["Date", "Name", "Email", "Mode", "Site / business", "Picked look(s)", "Domain", "Reply email", "Status"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} tabIndex={0} onClick={() => setOpenId(lead.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenId(lead.id))} data-lead-row={lead.id} className="cursor-pointer border-b border-border/70 last:border-0 hover:bg-brand-wash/60 focus-visible:bg-brand-wash/60">
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted">{chicagoShort(lead.created_at)}</td>
                  <td className="max-w-[9rem] break-words px-3 py-2.5 font-medium text-ink">{lead.name || "—"}</td>
                  <td className="max-w-[12rem] break-words px-3 py-2.5">{lead.email}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">{MODE_LABEL[lead.mode]}</td>
                  <td className="max-w-[11rem] truncate px-3 py-2.5" title={lead.source}>
                    {lead.source || "—"}
                  </td>
                  <td className="max-w-[10rem] truncate px-3 py-2.5" title={pickNames(lead)}>
                    {pickNames(lead) || "—"}
                    {lead.picks.length > 1 ? <span className="ml-1 text-xs text-faint">({lead.picks.length})</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">{lead.chosen_domain || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5" data-reply-status={replyKind(lead.webhook_status)}>
                    <ReplyBadge status={lead.webhook_status} />
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusPill status={lead.lead_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!leads.length ? <Empty loading={loading} filtered={filtered} /> : null}
        </div>

        <ul className="mt-4 space-y-2 md:hidden" data-leads-cards>
          {leads.map((lead) => (
            <li key={lead.id}>
              <button type="button" onClick={() => setOpenId(lead.id)} data-lead-row={lead.id} className="w-full rounded-xl border border-border bg-bg p-3 text-left active:bg-brand-wash">
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{lead.name || lead.source || lead.email}</span>
                    <span className="block truncate text-sm text-muted">{lead.email}</span>
                  </span>
                  <StatusPill status={lead.lead_status} />
                </span>
                <span className="mt-1.5 block text-xs text-faint">
                  {chicagoShort(lead.created_at)} · {MODE_LABEL[lead.mode]}
                  {pickNames(lead) ? ` · ${pickNames(lead)}` : ""}
                  {lead.chosen_domain ? ` · ${lead.chosen_domain}` : ""}
                </span>
                <span className="mt-1.5 flex items-center gap-1.5 text-xs text-faint">Reply email <ReplyBadge status={lead.webhook_status} /></span>
              </button>
            </li>
          ))}
          {!leads.length ? <li><Empty loading={loading} filtered={filtered} /></li> : null}
        </ul>
        </>
        )}
      </main>

      {open && section === "leads" ? <Drawer cp={cp} lead={open} onClose={() => setOpenId("")} onChanged={(next) => setLeads((all) => all.map((l) => (l.id === next.id ? next : l)))} /> : null}
    </div>
  );
}

function Empty({ loading, filtered }: { loading: boolean; filtered: boolean }) {
  return (
    <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted md:border-0" data-leads-empty>
      {loading ? "Loading…" : filtered ? "No leads match those filters." : "No leads yet. Every “Choose this look” on the site will show up here."}
    </p>
  );
}

function StatusPill({ status }: { status: LeadStatus }) {
  return <span className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${STATUS_STYLE[status]}`}>{status}</span>;
}

/** A look's preview as a small live thumbnail, same-origin so it is never blocked. */
function lookPath(url: string): string {
  if (url.startsWith("/made/")) return url;
  try {
    const u = new URL(url);
    return u.pathname.startsWith("/made/") ? u.pathname : "";
  } catch {
    return "";
  }
}
function Thumb({ url, label, cp }: { url: string; label: string; cp?: string }) {
  const path = lookPath(url);
  const lookId = /\/made\/([a-f0-9]{16})/.exec(path || url)?.[1];
  const { call } = useApi(cp ?? "x");
  const [qa, setQa] = useState("");
  useEffect(() => {
    if (!cp || !lookId) return;
    void call<{ qa?: { scores?: { total?: number }; mode?: string; rounds?: number } }>(`look-qa?id=${lookId}`).then((res) => {
      const q = res.ok ? res.data.qa : undefined;
      if (q?.scores && typeof q.scores.total === "number") {
        setQa(`QA ${q.scores.total} · ${q.mode ?? "structural"}${q.rounds ? ` · ${q.rounds}r` : ""}`);
      }
    });
  }, [call, cp, lookId]);
  // Same-origin /made path: never send the owner to a protected *.vercel.app deployment URL.
  return (
    <a href={path || url} target="_blank" rel="noreferrer" className="block w-[220px] shrink-0" data-look-thumb>
      <span className="relative block h-[138px] w-[220px] overflow-hidden rounded-md border border-border bg-surface">
        {path ? <iframe src={path} title={label} loading="lazy" tabIndex={-1} sandbox="" aria-hidden="true" className="pointer-events-none absolute left-0 top-0 origin-top-left border-0" style={{ width: 1280, height: 800, transform: "scale(0.171875)" }} /> : null}
      </span>
      <span className="mt-1 block truncate text-xs text-primary">{label}</span>
      {qa ? <span className="mt-0.5 block font-mono text-[10px] text-faint" data-look-qa>{qa}</span> : null}
    </a>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border px-5 py-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">{title}</h3>
      <div className="mt-2 space-y-1.5 text-sm">{children}</div>
    </section>
  );
}
const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <p className="grid grid-cols-[7.5rem_1fr] gap-2">
    <span className="text-muted">{k}</span>
    <span className="min-w-0 break-words text-fg">{children || "—"}</span>
  </p>
);
const Link = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={lookPath(href) || href} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
    {children}
  </a>
);
const isHttp = (s: string) => /^https?:\/\//i.test(s);
const delivery = (s: string) => (s ? s : "not reported");

/** Round 13: the Email Bot reply webhook outcome as a small badge (list view and phone cards). */
const replyKind = (s: string): "sent" | "failed" | "skipped" | "pending" => (/^sent/i.test(s) ? "sent" : /^failed/i.test(s) ? "failed" : /skipped|not configured/i.test(s) ? "skipped" : "pending");
function ReplyBadge({ status }: { status: string }) {
  const kind = replyKind(status);
  const style = { sent: "bg-emerald-50 text-emerald-900 ring-emerald-300", failed: "bg-red-50 text-red-900 ring-red-300", skipped: "bg-amber-50 text-amber-900 ring-amber-300", pending: "bg-zinc-100 text-zinc-600 ring-zinc-300" }[kind];
  const label = { sent: "Sent", failed: "Failed", skipped: "Not sent", pending: "Not reported" }[kind];
  return (
    <span title={status || "No webhook result reported for this lead yet"} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${style}`}>
      {label}
    </span>
  );
}

function Drawer({ cp, lead, onClose, onChanged }: { cp: string; lead: Lead; onClose: () => void; onChanged: (lead: Lead) => void }) {
  const { call } = useApi(cp);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  async function save(patch: { status?: string; note?: string }) {
    setBusy(true);
    setError("");
    try {
      const res = await call<{ lead?: Lead; error?: string }>(`lead/${lead.id}`, { method: "POST", body: patch });
      if (!res.ok || !res.data.lead) throw new Error(res.data.error ?? "Could not save.");
      onChanged(res.data.lead);
      if (patch.note) setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  const picked = lead.picks[lead.picks.length - 1];
  const domainText = lead.domain_status === "selected_not_registered" ? "picked, not registered (reserve at checkout)" : lead.domain_status === "owned" ? "visitor's own domain" : lead.domain_status === "not_selected" ? "none picked" : "";

  return (
    <div className="fixed inset-0 z-40" data-lead-drawer-wrap>
      <button type="button" aria-label="Close details" onClick={onClose} className="absolute inset-0 bg-ink/40" />
      <aside role="dialog" aria-modal="true" aria-label="Lead details" data-lead-drawer className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col overflow-y-auto bg-bg shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-bg px-5 py-4">
          <div className="min-w-0">
            <p className="truncate font-display text-xl text-ink">{lead.name || lead.source || lead.email}</p>
            <p className="text-xs text-muted">
              {chicagoTime(lead.created_at)} (Chicago) · {MODE_LABEL[lead.mode]} · <span className="font-mono">{lead.id}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} data-drawer-close className="h-10 shrink-0 rounded-md border border-border px-3 text-sm hover:bg-surface">
            Close
          </button>
        </header>

        <section className="px-5 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">Status</h3>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Lead status" data-status-buttons>
            {LEAD_STATUSES.map((s) => (
              <button key={s} type="button" disabled={busy} data-status={s} aria-pressed={lead.lead_status === s} onClick={() => lead.lead_status !== s && void save({ status: s })} className={`h-10 rounded-full px-4 text-sm font-medium capitalize ring-1 ring-inset ${lead.lead_status === s ? `${STATUS_STYLE[s]} ring-2` : "bg-bg text-muted ring-border hover:bg-surface"}`}>
                {s}
              </button>
            ))}
          </div>
        </section>

        <Section title="Contact">
          <Row k="Email">{lead.email ? <Link href={`mailto:${lead.email}`}>{lead.email}</Link> : ""}</Row>
          <Row k="Phone">{lead.phone ? <Link href={`tel:${lead.phone}`}>{lead.phone}</Link> : ""}</Row>
        </Section>

        <Section title="Brief">
          <Row k={lead.mode === "reimagine" ? "Site" : "Business"}>{isHttp(lead.source) ? <Link href={lead.source}>{lead.source}</Link> : lead.source}</Row>
          <Row k={lead.mode === "reimagine" ? "Their note" : "What / who"}>{lead.what}</Row>
          {lead.mode === "new_site" ? (
            <>
              <Row k="Area">{lead.location}</Row>
              <Row k="Style">{lead.style}</Row>
            </>
          ) : null}
          <Row k="Changes asked">{lead.change_requests.length ? <ol className="list-decimal pl-4">{lead.change_requests.map((c, i) => <li key={i}>{c}</li>)}</ol> : ""}</Row>
        </Section>

        {lead.mode === "new_site" ? (
          <Section title="Domain & logo">
            <Row k="Domain">{lead.domain_choice === "have" ? "Has a domain" : lead.domain_choice === "get" ? "Wants one found" : lead.domain_choice}</Row>
            <Row k="Name">{lead.chosen_domain ? <><strong>{lead.chosen_domain}</strong> — {domainText}</> : domainText}</Row>
            <Row k="Logo">{lead.logo_source ? (lead.logo_source === "ai" ? "AI-made" : "Uploaded") : ""}</Row>
            {lead.logo_url ? <a href={lead.logo_url} target="_blank" rel="noreferrer"><img src={lead.logo_url} alt="Logo" className="mt-1 max-h-20 rounded border border-border bg-surface p-1" /></a> : null}
          </Section>
        ) : null}

        <Section title={`Picked look${lead.picks.length === 1 ? "" : "s"} (${lead.picks.length})`}>
          {lead.picks.length ? (
            lead.picks.map((p, i) => (
              <div key={`${p.look_id}${i}`} className="rounded-lg border border-border p-3" data-pick>
                <p className="font-medium text-ink">{p.look || "Look"}</p>
                <p className="text-xs text-muted">{chicagoTime(p.picked_at)} · Formcarry: {delivery(p.formcarry_status)} · Reply webhook: {delivery(p.webhook_status)}</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {p.preview_url ? <Thumb url={p.preview_url} label="Open preview" cp={cp} /> : null}
                  {p.look_id && lookPath(p.preview_url) ? (
                    <a href={`/made/${p.look_id}/img/capture`} target="_blank" rel="noreferrer" className="block w-[220px] shrink-0" title="The picture sent with the lead">
                      <img src={`/made/${p.look_id}/img/capture`} alt="Picture sent with the lead" loading="lazy" onError={(e) => (e.currentTarget.parentElement!.style.display = "none")} className="h-[138px] w-[220px] rounded-md border border-border object-cover object-top" />
                      <span className="mt-1 block text-xs text-primary">Picture sent</span>
                    </a>
                  ) : null}
                </div>
                {p.pages.length ? (
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {p.pages.map((page) => {
                      const m = /^(.*?):\s*(https?:\/\/\S+|\/made\/\S+)$/.exec(page);
                      return <li key={page}>{m ? <Link href={m[2]!}>{m[1]}</Link> : page}</li>;
                    })}
                  </ul>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-muted">No look picked.</p>
          )}
        </Section>

        {lead.looks.length ? (
          <Section title="All three looks shown">
            <div className="flex gap-3 overflow-x-auto pb-1">
              {lead.looks.map((l) => (
                <Thumb key={l.look_id || l.name} url={l.url} label={l.name} cp={cp} />
              ))}
            </div>
          </Section>
        ) : null}

        {Object.keys(lead.extras).length ? (
          <Section title="Extra details">
            {Object.entries(lead.extras).map(([k, v]) => (
              <Row key={k} k={k.replace(/_/g, " ")}>
                <span className="whitespace-pre-line">{isHttp(v) && !v.includes("\n") ? <Link href={v}>{v}</Link> : v}</span>
              </Row>
            ))}
          </Section>
        ) : null}

        <Section title="Delivery & source">
          <Row k="Formcarry">{delivery(lead.formcarry_status)}</Row>
          <Row k="Reply webhook">{delivery(lead.webhook_status)}</Row>
          {Object.entries(lead.attribution).map(([k, v]) => (
            <Row key={k} k={k.replace(/_/g, " ")}>{v}</Row>
          ))}
          <Row k="Country">{lead.country}</Row>
          <Row k="Browser">
            <span className="text-xs text-muted">{lead.user_agent}</span>
          </Row>
        </Section>

        <Section title="Notes">
          {lead.notes.length ? (
            <ul className="space-y-2" data-notes>
              {lead.notes.map((n, i) => (
                <li key={i} className="rounded-md bg-surface/60 px-3 py-2">
                  <span className="block text-xs text-muted">{chicagoTime(n.at)}</span>
                  <span className="whitespace-pre-line">{n.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">No notes yet.</p>
          )}
          <form onSubmit={(e) => (e.preventDefault(), note.trim() && void save({ note }))} className="pt-2">
            <label htmlFor="lead-note" className="sr-only">
              Add a note
            </label>
            <textarea id="lead-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Add a note…" data-note-input className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm" />
            <button type="submit" disabled={busy || !note.trim()} data-note-save className="mt-2 h-10 rounded-md bg-brand px-4 text-sm font-semibold text-ink hover:bg-brand-hover disabled:opacity-40">
              Add note
            </button>
            {error ? <span role="alert" className="ml-3 text-sm text-danger">{error}</span> : null}
          </form>
        </Section>
        {picked ? <div className="h-4" /> : null}
      </aside>
    </div>
  );
}


type SettingsInfo = {
  source: "env" | "db";
  email: string;
  adminPath: string;
  adminUrl: string;
  envOverride: boolean;
  canChangePassword: boolean;
  canRegeneratePath: boolean;
  brandName: string;
  brandColor: string;
};

function SettingsPanel({ cp, onSignedOut }: { cp: string; onSignedOut: () => void }) {
  const { call } = useApi(cp);
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [confirmRegen, setConfirmRegen] = useState(false);

  async function load() {
    const res = await call<SettingsInfo & { error?: string }>("settings");
    if (res.status === 401) return onSignedOut();
    if (!res.ok) throw new Error(res.data.error ?? "Could not load settings.");
    setInfo(res.data);
  }
  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Could not load settings."));
  }, []);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setPwMsg("");
    try {
      const res = await call<SettingsInfo & { error?: string }>("settings/password", { method: "POST", body: { current, next, confirm } });
      if (res.status === 401) return onSignedOut();
      if (!res.ok) throw new Error(res.data.error ?? "Could not change the password.");
      setCurrent("");
      setNext("");
      setConfirm("");
      setPwMsg("Password saved. You’ll use it the next time you sign in.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  async function regen() {
    setBusy(true);
    setError("");
    try {
      const res = await call<SettingsInfo & { error?: string; adminUrl?: string }>("settings/path", { method: "POST", body: {} });
      if (res.status === 401) return onSignedOut();
      if (!res.ok || !res.data.adminUrl) throw new Error(res.data.error ?? "Could not create a new address.");
      setNewUrl(res.data.adminUrl);
      setInfo(res.data);
      setConfirmRegen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a new address.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-admin-settings>
      <h1 className="font-display text-2xl text-ink sm:text-3xl">Settings</h1>
      <p className="mt-1 text-sm text-muted">The control panel address and the admin password.</p>

      {info?.envOverride ? (
        <p role="status" data-env-override className="mt-4 rounded-md border border-border bg-bg px-3 py-2 text-sm text-muted">
          Sign-in is using <span className="font-mono">ADMIN_PATH</span> and <span className="font-mono">ADMIN_PASSWORD</span> set on the server, which take priority over the in-app login. To recover a lost password, set those two (and optionally <span className="font-mono">ADMIN_SESSION_SECRET</span>) in the environment, then remove them to go back to the password created at setup.
        </p>
      ) : null}

      <section className="mt-6 max-w-xl rounded-xl border border-border bg-bg p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">Admin address</h2>
        {info ? (
          <>
            <div className="mt-3">
              <AdminUrlCard url={newUrl || info.adminUrl} heading={newUrl ? "Your new private admin address — the old one no longer works" : "Your private admin address"} />
            </div>
            <p className="mt-3 text-sm text-muted">Bookmark it. There is no link to the control panel from the site.</p>
            {newUrl ? (
              <a href={newUrl} data-open-admin className="mt-3 inline-flex h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-ink hover:bg-brand-hover">
                Open the new address
              </a>
            ) : info.canRegeneratePath ? (
              confirmRegen ? (
                <div className="mt-4 rounded-md border border-danger/30 bg-red-50 px-3 py-3" data-regen-confirm>
                  <p className="text-sm text-red-900">The current address will stop working. Copy the new one and bookmark it.</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={busy} onClick={() => void regen()} data-regen-path className="h-10 rounded-md bg-brand px-4 text-sm font-semibold text-ink hover:bg-brand-hover disabled:opacity-40">
                      {busy ? "Creating…" : "Create a new address"}
                    </button>
                    <button type="button" onClick={() => setConfirmRegen(false)} className="h-10 rounded-md border border-border px-4 text-sm">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmRegen(true)} data-regen-start className="mt-4 h-10 rounded-md border border-border bg-bg px-4 text-sm font-medium text-fg hover:bg-surface">
                  Get a new admin address
                </button>
              )
            ) : null}
          </>
        ) : (
          <p className="mt-3 text-sm text-muted">Loading…</p>
        )}
      </section>

      <section className="mt-6 max-w-xl rounded-xl border border-border bg-bg p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">Password</h2>
        {info?.email ? <p className="mt-2 text-sm text-fg">Owner email: <span className="font-medium">{info.email}</span></p> : null}
        {info?.canChangePassword ? (
          <form onSubmit={changePassword} className="mt-4 space-y-3" data-change-password>
            <label className="block text-sm font-medium text-ink">
              Current password
              <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required className="mt-1.5 h-11 w-full rounded-md border border-border bg-bg px-3 text-sm" data-pw-current />
            </label>
            <label className="block text-sm font-medium text-ink">
              New password
              <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={MIN_PASSWORD} className="mt-1.5 h-11 w-full rounded-md border border-border bg-bg px-3 text-sm" data-pw-next />
            </label>
            <p className="text-xs text-muted">At least {MIN_PASSWORD} characters.</p>
            <label className="block text-sm font-medium text-ink">
              Confirm new password
              <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className="mt-1.5 h-11 w-full rounded-md border border-border bg-bg px-3 text-sm" data-pw-confirm />
            </label>
            <button type="submit" disabled={busy} data-pw-save className="h-11 rounded-md bg-brand px-4 text-sm font-semibold text-ink hover:bg-brand-hover disabled:opacity-40">
              {busy ? "Saving…" : "Save password"}
            </button>
            {pwMsg ? <p role="status" data-pw-ok className="text-sm text-emerald-800">{pwMsg}</p> : null}
          </form>
        ) : (
          <p className="mt-3 text-sm text-muted">The password is set by <span className="font-mono">ADMIN_PASSWORD</span> in the server environment, so it cannot be changed here.</p>
        )}
      </section>

      {error ? (
        <p role="alert" data-settings-error className="mt-4 max-w-xl text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
