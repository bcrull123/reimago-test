/**
 * Round 15b — quality checks for from-scratch Custom Design.
 * Catches the failure mode Bob saw: a cropped tree/sky hero, a tiny corner headline,
 * a tiny CTA, and a mostly empty hero. Pure (no I/O) so tests can run it.
 */
export type HeroSample = {
  /** 0–1 fraction of sampled pixels that look like sky / pale wash. */
  sky: number;
  /** 0–1 fraction that look like foliage / grass. */
  foliage: number;
  /** 0–1 fraction with enough local contrast to be a real scene (buildings, people, streets). */
  structure: number;
};

const WEAK_SUBJECT = /\b(sky|clouds?|sunset glow|treetops?|tree canopy|leaves?|foliage|branches?|lawn|grass only)\b/i;
const STRONG_SUBJECT = /\b(downtown|main street|storefront|courthouse|skyline|aerial|street|building|plaza|park pavilion|people|crowd|store|shop|dining|kitchen|truck|van|team|pool|slides?|school|library|depot)\b/i;

/** Parse a CSS font-size to px, evaluating clamp() at a 1280px viewport. */
export function fontSizePx(value: string, viewportPx = 1280): number | undefined {
  const v = value.trim().toLowerCase();
  const clamp = v.match(/^clamp\(\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/);
  if (clamp) {
    const min = fontSizePx(clamp[1]!, viewportPx);
    const pref = fontSizePx(clamp[2]!, viewportPx);
    const max = fontSizePx(clamp[3]!, viewportPx);
    if (min == null || pref == null || max == null) return undefined;
    return Math.min(max, Math.max(min, pref));
  }
  const m = v.match(/^(-?[\d.]+)(px|rem|em|vw|vh)?$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = m[2] || "px";
  if (unit === "px") return n;
  if (unit === "rem" || unit === "em") return n * 16;
  if (unit === "vw") return (n / 100) * viewportPx;
  if (unit === "vh") return (n / 100) * 800;
  return undefined;
}

function cssRules(css: string): { selector: string; decls: Record<string, string> }[] {
  const out: { selector: string; decls: Record<string, string> }[] = [];
  const flat = css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi, "");
  for (const m of flat.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const decls: Record<string, string> = {};
    for (const d of m[2]!.split(";")) {
      const i = d.indexOf(":");
      if (i > 0) decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
    }
    out.push({ selector: m[1]!.trim().replace(/\s+/g, " "), decls });
  }
  return out;
}

function ruleFontSize(rules: { selector: string; decls: Record<string, string> }[], match: RegExp, viewportPx = 1280): number | undefined {
  let found: number | undefined;
  for (const r of rules) {
    if (!match.test(r.selector)) continue;
    if (!r.decls["font-size"]) continue;
    const px = fontSizePx(r.decls["font-size"], viewportPx);
    if (px != null) found = px;
  }
  return found;
}

function paddingMinPx(value: string, viewportPx = 1280): number | undefined {
  const parts = value.trim().split(/\s+/).map((p) => fontSizePx(p, viewportPx)).filter((n): n is number => n != null);
  return parts.length ? Math.min(...parts) : undefined;
}

function heroBlock(html: string): string {
  const h1 = html.search(/<h1\b/i);
  if (h1 < 0) return html;
  const sec = html.lastIndexOf("<section", h1);
  const start = sec >= 0 ? sec : h1;
  const end = html.indexOf("</section>", h1);
  return end > start ? html.slice(start, end + 10) : html.slice(start, start + 4000);
}

/**
 * HTML/CSS problems that make a from-scratch hero unusable.
 * These are structural: they trigger one repair, then a polished fallback.
 */
export function customQualityProblems(
  html: string,
  css: string,
  opts: { alt?: string; shows?: string; sample?: HeroSample; hasBetterPhoto?: boolean } = {},
): string[] {
  const problems: string[] = [];
  const rules = cssRules(css);
  const hero = heroBlock(html);
  const h1 = ruleFontSize(rules, /(^|[\s,>#.])h1\b|\.hero(?:-)?title|\.headline|\.display/i) ?? ruleFontSize(rules, /\bh1\b/);
  if (h1 != null && h1 < 38) problems.push(`The hero headline is too small (${Math.round(h1)}px at desktop). It must be at least ~2.4rem so it can be read at a glance.`);

  const ctaSel = /(btn|button|cta|hero\s+a|\.hero a)/i;
  let ctaSize = ruleFontSize(rules, ctaSel);
  let ctaPad: number | undefined;
  let ctaMinH: number | undefined;
  for (const r of rules) {
    if (!ctaSel.test(r.selector) && !/\ba\b/.test(r.selector)) continue;
    if (r.decls.padding) ctaPad = paddingMinPx(r.decls.padding) ?? ctaPad;
    if (r.decls["min-height"]) ctaMinH = fontSizePx(r.decls["min-height"]) ?? ctaMinH;
    if (r.decls["font-size"]) ctaSize = fontSizePx(r.decls["font-size"]) ?? ctaSize;
  }
  const tappable = (ctaMinH != null && ctaMinH >= 44) || (ctaPad != null && ctaPad >= 10 && (ctaSize ?? 16) >= 15);
  if (ctaSize != null && ctaSize < 14 && !tappable) problems.push(`The call-to-action is too small (${Math.round(ctaSize)}px). Use at least 1rem type and 44px tap height.`);
  if (ctaPad != null && ctaPad < 6 && (ctaMinH == null || ctaMinH < 40) && (ctaSize == null || ctaSize < 18)) {
    problems.push("The call-to-action padding is too tight for a thumb. Use at least 0.7rem 1.1rem padding or a 44px min-height.");
  }

  const heroCss = rules.filter((r) => /hero|^main\b|\.stage|\.masthead/i.test(r.selector));
  const heroMin = heroCss.map((r) => fontSizePx(r.decls["min-height"] ?? "", 1280) ?? fontSizePx(r.decls.height ?? "", 1280)).find((n) => n != null && n >= 400);
  if (heroMin && h1 != null && h1 < 48 && heroMin >= 560) {
    problems.push("The hero is tall but the headline is small, so the section looks empty. Make the headline large and fill the hero with a strong photo plus a clear CTA.");
  }

  const clip = [...css.matchAll(/clip-path\s*:[^;]{0,160}/gi)].map((m) => m[0]);
  const arc = [...css.matchAll(/border-radius\s*:\s*(50%|100vw|[5-9]\d%)/gi)].map((m) => m[0]);
  if ((clip.some((c) => /ellipse|circle|polygon|inset/i.test(c)) || arc.length) && (h1 == null || h1 < 56)) {
    problems.push("The hero photo is cropped into a tight arc/circle with a small headline, which wastes the picture and looks unfinished. Use a full-bleed or large split photo with big type.");
  }

  const caption = `${opts.alt ?? ""} ${opts.shows ?? ""}`.trim();
  if (caption && WEAK_SUBJECT.test(caption) && !STRONG_SUBJECT.test(caption) && opts.hasBetterPhoto) {
    problems.push(`The hero photo looks like a weak crop (“${caption.slice(0, 80)}”). Prefer a strong site photo of the place (street, building, people, landmark), not mostly sky or foliage.`);
  }

  if (opts.sample) {
    const { sky, foliage, structure } = opts.sample;
    if (sky + foliage >= 0.62 && structure < 0.22) {
      problems.push(`The hero image is mostly sky or foliage (${Math.round((sky + foliage) * 100)}%) with little of the place itself. Use a stronger site photo, uncropped, as a full-bleed or large split hero.`);
    }
  }

  // A hero copy block crammed into a small top-left corner (tiny max-width + absolute top/left).
  const corner = heroCss.some((r) => {
    const maxW = fontSizePx(r.decls["max-width"] ?? "");
    const top = r.decls.top;
    const left = r.decls.left;
    const pos = r.decls.position;
    return pos === "absolute" && maxW != null && maxW <= 360 && /^(0|0px|1rem|2rem|8px|16px)$/.test(`${top ?? ""}`.split(" ")[0] ?? "") && left != null;
  });
  if (corner) problems.push("The headline and CTA are crammed into a small corner of the hero. Let the type sit large over or beside a strong photo.");

  return [...new Set(problems)];
}

/** Sample an RGBA buffer (4 bytes/pixel, row-major) for sky / foliage / structure fractions. */
export function sampleHeroSubject(data: Uint8Array | Buffer, width: number, height: number): HeroSample {
  if (width < 4 || height < 4) return { sky: 0, foliage: 0, structure: 0 };
  let sky = 0, foliage = 0, structure = 0, n = 0;
  const stepX = Math.max(1, Math.floor(width / 40));
  const stepY = Math.max(1, Math.floor(height / 40));
  const lumAt = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
  };
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4;
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = data[i + 3] ?? 255;
      if (a < 32) continue;
      n += 1;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2 / 255;
      const sat = max === 0 ? 0 : (max - min) / max;
      const isSky = b >= r + 15 && b >= g - 5 && l > 0.45 && sat < 0.55;
      const isWash = l > 0.85 && sat < 0.12;
      const isFoliage = g > r + 12 && g > b + 12 && l > 0.15 && l < 0.75;
      // Local contrast vs a neighbor pixel: buildings/streets vary; sky/lawn do not.
      const nx = Math.min(width - 1, x + stepX);
      const ny = Math.min(height - 1, y + stepY);
      const contrast = Math.abs(lumAt(x, y) - lumAt(nx, ny));
      const isStructure = contrast > 18 && !isSky && !isWash;
      if (isSky || isWash) sky += 1;
      else if (isFoliage) foliage += 1;
      if (isStructure) structure += 1;
    }
  }
  if (!n) return { sky: 0, foliage: 0, structure: 0 };
  return { sky: sky / n, foliage: foliage / n, structure: structure / n };
}

export function isWeakHeroSubject(sample: HeroSample): boolean {
  return sample.sky + sample.foliage >= 0.62 && sample.structure < 0.22;
}

/**
 * A deterministic, polished from-scratch homepage used when Custom Design fails quality
 * after one repair. Large photo hero, readable headline, tappable CTA, no empty corners.
 */
export function polishedScratchLayout(input: {
  name: string;
  headline?: string;
  tagline?: string;
  description?: string;
  cta: { label: string; slug: string };
  pages: { slug: string; navLabel?: string; title?: string }[];
  phone?: string;
  email?: string;
  fonts: { heading: string; body: string };
  palette: { primary: string; accent: string; background: string; surface: string; text: string; muted: string };
  photo?: string;
  photoAlt?: string;
}): { html: string; css: string } {
  const pages = input.pages.filter((p) => p.slug !== "home");
  const nav = pages.map((p) => `<a href="@page:${p.slug}">${p.navLabel || p.title || p.slug}</a>`).join("");
  const h1 = (input.headline || input.tagline || input.name).replace(/\s+/g, " ").trim().slice(0, 90);
  const lead = (input.description || input.tagline || "").replace(/\s+/g, " ").trim().slice(0, 220);
  const photo = input.photo && input.photo !== "logo" ? input.photo : undefined;
  const img = photo
    ? `<img src="@img:${photo}" alt="${(input.photoAlt || input.name).replace(/"/g, "")}">`
    : `<div class="hero-wash" aria-hidden="true"></div>`;
  const tel = input.phone ? `<a href="tel:${input.phone.replace(/[^\d+]/g, "")}">${input.phone}</a>` : "";
  const html = `<header>
  <a class="brand" href="@page:home">@brand:light</a>
  <nav>${nav}</nav>
</header>
<main>
  <section class="hero">
    ${img}
    <div class="copy">
      <p class="eyebrow">${input.name.replace(/</g, "")}</p>
      <h1>${h1.replace(/</g, "")}</h1>
      ${lead ? `<p class="lead">${lead.replace(/</g, "")}</p>` : ""}
      <a class="btn" href="@page:${input.cta.slug}">${(input.cta.label || "Get in touch").replace(/</g, "")}</a>
    </div>
  </section>
  <section class="intro">
    <h2>Welcome</h2>
    <p>${(lead || `Explore ${input.name}.`).replace(/</g, "")}</p>
  </section>
  <section class="cta-band">
    <h2>Ready when you are</h2>
    <a class="btn" href="@page:${input.cta.slug}">${(input.cta.label || "Get in touch").replace(/</g, "")}</a>
  </section>
</main>
<footer>
  <p>${input.name.replace(/</g, "")}</p>
  ${tel}
</footer>`;
  const p = input.palette;
  const css = `:root{--background:${p.background};--surface:${p.surface};--text:${p.text};--muted:${p.muted};--primary:${p.primary};--accent:${p.accent};--hf:"${input.fonts.heading}",system-ui,sans-serif;--bf:"${input.fonts.body}",system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--text);font-family:var(--bf)}
header{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 6vw;background:var(--surface)}
header nav{display:flex;gap:1.2rem;flex-wrap:wrap}header a{color:var(--text);text-decoration:none}
.hero{position:relative;min-height:78vh;display:grid;align-items:end;overflow:hidden;color:#f7f4ee}
.hero img,.hero-wash{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center}
.hero-wash{background:linear-gradient(135deg,var(--primary),var(--accent))}
.hero::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 20%,rgba(0,0,0,.62) 100%)}
.hero .copy{position:relative;z-index:1;padding:clamp(2rem,6vw,5rem);max-width:18ch}
.eyebrow{letter-spacing:.12em;text-transform:uppercase;font-size:.85rem;margin:0 0 .6rem}
.hero h1{font-family:var(--hf);font-size:clamp(2.8rem,7vw,5.5rem);line-height:1.02;margin:0 0 1rem}
.lead{font-size:1.15rem;max-width:36rem;margin:0 0 1.4rem}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:.85rem 1.4rem;font-size:1.05rem;font-weight:600;background:var(--accent);color:#111;text-decoration:none;border-radius:999px}
.intro,.cta-band,footer{padding:4rem 6vw}
.intro{background:var(--surface)}
.cta-band{background:var(--primary);color:#fff}.cta-band .btn{background:#fff}
@media (max-width:720px){header{flex-direction:column;align-items:flex-start}.hero{min-height:70vh}.hero h1{font-size:clamp(2.4rem,12vw,3.4rem)}}`;
  return { html, css };
}


export type PhotoPick = { name: string; alt?: string; shows?: string; source?: string; gate?: string; width?: number; height?: number };

/** Prefer a wide, passed site photo of the place itself over a sky/foliage crop. */
export function pickBestSitePhoto(images: Record<string, PhotoPick> | undefined, avoid?: string): PhotoPick | undefined {
  if (!images) return undefined;
  const weak = /\b(sky|clouds?|treetops?|leaves?|foliage|branches?)\b/i;
  const strong = /\b(downtown|main street|storefront|courthouse|skyline|aerial|street|building|plaza|people|dining|truck|team|slides?|depot)\b/i;
  const cands = Object.values(images).filter((i) => {
    if (avoid && i.name === avoid) return false;
    if (i.name.startsWith("logo") || i.name === "mockup" || i.name.startsWith("art-")) return false;
    return i.source === "photo" || i.name === "hero" || /^photo-\d+$/.test(i.name);
  });
  const score = (i: PhotoPick): number => {
    let s = 0;
    if (i.gate === "passed") s += 40;
    if (i.gate === "failed") s -= 30;
    const cap = `${i.alt ?? ""} ${i.shows ?? ""}`;
    if (strong.test(cap)) s += 25;
    if (weak.test(cap) && !strong.test(cap)) s -= 25;
    const w = i.width ?? 0;
    const h = i.height ?? 0;
    if (w >= 1400) s += 15;
    else if (w >= 900) s += 8;
    if (h && w / h >= 1.3) s += 8;
    if (i.name === "hero") s += 5;
    return s;
  };
  return cands.sort((a, b) => score(b) - score(a) || (b.width ?? 0) - (a.width ?? 0))[0];
}
