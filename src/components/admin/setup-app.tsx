import { useState, type CSSProperties, type FormEvent } from "react";
import { BRAND } from "@/lib/brand";
import { MIN_PASSWORD } from "@/lib/admin-constants";
import { AdminUrlCard } from "@/components/admin/admin-url";

/**
 * Round 12b — first-run setup. Shown only at /setup while the install is unclaimed (or, without a
 * database, as a "can't persist" message). After a successful submit the "Save this" screen stays
 * in this tab; a refresh of /setup is a 404 because the install is then claimed.
 */
type SetupView = { status: "no-store" } | { status: "unclaimed"; needsCode: boolean; brandName: string; brandColor: string };

export function SetupApp({ state }: { state: SetupView }) {
  return (
    <div className="min-h-screen bg-surface-2/50 text-fg" style={{ ["--brand" as string]: BRAND.color } as CSSProperties} data-setup-root>
      <main className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-10">
        {state.status === "no-store" ? <NoStore /> : <Form needsCode={state.needsCode} brandName={state.brandName} brandColor={state.brandColor} />}
      </main>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="w-full rounded-xl border border-border bg-bg p-6 shadow-sm">{children}</div>;
}

function NoStore() {
  return (
    <Card>
      <p className="text-sm font-semibold tracking-tight text-ink">
        {BRAND.name} <span className="text-faint">· control panel</span>
      </p>
      <h1 className="mt-4 font-display text-2xl text-ink">Setup needs a database</h1>
      <p role="alert" data-setup-no-store className="mt-4 text-sm leading-relaxed text-fg">
        This app has no database (<span className="font-mono">DATABASE_URL</span> is not set), so a control-panel password cannot be saved — it would disappear on the next restart.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Add a database, or set <span className="font-mono">ADMIN_PATH</span> and <span className="font-mono">ADMIN_PASSWORD</span> in the server environment (those always take priority, and are also how you recover a lost login).
      </p>
    </Card>
  );
}

function Form({ needsCode, brandName: startName, brandColor: startColor }: { needsCode: boolean; brandName: string; brandColor: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [brandName, setBrandName] = useState(startName);
  const [brandColor, setBrandColor] = useState(startColor);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ adminUrl: string; email: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/setup/api", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-rmg-admin": "1" },
        body: JSON.stringify({ email, password, confirm, setupCode, brandName, brandColor }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; adminUrl?: string; email?: string };
      if (res.status === 404) {
        setError("This install is already set up. If you have the admin address, open it to sign in.");
      } else if (!res.ok || !data.adminUrl) {
        setError(data.error ?? "Setup could not be saved. Try again.");
      } else {
        setSaved({ adminUrl: data.adminUrl, email: data.email ?? email });
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (saved) return <SaveScreen url={saved.adminUrl} email={saved.email} />;

  return (
    <Card>
      <form onSubmit={submit} data-setup-form>
        <p className="text-sm font-semibold tracking-tight text-ink">
          {BRAND.name} <span className="text-faint">· control panel</span>
        </p>
        <h1 className="mt-4 font-display text-2xl text-ink">Create your admin password</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">This is a one-time setup. You’ll get a private address for the control panel — bookmark it, there is no link to it from the site.</p>

        <label htmlFor="setup-email" className="mt-5 block text-sm font-medium text-ink">
          Owner email
        </label>
        <input id="setup-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 h-12 w-full rounded-md border border-border bg-bg px-3 text-base" />

        <label htmlFor="setup-password" className="mt-4 block text-sm font-medium text-ink">
          Create a password
        </label>
        <input id="setup-password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 h-12 w-full rounded-md border border-border bg-bg px-3 text-base" />
        <p className="mt-1 text-xs text-muted">At least {MIN_PASSWORD} characters.</p>

        <label htmlFor="setup-confirm" className="mt-3 block text-sm font-medium text-ink">
          Confirm password
        </label>
        <input id="setup-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1.5 h-12 w-full rounded-md border border-border bg-bg px-3 text-base" />

        {needsCode ? (
          <>
            <label htmlFor="setup-code" className="mt-4 block text-sm font-medium text-ink">
              Setup code
            </label>
            <input id="setup-code" type="password" autoComplete="off" required value={setupCode} onChange={(e) => setSetupCode(e.target.value)} className="mt-1.5 h-12 w-full rounded-md border border-border bg-bg px-3 text-base" />
            <p className="mt-1 text-xs text-muted">This install requires the setup code from the server environment.</p>
          </>
        ) : null}

        <details className="mt-5 rounded-md border border-border bg-surface/40 px-3 py-2" data-setup-brand>
          <summary className="cursor-pointer text-sm font-medium text-ink">Brand name and color (optional)</summary>
          <p className="mt-2 text-xs text-muted">Pre-filled from this site’s defaults. You can change them later.</p>
          <label htmlFor="setup-brand-name" className="mt-3 block text-sm font-medium text-ink">
            Brand name
          </label>
          <input id="setup-brand-name" type="text" value={brandName} onChange={(e) => setBrandName(e.target.value)} className="mt-1.5 h-11 w-full rounded-md border border-border bg-bg px-3 text-sm" />
          <label htmlFor="setup-brand-color" className="mt-3 block text-sm font-medium text-ink">
            Brand color
          </label>
          <span className="mt-1.5 flex items-center gap-2">
            <input type="color" aria-label="Pick a brand color" value={/^#[0-9A-Fa-f]{6}$/.test(brandColor) ? brandColor : "#f89800"} onChange={(e) => setBrandColor(e.target.value)} className="h-11 w-14 cursor-pointer rounded border border-border bg-bg p-1" />
            <input id="setup-brand-color" type="text" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-11 min-w-0 flex-1 rounded-md border border-border bg-bg px-3 font-mono text-sm" />
          </span>
        </details>

        {error ? (
          <p role="alert" data-setup-error className="mt-4 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={busy} data-setup-submit className="mt-6 h-12 w-full rounded-md bg-brand text-sm font-semibold text-ink transition-transform hover:bg-brand-hover active:scale-[0.98] disabled:opacity-40">
          {busy ? "Saving…" : "Create password and continue"}
        </button>
      </form>
    </Card>
  );
}

function SaveScreen({ url, email }: { url: string; email: string }) {
  return (
    <Card>
      <p className="text-sm font-semibold tracking-tight text-ink">
        {BRAND.name} <span className="text-faint">· control panel</span>
      </p>
      <h1 className="mt-4 font-display text-2xl text-ink">Save this address</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Your control panel is ready{email ? ` for ${email}` : ""}. There is no link to it from the site — copy the address and bookmark it.
      </p>
      <div className="mt-5">
        <AdminUrlCard url={url} heading="Your private admin address" />
      </div>
      <a href={url} data-open-admin className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-md border border-border bg-bg text-sm font-semibold text-ink hover:bg-surface">
        Open my control panel
      </a>
      <p className="mt-4 text-xs leading-relaxed text-muted">
        If you ever lose this address or the password, set <span className="font-mono">ADMIN_PATH</span> and <span className="font-mono">ADMIN_PASSWORD</span> in the server environment — they override the in-app login until you remove them.
      </p>
    </Card>
  );
}
