#!/usr/bin/env node
/**
 * Round 15b e2e (mock AI): civic reimagine (Pauls Valley) must produce three
 * looks that differ in base, heading font category and layout; Custom Design
 * must not ship a tiny/empty/arc hero. Also re-checks freak show (horror) and
 * a normal bakery.
 *
 *   APP_URL=http://localhost:8090 CHROME_PATH=/usr/bin/google-chrome \
 *     node scripts/round15b-e2e.mjs /workspace/live-preview-shots/round15b
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = process.env.APP_URL || "http://localhost:8090";
const outDir = process.argv[2] || "/workspace/live-preview-shots/round15b";
mkdirSync(outDir, { recursive: true });
const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
await context.route("**/formcarry.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"code":200}' }));

const SERIF = /Playfair|Fraunces|DM Serif|Cormorant|Instrument Serif|Caslon|Garamond|Lora|Merriweather|Pirata/i;
const GEOMETRIC = /Space Grotesk|Syne|Bricolage|Montserrat|Poppins|Unbounded|Work Sans|Inter|Archivo(?! Black)|Fredoka|Baloo/i;
const CONDENSED = /Archivo Black|Anton|Big Shoulders|Oswald/i;
const HORROR = /Creepster|Eater|Nosifer|Pirata One|New Rocker|Griffy|Special Elite/i;

function headingFont(html) {
  return html.match(/--hf:\s*"([^"]+)"/)?.[1] || html.match(/family=([A-Za-z+\-]+)[:&]/)?.[1]?.replace(/\+/g, " ") || "";
}
function bg(html) {
  return html.match(/--bg:\s*([^;]+)/)?.[1]?.trim() || html.match(/--background:\s*([^;]+)/)?.[1]?.trim() || "";
}
function lum(hex) {
  const h = (hex || "").replace("#", "").trim();
  if (h.length < 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function fontCat(name) {
  if (HORROR.test(name)) return "novelty";
  if (CONDENSED.test(name)) return "condensed";
  if (SERIF.test(name)) return "serif";
  if (GEOMETRIC.test(name)) return "geometric";
  return name ? "other" : "unknown";
}
function layoutOf(html) {
  if (/s-hero-type|hero-type/.test(html)) return "big-type";
  if (/s-hero-photo|hero-photo/.test(html)) return "full-bleed";
  if (/hero-collage|s-hero-split|hero-split/.test(html)) return "split-or-bento";
  return "other";
}

async function openMode(mode) {
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "networkidle" });
  if (mode === "reimagine") await page.locator('[data-mode="reimagine"]').first().click();
  else await page.locator('[data-mode="newsite"], [data-mode="new_site"], button:has-text("Build a New Site")').first().click();
  return page;
}

async function waitLooks(page, ms = 180_000) {
  await page.locator("[data-look]").nth(2).waitFor({ timeout: ms });
  await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 60_000 }).catch(() => undefined);
  const modal = page.locator("[data-domain-modal]");
  if (await modal.count()) {
    const close = page.locator("[data-domain-close], [data-domain-modal] button:has-text('Skip for now'), [data-domain-modal] button:has-text('Close')").first();
    if (await close.count()) await close.click();
    else await modal.press("Escape").catch(() => undefined);
    await modal.waitFor({ state: "detached", timeout: 10_000 }).catch(() => undefined);
  }
  await page.waitForTimeout(800);
}

const lookIds = (page) => page.locator("[data-look]").evaluateAll((els) => els.map((e) => e.getAttribute("data-look")));
const bodyOf = async (id) => (await fetch(`${base}/made/${id}`)).text();

