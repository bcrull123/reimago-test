/** Round 10 — "Build a New Site": the owner's answers (no source site), checked and mapped for factsFromBrief. */
export type NewSiteDomainChoice = "" | "have" | "get";

/** Optional chip lists (same ideas as the old wizard; nothing is tied to one trade). */
export const NEW_SITE_PAGES = ["Home", "About", "Services/Products", "Pricing", "Portfolio", "Blog", "Contact", "Booking", "Shop", "FAQ"] as const;
export const NEW_SITE_GOALS = ["Call us", "Book an appointment", "Buy online", "Get a quote", "Sign up", "Other"] as const;
export const NEW_SITE_FEATURES = ["Booking", "Store/payments", "Blog", "Contact form", "Newsletter", "Chat", "Member login", "Multi-language"] as const;

export type NewSiteBrief = {
  business_name: string;
  /** What the business does and who it serves (one box). */
  what: string;
  location: string;
  style: string;
  /** "have" = "I have a domain" (+ domain); "get" = "Get me a domain, email & hosting" (recorded only). */
  domain_choice: NewSiteDomainChoice;
  domain: string;
  // Round 10d — optional "Add more details" (all empty by default; none are required).
  industry: string;
  customers: string;
  services: string;
  pages: string[];
  goal: string;
  features: string[];
  brand_color: string;
  phone: string;
  contact_email: string;
  address: string;
  hours: string;
  /** Social profile URLs, one per line. */
  social: string;
  existing_site: string;
  emulate_url_1: string;
  emulate_url_2: string;
  emulate_url_3: string;
  emulate_note: string;
  copy_text: string;
  anything_else: string;
  files_link: string;
  video_link: string;
};

export const emptyNewSite = (): NewSiteBrief => ({
  business_name: "",
  what: "",
  location: "",
  style: "",
  domain_choice: "",
  domain: "",
  industry: "",
  customers: "",
  services: "",
  pages: [],
  goal: "",
  features: [],
  brand_color: "",
  phone: "",
  contact_email: "",
  address: "",
  hours: "",
  social: "",
  existing_site: "",
  emulate_url_1: "",
  emulate_url_2: "",
  emulate_url_3: "",
  emulate_note: "",
  copy_text: "",
  anything_else: "",
  files_link: "",
  video_link: "",
});

/** What's missing before we can build (empty = ready). Extra details are never required. */
export function newSiteProblem(brief: NewSiteBrief): string {
  if (!brief.business_name.trim()) return "Enter your business name.";
  if (brief.what.trim().length < 8) return "Tell us what the business does and who it serves.";
  if (!brief.domain_choice) return "Choose “I have a domain” or “Get me a domain, email & hosting”.";
  if (brief.domain_choice === "have" && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(bareHost(brief.domain))) return "Enter your domain, like yourbusiness.com.";
  return "";
}

export function bareHost(value: string): string {
  return value.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0] ?? "";
}

/** Turn a list (one per line, or commas) into trimmed unique items. */
export function splitLines(value: string, max = 12, each = 120): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(/\n|,/)) {
    const item = raw.trim().slice(0, each);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

/** Accept http(s) links, and fill in https:// when the owner typed instagram.com/… or www.… */
export function parseSocialLinks(value: string, max = 8): string[] {
  const out: string[] = [];
  for (const raw of value.split(/\n|,/).map((s) => s.trim()).filter(Boolean)) {
    let url = raw;
    if (!/^https?:\/\//i.test(url)) url = `https://${url.replace(/^\/\//, "")}`;
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (u.username || u.password) continue;
      const href = u.toString().slice(0, 300);
      if (!out.includes(href)) out.push(href);
    } catch {
      // skip
    }
    if (out.length >= max) break;
  }
  return out;
}

const EXTRA_STRINGS: (keyof NewSiteBrief)[] = [
  "industry",
  "customers",
  "services",
  "goal",
  "brand_color",
  "phone",
  "contact_email",
  "address",
  "hours",
  "social",
  "existing_site",
  "emulate_url_1",
  "emulate_url_2",
  "emulate_url_3",
  "emulate_note",
  "copy_text",
  "anything_else",
  "files_link",
  "video_link",
];

/** How many optional "Add more details" fields have something in them (for the expander label). */
export function extraDetailsCount(brief: NewSiteBrief, photoCount = 0): number {
  let n = photoCount > 0 ? 1 : 0;
  for (const key of EXTRA_STRINGS) if (String(brief[key] ?? "").trim()) n += 1;
  if (brief.pages.length) n += 1;
  if (brief.features.length) n += 1;
  return n;
}

function optionalUrl(value: string): string {
  const links = parseSocialLinks(value, 1);
  return links[0] ?? "";
}

/** The fields factsFromBrief reads (the same keys the older Create a New Site wizard sent). */
export function briefForFacts(brief: NewSiteBrief, logoUrl?: string, photoUrls: string[] = []): Record<string, unknown> {
  const color = brief.brand_color.trim();
  return {
    business_name: brief.business_name.trim(),
    what: brief.what.trim(),
    customers: brief.customers.trim(),
    location: brief.location.trim(),
    style: brief.style.trim(),
    industry: brief.industry.trim(),
    services: brief.services.trim(),
    pages: brief.pages.map((p) => p.trim()).filter(Boolean).slice(0, 10),
    goal: brief.goal.trim(),
    features: brief.features.map((f) => f.trim()).filter(Boolean).slice(0, 8),
    brand_color: /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : "",
    phone: brief.phone.trim(),
    contact_email: brief.contact_email.trim(),
    address: brief.address.trim(),
    hours: brief.hours.trim(),
    social: parseSocialLinks(brief.social),
    existing_site: optionalUrl(brief.existing_site),
    emulate_url_1: optionalUrl(brief.emulate_url_1),
    emulate_url_2: optionalUrl(brief.emulate_url_2),
    emulate_url_3: optionalUrl(brief.emulate_url_3),
    emulate_note: brief.emulate_note.trim(),
    copy_text: brief.copy_text.trim(),
    anything_else: brief.anything_else.trim(),
    files_link: optionalUrl(brief.files_link),
    video_link: optionalUrl(brief.video_link),
    domain: brief.domain_choice === "have" ? bareHost(brief.domain) : "",
    domain_status: brief.domain_choice === "have" ? "owned" : "",
    logo_url: logoUrl ?? "",
    photo_urls: photoUrls.filter((u) => /^https?:\/\//.test(u)).slice(0, 12),
  };
}

export const EXTRA_LEAD_KEYS = [
  "industry",
  "customers",
  "services",
  "pages",
  "goal",
  "features",
  "brand_color",
  "phone",
  "contact_email",
  "address",
  "hours",
  "social",
  "existing_site",
  "emulate_url_1",
  "emulate_url_2",
  "emulate_url_3",
  "emulate_note",
  "copy_text",
  "anything_else",
  "files_link",
  "video_link",
  "photo_urls",
] as const;

/** Flat string fields to send with a new-site lead (Formcarry / reply webhook). Empty values omitted by the caller. */
export function extraLeadFields(brief: NewSiteBrief, photoUrls: string[] = []): Record<string, string> {
  const facts = briefForFacts(brief, "", photoUrls);
  const out: Record<string, string> = {};
  const put = (key: string, value: unknown) => {
    if (Array.isArray(value) && value.length) out[key] = value.map(String).join("\n");
    else if (typeof value === "string" && value.trim()) out[key] = value.trim();
  };
  for (const key of EXTRA_LEAD_KEYS) {
    put(key, facts[key]);
  }
  return out;
}
