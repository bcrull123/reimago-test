/**
 * Stand-in answers for the from-scratch look (custom-design.ts prompts), used by fake-ai-server.mjs:
 * a creative brief per business type, and a realistic freeform homepage (HTML + CSS with inline SVG) built from
 * the site JSON in the prompt. FAKE_CUSTOM=broken makes the first draft fail the checks (script, handler,
 * external image/link, missing nav, low contrast, fixed width) so the repair pass is exercised; broken-always
 * keeps the repair broken too (the look falls back to its template).
 */
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function jsonAfter(text, label) {
  const at = text.indexOf(label);
  if (at < 0) return {};
  const start = text.indexOf("{", at);
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i += 1;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth += 1;
    else if (c === "}" && (depth -= 1) === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return {};
      }
    }
  }
  return {};
}

const BRIEFS = {
  "startup-community": {
    concept: "The Launchpad",
    metaphor: "a launchpad for founders: the page climbs from the ground (an idea) to orbit (a running business)",
    mood: "optimistic, electric, friendly, a little cosmic",
    composition: "deep-space hero with an SVG rocket trail arcing behind a huge headline, a 3-2-1 countdown band of steps, orbit rings around the community, a launch-checklist CTA",
    typography: { heading: "Space Grotesk", body: "Inter", notes: "huge tight headline, uppercase tracked labels" },
    motion: "stars twinkle; the rocket trail draws itself once",
    illustration: "SVG rocket, dotted trajectory, planets and orbit rings",
    headline: "Your idea, cleared for launch.",
    palette: { primary: "#ff5a36", accent: "#7c5cff", background: "#0b1026", surface: "#141a3a", text: "#f4f5ff", muted: "#b9bfe6" },
  },
  town: {
    concept: "Front Porch",
    metaphor: "the town as a front porch: a warm welcome and a long view down main street",
    mood: "sunlit, proud, neighborly",
    composition: "tall arched photo window, a hand-drawn horizon with the sun, a stamped welcome seal, an offset grid of things to do",
    typography: { heading: "Fraunces", body: "Work Sans", notes: "soft big serif headings" },
    motion: "the sun rises behind the horizon once",
    illustration: "SVG horizon, sun rays and wheat stalks",
    headline: "Pull up a chair. You're home.",
    palette: { primary: "#b5452b", accent: "#e8a33d", background: "#fbf4e8", surface: "#f3e6cf", text: "#2a1d14", muted: "#5e4a3a" },
  },
  restaurant: {
    concept: "The Long Table",
    metaphor: "one long table where everyone is invited: the page reads like a menu on linen",
    mood: "appetizing, candlelit, generous",
    composition: "full-bleed plate in a round SVG plate rim, menu-card column with dotted leaders, ticket-stub reservation card",
    typography: { heading: "Playfair Display", body: "Karla", notes: "italic serif accents" },
    motion: "steam wisps drift up over the plate",
    illustration: "SVG steam wisps and a plate rim",
    headline: "Pull up a chair at the long table.",
    palette: { primary: "#8c2f1b", accent: "#d9a441", background: "#fff8ef", surface: "#f5e8d6", text: "#2b1a12", muted: "#5f4636" },
  },
  trades: {
    concept: "Blueprint",
    metaphor: "the job as a blueprint: precise lines, measured steps, a spotless finish",
    mood: "trustworthy, precise, fast",
    composition: "blueprint grid hero with a dimensioned photo frame, numbered steps along a ruler, a big phone CTA",
    typography: { heading: "Space Grotesk", body: "Inter", notes: "technical uppercase labels" },
    motion: "dimension lines extend once",
    illustration: "SVG blueprint grid, dimension arrows, a drop mark",
    headline: "Measured twice. Fixed once.",
    palette: { primary: "#f2b705", accent: "#38bdf8", background: "#0d2b4e", surface: "#123a66", text: "#f5f9ff", muted: "#c3d4ea" },
  },
};

