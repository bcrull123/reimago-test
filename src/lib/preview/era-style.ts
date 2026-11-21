/**
 * Round 13 — period looks ("make it look like it's from the late 90s / early 2000s").
 *
 * Bob's tester Jason asked for exactly that and the app didn't know what it meant. Words like "90s", "late 90s",
 * "early 2000s", "Y2K", "Geocities", "retro", "web 1.0" and "brutalist" are now a strong creative direction:
 *   - detectEra() reads them from the owner's note and feedback rounds (latest first, negations respected);
 *   - the AI prompts get an explicit ERA DIRECTION block (eraDirective / withEra);
 *   - applyEra() forces the period look onto the template looks, deterministically, so it works even when the AI
 *     ignored the request: every look gets its own variant (three different 90s looks, not one look three times);
 *   - eraCss() paints the look: system fonts, bevelled buttons, ridged table-style borders, tiled backgrounds.
 * Pure (no I/O), relative imports only, so node tests can run it.
 */
import type { DesignDirection, SitePalette } from "./types.ts";

export const ERA_IDS = ["web90s", "brutalist"] as const;
export type EraId = (typeof ERA_IDS)[number];

export type EraTag = { id: EraId; variant: 0 | 1 | 2 };

export type EraMatch = { id: EraId; /** What the owner wrote, e.g. "late 90s". */ phrase: string };

type RequestFacts = { notes?: string; feedback?: string[] };

const WEB90S =
  /\b(?:(?:early|late|mid|the)[\s-]+)?(?:19)?90'?s\b|\bnineties\b|\b(?:early|late|mid|the)?[\s-]*(?:20)?00'?s\b|\baughts\b|\by2k\b|\bgeocities\b|\bangelfire\b|\btripod\b|\bweb\s*1\.0\b|\bold[\s-]*(?:school\s+)?(?:internet|web(?:site)?)\b|\bdot[\s-]?com\s+(?:era|boom|bubble|look)\b|\bwindows\s*9[58]\b|\bretro(?:\s+web)?\b|\bnetscape\b|\bturn of the (?:century|millennium)\b/i;
const BRUTALIST = /\bbrutalis[tm]\b|\bneo[\s-]?brutalis[tm]\b|\braw\s+html\b|\banti[\s-]?design\b/i;

