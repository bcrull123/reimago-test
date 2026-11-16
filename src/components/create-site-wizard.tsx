import { useEffect, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { suggestCreateStep } from "@/lib/reimagine.functions";

const BRIEF_KEY = "reimago-create-brief-v1";
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
  domain_choice: "" | "have" | "find" | "later";
  domain: string;
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
  features: [],
  product_count: "",
  files_link: "",
  copy_text: "",
  video_link: "",
  anything_else: "",
  files_note: "",
  ai_suggested: [],
});

const STEP_IDS = [
  "business_name",
  "industry",
  "location",
  "existing_site",
  "emulate",
  "goal",
  "customers",
  "services",
  "pages",
  "style",
  "contact",
  "domain",
  "features",
  "files",
] as const;

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

function loadBrief(): { step: number; brief: CreateBrief } {
  try {
    const raw = localStorage.getItem(BRIEF_KEY);
    if (!raw) return { step: 0, brief: emptyBrief() };
    const saved = JSON.parse(raw) as { step?: number; brief?: Partial<CreateBrief> };
    return { step: Math.min(14, Math.max(0, saved.step ?? 0)), brief: { ...emptyBrief(), ...saved.brief } };
  } catch {
    return { step: 0, brief: emptyBrief() };
  }
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

  useEffect(() => {
    try {
      localStorage.setItem(BRIEF_KEY, JSON.stringify({ step, brief }));
    } catch {
      // A full browser store should not block the wizard.
    }
  }, [step, brief]);

  function patch(partial: Partial<CreateBrief>) {
    setBrief((current) => ({ ...current, ...partial }));
  }

  function forward() {
    setAiNote("");
    setChoices([]);
    setSuggestError("");
    setStep((current) => Math.min(14, current + 1));
  }

  function clearStep(index: number): Partial<CreateBrief> {
    const blanks: Partial<CreateBrief>[] = [
      { business_name: "" },
      { what: "", industry: "" },
      { location: "" },
      { existing_site: "" },
      { emulate_url_1: "", emulate_url_2: "", emulate_url_3: "", emulate_likes: [], emulate_note: "" },
      { goal: "" },
      { customers: "" },
      { services: "" },
      { pages: [] },
      { style: "", brand_color: "" },
      { phone: "", contact_email: "", address: "", hours: "" },
      { domain_choice: "", domain: "" },
      { features: [], product_count: "" },
      { files_note: "" },
    ];
    return blanks[index] ?? {};
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
      if (step === 13) {
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

  const review = step === 14;
  const title = [
    "Business name",
    "What do you do?",
    "Location",
    "Existing website",
    "Sites you want to emulate",
    "Main goal",
    "Who are your customers?",
    "Services or products",
    "Pages you need",
    "Style and colors",
    "Contact info and hours",
    "Domain",
    "Features",
    "Add your files",
  ][step];

  let body: ReactNode = null;
  if (step === 0) {
    body = (
      <label className="block text-sm font-medium text-fg">
        Business name
        <input className={fieldClass} placeholder="Acme Dental" value={brief.business_name} onChange={(event) => patch({ business_name: event.target.value })} />
      </label>
    );
  } else if (step === 1) {
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
  } else if (step === 2) {
    body = (
      <label className="block text-sm font-medium text-fg">
        Location / service area
        <input className={fieldClass} placeholder="Oklahoma City metro" value={brief.location} onChange={(event) => patch({ location: event.target.value })} />
      </label>
    );
  } else if (step === 3) {
    body = (
      <label className="block text-sm font-medium text-fg">
        Existing website, if any
        <input className={fieldClass} inputMode="url" placeholder="https://" value={brief.existing_site} onChange={(event) => patch({ existing_site: event.target.value })} />
      </label>
    );
  } else if (step === 4) {
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
  } else if (step === 5) {
    body = (
      <div className="flex flex-wrap gap-2">
        {GOALS.map((item) => (
          <Chip key={item} selected={brief.goal === item} onClick={() => patch({ goal: brief.goal === item ? "" : item })}>
            {item}
          </Chip>
        ))}
      </div>
    );
  } else if (step === 6) {
    body = (
      <label className="block text-sm font-medium text-fg">
        Who are your customers?
        <textarea className="mt-1.5 min-h-24 w-full rounded-md border border-border bg-bg px-3 py-2 text-base text-fg outline-none" value={brief.customers} onChange={(event) => patch({ customers: event.target.value })} />
      </label>
    );
  } else if (step === 7) {
    body = (
      <label className="block text-sm font-medium text-fg">
        Services or products
        <textarea className="mt-1.5 min-h-24 w-full rounded-md border border-border bg-bg px-3 py-2 text-base text-fg outline-none" placeholder="One per line, or paste a list" value={brief.services} onChange={(event) => patch({ services: event.target.value })} />
      </label>
    );
  } else if (step === 8) {
    body = (
      <div className="flex flex-wrap gap-2">
        {PAGES.map((item) => (
          <Chip key={item} selected={brief.pages.includes(item)} onClick={() => patch({ pages: toggle(brief.pages, item) })}>
            {item}
          </Chip>
        ))}
      </div>
    );
  } else if (step === 9) {
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
  } else if (step === 10) {
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
  } else if (step === 11) {
    body = (
      <div className="space-y-3">
        {(
          [
            ["have", "I have one"],
            ["find", "Help me find one"],
            ["later", "Decide later"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex min-h-11 items-center gap-3 text-base text-fg">
            <input type="radio" checked={brief.domain_choice === value} onChange={() => patch({ domain_choice: value })} className="size-5 accent-primary" />
            {label}
          </label>
        ))}
        {brief.domain_choice === "have" ? (
          <input className={fieldClass} placeholder="yourbusiness.com" value={brief.domain} onChange={(event) => patch({ domain: event.target.value })} />
        ) : null}
      </div>
    );
  } else if (step === 12) {
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
  } else if (step === 13) {
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
    { label: "Business name", value: brief.business_name, edit: 0 },
    { label: "What you do", value: [brief.industry, brief.what].filter(Boolean).join(" — "), edit: 1 },
    { label: "Location", value: brief.location, edit: 2 },
    { label: "Existing site", value: brief.existing_site, edit: 3 },
    { label: "Emulate", value: [brief.emulate_url_1, brief.emulate_url_2, brief.emulate_url_3].filter(Boolean).join(", "), edit: 4 },
    { label: "Likes", value: brief.emulate_likes.join(", "), edit: 4 },
    { label: "Goal", value: brief.goal, edit: 5 },
    { label: "Customers", value: brief.customers, edit: 6 },
    { label: "Services", value: brief.services, edit: 7 },
    { label: "Pages", value: (brief.pages.length ? brief.pages : ["Home", "About", "Services", "Contact"]).join(", "), edit: 8 },
    { label: "Style", value: [brief.style, brief.brand_color].filter(Boolean).join(" "), edit: 9 },
    { label: "Contact", value: [brief.phone, brief.contact_email, brief.address, brief.hours].filter(Boolean).join(" · "), edit: 10 },
    { label: "Domain", value: brief.domain_choice === "have" ? brief.domain : brief.domain_choice, edit: 11 },
    { label: "Features", value: [brief.features.join(", "), brief.product_count].filter(Boolean).join(" · "), edit: 12 },
    {
      label: "Files",
      value: [files.logo, files.brand, ...files.photos, files.copy, files.testimonials, files.licenses, files.video]
        .filter((file): file is File => Boolean(file))
        .map((file) => file.name)
        .concat(brief.files_link ? [brief.files_link] : [])
        .concat(brief.files_note ? [brief.files_note] : [])
        .join(", "),
      edit: 13,
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
          <button type="button" className="h-12 text-sm font-medium text-fg" onClick={() => setStep(13)}>
            Back
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between text-sm text-muted">
              <span>Step {step + 1} of 14</span>
              <span>{title}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-border">
              <div className="h-full bg-primary" style={{ width: `${((step + 1) / 14) * 100}%` }} />
            </div>
          </div>
          <h2 className="font-display text-2xl text-ink">{title}</h2>
          {body}
          {choices.length ? (
            <div className="flex flex-wrap gap-2">
              {choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className="min-h-11 rounded-full border border-primary px-4 text-sm font-medium text-primary"
                  onClick={() => (step === 0 ? patch({ business_name: choice }) : patch({ domain: choice }))}
                >
                  {choice}
                </button>
              ))}
            </div>
          ) : null}
          {aiNote ? <p className="text-sm text-muted">{aiNote}</p> : null}
          {brief.files_note && step === 13 ? <p className="text-sm text-muted">{brief.files_note}</p> : null}
          {suggestError ? <p className="text-sm text-danger">{suggestError}</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="h-12 rounded-md border border-border text-sm font-medium text-fg disabled:opacity-40" disabled={step === 0 || suggesting} onClick={() => setStep((current) => Math.max(0, current - 1))}>
              Back
            </button>
            <button type="button" className="h-12 rounded-md bg-accent text-sm font-semibold text-ink disabled:opacity-40" disabled={suggesting} onClick={forward}>
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
