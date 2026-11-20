/**
 * Round 10 — "Build a New Site": no source site. The owner tells us the business (name, what it does / who it
 * serves, optional area, optional style notes, optional logo) and how they want their domain handled. The answers
 * become the same SiteFacts a scraped site would (factsFromBrief), so the three looks, card boxes, refine,
 * preview and "Choose this look" all work unchanged. Nothing is bought or registered: the domain choice is only
 * recorded and sent with the lead.
 *
 * Round 10b — beside the logo upload, "Have AI make one" asks Grok Imagine for a few marks (a styled wordmark of
 * the name or domain first) to pick from; the chosen one is used exactly like an uploaded file.
 */
import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { NewSiteBrief } from "@/lib/new-site";
import { logoFileStem, logoProblem, logoWord, LOGO_STATUS, type LogoBrief, type LogoOption } from "@/lib/preview/ai-logo";
import { previewMakeLogos } from "@/lib/preview.functions";
import { ProgressRing, RotatingStatus } from "@/components/progress-ring";

const fieldClass =
  "mt-1.5 flex h-11 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring/70";
const areaClass =
  "mt-1.5 flex min-h-20 w-full rounded-md border border-border bg-bg px-3 py-2.5 text-sm text-fg outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring/70";

export type LogoSource = "" | "upload" | "ai";