/** "no / not / without / don't want" just before the phrase negates it ("not retro"). */
function negated(text: string, index: number): boolean {
  return /\b(no|not|without|never|don't want|dont want|instead of|less)\s+(\w+\s+)?$/i.test(text.slice(Math.max(0, index - 26), index));
}

function firstHit(text: string, re: RegExp): string | undefined {
  for (const m of text.matchAll(new RegExp(re.source, "gi"))) {
    if (!negated(text, m.index ?? 0)) return m[0];
  }
  return undefined;
}

/** The period look the owner asked for, if any. The latest feedback round wins over the original note. */
export function detectEra(facts: RequestFacts): EraMatch | undefined {
  const texts = [...(facts.feedback ?? [])].reverse().concat(facts.notes ? [facts.notes] : []);
  for (const text of texts) {
    const brut = firstHit(text, BRUTALIST);
    if (brut) return { id: "brutalist", phrase: brut.trim() };
    const web = firstHit(text, WEB90S);
    if (web) return { id: "web90s", phrase: web.trim() };
  }
  return undefined;
}

/** True when the owner explicitly asked for something vintage (so vintage photos are welcome, not off-topic). */
export function wantsVintage(facts: RequestFacts): boolean {
  if (detectEra(facts)) return true;
  const texts = [...(facts.feedback ?? []), facts.notes ?? ""];
  return texts.some((t) => Boolean(firstHit(t, /\b(?:vintage|antique|old[\s-]?fashioned|archival|historic(?:al)?|old photos?|nostalgi\w*|throwback)\b/i)));
}

// ---------------------------------------------------------------- the variants (three different looks per era)

type EraVariant = {
  name: string;
  palette: SitePalette;
  /** System font stacks: nothing to download, which is the point. */
  heading: string;
  body: string;
  mood: string;
};

const SERIF = `"Times New Roman", Times, serif`;
const VERDANA = `Verdana, Geneva, Tahoma, sans-serif`;
const ARIAL = `Arial, Helvetica, sans-serif`;
const COMIC = `"Comic Sans MS", "Comic Sans", "Chalkboard SE", "Trebuchet MS", cursive, sans-serif`;
const MONO = `"Courier New", Courier, monospace`;
const TAHOMA = `Tahoma, Verdana, Geneva, sans-serif`;
const IMPACT = `Impact, "Arial Black", Haettenschweiler, sans-serif`;

export const ERA_VARIANTS: Record<EraId, [EraVariant, EraVariant, EraVariant]> = {
  web90s: [
    {
      name: "Web 1.0",
      palette: { primary: "#0000cc", accent: "#cc0000", background: "#ffffff", surface: "#e6e6e6", text: "#000000", muted: "#333333" },
      heading: SERIF,
      body: SERIF,
      mood: "A 1997 homepage: white page, big Times headings, blue underlined links, gray bevelled buttons and ridged table borders.",
    },
    {
      name: "Geocities Party",
      palette: { primary: "#ffff00", accent: "#ff33cc", background: "#000066", surface: "#0000aa", text: "#ffffcc", muted: "#ccccff" },
      heading: COMIC,
      body: VERDANA,
      mood: "A 1999 fan page: deep navy tiled background, neon yellow and hot pink, Comic-style headings, chunky bevels.",
    },
    {
      name: "Y2K Portal",
      palette: { primary: "#003399", accent: "#ff9900", background: "#f4f7fb", surface: "#e1e9f5", text: "#111111", muted: "#44505f" },
      heading: ARIAL,
      body: TAHOMA,
      mood: "A 2001 corporate portal: navy title bars, Tahoma text, orange call-outs, glossy bevelled buttons and boxed panels.",
    },
  ],
  brutalist: [
    {
      name: "Raw HTML",
      palette: { primary: "#0000ee", accent: "#ff0000", background: "#ffffff", surface: "#f0f0f0", text: "#000000", muted: "#333333" },
      heading: MONO,
      body: MONO,
      mood: "Brutalist web: stark white, black monospace, blue underlined links, thick black rules, no decoration.",
    },
    {
      name: "Concrete",
      palette: { primary: "#111111", accent: "#e60000", background: "#d9d9d9", surface: "#bdbdbd", text: "#000000", muted: "#262626" },
      heading: IMPACT,
      body: ARIAL,
      mood: "Brutalist web: concrete gray, heavy black type, red stamps, thick borders and hard edges.",
    },
    {
      name: "Hazard",
      palette: { primary: "#000000", accent: "#d40000", background: "#fff200", surface: "#ffe600", text: "#000000", muted: "#1a1a1a" },
      heading: ARIAL,
      body: MONO,
      mood: "Brutalist web: hazard yellow, black blocks, huge uppercase headings and thick outlines.",
    },
  ],
};

const LABEL: Record<EraId, string> = { web90s: "late-90s / early-2000s web", brutalist: "brutalist web" };

/** What the owner asked for, in plain words for a "Based on your request" line. */
export function eraLabel(id: EraId): string {
  return LABEL[id];
}

// ---------------------------------------------------------------- AI prompts

/** A strong creative-direction block for every AI step (directions, sections, custom design). Empty when no era. */
export function eraDirective(facts: RequestFacts): string {
  const era = detectEra(facts);
  if (!era) return "";
  if (era.id === "brutalist") {
    return `ERA DIRECTION (explicit, overrides generic taste): the owner asked for "${era.phrase}". Design a brutalist web page: raw and stark, system or monospace fonts (Courier New, Times New Roman, Arial/Impact), black on white or one loud flat color, thick black borders and rules, hard square edges, no gradients, no rounded corners, no soft shadows, plain underlined links, huge plain headings. Still readable, still a real business site, no invented facts.`;
  }
  return `ERA DIRECTION (explicit, overrides generic taste): the owner asked for "${era.phrase}". Make it look like a real website from the late 1990s / early 2000s, not a modern site with a filter: system fonts only (Times New Roman, Verdana, Arial, Tahoma, Comic Sans MS, Courier New), blue underlined links, gray bevelled (outset) buttons or glossy Y2K buttons, ridged table-style borders and boxed panels, a flat or tiled background, navy / silver / neon accents, small dense text, centered headings, horizontal rules, no gradients-on-gradients, no rounded corners, no parallax or fancy animation. Photos stay (framed with a thin border); keep every fact true and every page readable.`;
}

/** The owner's request plus the era directive (for prompts that only take one "request" string). */
export function withEra(request: string | undefined, facts: RequestFacts): string {
  const era = eraDirective(facts);
  return [request ?? "", era].filter(Boolean).join(" ").slice(0, 1400);
}

// ---------------------------------------------------------------- deterministic override

/** The era tag stored on a direction (re-validated whenever a direction comes back from the browser). */
export function cleanEraTag(raw: unknown): EraTag | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const id = ERA_IDS.find((e) => e === r.id);
  if (!id) return undefined;
  const v = Number(r.variant);
  return { id, variant: v === 1 ? 1 : v === 2 ? 2 : 0 };
}

