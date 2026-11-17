#!/usr/bin/env node
/**
 * E2E: does the owner's note reach the photos? Submits the reimagine form with a note (default
 * "use the brick streets"), opens each card's "How your request was used" details, saves screenshots,
 * and reads each look's hero image. Formcarry is intercepted; nothing is chosen, so nothing is sent.
 *
 *   node scripts/note-photo-e2e.mjs https://www.morganplumbingokc.com/ live-preview-shots/note-photo-mock
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const target = process.argv[2] ?? "https://www.morganplumbingokc.com/";
const outDir = process.argv[3] ?? "live-preview-shots/note-photo";
const note = process.env.NOTE ?? "use the brick streets";
const base = process.env.APP_URL ?? "http://localhost:8080";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
const sent = [];
await page.context().route("**/formcarry.com/**", async (route) => {
  sent.push(route.request().url());
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200 }) });
});
await page.goto(base, { waitUntil: "networkidle" });
await page.getByLabel("Reimagine My Website").check();
await page.locator("#site-url").fill(target);
await page.locator("#site-email").fill("e2e-test@example.com");
await page.locator("#site-notes").fill(note);
await page.locator('input[type="checkbox"]').filter({ hasNot: page.locator("[name]") }).last().check();
await page.getByRole("button", { name: /Reimagine my site/i }).click();
await page.locator("[data-look]").nth(2).waitFor({ timeout: 400_000 });
await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 200_000 }).catch(() => undefined);
await page.waitForTimeout(4000);
await page.locator("[data-look-trace] summary").evaluateAll((els) => els.forEach((el) => el.click()));
await page.waitForTimeout(500);
await page.locator("[data-look]").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "01-cards-photos-line.png"), fullPage: false });
const cards = await page.locator("[data-look]").evaluateAll((list) =>
  list.map((card) => ({
    id: card.getAttribute("data-look"),
    name: card.querySelector("h3")?.textContent,
    photos: card.querySelector("[data-look-photos]")?.textContent,
    trace: card.querySelector("[data-look-trace]")?.textContent?.slice(0, 1500),
  })),
);
// Hero image of each look.
const site = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
for (const [i, card] of cards.entries()) {
  await site.goto(`${base}/made/${card.id}`, { waitUntil: "networkidle" });
  card.heroImage = await site.locator("section").first().locator("img").first().getAttribute("src").catch(() => null);
  await site.screenshot({ path: join(outDir, `02-look-${i + 1}-top.png`) });
  card.heroType = await site.locator("section").first().getAttribute("class").catch(() => null);
  card.credit = await site.locator(".photo-credit").first().innerText().catch(() => null);
  if (i === 0 && card.credit) {
    await site.locator(".photo-credit").first().scrollIntoViewIfNeeded();
    await site.screenshot({ path: join(outDir, "03-look-1-footer-credit.png") });
  }
}
const summary = { target, note, formcarryCalls: sent.length, cards };
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