export function NewSiteForm(props: {
  brief: NewSiteBrief;
  setBrief: (next: NewSiteBrief) => void;
  logo: File | null;
  setLogo: (file: File | null) => void;
  setLogoUrl: (url: string) => void;
  logoSource: LogoSource;
  setLogoSource: (source: LogoSource) => void;
  email: string;
  setEmail: (value: string) => void;
  agreed: boolean;
  setAgreed: (value: boolean) => void;
  working: boolean;
  onBuild: () => void;
}) {
  const { brief, setBrief } = props;
  const [logoBusy, setLogoBusy] = useState(false);
  const set = (key: keyof NewSiteBrief) => (event: { target: { value: string } }) => setBrief({ ...brief, [key]: event.target.value });
  return (
    <div className="space-y-4" data-new-site-form>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block" htmlFor="ns-name">
          <span className="text-sm font-medium text-fg">Business name</span>
          <input id="ns-name" name="business_name" value={brief.business_name} onChange={set("business_name")} maxLength={60} placeholder="Riverside Plumbing" className={fieldClass} />
        </label>
        <label className="block" htmlFor="ns-location">
          <span className="text-sm font-medium text-fg">
            City or area <span className="font-normal text-faint">(optional)</span>
          </span>
          <input id="ns-location" name="location" value={brief.location} onChange={set("location")} maxLength={80} placeholder="Austin, Texas" className={fieldClass} />
        </label>
      </div>
      <label className="block" htmlFor="ns-what">
        <span className="text-sm font-medium text-fg">What does the business do, and who does it serve?</span>
        <textarea id="ns-what" name="what" value={brief.what} onChange={set("what")} maxLength={600} rows={3} placeholder="Family-run plumbing repairs and water heaters for homeowners on the east side." className={areaClass} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block" htmlFor="ns-style">
          <span className="text-sm font-medium text-fg">
            Style notes <span className="font-normal text-faint">(optional)</span>
          </span>
          <textarea id="ns-style" name="style" value={brief.style} onChange={set("style")} maxLength={300} rows={2} placeholder="Warm and trustworthy. Navy and copper." className={areaClass} />
        </label>
        <LogoField
          brief={brief}
          logo={props.logo}
          setLogo={props.setLogo}
          setLogoUrl={props.setLogoUrl}
          logoSource={props.logoSource}
          setLogoSource={props.setLogoSource}
          disabled={props.working}
          onBusy={setLogoBusy}
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-fg">Your domain</legend>
        <label className="flex items-center gap-2.5 text-sm text-fg">
          <input type="radio" name="ns-domain-choice" checked={brief.domain_choice === "have"} onChange={() => setBrief({ ...brief, domain_choice: "have" })} className="size-4 accent-primary" />
          I have a domain
        </label>
        {brief.domain_choice === "have" ? (
          <input
            id="ns-domain"
            name="domain"
            value={brief.domain}
            onChange={set("domain")}
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="yourbusiness.com"
            aria-label="Your domain"
            className={`${fieldClass} ml-6 max-w-sm`}
          />
        ) : null}
        <label className="flex items-center gap-2.5 text-sm text-fg">
          <input type="radio" name="ns-domain-choice" checked={brief.domain_choice === "get"} onChange={() => setBrief({ ...brief, domain_choice: "get", domain: "" })} className="size-4 accent-primary" />
          Get me a domain, email &amp; hosting
        </label>
        {brief.domain_choice === "get" ? <p className="ml-6 text-xs text-muted">We'll note it and help you pick one after you choose a look. Nothing is bought now.</p> : null}
      </fieldset>
      <label className="block" htmlFor="ns-email">
        <span className="text-sm font-medium text-fg">Email</span>
        <input id="ns-email" name="email" value={props.email} onChange={(event) => props.setEmail(event.target.value)} type="email" autoComplete="email" placeholder="you@company.com" className={`${fieldClass} sm:max-w-sm`} />
      </label>
      <label className="flex items-start gap-2.5 text-sm text-muted">
        <input type="checkbox" checked={props.agreed} onChange={(event) => props.setAgreed(event.target.checked)} className="mt-1 size-4 shrink-0 accent-fg" />
        <span>
          I agree to the{" "}
          <Link to="/terms" className="text-fg underline-offset-4 hover:underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className="text-fg underline-offset-4 hover:underline">
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      <button
        type="button"
        onClick={props.onBuild}
        disabled={props.working || logoBusy}
        data-build-new-site
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-accent px-6 text-sm font-semibold text-ink transition-transform duration-150 ease-out hover:bg-accent/90 active:scale-[0.96] disabled:opacity-40 sm:w-auto"
      >
        {props.working ? "Building your looks…" : "Build my new site"}
        {props.working ? null : <ArrowRight className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

function logoBriefOf(brief: NewSiteBrief): LogoBrief {
  return {
    business_name: brief.business_name,
    what: brief.what,
    location: brief.location,
    style: brief.style,
    domain: brief.domain_choice === "have" ? brief.domain : "",
  };
}

function LogoField(props: {
  brief: NewSiteBrief;
  logo: File | null;
  setLogo: (file: File | null) => void;
  setLogoUrl: (url: string) => void;
  logoSource: LogoSource;
  setLogoSource: (source: LogoSource) => void;
  disabled?: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const [options, setOptions] = useState<LogoOption[]>([]);
  const [selected, setSelected] = useState("");
  const [working, setWorking] = useState(false);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [start, setStart] = useState(0);
  const [variation, setVariation] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const linkClass = "text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-40";

  async function make(more = false) {
    const brief = logoBriefOf(props.brief);
    const problem = logoProblem(brief);
    setError("");
    if (problem) {
      setHint(problem);
      return;
    }
    setHint("");
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const nextVar = more ? variation + 1 : 0;
    setVariation(nextVar);
    setWorking(true);
    props.onBusy?.(true);
    setStart(Date.now());
    try {
      const made = await previewMakeLogos({ data: { brief, variation: nextVar }, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!made.ok) {
        setError(made.error);
        return;
      }
      setOptions((prev) => (more ? [...prev, ...made.options] : made.options));
      if (!more) setSelected("");
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError") || (err instanceof Error && err.name === "AbortError")) return;
      setError("Grok Imagine couldn't make logos this time. Upload a file, or try again in a moment.");
    } finally {
      if (!controller.signal.aborted) {
        setWorking(false);
        props.onBusy?.(false);
      }
      if (abort.current === controller) abort.current = null;
    }
  }

  function stop() {
    abort.current?.abort();
    abort.current = null;
    setWorking(false);
    props.onBusy?.(false);
  }

  async function pick(option: LogoOption) {
    setSelected(option.id);
    setError("");
    try {
      const res = await fetch(option.url);
      if (!res.ok) throw new Error("missing");
      const blob = await res.blob();
      const type = blob.type === "image/jpeg" ? "image/jpeg" : "image/png";
      const ext = type === "image/jpeg" ? "jpg" : "png";
      const file = new File([blob], `${logoFileStem(logoWord(logoBriefOf(props.brief)), option.kind)}.${ext}`, { type });
      props.setLogo(file);
      props.setLogoUrl(option.url);
      props.setLogoSource("ai");
    } catch {
      setError("That logo couldn't be opened. Try another, or upload a file.");
    }
  }

  function useUpload() {
    stop();
    setOptions([]);
    setSelected("");
    setHint("");
    setError("");
    setVariation(0);
    if (props.logoSource === "ai") {
      props.setLogo(null);
      props.setLogoUrl("");
      props.setLogoSource("");
    }
  }

  function onFile(file: File | null) {
    props.setLogo(file);
    props.setLogoUrl("");
    props.setLogoSource(file ? "upload" : "");
    setSelected("");
    setHint("");
    setError("");
  }

  const showTiles = options.length > 0;
  return (
    <div className="block" data-logo-field>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label className="text-sm font-medium text-fg" htmlFor="ns-logo">
          Logo <span className="font-normal text-faint">(optional, PNG or JPG)</span>
        </label>
        {showTiles || working ? (
          <button type="button" onClick={useUpload} disabled={props.disabled} data-logo-upload-instead className={linkClass}>
            Upload a file instead
          </button>
        ) : (
          <button type="button" onClick={() => void make(false)} disabled={props.disabled} data-ai-logo-link className={linkClass}>
            Have AI make one
          </button>
        )}
      </div>
      {hint ? (
        <p className="mt-1.5 text-xs text-muted" data-logo-hint role="status">
          {hint}
        </p>
      ) : null}
      {!working && !showTiles ? (
        <>
          <input
            id="ns-logo"
            name="logo"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(event) => onFile(event.target.files?.[0] ?? null)}
            className="mt-1.5 block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-2 file:text-sm file:text-fg"
          />
          {props.logo ? <span className="mt-1 block text-xs text-muted">{props.logo.name}</span> : null}
        </>
      ) : null}
      {working ? (
        <div className="mt-3 flex flex-col items-center" data-logo-progress>
          <ProgressRing start={start} averageMs={25_000} compact />
          <RotatingStatus lines={LOGO_STATUS} />
          <button
            type="button"
            onClick={stop}
            data-logo-stop
            className="mt-3 inline-flex h-9 items-center justify-center rounded-md border border-border bg-bg px-4 text-sm font-medium text-fg shadow-sm transition-transform duration-150 hover:bg-surface active:scale-[0.96]"
          >
            Stop
          </button>
        </div>
      ) : null}
      {showTiles ? (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2" data-logo-options>
            {options.map((option) => {
              const on = selected === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  data-logo-option
                  data-kind={option.kind}
                  data-selected={on ? "true" : "false"}
                  onClick={() => void pick(option)}
                  disabled={working || props.disabled}
                  className={`rounded-lg border bg-bg p-1.5 text-center transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-50 ${
                    on ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/50"
                  }`}
                >
                  <img src={option.url} alt="" className="aspect-square w-full rounded-md bg-[#faf8f4] object-contain" />
                  <span className="mt-1 block truncate text-[11px] font-medium text-fg">{option.label}</span>
                </button>
              );
            })}
          </div>
          {props.logoSource === "ai" && props.logo ? <span className="mt-1.5 block text-xs text-muted">Using {props.logo.name}</span> : null}
          {!working ? (
            <button type="button" onClick={() => void make(true)} disabled={props.disabled} data-logo-more className={`mt-2 ${linkClass}`}>
              Make more
            </button>
          ) : null}
        </>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-danger" data-logo-error role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The two big choices at the top of the form (Bob's copy). Orange buttons, not checkboxes: the chosen one turns a
 * deeper orange with white text, a ring and a shadow; the other stays light orange with dark text.
 * A radio group for screen readers and keyboards (arrow keys move between the two).
 */
export type ModeChoice = "reimagine" | "newsite";
const CHOICES: { key: ModeChoice; title: string; lines: string[] }[] = [
  { key: "reimagine", title: "Reimagine My Site", lines: ["Let AI make it Better", "Lower your cost"] },
  { key: "newsite", title: "Build a New Site", lines: ["Use Yours or Get a Domain, Email, Hosting"] },
];

export function ModeChoices({ value, onChange }: { value: ModeChoice | null; onChange: (next: ModeChoice) => void }) {
  return (
    <div role="radiogroup" aria-label="What would you like to do?" className="grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr] sm:gap-3" data-mode-choices>
      {CHOICES.map((choice, i) => {
        const selected = value === choice.key;
        return [
          i > 0 ? <PickOne key="pick-one" /> : null,
          <button
            key={choice.key}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (!value && i === 0) ? 0 : -1}
            data-mode={choice.key}
            data-selected={selected ? "true" : "false"}
            onClick={() => onChange(choice.key)}
            onKeyDown={(event) => {
              if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
                event.preventDefault();
                const next = CHOICES[(i + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : CHOICES.length - 1)) % CHOICES.length]!;
                onChange(next.key);
                (event.currentTarget.parentElement?.querySelector(`[data-mode="${next.key}"]`) as HTMLElement | null)?.focus();
              }
            }}
            className={`flex min-h-24 flex-col items-start justify-center rounded-xl px-5 py-4 text-left transition duration-150 ease-out focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/50 active:scale-[0.98] ${
              selected
                ? "bg-[#a65400] text-white shadow-[0_10px_24px_-10px_rgba(150,70,0,0.9)] ring-4 ring-[#f89800]/45"
                : "bg-[#fdd9a0] text-ink hover:bg-[#fcc978]"
            }`}
          >
            <span className={`font-display text-xl font-semibold leading-tight sm:text-2xl ${selected ? "text-white" : "text-ink"}`}>{choice.title}</span>
            {choice.lines.map((line) => (
              <span key={line} className={`mt-0.5 text-sm ${selected ? "text-white/90" : "text-ink/75"}`}>
                {line}
              </span>
            ))}
          </button>,
        ];
      })}
    </div>
  );
}

/** Between the two choices: a two-sided arrow and "Pick one" (↔ side by side; ↕ when the buttons stack on phones). */
function PickOne() {
  return (
    <div className="flex items-center justify-center gap-2 py-0.5 text-muted sm:flex-col sm:gap-1 sm:py-0" aria-hidden="true" data-pick-one>
      <svg viewBox="0 0 48 16" className="-mx-3 my-4 h-4 w-12 rotate-90 sm:mx-0 sm:my-0 sm:rotate-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 8h40M10 2 4 8l6 6M38 2l6 6-6 6" />
      </svg>
      <span className="text-xs font-medium tracking-wide">Pick one</span>
    </div>
  );
}