/**
 * Force the period look onto the three looks. Each look keeps its archetype, hero style, headline and photo ideas,
 * but gets a different variant of the era (so three different 90s looks, not the same look three times), the
 * variant's palette and fonts, square buttons, sharp corners and no modern motifs.
 */
export function applyEra(directions: DesignDirection[], facts: RequestFacts): DesignDirection[] {
  const era = detectEra(facts);
  if (!era) return directions;
  return directions.map((d, i) => {
    const variant = (i % 3) as 0 | 1 | 2;
    const v = ERA_VARIANTS[era.id][variant];
    return {
      ...d,
      mood: v.mood,
      palette: { ...v.palette },
      // The stored fonts must stay Google-valid names; the era's system fonts are applied by eraCss().
      motifs: era.id === "brutalist" ? ["thin-rules"] : [],
      radius: "sharp" as const,
      buttons: "square" as const,
      header: d.header === "overlay" ? "light" : d.header,
      era: { id: era.id, variant },
      rationale: `Built in the ${v.name} style you asked for (“${era.phrase}”).`,
    };
  });
}

// ---------------------------------------------------------------- CSS

/** Body classes for a direction's era ("" when none). */
export function eraClasses(era: EraTag | undefined): string {
  return era ? `era era-${era.id} ev-${era.variant}` : "";
}

/**
 * The period stylesheet, appended after the modern design system so it wins. Scoped to body.era, so a look
 * without an era is untouched.
 */