export function fakeBrief(user) {
  const biz = jsonAfter(user, "Business:");
  const type = biz.type in BRIEFS ? biz.type : /launch|startup|founder|business/i.test(`${biz.tagline} ${biz.kind}`) ? "startup-community" : "town";
  return { ...BRIEFS[type] };
}

function art(concept) {
  if (/launch/i.test(concept))
    return `<svg class="art" viewBox="0 0 600 600" aria-hidden="true"><defs><radialGradient id="pl" cx=".35" cy=".35"><stop offset="0" stop-color="#ffb199"/><stop offset="1" stop-color="var(--primary)"/></radialGradient></defs><g class="stars" fill="#fff">${Array.from({ length: 34 }, (_, i) => `<circle cx="${(i * 97) % 600}" cy="${(i * 53) % 600}" r="${1 + (i % 3) * 0.8}" opacity="${0.4 + (i % 5) / 10}"/>`).join("")}</g><ellipse cx="300" cy="320" rx="250" ry="90" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="6 10" transform="rotate(-18 300 320)"/><ellipse cx="300" cy="320" rx="190" ry="60" fill="none" stroke="#ffffff55" stroke-width="1.5" transform="rotate(-18 300 320)"/><circle cx="300" cy="320" r="92" fill="url(#pl)"/><circle cx="520" cy="230" r="22" fill="var(--accent)"/><path class="trail" d="M60 560 C 180 470, 260 300, 470 90" fill="none" stroke="var(--primary)" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 14"/><g transform="translate(470 90) rotate(42)"><path d="M0-46 C 18-24 18 18 12 34 L-12 34 C-18 18-18-24 0-46Z" fill="#f4f5ff"/><circle cy="-8" r="8" fill="var(--accent)"/><path d="M-12 18 L-28 40 L-12 34Z M12 18 L28 40 L12 34Z" fill="var(--primary)"/><path d="M-8 36 Q0 70 8 36Z" fill="#ffcf5a"/></g></svg>`;
  if (/porch/i.test(concept))
    return `<svg class="art" viewBox="0 0 600 300" aria-hidden="true"><circle class="sun" cx="300" cy="230" r="110" fill="var(--accent)" opacity=".9"/>${Array.from({ length: 12 }, (_, i) => `<line x1="300" y1="230" x2="${300 + Math.cos((Math.PI * (i + 0.5)) / 12) * -180}" y2="${230 - Math.sin((Math.PI * (i + 0.5)) / 12) * 180}" stroke="var(--accent)" stroke-width="3" opacity=".45"/>`).join("")}<path d="M0 230 Q150 200 300 228 T600 222 L600 300 L0 300Z" fill="var(--primary)"/>${Array.from({ length: 9 }, (_, i) => `<path d="M${40 + i * 65} 300 q4 -40 0 -70 m0 12 q-10 -6 -12 -16 m12 26 q10 -6 12 -16" stroke="var(--text)" stroke-width="2.5" fill="none" opacity=".6"/>`).join("")}</svg>`;
  if (/table/i.test(concept))
    return `<svg class="art" viewBox="0 0 400 200" aria-hidden="true"><path class="steam" d="M120 180 C 100 140, 150 120, 125 80 S 140 30, 120 10" stroke="var(--accent)" stroke-width="5" fill="none" stroke-linecap="round"/><path class="steam" d="M200 180 C 180 140, 230 120, 205 80 S 220 30, 200 10" stroke="var(--primary)" stroke-width="5" fill="none" stroke-linecap="round"/><path class="steam" d="M280 180 C 260 140, 310 120, 285 80 S 300 30, 280 10" stroke="var(--accent)" stroke-width="5" fill="none" stroke-linecap="round"/></svg>`;
  return `<svg class="art" viewBox="0 0 600 300" aria-hidden="true"><defs><pattern id="g" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#ffffff33"/></pattern></defs><rect width="600" height="300" fill="url(#g)"/><path d="M40 260 H560 M40 250 V270 M560 250 V270" stroke="var(--primary)" stroke-width="3"/><path d="M300 40 C 340 100, 360 140, 300 200 C 240 140, 260 100, 300 40Z" fill="var(--accent)"/></svg>`;
}

