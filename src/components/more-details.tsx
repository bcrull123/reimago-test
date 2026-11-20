/**
 * Round 10d — optional "Add more details" expander on Build a New Site. Collapsed by default so the form stays
 * a quick single page. The extra answers (all optional) come from the old step-by-step wizard: services, hours,
 * pages, contact, social links, photos, and the rest. Nothing is tied to one kind of business.
 */
import { extraDetailsCount, NEW_SITE_FEATURES, NEW_SITE_GOALS, NEW_SITE_PAGES, type NewSiteBrief } from "@/lib/new-site";

const fieldClass =
  "mt-1.5 flex h-11 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring/70";
const areaClass =
  "mt-1.5 flex min-h-20 w-full rounded-md border border-border bg-bg px-3 py-2.5 text-sm text-fg outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring/70";

const MAX_PHOTOS = 12;
const MAX_PHOTO_BYTES = 2_500_000;

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      data-chip={children}
      data-selected={selected ? "true" : "false"}
      onClick={onClick}
      className={`min-h-9 rounded-full border px-3 text-sm transition ${selected ? "border-primary bg-primary/10 text-fg" : "border-border bg-bg text-muted hover:border-primary/50 hover:text-fg"}`}
    >
      {children}
    </button>
  );
}

function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function MoreDetails(props: {
  brief: NewSiteBrief;
  setBrief: (next: NewSiteBrief) => void;
  photos: File[];
  setPhotos: (files: File[]) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  disabled?: boolean;
}) {
  const { brief, setBrief, photos, open } = props;
  const set = (key: keyof NewSiteBrief) => (event: { target: { value: string } }) => setBrief({ ...brief, [key]: event.target.value });
  const count = extraDetailsCount(brief, photos.length);
  return (
    <div data-more-details>
      <button
        type="button"
        data-more-details-toggle
        aria-expanded={open}
        onClick={() => props.setOpen(!open)}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {open ? "Hide extra details" : count ? `Add more details (${count} added)` : "Add more details"}
      </button>
      {!open ? (
        <p className="mt-1 text-xs text-muted">Optional — services, hours, pages, contact, social links, photos, and anything else you want in the looks.</p>
      ) : (
        <div className="mt-3 space-y-4 rounded-xl border border-border bg-surface/40 p-4" data-more-details-fields>
          <p className="text-xs text-muted">Everything here is optional. Whatever you add is used in the three looks and sent with your request.</p>

          <div>
            <span className="text-sm font-medium text-fg">Services or offerings</span>
            <textarea id="ns-services" name="services" value={brief.services} onChange={set("services")} maxLength={1000} rows={3} placeholder="One per line — color, cuts, highlights…" className={areaClass} />
          </div>

          <div>
            <span className="text-sm font-medium text-fg">Pages you want</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5" data-ns-pages>
              {NEW_SITE_PAGES.map((item) => (
                <Chip key={item} selected={brief.pages.includes(item)} onClick={() => setBrief({ ...brief, pages: toggle(brief.pages, item) })}>
                  {item}
                </Chip>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block" htmlFor="ns-phone">
              <span className="text-sm font-medium text-fg">Phone</span>
              <input id="ns-phone" name="phone" value={brief.phone} onChange={set("phone")} maxLength={40} placeholder="(555) 123-4567" className={fieldClass} />
            </label>
            <label className="block" htmlFor="ns-contact-email">
              <span className="text-sm font-medium text-fg">Business email</span>
              <input id="ns-contact-email" name="contact_email" value={brief.contact_email} onChange={set("contact_email")} type="email" maxLength={200} placeholder="hello@yourbusiness.com" className={fieldClass} />
            </label>
            <label className="block sm:col-span-2" htmlFor="ns-address">
              <span className="text-sm font-medium text-fg">Address</span>
              <input id="ns-address" name="address" value={brief.address} onChange={set("address")} maxLength={160} placeholder="123 Main Street, City, ST" className={fieldClass} />
            </label>
            <label className="block sm:col-span-2" htmlFor="ns-hours">
              <span className="text-sm font-medium text-fg">Hours</span>
              <textarea id="ns-hours" name="hours" value={brief.hours} onChange={set("hours")} maxLength={300} rows={2} placeholder="Mon–Fri 9–5&#10;Sat 10–2" className={areaClass} />
            </label>
          </div>

          <label className="block" htmlFor="ns-social">
            <span className="text-sm font-medium text-fg">Social links</span>
            <textarea id="ns-social" name="social" value={brief.social} onChange={set("social")} maxLength={1000} rows={2} placeholder="One link per line — instagram.com/yourbusiness" className={areaClass} />
          </label>

          <div data-ns-photos>
            <span className="text-sm font-medium text-fg">
              Photos <span className="font-normal text-faint">(optional, PNG or JPG, up to {MAX_PHOTOS})</span>
            </span>
            <p className="mt-0.5 text-xs text-muted">These are used in the looks ahead of generated art. Larger photos work best.</p>
            <input
              id="ns-photos"
              name="photos"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              disabled={props.disabled}
              onChange={(event) => {
                const added = [...(event.target.files ?? [])].filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type) && f.size <= MAX_PHOTO_BYTES);
                props.setPhotos([...photos, ...added].slice(0, MAX_PHOTOS));
                event.target.value = "";
              }}
              className="mt-1.5 block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-2 file:text-sm file:text-fg"
            />
            {photos.length ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {photos.map((file, i) => (
                  <li key={`${file.name}-${i}`} className="flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 text-xs text-muted">
                    <span className="max-w-36 truncate">{file.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      data-remove-photo={i}
                      onClick={() => props.setPhotos(photos.filter((_, j) => j !== i))}
                      className="text-fg hover:text-danger"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div>
            <span className="text-sm font-medium text-fg">Main goal for visitors</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5" data-ns-goals>
              {NEW_SITE_GOALS.map((item) => (
                <Chip key={item} selected={brief.goal === item} onClick={() => setBrief({ ...brief, goal: brief.goal === item ? "" : item })}>
                  {item}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <span className="text-sm font-medium text-fg">Features you want</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5" data-ns-features>
              {NEW_SITE_FEATURES.map((item) => (
                <Chip key={item} selected={brief.features.includes(item)} onClick={() => setBrief({ ...brief, features: toggle(brief.features, item) })}>
                  {item}
                </Chip>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block" htmlFor="ns-industry">
              <span className="text-sm font-medium text-fg">Industry or type of business</span>
              <input id="ns-industry" name="industry" value={brief.industry} onChange={set("industry")} maxLength={60} placeholder="Salon, clinic, shop, studio…" className={fieldClass} />
            </label>
            <label className="block" htmlFor="ns-customers">
              <span className="text-sm font-medium text-fg">Who you serve</span>
              <input id="ns-customers" name="customers" value={brief.customers} onChange={set("customers")} maxLength={200} placeholder="Busy professionals, families…" className={fieldClass} />
            </label>
            <label className="block" htmlFor="ns-color">
              <span className="text-sm font-medium text-fg">Brand color</span>
              <input id="ns-color" name="brand_color" value={brief.brand_color} onChange={set("brand_color")} maxLength={7} placeholder="#1a365d" className={fieldClass} />
            </label>
            <label className="block" htmlFor="ns-existing">
              <span className="text-sm font-medium text-fg">Current website, if you have one</span>
              <input id="ns-existing" name="existing_site" value={brief.existing_site} onChange={set("existing_site")} inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={200} placeholder="https://…" className={fieldClass} />
            </label>
          </div>

          <div>
            <span className="text-sm font-medium text-fg">Sites you like the look of</span>
            <p className="mt-0.5 text-xs text-muted">Optional — up to three, plus a note about what you like.</p>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
              {(["emulate_url_1", "emulate_url_2", "emulate_url_3"] as const).map((key, i) => (
                <input key={key} id={`ns-${key}`} name={key} value={brief[key]} onChange={set(key)} inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={200} placeholder={`example.com #${i + 1}`} aria-label={`Site to emulate ${i + 1}`} className={fieldClass} />
              ))}
            </div>
            <textarea id="ns-emulate-note" name="emulate_note" value={brief.emulate_note} onChange={set("emulate_note")} maxLength={300} rows={2} placeholder="What you like about them — colors, layout, tone…" className={areaClass} />
          </div>

          <label className="block" htmlFor="ns-copy">
            <span className="text-sm font-medium text-fg">Words you already use</span>
            <textarea id="ns-copy" name="copy_text" value={brief.copy_text} onChange={set("copy_text")} maxLength={2000} rows={3} placeholder="Headlines, an about paragraph, a welcome message…" className={areaClass} />
          </label>
          <label className="block" htmlFor="ns-else">
            <span className="text-sm font-medium text-fg">Anything else we should know</span>
            <textarea id="ns-else" name="anything_else" value={brief.anything_else} onChange={set("anything_else")} maxLength={800} rows={2} className={areaClass} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block" htmlFor="ns-files-link">
              <span className="text-sm font-medium text-fg">Link to more files</span>
              <input id="ns-files-link" name="files_link" value={brief.files_link} onChange={set("files_link")} inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={300} placeholder="A shared folder, if you have one" className={fieldClass} />
            </label>
            <label className="block" htmlFor="ns-video">
              <span className="text-sm font-medium text-fg">Video link</span>
              <input id="ns-video" name="video_link" value={brief.video_link} onChange={set("video_link")} inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={300} placeholder="YouTube, Vimeo…" className={fieldClass} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
