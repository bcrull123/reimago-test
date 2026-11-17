/**
 * The design system every preview page uses: one stylesheet driven by the chosen
 * design direction (archetype, palette, fonts, radius, buttons, header/footer, motifs).
 * Pure CSS — no JavaScript. Scroll reveals use CSS scroll-driven animations where
 * the browser supports them and are disabled for prefers-reduced-motion.
 */
import {
  BODY_FONTS,
  HEADING_FONTS,
  SINGLE_WEIGHT,
  contrast,
  fontsHref as directionFontsHref,
  hashString,
  isHex,
  luminance,
  mix,
  readablePalette,
  safeFont,
} from "./design.ts";
import type { DesignDirection, SitePalette } from "./types.ts";

export { BODY_FONTS, HEADING_FONTS, contrast, hashString, isHex, luminance, safeFont };

const LEGACY_PALETTES: SitePalette[] = [
  { primary: "#1f4e79", accent: "#e8a33d", background: "#ffffff", surface: "#f4f6f9", text: "#16202b", muted: "#5b6573" },
  { primary: "#2f5d3a", accent: "#d9822b", background: "#ffffff", surface: "#f3f5f0", text: "#1b231d", muted: "#5d665f" },
  { primary: "#7a2e3a", accent: "#e0b04a", background: "#ffffff", surface: "#f8f3f1", text: "#231a1b", muted: "#6a5d5f" },
  { primary: "#123c69", accent: "#ac3b61", background: "#ffffff", surface: "#eef2f7", text: "#14212e", muted: "#56606d" },
  { primary: "#3d3a8f", accent: "#f2a541", background: "#ffffff", surface: "#f3f3fa", text: "#1c1b2e", muted: "#5f5e70" },
];

export function defaultPalette(seed: string, colors: string[]): SitePalette {
  const base = LEGACY_PALETTES[hashString(seed) % LEGACY_PALETTES.length]!;
  const primary = colors.find((c) => isHex(c) && contrast(c, "#ffffff") >= 3) ?? base.primary;
  return { ...base, primary };
}

/** Kept for the plan step: readable palette no matter what the AI picked. */
export function safePalette(raw: Partial<SitePalette> | undefined, fallback: SitePalette): SitePalette {
  return readablePalette(raw, fallback);
}

export function fontsHref(site: { fonts: { heading: string; body: string } }): string {
  return directionFontsHref(site.fonts);
}

function onColor(hex: string): string {
  return contrast(hex, "#ffffff") >= contrast(hex, "#111111") ? "#ffffff" : "#111111";
}

/** The "dark" surface color (dark header, footer, dark sections) for a palette. */
export function darkSurface(p: SitePalette): string {
  return luminance(p.background) < 0.2 ? mix(p.background, "#000000", 0.45) : mix(p.text, p.primary, 0.22);
}

