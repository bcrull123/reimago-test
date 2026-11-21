/**
 * Round 11 — "Pick your domain" pop-up for Build a New Site + "Get me a domain, email & hosting".
 *
 * Grok invents short brandable names, the Webhero/LogicBoxes check says which are free (server side; the token
 * never reaches the browser), and the owner picks one. NOTHING IS REGISTERED OR BOUGHT HERE: the pick is only
 * stored and sent with the lead (chosen_domain, domain_status=selected_not_registered); the Webhero cart reserves
 * it at checkout. "Try again" fetches a fresh batch (never repeating one already shown); "Have one in mind?"
 * checks a typed name (adds .com when there is no ending; an ending that is not live yet is "not offered yet").
 */
import { useEffect, useRef, useState } from "react";
import { Check, Globe, RefreshCw, X } from "lucide-react";
import { ProgressRing, RotatingStatus } from "@/components/progress-ring";
import { domainCheckTyped, domainIdeas } from "@/lib/domain-pick.functions";
import { sortItems, type BusinessBrief, type DomainItem } from "@/lib/domain-ideas";

const IDEA_STATUS = ["Thinking up names for your business…", "Trying short, memorable combinations…", "Asking the registrar what's free…", "Checking each name…"];
const TYPED_STATUS = ["Checking that name…", "Asking the registrar…", "Looking for close alternatives…"];

type Busy = "" | "ideas" | "typed";

