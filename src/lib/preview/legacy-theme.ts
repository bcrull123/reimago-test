/** Legacy stylesheet kept so preview links made by the first live-preview version still render. */
import { contrast } from "./design.ts";
import type { SitePalette } from "./types.ts";

function onColor(hex: string): string {
  return contrast(hex, "#ffffff") >= contrast(hex, "#111111") ? "#ffffff" : "#111111";
}

/** Stylesheet for v2 preview records (built before design directions existed). */
export function legacyCss(plan: { palette: SitePalette; fonts: { heading: string; body: string } }): string {
  const p = plan.palette;
  const onPrimary = onColor(p.primary);
  const onAccent = onColor(p.accent);
  const heading = `"${plan.fonts.heading}", Georgia, serif`;
  const body = `"${plan.fonts.body}", system-ui, -apple-system, "Segoe UI", sans-serif`;
  return `
:root{--primary:${p.primary};--on-primary:${onPrimary};--accent:${p.accent};--on-accent:${onAccent};--bg:${p.background};--surface:${p.surface};--text:${p.text};--muted:${p.muted};--radius:14px;--max:1160px}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font-family:${body};font-size:17px;line-height:1.65;-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block}
a{color:var(--primary)}
h1,h2,h3,h4{font-family:${heading};line-height:1.15;margin:0 0 .5em;color:var(--text);letter-spacing:-.01em}
h1{font-size:clamp(2.2rem,5vw,3.8rem)}h2{font-size:clamp(1.7rem,3.2vw,2.5rem)}h3{font-size:1.25rem}
p{margin:0 0 1em}
.container{width:min(100% - 2.5rem,var(--max));margin-inline:auto}
.site-header{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid color-mix(in srgb,var(--text) 10%,transparent)}
.site-header .bar{display:flex;align-items:center;justify-content:space-between;gap:1.5rem;min-height:72px}
.brand{display:flex;align-items:center;gap:.75rem;text-decoration:none;color:var(--text);font-family:${heading};font-weight:700;font-size:1.3rem}
.brand img{height:44px;width:auto;max-width:180px;object-fit:contain}
.site-nav{display:flex;align-items:center;gap:1.4rem}
.site-nav a{color:var(--text);text-decoration:none;font-weight:500;font-size:.98rem;opacity:.85}
.site-nav a:hover,.site-nav a[aria-current=page]{opacity:1;color:var(--primary)}
.site-nav a[aria-current=page]{text-decoration:underline;text-underline-offset:6px}
.menu{display:none;position:relative}
.menu summary{list-style:none;cursor:pointer;padding:.5rem .8rem;border:1px solid color-mix(in srgb,var(--text) 20%,transparent);border-radius:10px;font-weight:600}
.menu summary::-webkit-details-marker{display:none}
.menu .menu-list{position:absolute;right:0;top:calc(100% + .5rem);background:var(--bg);border:1px solid color-mix(in srgb,var(--text) 12%,transparent);border-radius:12px;padding:.5rem;min-width:220px;box-shadow:0 18px 40px -18px rgba(0,0,0,.35);display:grid}
.menu .menu-list a{padding:.65rem .8rem;color:var(--text);text-decoration:none;border-radius:8px}
.menu .menu-list a:hover{background:var(--surface)}
@media (max-width:860px){.site-nav{display:none}.menu{display:block}.site-header .header-cta{display:none}}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;min-height:48px;padding:.75rem 1.4rem;border-radius:999px;font-weight:600;text-decoration:none;border:2px solid transparent;transition:transform .15s ease,filter .15s ease;cursor:pointer;font-size:1rem}
.btn:hover{transform:translateY(-1px);filter:brightness(1.05)}
.btn.primary{background:var(--primary);color:var(--on-primary)}
.btn.accent{background:var(--accent);color:var(--on-accent)}
.btn.ghost{background:transparent;color:var(--text);border-color:color-mix(in srgb,var(--text) 25%,transparent)}
.dark .btn.ghost,.cta-band .btn.ghost{color:inherit;border-color:currentColor}
.actions{display:flex;flex-wrap:wrap;gap:.8rem;margin-top:1.6rem}
.section{padding:clamp(3.5rem,7vw,6rem) 0}
.section.alt{background:var(--surface)}
.section.dark{background:var(--primary);color:var(--on-primary)}
.section.dark h1,.section.dark h2,.section.dark h3,.section.dark a:not(.btn){color:var(--on-primary)}
.section.dark .lead,.section.dark .muted{color:color-mix(in srgb,var(--on-primary) 80%,transparent)}
.eyebrow{display:inline-block;font-size:.8rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--primary);margin-bottom:.8rem}
.dark .eyebrow{color:var(--accent)}
.lead{font-size:1.18rem;color:var(--muted);max-width:40rem}
.muted{color:var(--muted)}
.center{text-align:center}.center .lead{margin-inline:auto}.center .actions{justify-content:center}
.hero{padding:clamp(3.5rem,8vw,7rem) 0;background:linear-gradient(180deg,var(--surface),var(--bg))}
.hero-grid,.split{display:grid;grid-template-columns:1.1fr .9fr;gap:clamp(2rem,5vw,4.5rem);align-items:center}
.split.reverse>:first-child{order:2}
.page-hero{padding:clamp(3rem,6vw,5rem) 0 clamp(2rem,4vw,3rem);background:var(--surface)}
.grid-2,.grid-3,.grid-4{display:grid;gap:1.4rem;margin-top:2rem}
.grid-2{grid-template-columns:repeat(2,1fr)}.grid-3{grid-template-columns:repeat(3,1fr)}.grid-4{grid-template-columns:repeat(4,1fr)}
@media (max-width:900px){.grid-3,.grid-4{grid-template-columns:repeat(2,1fr)}.hero-grid,.split{grid-template-columns:1fr}.split.reverse>:first-child{order:0}}
@media (max-width:600px){.grid-2,.grid-3,.grid-4{grid-template-columns:1fr}body{font-size:16px}}
.card{background:var(--bg);border:1px solid color-mix(in srgb,var(--text) 10%,transparent);border-radius:var(--radius);padding:1.6rem;box-shadow:0 1px 0 rgba(0,0,0,.02)}
.section.alt .card{background:var(--bg)}
.card h3{margin-bottom:.4rem}.card p:last-child{margin-bottom:0}
.card .icon{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:12px;background:color-mix(in srgb,var(--primary) 12%,transparent);color:var(--primary);font-weight:700;margin-bottom:1rem}
.media{border-radius:calc(var(--radius) + 6px);overflow:hidden;aspect-ratio:4/3;background:var(--surface)}
.media img{width:100%;height:100%;object-fit:cover}
.ph{width:100%;height:100%;min-height:220px;border-radius:inherit;background:linear-gradient(135deg,color-mix(in srgb,var(--primary) 85%,#000) 0%,var(--primary) 45%,color-mix(in srgb,var(--accent) 80%,var(--primary)) 100%);position:relative}
.ph::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 25% 30%,rgba(255,255,255,.22),transparent 45%),radial-gradient(circle at 80% 75%,rgba(255,255,255,.12),transparent 40%)}
.ph-2{background:linear-gradient(160deg,var(--accent),color-mix(in srgb,var(--accent) 55%,var(--primary)))}
.ph-3{background:linear-gradient(120deg,var(--surface),color-mix(in srgb,var(--primary) 30%,var(--surface)))}
.quote{margin:0;padding:1.6rem;border-radius:var(--radius);background:var(--bg);border-left:4px solid var(--accent)}
.quote p{font-size:1.08rem;font-style:italic}
.quote cite{font-style:normal;font-weight:600;color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1.2rem;margin-top:2rem}
.stat strong{display:block;font-family:${heading};font-size:2rem;color:var(--primary)}
.list-check{list-style:none;padding:0;margin:1rem 0;display:grid;gap:.6rem}
.list-check li{padding-left:1.8rem;position:relative}
.list-check li::before{content:"✓";position:absolute;left:0;top:0;color:var(--primary);font-weight:700}
.cta-band{background:var(--primary);color:var(--on-primary);border-radius:calc(var(--radius) + 8px);padding:clamp(2rem,5vw,3.5rem);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1.5rem}
.cta-band h2{color:var(--on-primary);margin:0}
.cta-band p{margin:.4rem 0 0;opacity:.9}
.info-list{display:grid;gap:1rem;margin:0}
.info-list dt{font-weight:700;font-size:.85rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.info-list dd{margin:0 0 .4rem;font-size:1.08rem}
.faq details{border-bottom:1px solid color-mix(in srgb,var(--text) 12%,transparent);padding:1rem 0}
.faq summary{cursor:pointer;font-weight:600;font-size:1.08rem}
.contact-form{display:grid;gap:1rem}
.contact-form label{display:grid;gap:.35rem;font-weight:600;font-size:.95rem}
.contact-form input,.contact-form textarea{font:inherit;padding:.8rem 1rem;border-radius:10px;border:1px solid color-mix(in srgb,var(--text) 22%,transparent);background:var(--bg);color:var(--text)}
.contact-form textarea{min-height:140px;resize:vertical}
.contact-form .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.site-footer{background:color-mix(in srgb,var(--primary) 92%,#000);color:color-mix(in srgb,#fff 88%,transparent);padding:3.5rem 0 2rem;font-size:.95rem}
.site-footer a{color:inherit}
.site-footer .cols{display:grid;grid-template-columns:2fr 1fr 1fr;gap:2rem}
@media (max-width:760px){.site-footer .cols{grid-template-columns:1fr}}
.site-footer h4{color:#fff;font-size:1rem;margin-bottom:.8rem}
.site-footer ul{list-style:none;padding:0;margin:0;display:grid;gap:.4rem}
.site-footer .legal{margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid rgba(255,255,255,.15);display:flex;flex-wrap:wrap;justify-content:space-between;gap:1rem;opacity:.75;font-size:.85rem}
.preview-ribbon{background:#111;color:#fff;text-align:center;font:500 12px/1.4 system-ui,sans-serif;padding:6px 12px;letter-spacing:.02em}
.preview-ribbon a{color:#9cc3ff}
`.trim();
}