/** Body classes that switch the design system for one direction. */
export function designClasses(design: DesignDirection | undefined, overlayHeader: boolean): string {
  if (!design) return "a-classic r-soft b-pill h-light f-columns";
  // An overlay header needs a photo behind it; without one, the look keeps a dark bar (not the light one another look uses).
  const header = design.header === "overlay" && !overlayHeader ? (design.heroStyle ? "dark" : "light") : design.header;
  return [
    `a-${design.archetype}`,
    `r-${design.radius}`,
    `b-${design.buttons}`,
    `h-${header}`,
    `f-${design.footer}`,
    ...design.motifs.map((m) => `m-${m}`),
  ].join(" ");
}

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** The single stylesheet shared by every page of a preview site. */
export function siteCss(site: { palette: SitePalette; fonts: { heading: string; body: string }; design?: DesignDirection }): string {
  const p = site.palette;
  const design = site.design;
  const archetype = design?.archetype ?? "classic";
  const darkTheme = luminance(p.background) < 0.2;
  const onPrimary = onColor(p.primary);
  const onAccent = onColor(p.accent);
  const ctaOnAccent = ["bold-photo", "playful", "dark-premium"].includes(archetype);
  const cta = ctaOnAccent ? p.accent : p.primary;
  const onCta = onColor(cta);
  const darkBg = darkSurface(p);
  const darkText = "#f6f4ef";
  const single = SINGLE_WEIGHT.has(site.fonts.heading);
  const condensed = /Anton|Oswald|Big Shoulders|Archivo Black/.test(site.fonts.heading);
  const hWeight = single ? 400 : archetype === "minimal-luxury" || archetype === "dark-premium" ? 500 : archetype === "editorial" ? 600 : 800;
  const hTracking = condensed ? "0.005em" : archetype === "bold-photo" || archetype === "playful" ? "-0.035em" : archetype === "minimal-luxury" ? "-0.01em" : "-0.02em";
  const serifish = /Playfair|Fraunces|Serif|Cormorant|Caslon|Garamond|Lora|Merriweather/.test(site.fonts.heading);
  const heading = `"${site.fonts.heading}", ${serifish ? "Georgia, serif" : "system-ui, sans-serif"}`;
  const body = `"${site.fonts.body}", system-ui, -apple-system, "Segoe UI", sans-serif`;
  const radius = design?.radius === "sharp" ? "3px" : design?.radius === "round" ? "28px" : "16px";
  const btnRadius = design?.buttons === "pill" ? "999px" : design?.buttons === "square" ? "4px" : radius === "28px" ? "999px" : "6px";
  const scale = archetype === "editorial" || archetype === "minimal-luxury" ? "clamp(2.8rem,7.4vw,6.4rem)" : condensed ? "clamp(3rem,8vw,7rem)" : "clamp(2.5rem,6.2vw,5.4rem)";
  return `
:root{--primary:${p.primary};--on-primary:${onPrimary};--accent:${p.accent};--on-accent:${onAccent};--cta:${cta};--on-cta:${onCta};--bg:${p.background};--surface:${p.surface};--text:${p.text};--muted:${p.muted};--dark-bg:${darkBg};--dark-text:${darkText};--radius:${radius};--btn-radius:${btnRadius};--max:1200px;--hf:${heading};--bf:${body};--hw:${hWeight};--ht:${hTracking};--h1:${scale};--line:color-mix(in srgb,var(--text) 13%,transparent)}
*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--bf);font-size:17.5px;line-height:1.68;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;overflow-x:hidden}
img{max-width:100%;display:block}
a{color:var(--primary);text-underline-offset:.2em}
h1,h2,h3,h4{font-family:var(--hf);font-weight:var(--hw);line-height:1.04;margin:0 0 .45em;letter-spacing:var(--ht);color:var(--fg,var(--text));text-wrap:balance}
${condensed ? "h1,h2,h3{text-transform:uppercase}" : ""}
h1{font-size:var(--h1)}h2{font-size:clamp(2rem,4.2vw,3.4rem)}h3{font-size:clamp(1.2rem,1.8vw,1.45rem);line-height:1.2}
h1 em,h2 em{font-style:italic;color:var(--accent-text,var(--primary));${serifish ? "" : "font-style:normal;"}}
p{margin:0 0 1em}
.wrap{width:min(100% - 2.75rem,var(--max));margin-inline:auto;position:relative}
.narrow{max-width:760px}
.eyebrow{display:inline-flex;align-items:center;gap:.6rem;font:700 .76rem/1.2 var(--bf);letter-spacing:.18em;text-transform:uppercase;color:var(--eyebrow,var(--primary));margin-bottom:1.1rem}
.eyebrow::before{content:"";width:1.8rem;height:2px;background:currentColor;opacity:.7}
.lead{font-size:clamp(1.08rem,1.5vw,1.28rem);color:var(--fg-muted,var(--muted));max-width:40rem;line-height:1.6}
.muted{color:var(--fg-muted,var(--muted))}
.center{text-align:center}.center .lead{margin-inline:auto}.center .actions{justify-content:center}.center .eyebrow{justify-content:center}
/* ---------- header */
.site-header{position:sticky;top:0;z-index:30;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:saturate(1.4) blur(12px);-webkit-backdrop-filter:saturate(1.4) blur(12px);border-bottom:1px solid var(--line)}
.site-header .bar{display:flex;align-items:center;justify-content:space-between;gap:1.5rem;min-height:76px}
.brand{display:flex;align-items:center;gap:.75rem;text-decoration:none;color:var(--text);font-family:var(--hf);font-weight:var(--hw);font-size:1.35rem;letter-spacing:var(--ht);line-height:1.1}
.brand img{height:46px;width:auto;max-width:190px;object-fit:contain}
.site-nav{display:flex;align-items:center;gap:1.6rem}
.site-nav a{color:inherit;text-decoration:none;font-weight:500;font-size:.96rem;opacity:.82;position:relative;padding:.3rem 0}
.site-nav a::after{content:"";position:absolute;left:0;right:0;bottom:-2px;height:2px;background:var(--accent);transform:scaleX(0);transform-origin:left;transition:transform .25s ease}
.site-nav a:hover{opacity:1}.site-nav a:hover::after,.site-nav a[aria-current=page]::after{transform:scaleX(1)}
.site-nav a[aria-current=page]{opacity:1}
.menu{display:none;position:relative}
.menu summary{list-style:none;cursor:pointer;padding:.55rem .95rem;border:1px solid currentColor;border-radius:var(--btn-radius);font-weight:600;font-size:.92rem}
.menu summary::-webkit-details-marker{display:none}
.menu .menu-list{position:absolute;right:0;top:calc(100% + .6rem);background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:14px;padding:.5rem;min-width:230px;box-shadow:0 24px 50px -20px rgba(0,0,0,.4);display:grid}
.menu .menu-list a{padding:.7rem .85rem;color:var(--text);text-decoration:none;border-radius:8px}
.menu .menu-list a:hover{background:var(--surface)}
.h-dark .site-header{background:var(--dark-bg);color:var(--dark-text);border-bottom-color:transparent}
.h-dark .brand{color:var(--dark-text)}
.logo{display:inline-flex;align-items:center;line-height:0}
.logo img{height:46px;width:auto;max-width:200px;object-fit:contain}
.logo.multiply img{mix-blend-mode:multiply}
.logo.knockout-white img{filter:brightness(0) invert(1)}
.logo.knockout-black img{filter:brightness(0)}
.logo.plate{background:var(--plate);padding:7px 14px;border-radius:min(var(--radius),14px);box-shadow:0 1px 2px rgba(0,0,0,.18),0 6px 18px -8px rgba(0,0,0,.35)}
.logo.plate img{height:36px;max-width:180px}
.site-footer .flogo{margin-bottom:1rem}
.site-footer .logo img{height:40px}
.site-footer .logo.plate img{height:32px}
.h-overlay .site-header{position:absolute;top:auto;left:0;right:0;background:linear-gradient(180deg,rgba(0,0,0,.55),transparent);border-bottom:0;color:#fff;backdrop-filter:none;-webkit-backdrop-filter:none}
.h-center .site-header .bar{display:grid;grid-template-columns:1fr auto 1fr;grid-template-areas:". brand cta" "nav nav nav";row-gap:.2rem;padding:.7rem 0 0;min-height:0}
.h-center .brand{grid-area:brand;justify-self:center}.h-center .header-cta,.h-center .menu{grid-area:cta;justify-self:end}
.h-center .site-nav{grid-area:nav;justify-content:center;border-top:1px solid var(--line);padding:.55rem 0 .6rem;margin-top:.5rem}
.h-overlay .brand{color:#fff}.h-overlay .logo.plain img{filter:drop-shadow(0 2px 8px rgba(0,0,0,.35))}
@media (max-width:900px){.site-nav{display:none}.menu{display:block}.site-header .header-cta{display:none}}
/* ---------- buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.55rem;min-height:52px;padding:.85rem 1.6rem;border-radius:var(--btn-radius);font:700 1rem/1 var(--bf);letter-spacing:.01em;text-decoration:none;border:2px solid transparent;transition:transform .2s ease,box-shadow .2s ease,background .2s ease,color .2s ease;cursor:pointer}
.btn:hover{transform:translateY(-2px);box-shadow:0 14px 30px -14px color-mix(in srgb,var(--cta) 70%,#000)}
.btn.primary{background:var(--cta);color:var(--on-cta)}
.btn.ghost{background:transparent;color:var(--fg,var(--text));border-color:color-mix(in srgb,var(--fg,var(--text)) 35%,transparent)}
.btn.ghost:hover{border-color:currentColor}
.btn .ico{width:18px;height:18px}
.b-outline .btn.primary{background:transparent;color:var(--fg,var(--text));border-color:var(--cta)}
.b-outline .btn.primary:hover{background:var(--cta);color:var(--on-cta)}
.b-square .btn{text-transform:uppercase;letter-spacing:.08em;font-size:.88rem}
.actions{display:flex;flex-wrap:wrap;gap:.85rem;margin-top:2rem}
/* ---------- sections + tones */
.sec{padding:clamp(4.5rem,9vw,8rem) 0;position:relative;background:var(--sbg,var(--bg));color:var(--fg,var(--text))}
.t-tint{--sbg:var(--surface)}
.t-dark{--sbg:var(--dark-bg);--fg:var(--dark-text);--fg-muted:color-mix(in srgb,var(--dark-text) 72%,transparent);--eyebrow:var(--accent);--line:color-mix(in srgb,var(--dark-text) 16%,transparent);--accent-text:var(--accent)}
.t-brand{--sbg:var(--primary);--fg:var(--on-primary);--fg-muted:color-mix(in srgb,var(--on-primary) 78%,transparent);--eyebrow:var(--on-primary);--line:color-mix(in srgb,var(--on-primary) 20%,transparent);--accent-text:var(--on-primary)}
.t-dark a:not(.btn),.t-brand a:not(.btn){color:inherit}
.t-brand .btn.primary{background:var(--on-primary);color:var(--primary)}
.sec-head{max-width:46rem;margin-bottom:clamp(2rem,4vw,3.2rem)}
.sec-head.center{margin-inline:auto}
.sec-head p{margin:0}
/* ---------- media + placeholders */
.media{position:relative;border-radius:var(--radius);overflow:hidden;background:var(--surface);aspect-ratio:4/3;isolation:isolate}
.media img{width:100%;height:100%;object-fit:cover;transition:transform 1.2s cubic-bezier(.2,.7,.2,1)}
.media:hover img{transform:scale(1.035)}
.ph{position:absolute;inset:0;background:radial-gradient(120% 90% at 15% 10%,color-mix(in srgb,var(--accent) 70%,transparent),transparent 55%),radial-gradient(90% 80% at 90% 90%,color-mix(in srgb,var(--primary) 85%,#000),transparent 60%),linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--primary) 55%,var(--accent)))}
.ph::after{content:"";position:absolute;inset:0;background-image:${GRAIN};opacity:.35;mix-blend-mode:overlay}
.ph-2{background:radial-gradient(100% 80% at 80% 15%,color-mix(in srgb,var(--primary) 60%,transparent),transparent 60%),linear-gradient(160deg,var(--accent),color-mix(in srgb,var(--accent) 45%,var(--primary)))}
.ph-3{background:linear-gradient(120deg,var(--surface),color-mix(in srgb,var(--primary) 35%,var(--surface)))}
/* ---------- heroes */
.s-hero-split{padding:clamp(3.5rem,8vw,7rem) 0 clamp(4rem,8vw,7rem);overflow:hidden}
.s-hero-split .grid{display:grid;grid-template-columns:1.05fr .95fr;gap:clamp(2.5rem,6vw,5.5rem);align-items:center}
.s-hero-split .media{aspect-ratio:4/5;box-shadow:0 40px 80px -40px rgba(0,0,0,.45)}
.s-hero-split .frame{position:relative}
.s-hero-split .frame::before{content:"";position:absolute;inset:auto -1.2rem -1.2rem auto;width:70%;height:70%;border-radius:var(--radius);background:var(--accent);opacity:.9;z-index:-1}
.a-editorial .s-hero-split .frame::before,.a-minimal-luxury .s-hero-split .frame::before{background:none;border:1px solid var(--line);inset:-1rem 1rem 1rem -1rem;width:auto;height:auto}
.s-hero-photo{min-height:min(92vh,880px);display:flex;align-items:flex-end;padding:clamp(8rem,16vw,12rem) 0 clamp(3.5rem,7vw,6rem);color:#fff;--fg:#fff;--fg-muted:rgba(255,255,255,.86);--eyebrow:#fff;--accent-text:var(--accent);overflow:hidden;background:var(--dark-bg)}
.s-hero-photo .bgimg{position:absolute;inset:0;z-index:0}
.s-hero-photo .bgimg img,.s-hero-photo .bgimg .ph{width:100%;height:100%;object-fit:cover;transform:scale(1.06);animation:kenburns 18s ease-out both}
.s-hero-photo::after{content:"";position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,rgba(0,0,0,.25) 0%,rgba(0,0,0,.15) 35%,color-mix(in srgb,var(--dark-bg) 88%,transparent) 100%)}
.s-hero-photo .wrap{z-index:2}
.s-hero-photo h1{max-width:14ch;text-shadow:0 2px 30px rgba(0,0,0,.25)}
.s-hero-photo .lead{max-width:36rem}
.s-hero-photo .btn.ghost{color:#fff;border-color:rgba(255,255,255,.6)}
.s-hero-type{padding:clamp(4rem,10vw,9rem) 0 clamp(3rem,6vw,5rem)}
.s-hero-type h1{max-width:16ch;margin-bottom:.35em}
.s-hero-type .row{display:grid;grid-template-columns:1fr auto;gap:2rem;align-items:end;border-top:1px solid var(--line);padding-top:1.8rem}
.s-hero-type .row .actions{margin-top:0}
.s-hero-type .strip{margin-top:clamp(2.5rem,5vw,4rem)}
.s-hero-type .strip .media{aspect-ratio:21/9}
/* hero treatments: no two looks share one (look-variety.ts) */
.s-hero-split.v-caption{background:var(--surface)}
.s-hero-split.v-caption .grid{grid-template-columns:.9fr 1.1fr}
.s-hero-split.v-caption .hero-copy{background:var(--bg);padding:clamp(1.8rem,4vw,3.2rem);border:1px solid var(--line);border-radius:var(--radius)}
.s-hero-split.v-caption .frame{margin:0}
.s-hero-split.v-caption .frame::before{display:none}
.s-hero-split.v-caption .media{aspect-ratio:4/3;box-shadow:0 30px 60px -40px rgba(0,0,0,.35)}
.s-hero-split.v-caption figcaption{margin-top:.75rem;padding-top:.6rem;border-top:1px solid var(--line);font-size:.82rem;color:var(--muted);letter-spacing:.01em}
.s-hero-photo.v-cinematic{min-height:min(100vh,960px);align-items:center;padding-top:clamp(9rem,16vw,12rem)}
.s-hero-photo.v-cinematic .bgimg img{object-position:50% 88%;transform:scale(1.2);transform-origin:50% 100%;animation:none;filter:saturate(.85) contrast(1.08)}
.s-hero-photo.v-cinematic::after{background:linear-gradient(90deg,rgba(0,0,0,.88) 0%,rgba(0,0,0,.66) 36%,rgba(0,0,0,.12) 78%),linear-gradient(0deg,var(--dark-bg) 0%,transparent 28%)}
.s-hero-photo.v-cinematic h1{max-width:11ch;font-size:clamp(3rem,7vw,6.4rem);line-height:.98}
.s-hero-photo.v-cinematic .eyebrow{letter-spacing:.32em}
.s-hero-split.v-collage{overflow:hidden}
.s-hero-split.v-collage::before{content:"";position:absolute;right:-8vw;top:9%;width:50vw;height:82%;background:var(--accent);border-radius:56px;transform:rotate(-7deg);z-index:0}
.s-hero-split.v-collage .wrap{position:relative;z-index:1}
.s-hero-split.v-collage .frame{margin:1.5rem 2rem 2.5rem 3rem}
.s-hero-split.v-collage .frame::before{display:none}
.s-hero-split.v-collage .frame>.media:not(.tile){aspect-ratio:1/1;border-radius:40px;border:10px solid #fff;transform:rotate(3deg);box-shadow:0 40px 70px -35px rgba(0,0,0,.55)}
.s-hero-split.v-collage .frame>.media:not(.tile) img{filter:grayscale(1) contrast(1.12)}
.s-hero-split.v-collage .frame>.media:not(.tile)::after{content:"";position:absolute;inset:0;background:var(--accent);mix-blend-mode:multiply;opacity:.6;pointer-events:none}
.s-hero-split.v-collage .tile{position:absolute;width:44%;aspect-ratio:1/1;left:-14%;bottom:-12%;border-radius:26px;border:8px solid #fff;transform:rotate(-8deg);z-index:2;box-shadow:0 24px 40px -20px rgba(0,0,0,.5)}
.s-hero-split.v-collage .badge{display:grid!important;width:156px;height:156px;right:-26px;top:-34px;transform:rotate(12deg)}
.s-hero-type.v-caption .hero-copy{background:var(--bg);border:1px solid var(--line);border-radius:var(--radius);padding:clamp(2rem,5vw,4rem)}
.s-hero-type.v-cinematic{padding:clamp(7rem,14vw,11rem) 0 clamp(4rem,8vw,6rem)}
.s-hero-type.v-cinematic h1{font-size:clamp(3.2rem,8vw,7rem);max-width:11ch;line-height:.95}
.s-hero-type.v-collage{overflow:hidden}
.s-hero-type.v-collage::before{content:"";position:absolute;right:-10vw;top:12%;width:44vw;height:76%;background:var(--accent);border-radius:56px;transform:rotate(-7deg);z-index:0}
.s-hero-type.v-collage .wrap{position:relative;z-index:1}
@media (max-width:900px){.s-hero-split.v-caption .grid{grid-template-columns:1fr}.s-hero-split.v-collage .frame{margin:1rem}.s-hero-split.v-collage::before{width:90vw;right:-30vw}}
.s-page-hero{padding:clamp(4rem,8vw,6.5rem) 0 clamp(3rem,6vw,4.5rem)}
.s-page-hero .grid{display:grid;grid-template-columns:1.2fr .8fr;gap:clamp(2rem,5vw,4rem);align-items:end}
.s-page-hero .media{aspect-ratio:5/4}
.s-page-hero h1{font-size:clamp(2.4rem,5.6vw,4.6rem)}
.badge{position:absolute;width:132px;height:132px;right:-18px;top:-18px;z-index:3;color:var(--on-cta);background:var(--cta);border-radius:50%;display:grid;place-items:center;box-shadow:0 18px 40px -18px rgba(0,0,0,.5)}
.badge svg{width:118px;height:118px;animation:spin 22s linear infinite}
.badge text{font:700 10.5px var(--bf);letter-spacing:.22em;text-transform:uppercase;fill:currentColor}
.badge .core{position:absolute;font:700 1.5rem/1 var(--hf)}
body:not(.m-stamp-badges) .badge{display:none}
/* ---------- stat bar + marquee */
.s-stat-bar{padding:clamp(2.5rem,5vw,3.5rem) 0}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:0}
.stat{padding:.4rem 1.5rem;border-left:1px solid var(--line)}
.stat:first-child{border-left:0;padding-left:0}
.stat strong{display:block;font:var(--hw) clamp(2.2rem,4.5vw,3.4rem)/1 var(--hf);letter-spacing:var(--ht);color:var(--accent-text,var(--primary));margin-bottom:.35rem}
.stat span{color:var(--fg-muted,var(--muted));font-size:.95rem}
.s-marquee{padding:1.3rem 0;overflow:hidden;border-block:1px solid var(--line)}
.marquee{display:flex;width:max-content;animation:marquee 38s linear infinite}
.marquee span{font:var(--hw) clamp(1.4rem,3vw,2.2rem)/1.1 var(--hf);letter-spacing:var(--ht);white-space:nowrap;padding-right:2.6rem;display:inline-flex;align-items:center;gap:2.6rem}
.marquee span::after{content:"✦";color:var(--accent);font-size:.7em}
/* ---------- services */
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:1.4rem}
.cards.n2,.cards.n4{grid-template-columns:repeat(2,1fr)}
.card{position:relative;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:var(--radius);padding:clamp(1.5rem,2.5vw,2.1rem);transition:transform .3s ease,box-shadow .3s ease,border-color .3s ease;display:flex;flex-direction:column}
.t-tint .card{background:var(--bg)}
.t-dark .card,.t-brand .card{background:color-mix(in srgb,var(--fg) 7%,transparent);color:var(--fg);border-color:var(--line)}
.card:hover{transform:translateY(-4px);box-shadow:0 26px 50px -30px rgba(0,0,0,.45);border-color:color-mix(in srgb,var(--primary) 40%,transparent)}
.card h3{margin-bottom:.45rem}.card p{color:var(--fg-muted,var(--muted));margin:0}
.card .icon{width:54px;height:54px;border-radius:calc(var(--radius) * .7);display:grid;place-items:center;background:color-mix(in srgb,var(--primary) 12%,transparent);color:var(--primary);margin-bottom:1.3rem}
.t-dark .card .icon,.t-brand .card .icon{background:color-mix(in srgb,var(--accent) 22%,transparent);color:var(--accent)}
.card .icon svg{width:26px;height:26px}
.card .num{font:var(--hw) .95rem/1 var(--hf);color:var(--accent-text,var(--primary));margin-bottom:1rem;letter-spacing:.08em}
.card.img{padding:0;overflow:hidden}
.card.img .media{border-radius:0;aspect-ratio:16/11}
.card.img .body{padding:1.5rem 1.6rem 1.8rem}
.svc-list{border-top:1px solid var(--line)}
.svc-row{display:grid;grid-template-columns:5rem 1fr 1.2fr;gap:1.5rem;padding:1.8rem 0;border-bottom:1px solid var(--line);align-items:baseline;transition:padding .3s ease,background .3s ease}
.svc-row:hover{padding-left:.8rem;background:color-mix(in srgb,var(--primary) 5%,transparent)}
.svc-row .n{font:var(--hw) 1rem/1 var(--hf);color:var(--accent-text,var(--primary))}
.svc-row h3{margin:0}.svc-row p{margin:0;color:var(--fg-muted,var(--muted))}
.bento{display:grid;grid-template-columns:repeat(4,1fr);gap:1.2rem}
.bento .card:first-child{grid-column:span 2;grid-row:span 2;background:var(--primary);color:var(--on-primary);border-color:transparent;justify-content:flex-end}
.bento .card:first-child p{color:color-mix(in srgb,var(--on-primary) 80%,transparent)}
.bento .card:first-child h3{font-size:clamp(1.6rem,2.6vw,2.2rem);color:var(--on-primary)}
.bento .card:first-child .icon{background:color-mix(in srgb,var(--on-primary) 15%,transparent);color:var(--on-primary)}
/* ---------- feature split */
.split{display:grid;grid-template-columns:1fr 1fr;gap:clamp(2.5rem,6vw,5.5rem);align-items:center}
.split.reverse>.copy{order:2}
.split .media{aspect-ratio:5/6}
.checks{list-style:none;padding:0;margin:1.5rem 0 0;display:grid;gap:.8rem}
.checks li{display:grid;grid-template-columns:28px 1fr;gap:.7rem;align-items:start}
.checks li::before{content:"";width:22px;height:22px;margin-top:.2rem;border-radius:50%;background:var(--accent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.2 4.2L19 7'/%3E%3C/svg%3E") center/14px no-repeat}
/* ---------- process */
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1.4rem;counter-reset:step}
.step{position:relative;padding-top:1.5rem;border-top:2px solid var(--line)}
.step::before{counter-increment:step;content:counter(step,decimal-leading-zero);display:block;font:var(--hw) 1rem/1 var(--hf);color:var(--accent-text,var(--primary));margin-bottom:1rem;letter-spacing:.06em}
.m-oversized-numbers .step::before{font-size:clamp(3.4rem,6vw,5rem);line-height:.9;color:transparent;-webkit-text-stroke:1.5px var(--accent-text,var(--primary));letter-spacing:-.02em}
.step p{color:var(--fg-muted,var(--muted));margin:0}
/* ---------- reviews (CSS-only carousel) */
.carousel{display:grid;grid-auto-flow:column;grid-auto-columns:min(78%,560px);gap:1.4rem;overflow-x:auto;scroll-snap-type:x mandatory;padding:.5rem .2rem 1.6rem;scrollbar-width:thin;scrollbar-color:var(--accent) transparent;overscroll-behavior-x:contain}
.carousel.few{grid-auto-flow:row;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));overflow:visible}
.review{scroll-snap-align:start;margin:0;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:var(--radius);padding:clamp(1.8rem,3vw,2.6rem);display:flex;flex-direction:column;gap:1.2rem;position:relative}
.t-dark .review,.t-brand .review{background:color-mix(in srgb,var(--fg) 7%,transparent);color:var(--fg)}
.review::before{content:"\\201C";font:400 5rem/0.6 var(--hf);color:var(--accent);height:2.2rem}
.review p{font-size:clamp(1.05rem,1.6vw,1.25rem);line-height:1.6;margin:0}
.review cite{font-style:normal;font-weight:700;font-size:.95rem;color:var(--fg-muted,var(--muted))}
.review cite::before{content:"— "}
.hint{font-size:.85rem;color:var(--fg-muted,var(--muted));margin-top:.4rem}
/* ---------- before / after */
.ba{display:grid;grid-template-columns:1fr 1fr;gap:1.4rem}
.ba figure{margin:0;position:relative}
.ba .media{aspect-ratio:4/3}
.ba .chip{position:absolute;top:1rem;left:1rem;z-index:2;background:var(--bg);color:var(--text);font:700 .74rem/1 var(--bf);letter-spacing:.16em;text-transform:uppercase;padding:.55rem .8rem;border-radius:999px}
.ba figure:last-child .chip{background:var(--cta);color:var(--on-cta)}
.ba figcaption{margin-top:.9rem;color:var(--fg-muted,var(--muted))}
.ba figcaption strong{display:block;color:var(--fg,var(--text));font-family:var(--hf);font-weight:var(--hw);font-size:1.2rem}
/* ---------- gallery */
.gallery{display:grid;grid-template-columns:repeat(6,1fr);grid-auto-rows:150px;gap:1rem}
.gallery .media{aspect-ratio:auto;height:100%}
.gallery .g1{grid-column:span 3;grid-row:span 3}.gallery .g2{grid-column:span 3;grid-row:span 2}.gallery .g3{grid-column:span 3}
.gallery .g4{grid-column:span 2;grid-row:span 2}.gallery .g5{grid-column:span 2;grid-row:span 2}.gallery .g6{grid-column:span 2;grid-row:span 2}
/* ---------- statement */
.s-statement .big{font:var(--hw) clamp(1.9rem,4.4vw,3.6rem)/1.15 var(--hf);letter-spacing:var(--ht);max-width:22ch;margin:0;text-wrap:balance}
.s-statement.center .big{margin-inline:auto}
.s-statement .big em{color:var(--accent-text,var(--primary));font-style:${serifish ? "italic" : "normal"}}
.m-outlined-type .s-statement .big em{color:transparent;-webkit-text-stroke:1.5px var(--accent-text,var(--primary))}
.s-statement .by{margin-top:1.6rem;color:var(--fg-muted,var(--muted))}
/* ---------- faq */
.faq{border-top:1px solid var(--line);max-width:860px}
.center .faq,.s-faq .faq{margin-inline:auto}
.faq details{border-bottom:1px solid var(--line)}
.faq summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;gap:1.5rem;align-items:center;padding:1.45rem 0;font:var(--hw) clamp(1.05rem,1.6vw,1.25rem)/1.35 var(--hf);letter-spacing:var(--ht)}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";flex:none;width:36px;height:36px;border-radius:50%;border:1px solid var(--line);display:grid;place-items:center;font:400 1.3rem/1 var(--bf);transition:transform .3s ease,background .3s ease}
.faq details[open] summary::after{transform:rotate(45deg);background:var(--cta);color:var(--on-cta);border-color:transparent}
.faq details p{margin:0 0 1.5rem;color:var(--fg-muted,var(--muted));max-width:46rem}
/* ---------- cta band */
.cta-band{position:relative;overflow:hidden;border-radius:calc(var(--radius) * 1.4);padding:clamp(2.5rem,6vw,5rem);background:linear-gradient(125deg,var(--primary) 0%,color-mix(in srgb,var(--primary) 60%,var(--accent)) 100%);color:var(--on-primary);display:grid;grid-template-columns:1.4fr auto;gap:2rem;align-items:center;--fg:var(--on-primary);--fg-muted:color-mix(in srgb,var(--on-primary) 82%,transparent)}
.cta-band::before,.cta-band::after{content:"";position:absolute;border-radius:50%;background:color-mix(in srgb,#fff 12%,transparent);pointer-events:none}
.cta-band::before{width:420px;height:420px;right:-120px;top:-180px}
.cta-band::after{width:260px;height:260px;right:120px;bottom:-170px;background:color-mix(in srgb,var(--accent) 35%,transparent)}
.cta-band>*{position:relative;z-index:1}
.cta-band h2{margin:0 0 .4rem;color:var(--on-primary)}
.cta-band p{margin:0;color:var(--fg-muted);max-width:36rem}
.cta-band .actions{margin-top:0}
.cta-band .btn.primary{background:var(--on-primary);color:var(--primary);border-color:transparent}
.cta-band .btn.ghost{color:var(--on-primary);border-color:color-mix(in srgb,var(--on-primary) 50%,transparent)}
/* ---------- contact block */
.contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.4rem}
.info{display:grid;gap:1rem}
.info .row{display:grid;grid-template-columns:48px 1fr;gap:1rem;align-items:start;padding:1.25rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--bg)}
.t-dark .info .row{background:color-mix(in srgb,var(--fg) 6%,transparent)}
.info .row .icon{width:48px;height:48px;border-radius:calc(var(--radius) * .7);display:grid;place-items:center;background:color-mix(in srgb,var(--primary) 12%,transparent);color:var(--primary)}
.info .row .icon svg{width:22px;height:22px}
.info dt{font:700 .74rem/1.2 var(--bf);letter-spacing:.16em;text-transform:uppercase;color:var(--fg-muted,var(--muted));margin-bottom:.3rem}
.info dd{margin:0;font-size:1.08rem;font-weight:600}
.info dd a{text-decoration:none;color:inherit}
.map{position:relative;min-height:360px;border-radius:var(--radius);overflow:hidden;display:flex;align-items:flex-end;padding:1.5rem;text-decoration:none;color:#fff;background:linear-gradient(0deg,rgba(0,0,0,.55),transparent 55%),repeating-linear-gradient(0deg,transparent 0 46px,color-mix(in srgb,#fff 14%,transparent) 46px 48px),repeating-linear-gradient(90deg,transparent 0 46px,color-mix(in srgb,#fff 14%,transparent) 46px 48px),linear-gradient(135deg,color-mix(in srgb,var(--primary) 80%,#000),color-mix(in srgb,var(--primary) 45%,var(--accent)))}
.map .pin{position:absolute;left:50%;top:42%;width:46px;height:46px;transform:translate(-50%,-50%) rotate(-45deg);background:var(--cta);border-radius:50% 50% 50% 0;box-shadow:0 10px 30px rgba(0,0,0,.4)}
.map .pin::after{content:"";position:absolute;inset:14px;border-radius:50%;background:var(--on-cta)}
.map strong{font-family:var(--hf);font-weight:var(--hw);font-size:1.25rem;display:block}
.map span{opacity:.9}
/* ---------- rich text */
.prose{max-width:720px}
.prose p{font-size:1.1rem}
.prose.two{max-width:none;columns:2 320px;column-gap:3.5rem}
/* ---------- contact form */
.contact-form{display:grid;gap:1.1rem;margin-top:2rem}
.contact-form .two{display:grid;grid-template-columns:1fr 1fr;gap:1.1rem}
.contact-form label{display:grid;gap:.4rem;font-weight:600;font-size:.94rem}
.contact-form input,.contact-form textarea{font:inherit;padding:.95rem 1.1rem;border-radius:calc(var(--radius) * .6);border:1px solid color-mix(in srgb,var(--text) 22%,transparent);background:var(--bg);color:var(--text);transition:border-color .2s ease,box-shadow .2s ease}
.contact-form input:focus,.contact-form textarea:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 4px color-mix(in srgb,var(--primary) 18%,transparent)}
.contact-form textarea{min-height:150px;resize:vertical}
.contact-form .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.form-card{background:var(--bg);border:1px solid var(--line);border-radius:calc(var(--radius) * 1.2);padding:clamp(1.8rem,4vw,3rem);box-shadow:0 40px 80px -50px rgba(0,0,0,.35)}
/* ---------- footer */
.site-footer{background:var(--dark-bg);color:color-mix(in srgb,var(--dark-text) 82%,transparent);padding:clamp(3.5rem,7vw,5.5rem) 0 2rem;font-size:.96rem;position:relative}
.site-footer a{color:inherit;text-decoration:none}.site-footer a:hover{color:var(--dark-text);text-decoration:underline}
.site-footer .cols{display:grid;grid-template-columns:2fr 1fr 1.2fr;gap:2.5rem}
.site-footer h4{color:var(--dark-text);font-size:1.05rem;margin-bottom:.9rem;text-transform:none}
.site-footer .fbrand{font:var(--hw) 1.6rem/1.1 var(--hf);color:var(--dark-text);letter-spacing:var(--ht);margin-bottom:.8rem}
.site-footer ul{list-style:none;padding:0;margin:0;display:grid;gap:.5rem}
.site-footer .legal{margin-top:3rem;padding-top:1.5rem;border-top:1px solid color-mix(in srgb,var(--dark-text) 16%,transparent);display:flex;flex-wrap:wrap;justify-content:space-between;gap:1rem;opacity:.7;font-size:.85rem}
.site-footer .say{display:block;font:var(--hw) clamp(2.6rem,8vw,6.5rem)/0.95 var(--hf);letter-spacing:var(--ht);color:var(--dark-text);margin-bottom:clamp(2.5rem,5vw,4rem);text-decoration:none}
.site-footer .say:hover{color:var(--accent);text-decoration:none}
.site-footer .say::after{content:" →";color:var(--accent)}
.f-minimal .site-footer{padding:2.2rem 0}
.f-minimal .site-footer .row{display:flex;flex-wrap:wrap;gap:1.2rem 2rem;align-items:center;justify-content:space-between}
.f-minimal .site-footer .row ul{display:flex;flex-wrap:wrap;gap:1.2rem}
/* ---------- ribbon */
.preview-ribbon{background:#111;color:#fff;text-align:center;font:500 12px/1.4 system-ui,sans-serif;padding:6px 12px;letter-spacing:.02em;position:relative;z-index:40}
.notice{border:1px dashed var(--line);border-radius:var(--radius);padding:1.6rem;background:var(--surface);color:var(--text)}
/* ---------- archetype flavours */
.a-editorial .sec+.sec:not(.t-dark):not(.t-brand):not(.t-tint){border-top:1px solid var(--line)}
.a-editorial .site-header{border-bottom:1px solid var(--text)}
.a-editorial .card{border-radius:0;border-width:0 0 0 0;border-top:1px solid var(--text);padding-left:0;padding-right:0;background:transparent}
.a-editorial .card:hover{transform:none;box-shadow:none}
.a-dark-premium .eyebrow{letter-spacing:.3em}
.a-dark-premium .card{background:color-mix(in srgb,var(--text) 4%,transparent)}
.a-dark-premium h1,.a-dark-premium h2{font-weight:500}
.a-bold-photo .eyebrow{background:var(--accent);color:var(--on-accent);padding:.45rem .7rem;border-radius:2px}
.a-bold-photo .eyebrow::before{display:none}
.a-playful .card{box-shadow:6px 6px 0 color-mix(in srgb,var(--text) 85%,transparent);border:2px solid var(--text)}
.a-playful .card:hover{transform:translate(-3px,-3px);box-shadow:9px 9px 0 var(--accent)}
.a-playful .btn{box-shadow:4px 4px 0 var(--text)}
.a-playful .btn:hover{box-shadow:6px 6px 0 var(--text)}
.a-playful .media{border:2px solid var(--text)}
.a-minimal-luxury .sec{padding:clamp(5rem,11vw,9.5rem) 0}
.a-minimal-luxury .eyebrow::before{width:3rem;height:1px}
.a-minimal-luxury .card{border-radius:0;background:transparent}
.a-minimal-luxury .site-nav a{text-transform:uppercase;letter-spacing:.14em;font-size:.78rem}
.a-warm-craft .card{background:color-mix(in srgb,var(--surface) 60%,var(--bg))}
.a-warm-craft .media{box-shadow:0 30px 60px -35px color-mix(in srgb,var(--primary) 70%,#000)}
/* ---------- motifs */
body.m-grain::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:60;background-image:${GRAIN};opacity:.07;mix-blend-mode:multiply}
${darkTheme ? "body.m-grain::after{mix-blend-mode:screen;opacity:.05}" : ""}
.m-thin-rules .sec-head{border-left:1px solid var(--accent);padding-left:1.4rem}
.m-thin-rules .sec-head.center{border-left:0;padding-left:0}
.m-diagonal-cuts .sec.t-dark:not(.s-hero-photo),.m-diagonal-cuts .sec.t-brand{clip-path:polygon(0 3.5vw,100% 0,100% calc(100% - 3.5vw),0 100%);padding-block:clamp(6rem,12vw,10rem)}
.m-soft-blobs .s-hero-split::before,.m-soft-blobs .s-hero-type::before,.m-soft-blobs .s-page-hero::before{content:"";position:absolute;width:46vw;height:46vw;max-width:620px;max-height:620px;right:-12vw;top:-14vw;border-radius:42% 58% 63% 37%/45% 41% 59% 55%;background:color-mix(in srgb,var(--accent) 26%,transparent);filter:blur(2px);animation:blob 16s ease-in-out infinite alternate;z-index:0}
.m-soft-blobs .s-hero-split::after{content:"";position:absolute;width:24vw;height:24vw;max-width:320px;max-height:320px;left:-8vw;bottom:-8vw;border-radius:58% 42% 37% 63%/45% 55% 45% 55%;background:color-mix(in srgb,var(--primary) 16%,transparent);z-index:0}
.m-soft-blobs .s-hero-split .wrap,.m-soft-blobs .s-hero-type .wrap,.m-soft-blobs .s-page-hero .wrap{z-index:1}
.m-underline-marks h1 em,.m-underline-marks .big em{font-style:normal;color:inherit;background:linear-gradient(transparent 62%,color-mix(in srgb,var(--accent) 70%,transparent) 62%,color-mix(in srgb,var(--accent) 70%,transparent) 92%,transparent 92%);padding:0 .08em}
.m-grid-lines .s-hero-type,.m-grid-lines .s-page-hero,.m-grid-lines .s-hero-split{background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:80px 80px;background-position:-1px -1px}
.m-glow .s-hero-split,.m-glow .s-hero-type,.m-glow .s-page-hero,.m-glow .s-cta-band{background-image:radial-gradient(60% 70% at 85% 0%,color-mix(in srgb,var(--accent) 28%,transparent),transparent 70%),radial-gradient(50% 60% at 0% 100%,color-mix(in srgb,var(--primary) 22%,transparent),transparent 70%)}
.m-outlined-type .s-hero-type h1 em,.m-outlined-type .s-hero-photo h1 em{color:transparent;-webkit-text-stroke:2px currentColor;font-style:normal}
.m-outlined-type .s-hero-photo h1 em{-webkit-text-stroke-color:#fff}
/* ---------- motion */
@keyframes up{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
@keyframes kenburns{from{transform:scale(1.14)}to{transform:scale(1.03)}}
@keyframes marquee{to{transform:translateX(-50%)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes blob{to{border-radius:58% 42% 37% 63%/55% 45% 55% 45%;transform:translate(-3vw,2vw) rotate(12deg)}}
@keyframes reveal{from{opacity:0;transform:translateY(42px) scale(.985)}to{opacity:1;transform:none}}
.hero-copy>*{animation:up .9s cubic-bezier(.2,.7,.2,1) both}
.hero-copy>*:nth-child(2){animation-delay:.08s}.hero-copy>*:nth-child(3){animation-delay:.16s}.hero-copy>*:nth-child(4){animation-delay:.24s}.hero-copy>*:nth-child(5){animation-delay:.32s}
@supports (animation-timeline: view()){
  .rv{animation:reveal linear both;animation-timeline:view();animation-range:entry 0% entry 55%}
  .s-hero-split .media img,.s-page-hero .media img{animation:parallax linear both;animation-timeline:view();animation-range:exit 0% exit 100%}
  @keyframes parallax{to{transform:translateY(8%) scale(1.06)}}
}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
/* ---------- responsive */
@media (max-width:980px){
  .s-hero-split .grid,.s-page-hero .grid,.split,.contact-grid{grid-template-columns:1fr}
  .split.reverse>.copy{order:0}
  .cards,.bento{grid-template-columns:repeat(2,1fr)}
  .bento .card:first-child{grid-column:span 2;grid-row:auto}
  .s-hero-type .row{grid-template-columns:1fr}
  .cta-band{grid-template-columns:1fr}
  .site-footer .cols{grid-template-columns:1fr 1fr}
  .s-hero-split .media{aspect-ratio:4/3}
  .split .media{aspect-ratio:4/3}
}
@media (max-width:640px){
  body{font-size:16.5px}
  .cards,.cards.n2,.cards.n4,.bento,.ba,.contact-form .two{grid-template-columns:1fr}
  .bento .card:first-child{grid-column:auto}
  .svc-row{grid-template-columns:1fr;gap:.4rem}
  .stats{grid-template-columns:1fr 1fr}
  .stat{border-left:0;padding-left:0;padding-block:.8rem}
  .gallery{grid-template-columns:1fr 1fr;grid-auto-rows:140px}
  .gallery .media{grid-column:span 1!important;grid-row:span 1!important}
  .gallery .g1{grid-column:span 2!important;grid-row:span 2!important}
  .site-footer .cols{grid-template-columns:1fr}
  .badge{width:104px;height:104px;right:-6px;top:-10px}.badge svg{width:94px;height:94px}
  .carousel{grid-auto-columns:88%}
  .s-hero-photo{min-height:640px}
}
`.trim();
}
