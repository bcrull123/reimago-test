#!/usr/bin/env node
/**
 * E2E of Bob's steps on the refine box ("Follow my steps"):
 *   1. submit the site with NO note (round 1; proactive Google Images photos when photo search is on);
 *   2. refine: "Use a photo of downtown pauls valley with the brick streets for the background" (3 new looks);
 *   3. refine: "The <dark look> is best just a little too dark." -> that look is EDITED (same name, layout,
 *      photo, copy), returned first with two close variations, and the card says what changed.
 * Screenshots each round, the dark look before/after side by side, and measures luminance (WCAG relative
 * luminance and CIE L*) of the hero (first screen) and of the page backgrounds below it.
 * Formcarry is intercepted and nothing is chosen, so no lead is sent.
 *
 *   node scripts/refine-edit-e2e.mjs https://www.paulsvalley.com/ live-preview-shots/refine-lighten
 *   (env: APP_URL, CHROME_PATH, ROUND2, ROUND3 with {name} for the dark look's name)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const target = process.argv[2] ?? "https://www.paulsvalley.com/";
const outDir = process.argv[3] ?? "live-preview-shots/refine-lighten";
const base = process.env.APP_URL ?? "http://localhost:8080";
const round2 = process.env.ROUND2 ?? "Use a photo of downtown pauls valley with the brick streets for the background";
const round3 = process.env.ROUND3 ?? "The {name} is best just a little too dark.";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
const sent = [];
await page.context().route("**/formcarry.com/**", async (route) => {
  sent.push(route.request().url());
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200 }) });
});

const readCards = () =>
  page.locator("[data-look]").evaluateAll((list) =>
    list.map((card) => ({
      id: card.getAttribute("data-look"),
      name: card.querySelector("[data-look-name]")?.textContent?.trim(),
      archetype: card.querySelector("h3 + p")?.textContent?.trim(),
      photos: card.querySelector("[data-look-photos]")?.textContent?.trim(),
      changed: card.querySelector("[data-look-changed]")?.textContent?.trim() ?? null,
      request: card.querySelector("[data-look-request]")?.textContent?.trim() ?? null,
    })),
  );

async function waitForNewCards(previous) {
  const deadline = Date.now() + 400_000;
  for (;;) {
    const ids = await page.locator("[data-look]").evaluateAll((l) => l.map((c) => c.getAttribute("data-look")));
    if (ids.length >= 3 && !ids.some((id) => previous.includes(id))) break;
    if (Date.now() > deadline) throw new Error("new looks never appeared");
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);
}

async function refine(text, previous) {
  await page.locator("#refine-text").fill(text);
  await page.getByRole("button", { name: /Show me 3 new looks/ }).click();
  await waitForNewCards(previous);
}

// Luminance of a PNG region: mean WCAG relative luminance and mean CIE L*.
function measure(png, y0, y1) {
  let sumY = 0;
  let sumL = 0;
  let n = 0;
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  for (let y = Math.max(0, y0); y < Math.min(png.height, y1); y += 2) {
    for (let x = 0; x < png.width; x += 2) {
      const i = (y * png.width + x) * 4;
      const Y = 0.2126 * lin(png.data[i]) + 0.7152 * lin(png.data[i + 1]) + 0.0722 * lin(png.data[i + 2]);
      sumY += Y;
      sumL += Y > 216 / 24389 ? 116 * Math.cbrt(Y) - 16 : (24389 / 27) * Y;
      n += 1;
    }
  }
  return { relLum: +(sumY / n).toFixed(4), Lstar: +(sumL / n).toFixed(1) };
}

async function shootLook(id, prefix) {
  const site = await browser.newPage({ viewport: { width: 1280, height: 880 }, reducedMotion: "reduce" });
  await site.goto(`${base}/made/${id}`, { waitUntil: "networkidle" });
  await site.waitForTimeout(800);
  const top = await site.screenshot({ path: join(outDir, `${prefix}-top.png`) });
  await site.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 100));
    }
    window.scrollTo(0, 0);
  });
  await site.waitForLoadState("networkidle");
  await site.waitForTimeout(600);
  const heroHeight = await site.locator("main section").first().evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
  const full = await site.screenshot({ path: join(outDir, `${prefix}-full.png`), fullPage: true });
  const info = await site.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.body).color,
    heroAfterOpacity: getComputedStyle(document.querySelector(".s-hero-photo") ?? document.body, "::after").opacity,
    heroFilter: getComputedStyle(document.querySelector(".s-hero-photo .bgimg img, .s-hero-split .media img") ?? document.body).filter,
    h1: document.querySelector("h1")?.textContent?.trim(),
    heroImg: document.querySelector("main section img")?.getAttribute("src"),
    ribbon: document.querySelector(".preview-ribbon")?.textContent?.trim(),
  }));
  await site.close();
  const topPng = PNG.sync.read(top);
  const fullPng = PNG.sync.read(full);
  return { id, ...info, hero: measure(topPng, 0, topPng.height), backgrounds: measure(fullPng, Math.round(heroHeight), fullPng.height), wholePage: measure(fullPng, 0, fullPng.height) };
}

const sideBySide = async (files, name, width, labels = []) => {
  const imgs = files.map((f, i) => `<figure><figcaption>${labels[i] ?? ""}</figcaption><img src="data:image/png;base64,${readFileSync(join(outDir, f)).toString("base64")}"></figure>`).join("");
  const board = await browser.newPage({ viewport: { width, height: 400 } });
  await board.setContent(`<style>body{margin:0;display:flex;gap:14px;background:#ddd;align-items:flex-start;padding:14px;font:600 20px system-ui}figure{margin:0;flex:1}figcaption{padding:0 0 8px}img{width:100%;display:block;box-shadow:0 2px 8px rgba(0,0,0,.25)}</style>${imgs}`);
  await board.screenshot({ path: join(outDir, name), fullPage: true });
  await board.close();
};

// ---- Round 1: no note.
await page.goto(base, { waitUntil: "networkidle" });
await page.getByLabel("Reimagine My Website").check();
await page.locator("#site-url").fill(target);
await page.locator("#site-email").fill("e2e-test@example.com");
await page.locator('input[type="checkbox"]').filter({ hasNot: page.locator("[name]") }).last().check();
await page.getByRole("button", { name: /Reimagine my site/i }).click();
await page.locator("[data-look]").nth(2).waitFor({ timeout: 400_000 });
await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 200_000 }).catch(() => undefined);
await page.waitForTimeout(3000);
await page.locator("[data-look]").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "01-round1-no-note-cards.png") });
const round1 = await readCards();
for (const [i, c] of round1.entries()) c.look = await shootLook(c.id, `01-round1-look-${i + 1}`);
await sideBySide(round1.map((_, i) => `01-round1-look-${i + 1}-top.png`), "01-round1-tops-side-by-side.png", 2400, round1.map((c) => c.name));

// ---- Round 2: the brick-streets refine (three new looks).
await refine(round2, round1.map((c) => c.id));
await page.locator("[data-look]").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "02-round2-brick-cards.png") });
const round2Cards = await readCards();
for (const [i, c] of round2Cards.entries()) c.look = await shootLook(c.id, `02-round2-look-${i + 1}`);
await sideBySide(round2Cards.map((_, i) => `02-round2-look-${i + 1}-top.png`), "02-round2-tops-side-by-side.png", 2400, round2Cards.map((c) => c.name));

// ---- Round 3: "The <dark look> is best just a little too dark."
// The darkest look of round 2 (Bob's "Night Brick"), by measured page luminance.
const dark = [...round2Cards].sort((a, b) => a.look.wholePage.relLum - b.look.wholePage.relLum)[0];
const text3 = round3.replace("{name}", dark.name);
await refine(text3, round2Cards.map((c) => c.id));
await page.locator("[data-refine-round]").scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "03-round3-edited-cards.png") });
const round3Cards = await readCards();
for (const [i, c] of round3Cards.entries()) c.look = await shootLook(c.id, `03-round3-look-${i + 1}`);
await sideBySide(["02-round2-look-" + (round2Cards.indexOf(dark) + 1) + "-top.png", "03-round3-look-1-top.png"], "04-before-after-top.png", 2200, [`Before: ${dark.name}`, `After: ${round3Cards[0].name}`]);
await sideBySide(["02-round2-look-" + (round2Cards.indexOf(dark) + 1) + "-full.png", "03-round3-look-1-full.png"], "05-before-after-full.png", 1400, [`Before: ${dark.name}`, `After: ${round3Cards[0].name}`]);
await sideBySide(round3Cards.map((_, i) => `03-round3-look-${i + 1}-top.png`), "06-round3-variations-side-by-side.png", 2400, round3Cards.map((c) => c.name));

const pct = (a, b) => `${(((b - a) / a) * 100).toFixed(1)}%`;
const before = dark.look;
const luminance = round3Cards.map((c) => ({
  look: c.name,
  changed: c.changed,
  hero: { before: before.hero, after: c.look.hero, relLumIncrease: pct(before.hero.relLum, c.look.hero.relLum), LstarIncrease: pct(before.hero.Lstar, c.look.hero.Lstar) },
  backgrounds: { before: before.backgrounds, after: c.look.backgrounds, relLumIncrease: pct(before.backgrounds.relLum, c.look.backgrounds.relLum), LstarIncrease: pct(before.backgrounds.Lstar, c.look.backgrounds.Lstar) },
  wholePage: { relLumIncrease: pct(before.wholePage.relLum, c.look.wholePage.relLum), LstarIncrease: pct(before.wholePage.Lstar, c.look.wholePage.Lstar) },
  sameH1: c.look.h1 === before.h1,
  sameHeroImage: c.look.heroImg?.split("/").pop() === before.heroImg?.split("/").pop(),
  heroAfterOpacity: `${before.heroAfterOpacity} -> ${c.look.heroAfterOpacity}`,
  bodyBg: `${before.bg} -> ${c.look.bg}`,
}));
const summary = { target, steps: ["(no note)", round2, text3], formcarryCalls: sent.length, round1, round2: round2Cards, darkLook: dark.name, round3: round3Cards, luminance };
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ round1: round1.map((c) => [c.name, c.photos]), round2: round2Cards.map((c) => [c.name, c.photos]), round3: round3Cards.map((c) => [c.name, c.changed]), luminance, formcarryCalls: sent.length }, null, 2));
await browser.close();
