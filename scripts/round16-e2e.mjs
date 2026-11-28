#!/usr/bin/env node
/**
 * Round 16 e2e (mock AI): Your Site, Improved first; Dark Premium middle;
 * Sunlit Cut (bleed hero, not bland Editorial) last. Cafe 501 keeps its black
 * brand, food up front, a clear menu CTA. Swatches match the look. Blurbs
 * start capitalized and aren't cut mid-sentence. No typography-graphic heroes.
 *
 *   APP_URL=http://localhost:8090 CHROME_PATH=/usr/bin/google-chrome \
 *     node scripts/round16-e2e.mjs /workspace/live-preview-shots/round16
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = process.env.APP_URL || "http://localhost:8090";
const outDir = process.argv[2] || "/workspace/live-preview-shots/round16";
mkdirSync(outDir, { recursive: true });
const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
await context.route("**/formcarry.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"code":200}' }));

function headingFont(html) {
  return html.match(/--hf:\s*"([^"]+)"/)?.[1] || html.match(/family=([A-Za-z+\-]+)[:&]/)?.[1]?.replace(/\+/g, " ") || "";
}
function h1Of(html) {
  const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return (m?.[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function bgOf(html) {
  return (html.match(/--bg:\s*(#[0-9a-fA-F]{3,8})/)?.[1] || "").toLowerCase();
}
function lum(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return 1;
  return (r * 299 + g * 587 + b * 114) / 1000 / 255;
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

const lookIds = (page) => page.locator("[data-look]").evaluateAll((els) => els.map((e) => e.getAttribute("data-look")));
const bodyOf = async (id) => (await fetch(`${base}/made/${id}`)).text();

async function cardCopy(page) {
  return page.locator("[data-look]").evaluateAll((els) =>
    els.map((el) => {
      const name = (el.querySelector("[data-look-name]")?.textContent || el.querySelector("h3")?.textContent || "").replace(/\s+/g, " ").trim();
      const ps = [...el.querySelectorAll("p")].map((p) => (p.textContent || "").replace(/\s+/g, " ").trim());
      const mood = ps.find((t) => t.length > 40 && !/What would you change|Only this look|Based on your request|Photo:|Art:|Layout:|Changed:/.test(t)) || ps[0] || "";
      const photos = (el.querySelector("[data-look-photos]")?.textContent || "").replace(/\s+/g, " ").trim();
      const swatches = [...el.querySelectorAll("[aria-label='Palette'] span")].map((s) => (s.getAttribute("title") || "").toLowerCase());
      return { name, mood, photos, title: name, swatches };
    }),
  );
}

function assertOrder(cards, label) {
  const names = cards.map((c) => c.name.split("·")[0].trim());
  check(`${label}: exactly 3 looks`, cards.length === 3, JSON.stringify(names));
  check(`${label}: first look is Your Site, Improved`, /your site,\s*improved/i.test(names[0] || ""), names[0]);
  check(`${label}: middle look is Dark Premium`, /dark premium/i.test(names[1] || ""), names[1]);
  check(`${label}: third look is Sunlit Cut (not bland Editorial)`, /sunlit cut/i.test(names[2] || "") && !/^editorial$/i.test(names[2] || ""), names[2]);
  check(`${label}: no Custom Design card`, !cards.some((c) => /custom design/i.test(c.name)), JSON.stringify(names));
  check(`${label}: blurbs start with a capital and are not cut mid-sentence`, cards.every((c) => !c.mood || (/^[A-Z“"']/.test(c.mood.trim()) && !/\b(the|a|and|of|to|for|with)$/.test(c.mood.trim()))), JSON.stringify(cards.map((c) => c.mood.slice(0, 80))));
  check(`${label}: no lowercase-starting or cream-letterhead blurbs`, !cards.some((c) => /^[a-z]/.test(c.mood.trim()) || /cream letterhead/i.test(c.mood)), JSON.stringify(cards.map((c) => c.mood.slice(0, 80))));
}

async function screenshotLooks(page, ids, prefix) {
  for (let i = 0; i < ids.length; i++) {
    await page.locator(`[data-look="${ids[i]}"]`).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(outDir, `${prefix}-look-${i + 1}.png`) });
  }
}

// 1. Cafe 501 (the live site Bob tested)
{
  const page = await openMode("reimagine");
  await page.locator("#site-url").fill("https://www.cafe501.com/");
  await page.locator("#site-email").fill("e2e-test@example.com");
  await page.locator("#site-notes").fill("Keep the black brand, show the food, and make a clear menu button.");
  const terms = page.locator('input[type="checkbox"]').last();
  if (!(await terms.isChecked())) await terms.check();
  await page.getByRole("button", { name: /Reimagine my site/i }).click();
  try {
    await waitLooks(page, 180_000);
    const stamp = (await page.locator("[data-build-stamp]").first().textContent().catch(() => "")) || "";
    check("Footer shows Build r16", /Build r16\b/i.test(stamp), stamp.trim());
    const cards = await cardCopy(page);
    await page.screenshot({ path: join(outDir, "01-cafe501-cards.png"), fullPage: true });
    assertOrder(cards, "Cafe 501");
    check("Cafe 501 Improved blurb keeps the black brand, food, and a menu CTA", /black brand/i.test(cards[0]?.mood || "") && /food/i.test(cards[0]?.mood || "") && /view menu|menu/i.test(cards[0]?.mood || ""), cards[0]?.mood.slice(0, 180) || "");
    const ids = await lookIds(page);
    const htmls = [];
    for (const id of ids) htmls.push(await bodyOf(id));
    check("Cafe 501 Improved keeps a dark (black) brand", lum(bgOf(htmls[0] || "")) < 0.28, `bg=${bgOf(htmls[0] || "")} lum=${lum(bgOf(htmls[0] || "")).toFixed(3)}`);
    check("Cafe 501 Improved hero is photo-forward with a View Menu (or menu) CTA", /s-hero-photo/.test(htmls[0] || "") && /v-improved/.test(htmls[0] || "") && /View Menu|Menu/i.test(htmls[0] || ""), (htmls[0] || "").match(/<h1[\s\S]*?<\/a>/i)?.[0]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180) || "no hero");
    check("Cafe 501 Dark Premium stays cinematic and dark", /v-cinematic|s-hero-photo/.test(htmls[1] || "") && lum(bgOf(htmls[1] || "")) < 0.35, `bg=${bgOf(htmls[1] || "")}`);
    check("Cafe 501 Dark Premium swatches are not icy blue or lime", !cards[1]?.swatches.some((c) => /#8cb4ff|#00ff00|#22c55e|#38b620|#32cd32/i.test(c)), JSON.stringify(cards[1]?.swatches));
    check("Cafe 501 Sunlit Cut uses a bleed hero, not a tall serif stack over a small photo", /s-hero-split[^"]*v-bleed/.test(htmls[2] || ""), `h1=${h1Of(htmls[2] || "")} font=${headingFont(htmls[2] || "")}`);
    check("Cafe 501 Sunlit Cut headline is short (not a boulevard paragraph)", h1Of(htmls[2] || "").split(/\s+/).filter(Boolean).length <= 8, h1Of(htmls[2] || ""));
    const foodHero = htmls.every((h) => /s-hero-photo|v-bleed|s-hero-split/.test(h) && /@img:|class="media|bgimg/.test(h));
    check("Cafe 501 every look shows a photo in the hero", foodHero, htmls.map((h, i) => `${i}:${/bgimg|<img/.test(h)}`).join(" "));
    check("No cropped typography graphic (FES ED) as a hero", !htmls.some((h) => /FES ED|fes ed/.test(h)), "");
    await screenshotLooks(page, ids, "02-cafe501");
  } catch (error) {
    check("Cafe 501 reimagine completed", false, error instanceof Error ? error.message : String(error));
    await page.screenshot({ path: join(outDir, "01-cafe501-failed.png"), fullPage: true }).catch(() => undefined);
  }
  await page.close();
}

// 2. Pauls Valley
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
    const cards = await cardCopy(page);
    await page.screenshot({ path: join(outDir, "03-paulsvalley-cards.png"), fullPage: true });
    assertOrder(cards, "Pauls Valley");
    const ids = await lookIds(page);
    const htmls = [];
    for (const id of ids) htmls.push(await bodyOf(id));
    check("Pauls Valley Improved stays a light civic refresh, not forced dark", lum(bgOf(htmls[0] || "")) > 0.5, `bg=${bgOf(htmls[0] || "")}`);
    check("Pauls Valley Dark Premium is dark", lum(bgOf(htmls[1] || "")) < 0.35, `bg=${bgOf(htmls[1] || "")}`);
    check("Pauls Valley Sunlit Cut uses the bleed hero", /(?:s-hero-split|s-hero-type)[^"]*v-bleed/.test(htmls[2] || ""), `font=${headingFont(htmls[2] || "")}`);
    await screenshotLooks(page, ids, "04-paulsvalley");
  } catch (error) {
    check("Pauls Valley reimagine completed", false, error instanceof Error ? error.message : String(error));
    await page.screenshot({ path: join(outDir, "03-paulsvalley-failed.png"), fullPage: true }).catch(() => undefined);
  }
  await page.close();
}

// 3. Freak show (new site, scarry)
{
  const page = await openMode("newsite");
  try {
    await fillNewSite(page, {
      name: "Freak Show Restaurant",
      city: "Oklahoma City, OK",
      what: "A scarry sideshow restaurant that serves eyeballs and brains.",
      style: "scarry",
    });
    await page.getByRole("button", { name: /Build my new site/i }).click();
    await waitLooks(page);
    const cards = await cardCopy(page);
    await page.screenshot({ path: join(outDir, "05-freakshow-cards.png"), fullPage: true });
    assertOrder(cards, "Freak show");
    const ids = await lookIds(page);
    await screenshotLooks(page, ids, "06-freakshow");
    check("Freak show still produced three distinct looks", new Set(cards.map((c) => c.name.split("·")[0].trim())).size === 3, JSON.stringify(cards.map((c) => c.name)));
  } catch (error) {
    check("Freak show new site completed", false, error instanceof Error ? error.message : String(error));
    await page.screenshot({ path: join(outDir, "05-freakshow-failed.png"), fullPage: true }).catch(() => undefined);
  }
  await page.close();
}

// 4. Bakery
{
  const page = await openMode("newsite");
  try {
    await fillNewSite(page, {
      name: "Maple Street Bakery",
      city: "Norman, OK",
      what: "A neighborhood bakery known for sourdough, cinnamon rolls, and coffee.",
      style: "warm and sunny",
    });
    await page.getByRole("button", { name: /Build my new site/i }).click();
    await waitLooks(page);
    const cards = await cardCopy(page);
    await page.screenshot({ path: join(outDir, "07-bakery-cards.png"), fullPage: true });
    assertOrder(cards, "Bakery");
    const ids = await lookIds(page);
    const htmls = [];
    for (const id of ids) htmls.push(await bodyOf(id));
    check("Bakery Sunlit Cut uses a bleed hero", /(?:s-hero-split|s-hero-type)[^"]*v-bleed/.test(htmls[2] || ""), h1Of(htmls[2] || ""));
    await screenshotLooks(page, ids, "08-bakery");
  } catch (error) {
    check("Bakery new site completed", false, error instanceof Error ? error.message : String(error));
    await page.screenshot({ path: join(outDir, "07-bakery-failed.png"), fullPage: true }).catch(() => undefined);
  }
  await page.close();
}

await browser.close();
const passed = checks.filter((c) => c.pass).length;
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ passed, total: checks.length, checks }, null, 2));
console.log(`\n${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