export function fakeDesign(system, user, mode) {
  const site = jsonAfter(user, "Site:");
  const brief = jsonAfter(user, "Creative brief:");
  const concept = brief.concept || "Signature";
  const pages = site.pages ?? [{ href: "@page:home", label: "Home" }];
  const cta = site.cta ?? { label: "Contact us", href: "@page:contact" };
  const imgs = (site.images ?? []).map((i) => i.src);
  const has = (n) => imgs.includes(`@img:${n}`);
  const keep = Boolean(site.ownerAskedToKeep);
  const services = (site.services ?? []).slice(0, 6);
  const dark = /launch|blueprint/i.test(concept);
  const brand = dark ? "@brand:dark" : "@brand:light";
  const nav = pages.map((p) => `<a href="${p.href}">${esc(p.label)}</a>`).join("");
  const phone = site.phone ? `<a class="phone" href="tel:${site.phone.replace(/[^\d+]/g, "")}">${esc(site.phone)}</a>` : "";
  const headline = brief.headline || `${site.name}, at its best.`;
  const [h1a, ...rest] = headline.split(" ");
  const sig = (site.images ?? []).find((i) => i.kind === "the business's signature graphic");
  const heroMedia = !has("hero") && sig
    ? `<figure class="kept signature"><img src="${sig.src}" alt="${esc(sig.shows ?? "")}"></figure>`
    : has("hero")
    ? keep
      ? `<figure class="kept"><img src="@img:hero" alt="${esc(site.images.find((i) => i.src === "@img:hero")?.shows ?? "")}"></figure>`
      : `<figure class="mask"><img src="@img:hero" alt="${esc(site.images.find((i) => i.src === "@img:hero")?.shows ?? "")}"></figure>`
    : "";
  const steps = /launch/i.test(concept)
    ? [["3", "Name it", "Find the name and the domain that fit."], ["2", "Build it", "A real site and the basics, without the jargon."], ["1", "Launch it", "Tell people, find your first customers."]]
    : /porch/i.test(concept)
    ? [["01", "Visit", "Main street, parks and the places people love."], ["02", "Live", "Neighborhoods, schools and city services."], ["03", "Belong", "Events, festivals and the people who make it home."]]
    : /table/i.test(concept)
    ? [["I", "Sit down", "Come as you are; we'll set a place."], ["II", "Share", "Plates made to pass around the table."], ["III", "Stay", "Dessert, coffee and one more story."]]
    : [["01", "Call", "Tell us what's wrong; we answer fast."], ["02", "Plan", "A clear price before we start."], ["03", "Finish", "Clean, tested, done right the first time."]];
  const story = has("photo-1") ? `<section class="story"><img src="@img:photo-1" alt="${esc(site.images.find((i) => i.src === "@img:photo-1")?.shows ?? "")}"><div><span class="label">Our story</span><h2>${esc(site.tagline || site.name)}</h2><p>${esc((site.description || "").slice(0, 260) || `Everything ${site.name} does, in one place.`)}</p><a class="btn ghost" href="${pages[1]?.href ?? cta.href}">${esc(pages[1]?.label ?? "Learn more")}</a></div></section>` : "";
  let html = `<header class="top"><a class="brand" href="@page:home">${brand}</a><nav aria-label="Main">${nav}</nav><a class="btn small" href="${cta.href}">${esc(cta.label)}</a></header>
<main>
<section class="hero"><div class="copy"><span class="label">${esc(concept)} · ${esc(site.kind ?? "")}</span><h1>${esc(h1a)} <em>${esc(rest.join(" "))}</em></h1><p class="lead">${esc(site.tagline || site.description || "")}</p><div class="actions"><a class="btn" href="${cta.href}">${esc(cta.label)}</a>${phone}</div></div><div class="visual">${art(concept)}${heroMedia}</div></section>
<section class="band" aria-label="What we do"><div class="track">${(services.length ? services : ["Ideas", "Help", "Community"]).map((s) => `<span>${esc(s)}</span><i>✦</i>`).join("")}</div></section>
<section class="steps"><span class="label">How it works</span><h2>${/launch/i.test(concept) ? "Countdown to launch" : "Three easy steps"}</h2><ol>${steps.map(([n, t, d]) => `<li><b>${n}</b><h3>${t}</h3><p>${d}</p></li>`).join("")}</ol></section>
${story}
<section class="cards"><span class="label">What you'll find</span><h2>${esc(pages[1]?.label ?? "Services")}</h2><div class="grid">${(services.length ? services : pages.slice(1).map((p) => p.label)).slice(0, 6).map((s, i) => `<article class="card c${i % 3}"><h3>${esc(s)}</h3><a href="${pages[Math.min(1 + (i % Math.max(1, pages.length - 1)), pages.length - 1)].href}">Learn more →</a></article>`).join("")}</div></section>
<section class="cta"><h2>${/launch/i.test(concept) ? "Ready for liftoff?" : "Come say hello."}</h2><p>${esc(site.address || "We'd love to hear from you.")}</p><div class="actions"><a class="btn" href="${cta.href}">${esc(cta.label)}</a>${phone}</div></section>
</main>
<footer class="foot"><a class="brand" href="@page:home">@brand:dark</a><nav aria-label="Footer">${nav}</nav><p>${[site.phone ? `<a href="tel:${site.phone.replace(/[^\d+]/g, "")}">${esc(site.phone)}</a>` : "", site.email ? `<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>` : "", esc(site.address || "")].filter(Boolean).join(" · ")}</p></footer>`;
  let css = `
body{background:var(--background);color:var(--text);font-family:var(--font-body)}
h1,h2,h3{font-family:var(--font-heading);line-height:1.02;margin:0}
.label{display:inline-block;font:600 .72rem/1 var(--font-body);letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:1rem}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:1.5rem;padding:1rem clamp(1rem,4vw,3rem);background:var(--background);color:var(--text);border-bottom:1px solid color-mix(in srgb,var(--text) 12%,transparent)}
.top nav{display:flex;gap:1.2rem;margin-left:auto;flex-wrap:wrap}.top nav a,.foot nav a{color:var(--text);text-decoration:none;font-weight:500}.top nav a:hover{color:var(--primary)}
.btn{display:inline-flex;align-items:center;gap:.5rem;padding:.95rem 1.5rem;border-radius:999px;background:var(--primary);color:var(--on-primary);font-weight:700;text-decoration:none;box-shadow:0 10px 30px -10px var(--primary)}.btn.small{padding:.6rem 1.1rem}.btn.ghost{background:transparent;color:var(--text);border:2px solid var(--text);box-shadow:none}
.phone{color:var(--text);font-weight:600}
.hero{position:relative;display:grid;grid-template-columns:1.05fr .95fr;gap:2rem;align-items:center;padding:clamp(2.5rem,7vw,6rem) clamp(1rem,4vw,3rem);overflow:hidden}
.hero h1{font-size:clamp(2.8rem,7.4vw,6.6rem);letter-spacing:-.035em}.hero h1 em{font-style:normal;color:var(--primary);display:block}
.lead{font-size:clamp(1.05rem,1.6vw,1.3rem);color:var(--muted);max-width:38ch;margin:1.4rem 0 2rem}.actions{display:flex;gap:1.2rem;align-items:center;flex-wrap:wrap}
.visual{position:relative;min-height:420px}.art{position:absolute;inset:0;width:100%;height:100%}
.mask{position:absolute;right:4%;bottom:2%;width:62%;aspect-ratio:1;margin:0;border-radius:46% 54% 40% 60%/50% 42% 58% 50%;overflow:hidden;border:6px solid var(--accent);box-shadow:0 30px 60px -20px #0008}.mask img{width:100%;height:100%;object-fit:cover;display:block}
.kept{position:absolute;inset:8% 10%;margin:0;display:grid;place-items:center;background:color-mix(in srgb,var(--surface) 85%,transparent);border-radius:32px;padding:1.5rem}.kept img{width:100%;height:100%;object-fit:contain}
.band{background:var(--primary);color:var(--on-primary);overflow:hidden;padding:1rem 0;transform:rotate(-2deg);margin:1rem -2rem}.track{display:flex;gap:2rem;white-space:nowrap;font:700 clamp(1.1rem,2vw,1.6rem)/1 var(--font-heading);text-transform:uppercase;letter-spacing:.04em}.track i{font-style:normal;color:var(--on-primary)}
.steps{padding:clamp(3rem,7vw,6rem) clamp(1rem,4vw,3rem)}.steps h2,.cards h2,.cta h2{font-size:clamp(2rem,4.5vw,3.6rem);letter-spacing:-.02em;margin-bottom:2rem}
.steps ol{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(3,1fr);gap:1.5rem;counter-reset:s}.steps li{background:var(--surface);color:var(--text);border-radius:24px;padding:2rem;position:relative}.steps li b{font:800 3.4rem/1 var(--font-heading);color:var(--primary);display:block;margin-bottom:.8rem}.steps li p{color:var(--muted)}
.story{display:grid;grid-template-columns:1fr 1fr;gap:3rem;align-items:center;padding:0 clamp(1rem,4vw,3rem) clamp(3rem,7vw,6rem)}.story img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:28px 120px 28px 28px}.story p{color:var(--muted);font-size:1.1rem;margin:1rem 0 1.5rem}
.cards{padding:clamp(3rem,7vw,6rem) clamp(1rem,4vw,3rem);background:var(--surface);color:var(--text)}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1.2rem}.card{background:var(--background);color:var(--text);border-radius:20px;padding:1.6rem;min-height:150px;display:flex;flex-direction:column;justify-content:space-between;border-top:6px solid var(--primary)}.card.c1{border-color:var(--accent)}.card a{color:var(--text);font-weight:600}
.cta{text-align:center;padding:clamp(3.5rem,8vw,7rem) 1rem;background:var(--accent);color:var(--on-accent)}.cta p{margin:0 0 2rem;font-size:1.1rem}.cta .phone{color:var(--on-accent)}.cta .actions{justify-content:center}
.foot{display:flex;flex-wrap:wrap;gap:1.5rem;align-items:center;justify-content:space-between;padding:2rem clamp(1rem,4vw,3rem);background:#0d0d12;color:#f2f2f2}.foot nav{display:flex;gap:1rem;flex-wrap:wrap}.foot nav a,.foot a{color:#f2f2f2}.foot p{margin:0}
@media (prefers-reduced-motion:no-preference){.stars circle{animation:tw 3s ease-in-out infinite alternate}.stars circle:nth-child(3n){animation-delay:1s}@keyframes tw{to{opacity:.15}}.trail{stroke-dashoffset:400;animation:draw 2.4s ease-out forwards}@keyframes draw{to{stroke-dashoffset:0}}.steam{animation:rise 3s ease-in-out infinite alternate}@keyframes rise{to{transform:translateY(-8px)}}.sun{animation:up 2s ease-out}@keyframes up{from{transform:translateY(60px)}}}
@media (max-width:720px){.hero,.story{grid-template-columns:1fr}.visual{min-height:300px}.steps ol,.grid{grid-template-columns:1fr}.top{flex-wrap:wrap}.top nav{order:3;width:100%;margin-left:0;gap:.9rem}.band{margin:1rem -1rem}}
`;
  if (mode === "lowcontrast") {
    // Bob's round 2 failure: a 3.5:1 header button (white on #e85d04). Auto-fixed, never a fallback.
    css += "\n.top .btn.small{background:#e85d04;color:#ffffff}";
  }
  if (mode === "broken") {
    html = html.replace(/<nav aria-label="Main">[\s\S]*?<\/nav>/, '<nav aria-label="Main"><a href="@page:home">Home</a></nav>') + '<script>alert("x")</script><img src="https://example.com/stock.jpg" alt=""><link rel="stylesheet" href="https://evil.example/x.css">';
    html = html.replace('<a class="btn" href', '<a class="btn" onclick="track()" href');
    css += ".lead{color:#9a9a9a;background:#a5a5a5}.hero{width:1400px}";
  }
  return { css, html };
}