export function eraCss(era: EraTag | undefined): string {
  if (!era) return "";
  const v = ERA_VARIANTS[era.id][era.variant];
  const p = v.palette;
  const brutal = era.id === "brutalist";
  const dark = era.id === "web90s" && era.variant === 1;
  const border = brutal ? "#000000" : dark ? "#9999ff" : era.variant === 2 ? "#7f93b5" : "#808080";
  const face = brutal ? p.surface : dark ? "#c0c0ff" : era.variant === 2 ? "#dfe7f5" : "#d4d0c8";
  const onFace = "#000000";
  // The Geocities look gets a tiled "starfield" background, the way every fan page had one.
  const tile = dark
    ? `background-image:radial-gradient(#ffffff 1px,transparent 1.5px),radial-gradient(#ffffff 1px,transparent 1.5px);background-size:48px 48px;background-position:0 0,24px 24px;`
    : "";
  return `
/* ---------- era: ${v.name} */
body.era{--hf:${v.heading};--bf:${v.body};--hw:700;--ht:0;--radius:0px;--btn-radius:0px;--line:${border};font-size:16px;line-height:1.45;-webkit-font-smoothing:auto;text-rendering:auto;${tile}}
body.era *{border-radius:0!important;text-shadow:none!important}
body.era h1,body.era h2,body.era h3,body.era h4{text-transform:none;letter-spacing:0;line-height:1.15;text-wrap:wrap;font-weight:700}
body.era h1{font-size:clamp(1.9rem,4.6vw,3.1rem)}body.era h2{font-size:clamp(1.45rem,3vw,2.1rem)}body.era h3{font-size:1.2rem}
body.era h1 em,body.era h2 em{font-style:normal;color:var(--accent)}
body.era p{margin:0 0 .9em}
body.era a{text-decoration:underline;text-underline-offset:auto}
body.era .lead{font-size:1.1rem;max-width:44rem}
body.era .eyebrow{letter-spacing:0;text-transform:none;font-size:.9rem}body.era .eyebrow::before{display:none}
body.era .rv,body.era .hero-copy>*{animation:none!important;opacity:1!important;transform:none!important}
body.era .s-hero-photo .bgimg img,body.era .s-hero-photo .bgimg .ph,body.era .media img{animation:none!important;transform:none!important}
body.era .media:hover img{transform:none}
body.era .media{border:2px inset ${border};background:var(--surface)}
body.era .ph::after{display:none}
/* header: a plain title bar */
body.era .site-header{position:static;backdrop-filter:none;-webkit-backdrop-filter:none;background:${dark ? p.surface : era.variant === 2 && !brutal ? p.primary : face};color:${dark ? p.text : era.variant === 2 && !brutal ? "#ffffff" : onFace};border-bottom:${brutal ? "4px solid #000" : "3px ridge " + border}}
body.era .site-header .bar{min-height:0;padding:.55rem 0}
body.era .brand{color:inherit;font-size:1.5rem;letter-spacing:0}
body.era .site-nav{gap:0}
body.era .site-nav a{opacity:1;padding:.2rem .7rem;border-left:1px solid ${border};font-weight:700;font-size:.95rem}
body.era .site-nav a:first-child{border-left:0}
body.era .site-nav a::after{display:none}
body.era .site-nav a:hover{text-decoration:underline;background:transparent}
body.era .h-overlay .site-header{position:static;background:${face};color:${onFace}}
body.era .menu summary{border:2px outset ${border};background:${face};color:${onFace}}
/* buttons: Win-98 bevels (Y2K Portal: glossy) */
body.era .btn{min-height:0;padding:.4rem 1.1rem;text-transform:none;letter-spacing:0;font:700 1rem/1.3 var(--bf);border:${brutal ? "3px solid #000" : "2px outset " + border};background:${brutal ? "#fff" : face};color:${onFace};transform:none!important;box-shadow:none!important;${!brutal && era.variant === 2 ? "background:linear-gradient(#ffffff 0%,#dfe7f5 48%,#b9c9e6 52%,#e6edf9 100%);border:1px solid #5a73a0;" : ""}}
body.era .btn.primary{background:${brutal ? "#000" : p.accent};color:${brutal ? "#fff" : "#000"};${!brutal && era.variant === 2 ? "background:linear-gradient(#ffd27a 0%,#ffae2e 48%,#ff9900 52%,#ffbb44 100%);border:1px solid #b36b00;" : ""}}
body.era .btn.ghost{background:${face};color:${onFace};border-color:${border}}
body.era .btn:active{border-style:inset}
body.era .btn:hover{text-decoration:underline}
/* panels: ridged boxes like table cells */
body.era .sec{padding:1.6rem 0;border-bottom:${brutal ? "3px solid #000" : "2px groove " + border}}
body.era .s-hero-split,body.era .s-hero-type,body.era .s-page-hero{padding:1.8rem 0}
body.era .s-hero-photo{min-height:0;padding:3rem 0 2rem}
body.era .s-hero-photo::after{background:rgba(0,0,0,.55)}
body.era .card,body.era .step,body.era .review,body.era .stat,body.era .faq details,body.era .form-card,body.era .info,body.era .notice,body.era .svc-row{border:${brutal ? "3px solid #000" : "2px ridge " + border};background:${brutal ? p.background : "var(--surface)"};color:var(--text);padding:.9rem 1rem}
body.era .cards,body.era .bento,body.era .steps,body.era .stats{gap:.6rem}
body.era .sec-head{margin-bottom:1rem}
body.era .t-brand{--sbg:var(--primary)}
body.era .t-dark{--sbg:${dark ? p.surface : "#222222"}}
body.era .s-hero-split::before,body.era .s-hero-split::after,body.era .s-hero-type::before,body.era .s-hero-type::after,body.era .s-page-hero::before,body.era .s-page-hero::after,body.era .s-hero-split .frame::before,body.era .cta-band::before,body.era .cta-band::after{display:none!important}
body.era .s-hero-split,body.era .s-hero-type,body.era .s-page-hero{background-image:none!important}
body.era .cta-band{background:${dark ? p.surface : "var(--primary)"};color:${dark ? p.text : "var(--on-primary)"};border:${brutal ? "3px solid #000" : "3px ridge " + border};padding:1rem}
body.era .cta-band h2,body.era .cta-band p{color:inherit}
body.era input,body.era textarea,body.era select{border:2px inset ${border};background:#fff;color:#000;font:inherit;padding:.3rem .4rem}
body.era hr{border:0;border-top:2px groove ${border}}
body.era .site-footer{border-top:${brutal ? "4px solid #000" : "3px ridge " + border}}
body.era .site-footer::after{content:"Best viewed in any browser";display:block;text-align:center;font-size:.8rem;padding:.8rem 0 1rem;opacity:.85}
${brutal && era.variant === 1 ? "body.era h1,body.era h2{text-transform:uppercase}" : ""}
${brutal && era.variant === 2 ? "body.era h1,body.era h2,body.era h3{text-transform:uppercase}body.era .site-header,body.era .site-footer{background:#000;color:#fff}body.era .brand{color:#fff}" : ""}
${!brutal && era.variant === 2 ? "body.era h2{border-bottom:2px solid " + p.primary + ";padding-bottom:.2rem}body.era .sec-head h2{border-bottom-color:" + p.accent + "}" : ""}
${!brutal && era.variant === 0 ? "body.era .sec-head,body.era .sec-head h2{text-align:center;margin-inline:auto}" : ""}
`.trim();
}