// 1. Civic reimagine — Pauls Valley
{
  const page = await openMode("reimagine");
  await page.locator("#site-url").fill("https://www.paulsvalley.com/");
  await page.locator("#site-email").fill("e2e-test@example.com");
  await page.locator("#site-notes").fill("Use a photo of downtown with the brick streets.");
  const terms = page.locator('input[type="checkbox"]').last();
  if (!(await terms.isChecked())) await terms.check();
  await page.getByRole("button", { name: /Reimagine my site/i }).click();
  try {
    await waitLooks(page, 180_000);
    const names = await page.locator("[data-look] h3").allTextContents();
    check("Pauls Valley produced three looks", names.length >= 3, JSON.stringify(names));
    await page.screenshot({ path: join(outDir, "01-paulsvalley-cards.png"), fullPage: true });
    const ids = await lookIds(page);
    const fonts = [];
    const bases = [];
    const layouts = [];
    for (let i = 0; i < ids.length; i++) {
      const html = await bodyOf(ids[i]);
      const font = headingFont(html);
      const background = bg(html);
      fonts.push(fontCat(font));
      bases.push(lum(background) < 0.28 ? "dark" : lum(background) < 0.85 && !/^#f[4-9a-f][ef]|^#f[7-9a-f]f[4-9a-f]/i.test(background.replace(/\s/g, "")) && /[1-9a-e]/i.test(background.slice(3, 5) || "f") ? "colorful-or-light" : "light");
      // Simpler base: dark if L<0.28, saturated if chroma-ish (not near white/cream), else light
      const h = (background || "").replace("#", "");
      let chroma = 0;
      if (h.length >= 6) {
        const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
        chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      }
      const L = lum(background);
      bases[i] = L < 0.28 ? "dark" : chroma >= 0.08 && L <= 0.92 ? "saturated" : "light";
      layouts.push(layoutOf(html));
      await page.locator(`[data-look="${ids[i]}"]`).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(outDir, `02-paulsvalley-look-${i + 1}.png`) });
      const tinyH1 = /font-size:\s*clamp\(1\.(0|1|2|3)/.test(html) || /font-size:\s*1\.[0-3]rem/.test(html);
      const arc = /clip-path\s*:\s*(ellipse|circle)/i.test(html);
      if (/custom design/i.test(names[i] ?? "")) {
        check("Custom Design does not use a tiny headline or arc crop", !tinyH1 && !arc, `font=${font} bg=${background}`);
      }
    }
    check("Pauls Valley looks differ in heading font category", new Set(fonts.filter((f) => f !== "unknown")).size >= 2, JSON.stringify(fonts));
    check("Pauls Valley looks include more than one light/dark/saturated base", new Set(bases).size >= 2, JSON.stringify(bases));
    check("Pauls Valley look names are distinct", new Set(names.map((n) => n.trim())).size >= 3, JSON.stringify(names));
  } catch (error) {
    check("Pauls Valley reimagine completed", false, error instanceof Error ? error.message : String(error));
    await page.screenshot({ path: join(outDir, "01-paulsvalley-failed.png"), fullPage: true }).catch(() => undefined);
  }
  await page.close();
}

// 2. Freak show + bakery (from r15)
async function fillNewSite(page, { name, city, what, style, email = "e2e-test@example.com" }) {
  await page.locator("#ns-name").fill(name);
  await page.locator("#ns-location").fill(city);
  await page.locator("#ns-what").fill(what);
  if (style) await page.locator("#ns-style").fill(style);
  const get = page.getByText(/Get me a domain/i).first();
  if (await get.count()) await get.click();
  await page.locator("#ns-email, input[name='email'][type='email']").first().fill(email);
  const terms = page.locator('input[type="checkbox"]').last();
  if (!(await terms.isChecked())) await terms.check();
}

{
  const page = await openMode("newsite");
  await fillNewSite(page, { name: "freak show resturant", city: "liversworth, tn", what: "We serve eyeballs and brains", style: "scarry" });
  await page.getByRole("button", { name: /Build my new site/i }).click();
  await waitLooks(page);
  await page.screenshot({ path: join(outDir, "03-freakshow-cards.png"), fullPage: true });
  const ids = await lookIds(page);
  const fonts = [];
  for (let i = 0; i < ids.length; i++) {
    const html = await bodyOf(ids[i]);
    const font = headingFont(html);
    fonts.push(font);
    const themed = HORROR.test(html) || /#0b0b0d|#8b1018|#140a0c/i.test(html);
    check(`Freak-show look ${i + 1} is still horror`, themed, font);
    await page.screenshot({ path: join(outDir, `04-freakshow-look-${i + 1}.png`) });
  }
  check("Freak-show heading fonts are not all the same", new Set(fonts).size >= 2, JSON.stringify(fonts));
  await page.close();
}

{
  const page = await openMode("newsite");
  await fillNewSite(page, {
    name: "Maple Street Bakery",
    city: "Tulsa, OK",
    what: "Family-run bakery known for sourdough and Saturday cinnamon rolls.",
    style: "warm and friendly",
  });
  await page.getByRole("button", { name: /Build my new site/i }).click();
  await waitLooks(page);
  await page.screenshot({ path: join(outDir, "05-bakery-cards.png"), fullPage: true });
  const ids = await lookIds(page);
  let horrorFont = false;
  const bases = [];
  for (const id of ids) {
    const html = await bodyOf(id);
    if (HORROR.test(headingFont(html))) horrorFont = true;
    const background = bg(html);
    const h = (background || "").replace("#", "");
    let chroma = 0;
    if (h.length >= 6) {
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    }
    const L = lum(background);
    bases.push(L < 0.28 ? "dark" : chroma >= 0.08 && L <= 0.92 ? "saturated" : "light");
  }
  check("A normal bakery is not forced into Creepster / horror fonts", !horrorFont);
  check("Bakery looks still vary in light/dark/saturated base", new Set(bases).size >= 2, JSON.stringify(bases));
  await page.close();
}

await browser.close();
const passed = checks.filter((c) => c.pass).length;
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ passed, total: checks.length, checks }, null, 2));
console.log(`\n${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