export function fakeEdit(user) {
  const page = jsonAfter(user, "Current page:");
  const palette = jsonAfter(user, "Current palette:");
  const req = (user.match(/Owner's request: "([^"]*)"/)?.[1] ?? "").toLowerCase();
  const darker = /dark/.test(req);
  const lighter = /light|bright/.test(req) && !darker;
  const next = { ...palette };
  if (darker) Object.assign(next, { background: "#05070f", surface: "#0e1430", text: "#f6f7ff", muted: "#b7bde3" });
  if (lighter) Object.assign(next, { background: "#ffffff", surface: "#f1f3ff", text: "#141a3a", muted: "#4a5175" });
  return { css: page.css ?? "", html: page.html ?? "", palette: next };
}

// ---------------------------------------------------------------- Grok Imagine stand-ins (mockup + art)

/**
 * A stand-in for Grok Imagine's homepage design mockup: a flat 1280x720 PNG drawn from the prompt's colors
 * (header with brand + nav + button, a big headline block, the hero photo area as a circle, a rocket when the
 * prompt asks for one, and a row of cards). Not a real design: it lets the pipeline (store, card, vision build)
 * run end to end without a key.
 */
export async function fakeMockupPng(prompt) {
  const { PNG } = await import("pngjs");
  const W = 1280;
  const H = 720;
  const png = new PNG({ width: W, height: H });
  const color = (name, fallback) => {
    const m = prompt.match(new RegExp(`${name} (#[0-9a-fA-F]{6})`));
    const hex = (m?.[1] ?? fallback).slice(1);
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  };
  const bg = color("background", "#f6f1e8");
  const surface = color("surface", "#ffffff");
  const text = color("text", "#1a1a1a");
  const primary = color("primary", "#c2410c");
  const accent = color("accent", "#f59e0b");
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    png.data[i] = c[0];
    png.data[i + 1] = c[1];
    png.data[i + 2] = c[2];
    png.data[i + 3] = 255;
  };
  const rect = (x0, y0, w, h, c, r = 0) => {
    for (let y = y0; y < y0 + h; y += 1)
      for (let x = x0; x < x0 + w; x += 1) {
        const dx = Math.max(x0 + r - x, 0, x - (x0 + w - 1 - r));
        const dy = Math.max(y0 + r - y, 0, y - (y0 + h - 1 - r));
        if (r && dx * dx + dy * dy > r * r) continue;
        set(x, y, c);
      }
  };
  const circle = (cx, cy, r, c, ring) => {
    for (let y = cy - r; y <= cy + r; y += 1)
      for (let x = cx - r; x <= cx + r; x += 1) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r && (!ring || d >= r - ring)) set(x, y, c);
      }
  };
  rect(0, 0, W, H, bg);
  // Header.
  rect(0, 0, W, 72, surface);
  rect(40, 22, 120, 28, text, 6);
  for (let i = 0; i < 5; i += 1) rect(720 + i * 82, 32, 60, 8, text, 4);
  rect(1130, 18, 120, 36, primary, 18);
  // Headline + supporting line + buttons.
  rect(60, 170, 520, 54, text, 8);
  rect(60, 240, 460, 54, primary, 8);
  rect(60, 310, 380, 54, primary, 8);
  rect(60, 395, 420, 12, text, 6);
  rect(60, 418, 340, 12, text, 6);
  rect(60, 470, 170, 52, primary, 26);
  rect(250, 486, 140, 14, text, 7);
  // Hero photo area (a circle with an accent ring) and a decorative orbit.
  circle(930, 330, 205, accent);
  for (let y = 145; y < 515; y += 1) for (let x = 745; x < 1115; x += 1) if (Math.hypot(x - 930, y - 330) <= 190) set(x, y, [Math.round(120 + (y - 145) / 4), Math.round(140 + (x - 745) / 6), 170]);
  circle(930, 330, 250, primary, 3);
  if (/rocket/i.test(prompt)) {
    // A simple rocket: body, nose, fins, flame.
    rect(1120, 120, 34, 90, surface, 14);
    for (let k = 0; k < 30; k += 1) rect(1120 + Math.floor(k / 2), 120 - k, 34 - k, 1, primary);
    rect(1108, 185, 14, 30, primary, 4);
    rect(1152, 185, 14, 30, primary, 4);
    circle(1137, 225, 12, accent);
  }
  // Next section: three cards.
  rect(0, 580, W, 140, surface);
  for (let i = 0; i < 3; i += 1) {
    rect(60 + i * 400, 605, 360, 100, bg, 16);
    rect(84 + i * 400, 628, 40, 40, accent, 20);
    rect(140 + i * 400, 632, 200, 12, text, 6);
    rect(140 + i * 400, 656, 160, 10, text, 5);
  }
  return PNG.sync.write(png);
}

