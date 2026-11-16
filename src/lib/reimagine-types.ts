import type { PreviewInfo } from "@/lib/preview/types";

export type DraftPoint = { title: string; body: string };

export type PaletteName = "copper" | "forest" | "harbor" | "plum" | "clay";

export type TemplateName =
  | "yours"
  | "organization"
  | "technology"
  | "restaurant"
  | "professional"
  | "shop"
  | "local";

export type SiteDraft = {
  name: string;
  kicker: string;
  headline: string;
  subhead: string;
  action: string;
  nav: string[];
  palette: PaletteName;
  points: DraftPoint[];
  bandTitle: string;
  bandBody: string;
  close: string;
  promise?: string;
  steps?: DraftPoint[];
  heroImage?: string;
  cardImage?: string;
  logo?: string;
  template?: TemplateName;
  /** @deprecated Grok Imagine picture previews were replaced by live HTML previews (see `ReimagineOk.preview`). */
  rendition?: string;
  change?: string;
};

export type ExistingLayout = {
  submitted: string;
  url: string;
  title: string;
  description: string;
  nav: string[];
  headings: string[];
  text: string;
};

export type ReimagineOk = {
  ok: true;
  source: "grok" | "crawl";
  live: boolean;
  finalUrl: string;
  host: string;
  foundTitle: string;
  foundDescription: string;
  diagnosis: string;
  honored: string[];
  draft: SiteDraft;
  layout?: ExistingLayout;
  note?: string;
  pageUrl?: string;
  mailed?: boolean;
  /** The live, clickable multi-page preview (served at /made/<id> and /made/<id>/<page>). */
  preview?: PreviewInfo;
};

export type ReimagineResult =
  | ReimagineOk
  | {
      ok: false;
      error: string;
    };

export type ReimagineInput = {
  url: string;
  notes: string;
  email?: string;
  template?: TemplateName;
};
