/** Shared (client + server) shapes for the live multi-page preview. */

export type SiteNavLink = { label: string; url: string };

export type ScrapedPage = {
  url: string;
  title: string;
  headings: string[];
  /** Visible paragraph text, clipped. */
  text: string;
};

export type Testimonial = { quote: string; author: string };

/** Everything we know for sure about the business. Nothing in here is invented. */
export type SiteFacts = {
  mode: "reimagine" | "create";
  sourceUrl: string;
  host: string;
  name: string;
  tagline: string;
  description: string;
  logo: string;
  colors: string[];
  phone: string;
  email: string;
  address: string;
  hours: string[];
  services: string[];
  about: string;
  testimonials: Testimonial[];
  images: string[];
  nav: SiteNavLink[];
  pages: ScrapedPage[];
  social: string[];
  industry: string;
  /** What the visitor asked to change. */
  notes: string;
  /** Extra brief details from the Create a New Site wizard. */
  brief?: string;
  /** Set when the live site could not be read and on-file copy was used. */
  note?: string;
};

export type PlanSection = { kind: string; heading: string; brief: string };

export type PlanPage = {
  slug: string;
  title: string;
  navLabel: string;
  purpose: string;
  sections: PlanSection[];
};

export type SitePalette = {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
};

export type SitePlan = {
  name: string;
  tagline: string;
  /** One or two sentences about the current site. */
  summary: string;
  /** What the new site changes. */
  changes: string[];
  palette: SitePalette;
  fonts: { heading: string; body: string };
  cta: { label: string; slug: string };
  pages: PlanPage[];
  /** True when the plan came from the deterministic mock/fallback, not the AI. */
  mock?: boolean;
};

export type PreviewPageLink = { slug: string; title: string; url: string };

export type PreviewInfo = {
  id: string;
  url: string;
  pages: PreviewPageLink[];
  mock: boolean;
};

export type PreviewStepResult<T> = ({ ok: true } & T) | { ok: false; error: string };
