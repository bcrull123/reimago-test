#!/usr/bin/env node
/**
 * Round 15c e2e (mock AI): refine casing, card name/description identity,
 * Custom Design concept blurb, no junk Art line, site-specific card copy
 * (no “cream letterhead”), Cafe 501 descriptions mention the restaurant.
 *
 *   APP_URL=http://localhost:8090 CHROME_PATH=/usr/bin/google-chrome \
 *     node scripts/round15c-e2e.mjs /workspace/live-preview-shots/round15c
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = process.env.APP_URL || "http://localhost:8090";
const outDir = process.argv[2] || "/workspace/live-preview-shots/round15c";
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
const GEOMETRIC = /Space Grotesk|Syne|Bricolage|Montserrat|Poppins|Unbounded|Work Sans|Inter|Archivo(?! Black)|Fredoka|Baloo|Manrope/i;
const CONDENSED = /Archivo Black|Anton|Big Shoulders|Oswald/i;

function headingFont(html) {
  return html.match(/--hf:\s*"([^"]+)"/)?.[1] || html.match(/family=([A-Za-z+\-]+)[:&]/)?.[1]?.replace(/\+/g, " ") || "";
}
function fontCat(name) {
  if (CONDENSED.test(name)) return "condensed";
  if (SERIF.test(name)) return "serif";
  if (GEOMETRIC.test(name)) return "geometric";
  return name ? "other" : "unknown";
}
function h1Of(html) {
  const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return (m?.[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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
      return { name, mood, photos, title: name };
    }),
  );
}

// 1. Pauls Valley + refine casing
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
    const stamp = (await page.locator("[data-build-stamp]").first().textContent().catch(() => "")) || "";
    check("Footer shows Build r15c (or current stamp is present)", /r15c|Build /i.test(stamp), stamp.trim());
    const before = await cardCopy(page);
    check("Pauls Valley produced three looks", before.length >= 3, JSON.stringify(before.map((c) => c.name)));
    await page.screenshot({ path: join(outDir, "01-paulsvalley-cards.png"), fullPage: true });
    const idsBefore = await lookIds(page);
    const names = before.map((c) => c.name.split("·")[0].trim());
    check("Look names are distinct", new Set(names).size >= 3, JSON.stringify(names));
    check("No card is named Minimal Luxury while describing a cinematic/dark look", !before.some((c) => /minimal luxury/i.test(c.name) && /cinematic and confident after dark/i.test(c.mood)));
    check("No card uses the leftover “not a cream letterhead” instruction", !before.some((c) => /cream letterhead/i.test(`${c.name} ${c.mood}`)), JSON.stringify(before.map((c) => c.mood.slice(0, 80))));
    const custom = before.find((c) => /custom design/i.test(c.name));
    if (custom) {
      check("Custom Design blurb is not the Playful template voice", !/^Bold, graphic, and colorful/i.test(custom.mood), custom.mood.slice(0, 140));
      check("Custom Design Art line has no leaked hitbox/class junk", !/hitbox|path group|yui /i.test(custom.photos), custom.photos);
    }
    // Descriptions should not all be the same template, and should mention the business or a concept.
    const moods = before.map((c) => c.mood);
    check("The three card descriptions are not identical", new Set(moods).size >= 2, JSON.stringify(moods.map((m) => m.slice(0, 60))));

    const fonts = [];
    const h1sBefore = [];
    for (let i = 0; i < idsBefore.length; i++) {
      const html = await bodyOf(idsBefore[i]);
      fonts.push(fontCat(headingFont(html)));
      h1sBefore.push(h1Of(html));
      await page.locator(`[data-look="${idsBefore[i]}"]`).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(outDir, `02-paulsvalley-look-${i + 1}.png`) });
    }
    check("Pauls Valley looks differ in heading font category", new Set(fonts.filter((f) => f !== "unknown")).size >= 2, JSON.stringify(fonts));

    const editorialIndex = before.findIndex((c) => /editorial/i.test(c.name)) >= 0 ? before.findIndex((c) => /editorial/i.test(c.name)) : 0;
    const box = page.locator("[data-card-edit]").nth(editorialIndex);
    const input = box.locator("[data-card-edit-text]");
    await input.click();
    await input.evaluate((el) => el.removeAttribute("readOnly"));
    await input.fill("Have it say explore our Brick streets");
    await box.locator("[data-card-edit-submit]").click();
    await page.locator("[data-look-variant], [data-look-changed]").first().waitFor({ timeout: 90_000 });
    await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(outDir, "03-paulsvalley-refined.png"), fullPage: true });

    const after = await cardCopy(page);
    const refined = after.find((c) => /new headline/i.test(c.name) || /new headline/i.test(c.mood)) || after[editorialIndex];
    check("The refined card shows “Editorial · new headline” (or that look · new headline)", /new headline/i.test(refined?.name || ""), JSON.stringify(after.map((c) => c.name)));
    check("The other cards were not marked as refined", after.filter((c) => /new headline/i.test(c.name)).length === 1, JSON.stringify(after.map((c) => c.name)));

    const idsAfter = await lookIds(page);
    const refinedId = await page.locator("[data-look]").evaluateAll((els) => {
      const hit = els.find((el) => /new headline/i.test(el.querySelector("h3")?.textContent || ""));
      return hit?.getAttribute("data-look") || els[0]?.getAttribute("data-look");
    });
    const refinedHtml = refinedId ? await bodyOf(refinedId) : "";
    const heading = h1Of(refinedHtml);
    const casedOk = heading === "Explore our brick streets" || heading === "Explore Our Brick Streets";
    check("Refine “Have it say explore our Brick streets” yields a properly cased headline", casedOk, heading);
    check("Headline is not the raw mixed casing", heading !== "explore our Brick streets", heading);

    const otherBefore = idsBefore.filter((_, i) => i !== editorialIndex);
    const otherH1Before = h1sBefore.filter((_, i) => i !== editorialIndex);
    const otherAfterIds = idsAfter.filter((id) => id !== refinedId);
    const otherH1After = [];
    for (const id of otherAfterIds.slice(0, 2)) otherH1After.push(h1Of(await bodyOf(id)));
    check("The other cards kept their headlines (no unexpected copy change)", otherH1Before.every((h) => !h || otherH1After.includes(h)) || otherBefore.every((id) => idsAfter.includes(id)), JSON.stringify({ otherH1Before, otherH1After }));
  } catch (error) {
    check("Pauls Valley reimagine + refine completed", false, error instanceof Error ? error.message : String(error));
    await page.screenshot({ path: join(outDir, "01-paulsvalley-failed.png"), fullPage: true }).catch(() => undefined);
  }
  await page.close();
}

// 2. Cafe 501 — site-specific blurbs, no cream letterhead, no linger in copy
{
  const page = await openMode("newsite");
  try {
    await fillNewSite(page, {
      name: "Cafe 501",
      city: "Edmond, OK",
      what: "An American restaurant in Edmond known for brunch, lunch, and dinner plates.",
      style: "warm and cinematic",
    });
    await page.getByRole("button", { name: /Build my new site/i }).click();
    await waitLooks(page);
    await page.screenshot({ path: join(outDir, "04-cafe501-cards.png"), fullPage: true });
    const cards = await cardCopy(page);
    check("Cafe 501 produced three looks", cards.length >= 3, JSON.stringify(cards.map((c) => c.name)));
    check("Cafe 501 card names are distinct", new Set(cards.map((c) => c.name.split("·")[0].trim())).size >= 3, JSON.stringify(cards.map((c) => c.name)));
    check("Cafe 501 has no “cream letterhead” instruction in a card blurb", !cards.some((c) => /cream letterhead/i.test(c.mood)), JSON.stringify(cards.map((c) => c.mood.slice(0, 90))));
    const custom = cards.find((c) => /custom design/i.test(c.name));
    if (custom) {
      check("Cafe 501 Custom Design blurb is not the Playful template voice", !/^Bold, graphic, and colorful/i.test(custom.mood), custom.mood.slice(0, 140));
    }
    const dark = cards.find((c) => /dark premium/i.test(c.name));
    if (dark) {
      check("Dark Premium’s blurb is written for Cafe 501, not the fixed template", /Cafe 501|Edmond/i.test(dark.mood) && !/^Cinematic and confident after dark:/i.test(dark.mood), dark.mood.slice(0, 160));
    }
    const ids = await lookIds(page);
    let linger = false;
    const headlines = [];
    for (let i = 0; i < ids.length; i++) {
      const html = await bodyOf(ids[i]);
      const heading = h1Of(html);
      headlines.push(heading);
      if (/linger/i.test(heading) || /linger/i.test(html.match(/<h1[\s\S]*?<\/h1>/i)?.[0] || "")) linger = true;
      await page.screenshot({ path: join(outDir, `05-cafe501-look-${i + 1}.png`) });
    }
    check("Cafe 501 headlines do not use “linger”", !linger, JSON.stringify(headlines));
    check("Cafe 501 looks still clearly differ (names + blurbs)", new Set(cards.map((c) => `${c.name}|${c.mood.slice(0, 40)}`)).size >= 3);
  } catch (error) {
    check("Cafe 501 new site completed", false, error instanceof Error ? error.message : String(error));
    await page.screenshot({ path: join(outDir, "04-cafe501-failed.png"), fullPage: true }).catch(() => undefined);
  }
  await page.close();
}

await browser.close();
const passed = checks.filter((c) => c.pass).length;
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ passed, total: checks.length, checks }, null, 2));
console.log(`\n${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