/** The vision build's optional extra Imagine art: one decorative illustration placed in the second section. */
export function withFakeAsset(out, concept) {
  const html = out.html.replace(/(<section\b[^>]*>)([\s\S]*?<section\b[^>]*>)/, (all, first, rest) => `${first}${rest}<img class="deco-art" src="@img:art-1" alt="">`);
  return {
    ...out,
    html,
    css: `${out.css}\n.deco-art{display:block;width:min(200px,40vw);height:auto;margin:0 auto 1.5rem;border-radius:50%}`,
    assets: [{ name: "art-1", prompt: `a flat decorative illustration for “${concept}”: simple geometric shapes in the brand colors`, aspect: "1:1" }],
  };
}

/**
 * The stand-in vision build from an Imagine mockup: the realistic page, the region list the prompt asks for first,
 * and the art. Art made up front for this design (kind "imagine art" in the site JSON) is used as given; otherwise
 * one extra asset is asked for (as before). FAKE_CUSTOM=plain: a first build that ignores the mockup's dark color
 * blocking (white header / hero / next section), so the fidelity check sends it back once.
 */
export function fakeMockupBuild(system, user, mode, plain = false) {
  const concept = (user.match(/"concept":"([^"]+)"/) ?? [])[1] ?? "Signature";
  const site = (() => {
    try {
      return JSON.parse(user.slice(user.indexOf("Site: ") + 6).split("\n")[0]);
    } catch {
      return {};
    }
  })();
  const art = (site.images ?? []).filter((i) => i.kind === "imagine art").map((i) => i.src);
  let out = fakeDesign(system, user, mode);
  if (art.length) {
    const tiles = art.filter((a) => a !== "@img:hero").map((a) => `<img class="deco-art" src="${a}" alt="">`).join("");
    out = { ...out, html: out.html.replace(/(<section\b[^>]*>)([\s\S]*?<section\b[^>]*>)/, (all, first, rest) => `${first}${rest}<div class="art-strip">${tiles}</div>`), css: `${out.css}\n.art-strip{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;margin:0 auto 1.5rem}.deco-art{display:block;width:min(200px,40vw);height:auto;border-radius:24px}.kept.signature img{object-fit:contain;max-height:420px}` };
  } else out = withFakeAsset(out, concept);
  if (plain) out = { ...out, css: `${out.css}\n.top{background:#ffffff;color:#111111}.hero{background:#ffffff;color:#111111}.band{background:#ffffff;color:#111111}.steps{background:#ffffff;color:#111111}` };
  out.regions = [
    { name: "header", background: "#0b1026", layout: "logo left, nav right, button", elements: "small" },
    { name: "hero", background: "#0b1026", layout: "2-column split", elements: "huge headline, centerpiece art" },
    { name: "band", background: "#ff5a36", layout: "marquee", elements: "services" },
  ];
  return out;
}
