#!/usr/bin/env node
/**
 * E2E: does the owner's note reach the photos? Submits the reimagine form with a note (default
 * "use the brick streets"), opens each card's "How your request was used" details, saves screenshots,
 * and reads each look's hero image. Formcarry is intercepted; nothing is chosen, so nothing is sent.
 *
 *   node scripts/note-photo-e2e.mjs https://www.morganplumbingokc.com/ live-preview-shots/note-photo-mock
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
    layout: card.querySelector("[data-look-layout]")?.textContent,
    trace: card.querySelector("[data-look-trace]")?.textContent?.slice(0, 4000),
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
  card.bodyClass = await site.locator("body").getAttribute("class").catch(() => null);
  card.sections = await site.locator("main section, body > section, section.sec").evaluateAll((els) => els.map((el) => (el.className.match(/s-[a-z-]+/)?.[0] ?? "?") + (el.className.match(/ v-[a-z-]+/)?.[0]?.trim().replace(/^v-/, "/") ?? "")));
  // Lazy images below the fold load only when scrolled into view.
  await site.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await site.waitForLoadState("networkidle");
  await site.waitForTimeout(600);
  await site.screenshot({ path: join(outDir, `04-look-${i + 1}-full.png`), fullPage: true });
  if (i === 0 && card.credit) {
    await site.locator(".photo-credit").first().scrollIntoViewIfNeeded();
    await site.screenshot({ path: join(outDir, "03-look-1-footer-credit.png") });
  }
}
// Side by side: the three look tops, and the three full pages (below the fold).
const sideBySide = async (files, name, width) => {
  const imgs = files.map((f) => `<img src="data:image/png;base64,${readFileSync(join(outDir, f)).toString("base64")}">`).join("");
  const board = await browser.newPage({ viewport: { width, height: 400 } });
  await board.setContent(`<style>body{margin:0;display:flex;gap:12px;background:#ddd;align-items:flex-start;padding:12px}img{width:calc((100% - 24px)/3);display:block;box-shadow:0 2px 8px rgba(0,0,0,.25)}</style>${imgs}`);
  await board.screenshot({ path: join(outDir, name), fullPage: true });
  await board.close();
};
await sideBySide(cards.map((_, i) => `02-look-${i + 1}-top.png`), "05-tops-side-by-side.png", 2400);
await sideBySide(cards.map((_, i) => `04-look-${i + 1}-full.png`), "06-full-pages-side-by-side.png", 1500);
// EXPECT_DISTINCT_HEROES=1 (round 1 photo check): three different hero pictures, none of them a sign.
let distinct;
if (process.env.EXPECT_DISTINCT_HEROES === "1") {
  const { createHash } = await import("node:crypto");
  const hashes = [];
  for (const card of cards) {
    const url = card.heroImage ? new URL(card.heroImage, `${base}/made/${card.id}`).href : "";
    const bytes = url ? Buffer.from(await (await fetch(url)).arrayBuffer()) : Buffer.alloc(0);
    hashes.push(createHash("sha1").update(bytes).digest("hex").slice(0, 12));
    card.heroSha1 = hashes.at(-1);
    // The pick's subject, from the server's "[photo] look N "Name": … subject: X" log line (SERVER_LOG=<file>).
    const log = process.env.SERVER_LOG ? readFileSync(process.env.SERVER_LOG, "utf8") : "";
    const line = log.split("\n").reverse().find((l) => l.startsWith("[photo] look") && l.includes(`"${card.name}"`));
    card.pickedSubject = line?.match(/picked for this look: .*?subject: ([a-z ]+)/)?.[1]?.trim() ?? null;
  }
  const subjects = cards.map((c) => c.pickedSubject);
  distinct = { hashes, subjects, ok: new Set(hashes).size === cards.length && new Set(subjects).size === cards.length && !subjects.includes("sign") && !subjects.includes(null) };
  console.log(`[check] distinct non-sign heroes: ${distinct.ok ? "PASS" : "FAIL"} ${JSON.stringify(distinct)}`);
  if (!distinct.ok) process.exitCode = 1;
}
const summary = { target, note, formcarryCalls: sent.length, distinct, cards };
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