export function DomainPicker(props: {
  brief: BusinessBrief;
  open: boolean;
  onClose: () => void;
  /** The domain picked so far ("" = none). Stored by the page and sent with the lead. */
  value: string;
  onPick: (domain: string) => void;
}) {
  const { brief, open, value, onPick } = props;
  const [items, setItems] = useState<DomainItem[]>([]);
  const [typed, setTyped] = useState<DomainItem | null>(null);
  const [typedText, setTypedText] = useState("");
  const [selected, setSelected] = useState(value);
  const [busy, setBusy] = useState<Busy>("");
  const [start, setStart] = useState(0);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [unchecked, setUnchecked] = useState("");
  const [tlds, setTlds] = useState<string[]>([]);
  const [mock, setMock] = useState(false);
  const shown = useRef<string[]>([]);
  const attempt = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const started = useRef(false);

  useEffect(() => setSelected(value), [value, open]);
  useEffect(
    () => () => {
      // Unmount (or React StrictMode's dev remount): stop any request and allow the first batch to start again.
      abort.current?.abort();
      started.current = false;
    },
    [],
  );

  async function fetchIdeas() {
    if (busy) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy("ideas");
    setStart(Date.now());
    setError("");
    setNote("");
    try {
      const res = await domainIdeas({ data: { brief, exclude: shown.current, attempt: attempt.current }, signal: ctl.signal });
      if (ctl.signal.aborted) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      attempt.current += 1;
      shown.current = [...shown.current, ...res.items.map((i) => i.domain)];
      setItems(res.items);
      setTlds(res.tlds);
      setMock(res.mock);
      setUnchecked(res.unchecked ? res.reason || "no answer" : "");
    } catch (err) {
      if (!ctl.signal.aborted) setError(err instanceof Error ? err.message : "Couldn't make domain ideas. Try again.");
    } finally {
      if (abort.current === ctl) setBusy("");
    }
  }

  async function checkTypedName() {
    const text = typedText.trim();
    if (busy || !text) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy("typed");
    setStart(Date.now());
    setError("");
    setNote("");
    try {
      const res = await domainCheckTyped({ data: { brief, exclude: shown.current, attempt: attempt.current, text }, signal: ctl.signal });
      if (ctl.signal.aborted) return;
      if (!res.ok) {
        setTyped(null);
        setError(res.error);
        return;
      }
      setTyped(res.typed);
      setNote(res.note);
      setTlds(res.tlds);
      setMock(res.mock);
      setUnchecked(res.unchecked ? res.reason || "no answer" : "");
      if (res.typed) shown.current = [...shown.current, res.typed.domain];
      if (res.items.length) {
        shown.current = [...shown.current, ...res.items.map((i) => i.domain)];
        setItems(res.items);
      }
    } catch (err) {
      if (!ctl.signal.aborted) setError(err instanceof Error ? err.message : "Couldn't check that name. Try again.");
    } finally {
      if (abort.current === ctl) setBusy("");
    }
  }

  function stop() {
    abort.current?.abort();
    setBusy("");
    setNote("Stopped. Press Try again whenever you like.");
  }

  // First open: make the first batch.
  useEffect(() => {
    if (open && !started.current) {
      started.current = true;
      void fetchIdeas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const available = sortItems(items.filter((i) => i.state === "available"), tlds.length ? tlds : ["com"]);
  const unknown = items.filter((i) => i.state === "unknown");
  const gone = items.filter((i) => i.state === "taken" || i.state === "premium");
  const pinned = selected && !available.some((i) => i.domain === selected) && typed?.domain !== selected ? selected : "";

  const row = (domain: string, label?: string) => {
    const on = selected === domain;
    return (
      <label
        key={domain}
        data-domain-option={domain}
        className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors ${on ? "border-brand bg-brand-wash text-ink" : "border-border bg-bg text-fg hover:bg-surface"}`}
      >
        <input type="radio" name="pick-domain" checked={on} onChange={() => setSelected(domain)} className="size-4 shrink-0 accent-brand" />
        <span className="min-w-0 flex-1 break-all font-medium">{domain}</span>
        <span className={`shrink-0 text-xs ${on ? "text-ink/70" : "text-muted"}`}>{label ?? "Available"}</span>
      </label>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4" data-domain-modal role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="pick-domain-title" className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-bg shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
          <div>
            <h2 id="pick-domain-title" className="flex items-center gap-2 font-display text-xl text-fg">
              <Globe className="size-5 text-brand" aria-hidden /> Pick your domain
            </h2>
            <p className="mt-1 text-sm text-muted" data-domain-reserve-note>
              Choose a name for your business. <strong className="font-semibold text-fg">We'll reserve it at checkout</strong> — nothing is bought or registered now.
            </p>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Close" data-domain-close className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-fg">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <form
            className="rounded-lg border border-border bg-surface/50 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void checkTypedName();
            }}
          >
            <label htmlFor="pick-domain-typed" className="text-sm font-medium text-fg">
              Have one in mind? Type it
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="pick-domain-typed"
                data-domain-typed
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="url"
                placeholder="yourbusiness or yourbusiness.com"
                className="h-11 min-w-0 flex-1 rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring/70"
              />
              <button type="submit" data-domain-check disabled={!typedText.trim() || Boolean(busy)} className="h-11 shrink-0 rounded-md bg-brand px-4 text-sm font-semibold text-ink transition-transform duration-150 hover:bg-brand-hover active:scale-[0.96] disabled:opacity-40">
                Check
              </button>
            </div>
            {typed ? (
              <div className="mt-3 space-y-2" data-domain-typed-result>
                {typed.state === "available" ? (
                  row(typed.domain, "Available")
                ) : typed.state === "unknown" ? (
                  row(typed.domain, "Not checked")
                ) : (
                  <p className="rounded-md border border-border bg-bg px-3 py-2.5 text-sm text-muted" data-domain-typed-taken>
                    <span className="break-all font-medium text-fg">{typed.domain}</span> is taken. {items.length ? "Here are close alternatives below." : ""}
                  </p>
                )}
              </div>
            ) : null}
          </form>

          {note ? <p className="mt-3 text-sm text-muted" data-domain-note>{note}</p> : null}
          {error ? (
            <p role="alert" className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" data-domain-error>
              {error}
            </p>
          ) : null}
          {unchecked ? (
            <div role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900" data-domain-unchecked>
              <strong className="font-semibold">Can't check availability right now.</strong> These are ideas only — we'll confirm the name at checkout. You can still pick one, or try again in a moment.
            </div>
          ) : null}
          {mock ? <p className="mt-2 text-xs text-faint">Mock mode (PREVIEW_MOCK=1): availability here is a stand-in, not a live check.</p> : null}

          {busy ? (
            <div className="mt-5 flex flex-col items-center" data-domain-progress>
              <ProgressRing start={start} averageMs={busy === "typed" ? 6_000 : 10_000} compact />
              <RotatingStatus lines={busy === "typed" ? TYPED_STATUS : IDEA_STATUS} />
              <button type="button" onClick={stop} data-domain-stop className="mt-3 inline-flex h-9 items-center justify-center rounded-md border border-border bg-bg px-4 text-sm font-medium text-fg shadow-sm hover:bg-surface active:scale-[0.96]">
                Stop
              </button>
            </div>
          ) : (
            <>
              {pinned ? <div className="mt-4 space-y-2">{row(pinned, "Your pick")}</div> : null}
              {available.length || unknown.length ? (
                <div className="mt-4" role="radiogroup" aria-label="Domain ideas" data-domain-list>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{unchecked ? "Ideas" : `Available (${available.length})`}</p>
                  <div className="space-y-2">
                    {available.map((i) => row(i.domain))}
                    {unknown.map((i) => row(i.domain, "Not checked"))}
                  </div>
                </div>
              ) : null}
              {!items.length && !error && !busy && started.current ? <p className="mt-4 text-sm text-muted">No ideas yet — press Try again.</p> : null}
              {gone.length ? (
                <details className="mt-4 text-sm" data-domain-taken>
                  <summary className="cursor-pointer text-muted">Not available ({gone.length})</summary>
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted">
                    {gone.map((i) => (
                      <li key={i.domain} className="break-all line-through opacity-60">
                        {i.domain}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-border bg-bg px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <button type="button" onClick={() => void fetchIdeas()} disabled={Boolean(busy)} data-domain-retry className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-border bg-bg px-4 text-sm font-medium text-fg hover:bg-surface active:scale-[0.96] disabled:opacity-40">
            <RefreshCw className="size-4" aria-hidden /> Try again
          </button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                props.onClose();
              }}
              data-domain-skip
              className="inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-medium text-muted hover:text-fg"
            >
              {value ? "Close" : "Skip for now"}
            </button>
            <button
              type="button"
              disabled={!selected || Boolean(busy)}
              data-domain-use
              onClick={() => {
                onPick(selected);
                props.onClose();
              }}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-semibold text-ink transition-transform duration-150 hover:bg-brand-hover active:scale-[0.96] disabled:opacity-40"
            >
              <Check className="size-4" aria-hidden /> {selected ? "Use this domain" : "Pick one to continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The chip under the looks: the pick so far, and a way to reopen the pop-up. */
export function DomainChip(props: { value: string; onOpen: () => void }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-brand-wash px-4 py-3 text-sm text-ink" data-domain-chip>
      <Globe className="size-4 shrink-0 text-brand-dark" aria-hidden />
      <span className="min-w-0 flex-1">
        {props.value ? (
          <>
            Your domain: <strong className="break-all font-semibold">{props.value}</strong> <span className="text-ink/70">— we'll reserve it at checkout.</span>
          </>
        ) : (
          <>You asked us to get you a domain, email &amp; hosting. Pick a name now — we'll reserve it at checkout.</>
        )}
      </span>
      <button type="button" onClick={props.onOpen} data-domain-open className="inline-flex h-10 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-ink hover:bg-brand-hover active:scale-[0.96]">
        {props.value ? "Change domain" : "Pick your domain"}
      </button>
    </div>
  );
}
