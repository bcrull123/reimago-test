import { useEffect, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { checkDomainName, selectDomain, suggestCreateStep } from "@/lib/reimagine.functions";
import { CREATE_STEP_IDS, stepIndex } from "@/lib/create-steps";
import { normalizeDomain, type DomainStatus } from "@/lib/domain-name";
import type { DomainCheck } from "@/lib/logicboxes-types";

const MAX_FILE = 10_000_000;
const MAX_PHOTOS = 20;

const INDUSTRIES = ["Restaurant", "Professional services", "Retail", "Home services", "Health", "Nonprofit", "Other"];
const LIKES = ["Layout", "Colors", "Fonts", "Imagery", "Features", "Tone of writing"];
const GOALS = ["Call us", "Book an appointment", "Buy online", "Get a quote", "Sign up", "Other"];
const PAGES = ["Home", "About", "Services/Products", "Pricing", "Portfolio", "Blog", "Contact", "Booking", "Shop", "FAQ"];
const STYLES = ["Professional", "Warm", "Bold", "Minimal", "Playful", "Elegant"];
const FEATURES = ["Booking", "Store/payments", "Blog", "Contact form", "Newsletter", "Chat", "Member login", "Multi-language"];

export type CreateBrief = {
  business_name: string;
  what: string;
  industry: string;
  location: string;
  existing_site: string;
  emulate_url_1: string;
  emulate_url_2: string;
  emulate_url_3: string;
  emulate_likes: string[];
  emulate_note: string;
  goal: string;
  customers: string;
  services: string;
  pages: string[];
  style: string;
  brand_color: string;
  phone: string;
  contact_email: string;
  address: string;
  hours: string;
  /** "have" = Yes, they own it; "find" = No, they searched and selected one; "later" = skipped. */
  domain_choice: "" | "have" | "find" | "later";
  domain: string;
  /** "owned", or "selected-pending-checkout" for a searched domain (not registered or paid for yet). */
  domain_status: DomainStatus;
  /** Set only when DOMAIN_CHECKOUT_URL (future Webhero cart) is configured. */
  domain_checkout_url: string;
  features: string[];
  product_count: string;
  files_link: string;
  copy_text: string;
  video_link: string;
  anything_else: string;
  files_note: string;
  ai_suggested: string[];
};

export type CreateFiles = {
  logo: File | null;
  brand: File | null;
  photos: File[];
  copy: File | null;
  testimonials: File | null;
  licenses: File | null;
  video: File | null;
};

const emptyBrief = (): CreateBrief => ({
  business_name: "",
  what: "",
  industry: "",
  location: "",
  existing_site: "",
  emulate_url_1: "",
  emulate_url_2: "",
  emulate_url_3: "",
  emulate_likes: [],
  emulate_note: "",
  goal: "",
  customers: "",
  services: "",
  pages: [],
  style: "",
  brand_color: "",
  phone: "",
  contact_email: "",
  address: "",
  hours: "",
  domain_choice: "",
  domain: "",
  domain_status: "",
  domain_checkout_url: "",
  features: [],
  product_count: "",
  files_link: "",
  copy_text: "",
  video_link: "",
  anything_else: "",
  files_note: "",
  ai_suggested: [],
});

const STEP_IDS = CREATE_STEP_IDS;
const LAST_STEP = STEP_IDS.length; // the review screen

const emptyFiles = (): CreateFiles => ({
  logo: null,
  brand: null,
  photos: [],
  copy: null,
  testimonials: null,
  licenses: null,
  video: null,
});

const fieldClass =
  "mt-1.5 flex h-12 w-full rounded-md border border-border bg-bg px-3 text-base text-fg outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring/70";

/**
 * Wizard answers live in memory only: they survive switching between the intent tabs, but a page
 * reload starts fresh. (E2E scripts may seed a brief via window.__reimagoSeedBrief before load.)
 */
let memory: { step: number; brief: CreateBrief } | null = null;

function loadBrief(): { step: number; brief: CreateBrief } {
  if (memory) return memory;
  const seed = typeof window !== "undefined" ? (window as { __reimagoSeedBrief?: { step?: number; brief?: Partial<CreateBrief> } }).__reimagoSeedBrief : undefined;
  if (seed && typeof seed === "object") {
    return { step: Math.min(LAST_STEP, Math.max(0, seed.step ?? 0)), brief: { ...emptyBrief(), ...seed.brief } };
  }
  return { step: 0, brief: emptyBrief() };
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function Chip({
  selected,
  children,
  onClick,
}: {
  selected: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 rounded-full border px-4 text-sm font-medium ${
        selected ? "border-primary bg-primary text-white" : "border-border bg-bg text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function FileSlot({
  label,
  accept,
  hint,
  multiple,
  files,
  onAdd,
  onRemove,
}: {
  label: string;
  accept: string;
  hint: string;
  multiple?: boolean;
  files: File[];
  onAdd: (next: File[]) => void;
  onRemove: (index: number) => void;
}) {
  function take(list: FileList | null) {
    if (!list?.length) return;
    const accepted: File[] = [];
    let rejected = false;
    for (const file of Array.from(list)) {
      if (file.size > MAX_FILE) {
        rejected = true;
        continue;
      }
      accepted.push(file);
    }
    if (rejected) setTooBig(true);
    if (accepted.length) onAdd(accepted);
  }
  const [tooBig, setTooBig] = useState(false);
  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    take(event.dataTransfer.files);
  }
  return (
    <div className="space-y-2">
      <label
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
        className="block cursor-pointer rounded-xl border-2 border-dashed border-primary/50 bg-bg px-4 py-4"
      >
        <span className="block text-sm font-medium text-fg">{label}</span>
        <span className="mt-1 block text-xs text-muted">{hint} Drop a file or tap to choose. 10 MB max.</span>
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          className="mt-3 block w-full text-sm"
          onChange={(event) => {
            take(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      {files.map((file, index) => (
        <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate text-fg">
            {file.name} <span className="text-muted">({Math.max(1, Math.round(file.size / 1024))} KB)</span>
          </span>
          <button type="button" className="shrink-0 text-primary" onClick={() => onRemove(index)}>
            Remove
          </button>
        </div>
      ))}
      {tooBig ? <p className="text-sm text-danger">Each file must be under 10 MB.</p> : null}
    </div>
  );
}

export function CreateSiteWizard({
  email,
  setEmail,
  agreed,
  setAgreed,
  working,
  error,
  mailed,
  onBuild,
}: {
  email: string;
  setEmail: (value: string) => void;
  agreed: boolean;
  setAgreed: (value: boolean) => void;
  working: boolean;
  error: string;
  mailed: string;
  onBuild: (brief: CreateBrief, files: CreateFiles) => void;
}) {
  const saved = loadBrief();
  const [step, setStep] = useState(saved.step);
  const [brief, setBrief] = useState<CreateBrief>(saved.brief);
  const [files, setFiles] = useState<CreateFiles>(emptyFiles());
  const [suggesting, setSuggesting] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const [choices, setChoices] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(1);
  const [suggestError, setSuggestError] = useState("");
  const [domainQuery, setDomainQuery] = useState(saved.brief.domain_status === "selected-pending-checkout" ? saved.brief.domain : "");
  const [domainResult, setDomainResult] = useState<DomainCheck | null>(null);
  const [domainChecking, setDomainChecking] = useState(false);
  const [domainError, setDomainError] = useState("");

  useEffect(() => {
    memory = { step, brief };
  }, [step, brief]);

  function patch(partial: Partial<CreateBrief>) {
    setBrief((current) => ({ ...current, ...partial }));
  }

  function forward() {
    setAiNote("");
    setChoices([]);
    setSuggestError("");
    setDomainError("");
    setStep((current) => Math.min(LAST_STEP, current + 1));
  }

  /** Continue: the domain step checks its answer first; every other step moves on. */
  function onContinue() {
    if (STEP_IDS[step] === "domain") {
      if (brief.domain_choice === "have") {
        const result = normalizeDomain(brief.domain);
        if (!result.domain) {
          setDomainError(result.error ?? "");
          return;
        }
        patch({ domain: result.domain, domain_status: "owned", domain_checkout_url: "" });
      } else if (brief.domain_choice === "find" && brief.domain_status !== "selected-pending-checkout") {
        setDomainError("Check a name and tap Select on an available domain, or tap Skip to decide later.");
        return;
      } else if (!brief.domain_choice) {
        patch({ domain_choice: "later", domain: "", domain_status: "", domain_checkout_url: "" });
      }
    }
    forward();
  }

  function chooseDomainPath(value: "have" | "find") {
    setDomainError("");
    if (value === brief.domain_choice) return;
    // Switching paths drops the other path's answer so a typed domain is never mistaken for a selected one.
    patch({ domain_choice: value, domain: "", domain_status: value === "have" ? "owned" : "", domain_checkout_url: "" });
    setDomainResult(null);
  }

  async function searchDomain(input?: string) {
    const query = (input ?? domainQuery).trim();
    setDomainError("");
    if (input !== undefined) setDomainQuery(query);
    if (!query) {
      setDomainError("Type a name to check, like yourbusiness.");
      return;
    }
    if (brief.domain_choice !== "find") patch({ domain_choice: "find", domain: "", domain_status: "", domain_checkout_url: "" });
    setDomainChecking(true);
    try {
      // degrade: in mock/dev, or if LogicBoxes is unreachable, the server returns a labelled sample instead of failing.
      setDomainResult(await checkDomainName({ data: { name: query, degrade: true } }));
    } catch (err) {
      setDomainResult(null);
      setDomainError(err instanceof Error ? err.message : "The domain check did not answer.");
    } finally {
      setDomainChecking(false);
    }
  }

  /**
   * "Select" only records the choice (domain_status "selected-pending-checkout"); nothing is registered or charged.
   * TODO(webhero-cart): real registration/checkout will go through the Webhero cart at alpha.webhero.com —
   * see src/lib/domain-checkout.server.ts and DOMAIN_CHECKOUT_URL (unset by default).
   */
  function chooseOffer(domain: string) {
    setDomainError("");
    patch({ domain_choice: "find", domain, domain_status: "selected-pending-checkout", domain_checkout_url: "" });
    void selectDomain({ data: { domain } })
      .then((result) => {
        if (result.checkoutUrl) setBrief((current) => (current.domain === domain ? { ...current, domain_checkout_url: result.checkoutUrl ?? "" } : current));
      })
      .catch(() => undefined);
  }

  function clearStep(index: number): Partial<CreateBrief> {
    const blanks: Record<(typeof STEP_IDS)[number], Partial<CreateBrief>> = {
      domain: { domain_choice: "later", domain: "", domain_status: "", domain_checkout_url: "" },
      business_name: { business_name: "" },
      industry: { what: "", industry: "" },
      location: { location: "" },
      existing_site: { existing_site: "" },
      emulate: { emulate_url_1: "", emulate_url_2: "", emulate_url_3: "", emulate_likes: [], emulate_note: "" },
      goal: { goal: "" },
      customers: { customers: "" },
      services: { services: "" },
      pages: { pages: [] },
      style: { style: "", brand_color: "" },
      contact: { phone: "", contact_email: "", address: "", hours: "" },
      features: { features: [], product_count: "" },
      files: { files_note: "" },
    };
    const id = STEP_IDS[index];
    return id ? blanks[id] : {};
  }

  function skip() {
    const id = STEP_IDS[step];
    setBrief((current) => ({
      ...current,
      ...clearStep(step),
      ai_suggested: current.ai_suggested.filter((item) => item !== id),
    }));
    forward();
  }

  async function letAiDecide() {
    setSuggesting(true);
    setSuggestError("");
    try {
      const result = await suggestCreateStep({ data: { step, brief, attempt } });
      const id = STEP_IDS[step];
      if (id === "files") {
        setBrief((current) => ({
          ...current,
          files_note: "AI will draft the pages and use placeholder images until you send photos.",
          ai_suggested: current.ai_suggested.includes(id) ? current.ai_suggested : [...current.ai_suggested, id],
        }));
      } else {
        setBrief((current) => ({
          ...current,
          ...result.patch,
          ai_suggested: current.ai_suggested.includes(id) ? current.ai_suggested : [...current.ai_suggested, id],
        }));
      }
      setChoices(result.choices);
      setAiNote(result.note);
      setAttempt((current) => current + 1);
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : "AI could not suggest an answer.");
    } finally {
      setSuggesting(false);
    }
  }

  const review = step === LAST_STEP;
  const domainLabel = brief.domain.split(".")[0] ?? "";
  const nameFromDomain = brief.domain && brief.domain_status ? domainLabel.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "";
  const domainSummary = !brief.domain
    ? brief.domain_choice === "later"
      ? "Decide later"
      : ""
    : brief.domain_status === "selected-pending-checkout"
      ? `${brief.domain} (selected — registration at checkout)`
      : `${brief.domain} (yours)`;
  const stepId = STEP_IDS[step];
  const titles: Record<(typeof STEP_IDS)[number], string> = {
    domain: "Do you already have a domain?",
    business_name: "Business name",
    industry: "What do you do?",
    location: "Location",
    existing_site: "Existing website",
    emulate: "Sites you want to emulate",
    goal: "Main goal",
    customers: "Who are your customers?",
    services: "Services or products",
    pages: "Pages you need",
    style: "Style and colors",
    contact: "Contact info and hours",
    features: "Features",
    files: "Add your files",
  };
  const title = stepId ? titles[stepId] : "";

  let body: ReactNode = null;
  if (stepId === "domain") {
    body = (
      <div className="space-y-4" data-step="domain">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Do you already have a domain?">
          {(
            [
              ["have", "Yes, I have one"],
              ["find", "No, help me find one"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 text-base ${
                brief.domain_choice === value ? "border-primary bg-primary/5 text-fg" : "border-border text-fg"
              }`}
            >
              <input type="radio" name="has-domain" checked={brief.domain_choice === value} onChange={() => chooseDomainPath(value)} className="size-5 accent-primary" />
              {label}
            </label>
          ))}
        </div>
        {brief.domain_choice === "have" ? (
          <label className="block text-sm font-medium text-fg">
            Your domain
            <input
              id="owned-domain"
              className={fieldClass}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="yourbusiness.com"
              value={brief.domain}
              onChange={(event) => {
                setDomainError("");
                patch({ domain: event.target.value, domain_status: "owned", domain_checkout_url: "" });
              }}
              onBlur={() => {
                const result = normalizeDomain(brief.domain);
                if (result.domain) patch({ domain: result.domain });
                else if (brief.domain.trim()) setDomainError(result.error ?? "");
              }}
            />
            <span className="mt-1 block text-xs font-normal text-muted">No need for https:// or www — we'll tidy it up.</span>
          </label>
        ) : null}
        {brief.domain_choice === "find" ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <label className="block min-w-0 flex-1 text-sm font-medium text-fg">
                Search for a domain
                <input
                  id="domain-search"
                  className={fieldClass}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={brief.business_name ? brief.business_name.toLowerCase().replace(/[^a-z0-9]+/g, "") : "yourbusiness"}
                  value={domainQuery}
                  onChange={(event) => setDomainQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void searchDomain();
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="mt-[1.6rem] h-12 shrink-0 rounded-md bg-primary px-4 text-sm font-semibold text-white disabled:opacity-40"
                disabled={domainChecking}
                onClick={() => void searchDomain()}
              >
                {domainChecking ? "Checking…" : "Check availability"}
              </button>
            </div>
            {domainResult?.note ? <p className="text-sm text-muted">{domainResult.note}</p> : null}
            {domainResult ? (
              <ul className="divide-y divide-border rounded-md border border-border text-sm" aria-label="Domain availability">
                {domainResult.offers.map((offer) => {
                  const chosen = brief.domain === offer.domain && brief.domain_status === "selected-pending-checkout";
                  return (
                    <li key={offer.domain} className="flex min-h-12 items-center justify-between gap-3 px-3">
                      <span className="font-medium text-fg">{offer.domain}</span>
                      {offer.state === "available" ? (
                        <button
                          type="button"
                          aria-pressed={chosen}
                          className={`h-9 min-w-24 rounded-md px-3 text-sm font-semibold ${chosen ? "bg-primary text-white" : "border border-primary text-primary"}`}
                          onClick={() => chooseOffer(offer.domain)}
                        >
                          {chosen ? "Selected ✓" : "Select"}
                        </button>
                      ) : (
                        <span className="text-muted">{offer.state === "taken" ? "Taken" : offer.state === "premium" ? "Premium, not offered" : "Unknown"}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {brief.domain && brief.domain_status === "selected-pending-checkout" ? (
              <p className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm text-fg">
                <span className="font-semibold">{brief.domain}</span> is selected. We'll build your site for it. Registration happens at checkout — nothing has been purchased yet.
              </p>
            ) : null}
          </div>
        ) : null}
        {domainError ? <p className="text-sm text-danger">{domainError}</p> : null}
      </div>
    );
  } else if (stepId === "business_name") {
    body = (
      <label className="block text-sm font-medium text-fg">
        Business name
        <input className={fieldClass} placeholder={nameFromDomain || "Acme Dental"} value={brief.business_name} onChange={(event) => patch({ business_name: event.target.value })} />
        {nameFromDomain && !brief.business_name ? (
          <button type="button" className="mt-2 min-h-11 rounded-full border border-primary px-4 text-sm font-medium text-primary" onClick={() => patch({ business_name: nameFromDomain })}>
            Use “{nameFromDomain}” from your domain
          </button>
        ) : null}
      </label>
    );
  } else if (stepId === "industry") {
    body = (
      <div className="space-y-3">
        <label className="block text-sm font-medium text-fg">
          What do you do?
          <input className={fieldClass} placeholder="Family dentist in Edmond" value={brief.what} onChange={(event) => patch({ what: event.target.value })} />
        </label>
        <div className="flex flex-wrap gap-2">
          {INDUSTRIES.map((item) => (
            <Chip key={item} selected={brief.industry === item} onClick={() => patch({ industry: brief.industry === item ? "" : item })}>
              {item}
            </Chip>
          ))}
        </div>
      </div>
    );
  } else if (stepId === "location") {
    body = (
      <label className="block text-sm font-medium text-fg">
        Location / service area
        <input className={fieldClass} placeholder="Oklahoma City metro" value={brief.location} onChange={(event) => patch({ location: event.target.value })} />
      </label>
    );
  } else if (stepId === "existing_site") {
    body = (
      <label className="block text-sm font-medium text-fg">
        Existing website, if any
        <input className={fieldClass} inputMode="url" placeholder="https://" value={brief.existing_site} onChange={(event) => patch({ existing_site: event.target.value })} />
        {brief.domain_status === "owned" && brief.domain && !brief.existing_site ? (
          <button type="button" className="mt-2 min-h-11 rounded-full border border-primary px-4 text-sm font-medium text-primary" onClick={() => patch({ existing_site: `https://${brief.domain}` })}>
            Use {brief.domain}
          </button>
        ) : null}
      </label>
    );
  } else if (stepId === "emulate") {
    body = (
      <div className="space-y-3 rounded-xl border-2 border-primary bg-bg p-3">
        {([1, 2, 3] as const).map((index) => {
          const key = `emulate_url_${index}` as const;
          return (
            <label key={key} className="block text-sm font-medium text-fg">
              Site {index}
              <input className={fieldClass} inputMode="url" placeholder="https://" value={brief[key]} onChange={(event) => patch({ [key]: event.target.value })} />
            </label>
          );
        })}
        <p className="text-sm font-medium text-fg">What do you like about it?</p>
        <div className="flex flex-wrap gap-2">
          {LIKES.map((item) => (
            <Chip key={item} selected={brief.emulate_likes.includes(item)} onClick={() => patch({ emulate_likes: toggle(brief.emulate_likes, item) })}>
              {item}
            </Chip>
          ))}
        </div>
        <label className="block text-sm font-medium text-fg">
          Note
          <textarea className="mt-1.5 min-h-20 w-full rounded-md border border-border bg-bg px-3 py-2 text-base text-fg outline-none" value={brief.emulate_note} onChange={(event) => patch({ emulate_note: event.target.value })} />
        </label>
        <p className="text-sm text-muted">We'll use these sites for layout and style inspiration only, not to copy their words, pictures, logo, or brand.</p>
      </div>
    );
  } else if (stepId === "goal") {
    body = (
      <div className="flex flex-wrap gap-2">
        {GOALS.map((item) => (
          <Chip key={item} selected={brief.goal === item} onClick={() => patch({ goal: brief.goal === item ? "" : item })}>
            {item}
          </Chip>
        ))}
      </div>
    );
  } else if (stepId === "customers") {
    body = (
      <label className="block text-sm font-medium text-fg">
        Who are your customers?
        <textarea className="mt-1.5 min-h-24 w-full rounded-md border border-border bg-bg px-3 py-2 text-base text-fg outline-none" value={brief.customers} onChange={(event) => patch({ customers: event.target.value })} />
      </label>
    );
  } else if (stepId === "services") {
    body = (
      <label className="block text-sm font-medium text-fg">
        Services or products
        <textarea className="mt-1.5 min-h-24 w-full rounded-md border border-border bg-bg px-3 py-2 text-base text-fg outline-none" placeholder="One per line, or paste a list" value={brief.services} onChange={(event) => patch({ services: event.target.value })} />
      </label>
    );
  } else if (stepId === "pages") {
    body = (
      <div className="flex flex-wrap gap-2">
        {PAGES.map((item) => (
          <Chip key={item} selected={brief.pages.includes(item)} onClick={() => patch({ pages: toggle(brief.pages, item) })}>
            {item}
          </Chip>
        ))}
      </div>
    );
  } else if (stepId === "style") {
    body = (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {STYLES.map((item) => (
            <Chip key={item} selected={brief.style === item} onClick={() => patch({ style: brief.style === item ? "" : item })}>
              {item}
            </Chip>
          ))}
        </div>
        <label className="block text-sm font-medium text-fg">
          Brand color
          <span className="mt-1.5 flex items-center gap-3">
            <input type="color" value={brief.brand_color || "#0068e8"} onChange={(event) => patch({ brand_color: event.target.value })} className="size-12 bg-transparent" />
            <input className={fieldClass} placeholder="#0068E8" value={brief.brand_color} onChange={(event) => patch({ brand_color: event.target.value })} />
          </span>
        </label>
      </div>
    );
  } else if (stepId === "contact") {
    body = (
      <div className="space-y-3">
        {(
          [
            ["Phone", "phone", "tel"],
            ["Email", "contact_email", "email"],
            ["Address", "address", "text"],
            ["Hours", "hours", "text"],
          ] as const
        ).map(([label, key, type]) => (
          <label key={key} className="block text-sm font-medium text-fg">
            {label}
            <input className={fieldClass} type={type === "text" ? "text" : type} value={brief[key]} onChange={(event) => patch({ [key]: event.target.value })} />
          </label>
        ))}
      </div>
    );
  } else if (stepId === "features") {
    body = (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {FEATURES.map((item) => (
            <Chip key={item} selected={brief.features.includes(item)} onClick={() => patch({ features: toggle(brief.features, item) })}>
              {item}
            </Chip>
          ))}
        </div>
        {brief.features.includes("Store/payments") ? (
          <label className="block text-sm font-medium text-fg">
            About how many products?
            <input className={fieldClass} inputMode="numeric" value={brief.product_count} onChange={(event) => patch({ product_count: event.target.value })} />
          </label>
        ) : null}
      </div>
    );
  } else if (stepId === "files") {
    body = (
      <div className="space-y-4">
        <FileSlot label="Logo" accept=".svg,.pdf,.png,.jpg,.jpeg" hint="SVG, PDF, PNG, or JPG." files={files.logo ? [files.logo] : []} onAdd={(next) => setFiles((current) => ({ ...current, logo: next[0] ?? current.logo }))} onRemove={() => setFiles((current) => ({ ...current, logo: null }))} />
        <FileSlot label="Brand colors, fonts, or style guide" accept=".pdf,.png,.jpg,.jpeg,.docx" hint="PDF, PNG, JPG, or DOCX." files={files.brand ? [files.brand] : []} onAdd={(next) => setFiles((current) => ({ ...current, brand: next[0] ?? current.brand }))} onRemove={() => setFiles((current) => ({ ...current, brand: null }))} />
        <FileSlot label="Photos" accept=".jpg,.jpeg,.png,.webp,.heic" hint="JPG, PNG, WEBP, or HEIC. Up to 20." multiple files={files.photos} onAdd={(next) => setFiles((current) => ({ ...current, photos: [...current.photos, ...next].slice(0, MAX_PHOTOS) }))} onRemove={(index) => setFiles((current) => ({ ...current, photos: current.photos.filter((_, item) => item !== index) }))} />
        <FileSlot label="Existing copy, menu, or price list" accept=".pdf,.docx,.txt,.csv,.xlsx" hint="PDF, DOCX, TXT, CSV, or XLSX." files={files.copy ? [files.copy] : []} onAdd={(next) => setFiles((current) => ({ ...current, copy: next[0] ?? current.copy }))} onRemove={() => setFiles((current) => ({ ...current, copy: null }))} />
        <label className="block text-sm font-medium text-fg">
          Or paste the copy
          <textarea className="mt-1.5 min-h-24 w-full rounded-md border border-border bg-bg px-3 py-2 text-base text-fg outline-none" value={brief.copy_text} onChange={(event) => patch({ copy_text: event.target.value })} />
        </label>
        <FileSlot label="Testimonials" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" hint="PDF, DOCX, TXT, or a screenshot." files={files.testimonials ? [files.testimonials] : []} onAdd={(next) => setFiles((current) => ({ ...current, testimonials: next[0] ?? current.testimonials }))} onRemove={() => setFiles((current) => ({ ...current, testimonials: null }))} />
        <FileSlot label="Licenses or awards" accept=".pdf,.png,.jpg,.jpeg" hint="PDF, PNG, or JPG." files={files.licenses ? [files.licenses] : []} onAdd={(next) => setFiles((current) => ({ ...current, licenses: next[0] ?? current.licenses }))} onRemove={() => setFiles((current) => ({ ...current, licenses: null }))} />
        <FileSlot label="Video" accept=".mp4,.mov" hint="MP4 or MOV." files={files.video ? [files.video] : []} onAdd={(next) => setFiles((current) => ({ ...current, video: next[0] ?? current.video }))} onRemove={() => setFiles((current) => ({ ...current, video: null }))} />
        <label className="block text-sm font-medium text-fg">
          YouTube or Vimeo link
          <input className={fieldClass} inputMode="url" placeholder="https://" value={brief.video_link} onChange={(event) => patch({ video_link: event.target.value })} />
        </label>
        <label className="block text-sm font-medium text-fg">
          Google Drive or Dropbox link
          <input className={fieldClass} inputMode="url" placeholder="https://" value={brief.files_link} onChange={(event) => patch({ files_link: event.target.value })} />
        </label>
      </div>
    );
  }

  const rows: { label: string; value: string; edit: number }[] = [
    { label: "Domain", value: domainSummary, edit: stepIndex("domain") },
    { label: "Business name", value: brief.business_name, edit: stepIndex("business_name") },
    { label: "What you do", value: [brief.industry, brief.what].filter(Boolean).join(" — "), edit: stepIndex("industry") },
    { label: "Location", value: brief.location, edit: stepIndex("location") },
    { label: "Existing site", value: brief.existing_site, edit: stepIndex("existing_site") },
    { label: "Emulate", value: [brief.emulate_url_1, brief.emulate_url_2, brief.emulate_url_3].filter(Boolean).join(", "), edit: stepIndex("emulate") },
    { label: "Likes", value: brief.emulate_likes.join(", "), edit: stepIndex("emulate") },
    { label: "Goal", value: brief.goal, edit: stepIndex("goal") },
    { label: "Customers", value: brief.customers, edit: stepIndex("customers") },
    { label: "Services", value: brief.services, edit: stepIndex("services") },
    { label: "Pages", value: (brief.pages.length ? brief.pages : ["Home", "About", "Services", "Contact"]).join(", "), edit: stepIndex("pages") },
    { label: "Style", value: [brief.style, brief.brand_color].filter(Boolean).join(" "), edit: stepIndex("style") },
    { label: "Contact", value: [brief.phone, brief.contact_email, brief.address, brief.hours].filter(Boolean).join(" · "), edit: stepIndex("contact") },
    { label: "Features", value: [brief.features.join(", "), brief.product_count].filter(Boolean).join(" · "), edit: stepIndex("features") },
    {
      label: "Files",
      value: [files.logo, files.brand, ...files.photos, files.copy, files.testimonials, files.licenses, files.video]
        .filter((file): file is File => Boolean(file))
        .map((file) => file.name)
        .concat(brief.files_link ? [brief.files_link] : [])
        .concat(brief.files_note ? [brief.files_note] : [])
        .join(", "),
      edit: stepIndex("files"),
    },
  ];

  return (
    <div className="space-y-4">
      {review ? (
        <div className="space-y-4">
          <p className="text-sm font-medium text-fg">Review</p>
          <ul className="space-y-2 text-sm">
            {rows.map((row) => (
              <li key={row.label} className="flex items-start justify-between gap-3">
                <span>
                  <span className="font-medium text-fg">{row.label}. </span>
                  <span className="text-muted">{row.value || "AI will decide"}</span>
                </span>
                <button type="button" className="shrink-0 text-primary" onClick={() => setStep(row.edit)}>
                  Edit
                </button>
              </li>
            ))}
          </ul>
          <label className="block text-sm font-medium text-fg">
            Anything else we should know?
            <textarea className="mt-1.5 min-h-24 w-full rounded-md border border-border bg-bg px-3 py-2 text-base text-fg outline-none" value={brief.anything_else} onChange={(event) => patch({ anything_else: event.target.value })} />
          </label>
          <label className="block text-sm font-medium text-fg" htmlFor="site-email">
            Email
            <input id="site-email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" className={fieldClass} />
          </label>
          <label className="flex items-start gap-2.5 text-sm text-muted">
            <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} className="mt-1 size-5 shrink-0 accent-fg" />
            <span>
              I agree to the <Link to="/terms" className="text-fg underline-offset-4 hover:underline">Terms of Service</Link> and{" "}
              <Link to="/privacy" className="text-fg underline-offset-4 hover:underline">Privacy Policy</Link>.
            </span>
          </label>
          <button
            type="button"
            disabled={working}
            onClick={() => onBuild(brief, files)}
            className="inline-flex h-12 w-full items-center justify-center rounded-md bg-accent px-6 text-base font-semibold text-ink disabled:opacity-40"
          >
            {working ? "Building the site…" : "Build my new site"}
          </button>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {mailed ? <p className="text-sm text-muted">{mailed}</p> : null}
          <button type="button" className="h-12 text-sm font-medium text-fg" onClick={() => setStep(stepIndex("files"))}>
            Back
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between text-sm text-muted">
              <span>Step {step + 1} of {LAST_STEP}</span>
              <span>{title}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-border">
              <div className="h-full bg-primary" style={{ width: `${((step + 1) / LAST_STEP) * 100}%` }} />
            </div>
          </div>
          <h2 className="font-display text-2xl text-ink">{title}</h2>
          {stepId !== "domain" && brief.domain ? (
            <p className="inline-flex flex-wrap items-center gap-2 rounded-full border border-border bg-bg px-3 py-1 text-sm text-muted" data-domain-badge>
              <span>
                Domain: <span className="font-semibold text-fg">{brief.domain}</span>
              </span>
              <span className="text-xs">{brief.domain_status === "selected-pending-checkout" ? "Selected · registration at checkout" : "Yours"}</span>
              <button type="button" className="text-xs text-primary" onClick={() => setStep(stepIndex("domain"))}>
                Change
              </button>
            </p>
          ) : null}
          {body}
          {choices.length ? (
            <div className="flex flex-wrap gap-2">
              {choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className="min-h-11 rounded-full border border-primary px-4 text-sm font-medium text-primary"
                  onClick={() => (stepId === "domain" ? void searchDomain(choice) : patch({ business_name: choice }))}
                >
                  {choice}
                </button>
              ))}
            </div>
          ) : null}
          {aiNote ? <p className="text-sm text-muted">{aiNote}</p> : null}
          {brief.files_note && stepId === "files" ? <p className="text-sm text-muted">{brief.files_note}</p> : null}
          {suggestError ? <p className="text-sm text-danger">{suggestError}</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="h-12 rounded-md border border-border text-sm font-medium text-fg disabled:opacity-40" disabled={step === 0 || suggesting} onClick={() => setStep((current) => Math.max(0, current - 1))}>
              Back
            </button>
            <button type="button" className="h-12 rounded-md bg-accent text-sm font-semibold text-ink disabled:opacity-40" disabled={suggesting} onClick={onContinue}>
              Continue
            </button>
            <button type="button" className="h-12 rounded-md border border-border text-sm font-medium text-fg disabled:opacity-40" disabled={suggesting} onClick={skip}>
              Skip
            </button>
            <button type="button" className="h-12 rounded-md border border-primary text-sm font-medium text-primary disabled:opacity-40" disabled={suggesting} onClick={() => void letAiDecide()}>
              {suggesting ? "Thinking…" : aiNote ? "Try another" : "Let AI decide"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
