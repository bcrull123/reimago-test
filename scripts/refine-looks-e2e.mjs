#!/usr/bin/env node
/**
 * E2E for the owner's note + "Not quite right?" refine box (mock mode works; Formcarry is intercepted).
 *   1. Submits the reimagine form with a note; checks every card says "Based on your request" and nothing was sent.
 *   2. Types feedback in the refine box and presses "Show me 3 new looks"; checks 3 new, different looks that
 *      reflect the feedback (and still nothing sent). Tries the sticky bar's "Change something" link.
 *   3. Chooses a look; checks exactly one Formcarry request carrying note + change_requests.
 *
 *   node scripts/refine-looks-e2e.mjs https://www.morganplumbingokc.com/ live-preview-shots/refine-morgan
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const target = process.argv[2] ?? "https://www.morganplumbingokc.com/";
const outDir = process.argv[3] ?? "live-preview-shots/refine";
const note = process.env.NOTE ?? "Make it dark and premium with navy and gold, and add a photo gallery.";
const feedback = process.env.FEEDBACK ?? "Too dark. Make it lighter and playful, use orange, and add how it works steps.";
const base = process.env.APP_URL ?? "http://localhost:8080";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const sent = [];
await page.context().route("**/formcarry.com/**", async (route) => {
  const request = route.request();
  sent.push({ contentType: request.headers()["content-type"] ?? "", body: request.postDataBuffer() ?? Buffer.alloc(0) });
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200, status: "success" }) });
});
// Slow the server steps a little during the refine, so its loading state can be screenshotted.
let slow = false;
await page.route("**/_serverFn/**", async (route) => {
  if (slow) await new Promise((r) => setTimeout(r, 1500));
  await route.continue();
});
page.on("console", (msg) => /error/.test(msg.type()) && !/sandboxed/.test(msg.text()) && console.log("[browser]", msg.text().slice(0, 300)));

const cardInfo = () =>
  page.locator("[data-look]").evaluateAll((cards) =>
    cards.map((card) => ({
      id: card.getAttribute("data-look"),
      name: card.querySelector("h3")?.textContent ?? "",
      style: card.querySelector("h3 + p")?.textContent ?? "",
      mood: card.querySelector("h3")?.closest("div")?.parentElement?.nextElementSibling?.textContent ?? "",
      request: card.querySelector("[data-look-request]")?.textContent ?? "",
      swatches: [...card.querySelectorAll('[aria-label="Palette"] span')].map((s) => s.getAttribute("title")),
    })),
  );

await page.goto(base, { waitUntil: "networkidle" });
await page.locator('[data-mode="reimagine"]').click();
await page.locator("#site-url").fill(target);
await page.locator("#site-email").fill("e2e-test@example.com");
await page.locator("#site-notes").fill(note);
await page.locator('input[type="checkbox"]').filter({ hasNot: page.locator("[name]") }).last().check();
await page.getByRole("button", { name: /Reimagine my site/i }).click();
await page.locator("[data-look]").nth(2).waitFor({ timeout: 300_000 });
await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 120_000 }).catch(() => undefined);
await page.waitForTimeout(3500);
const first = await cardInfo();
await page.locator("[data-choose-banner]").scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -20));
await page.screenshot({ path: join(outDir, "01-cards-with-request.png") });
const sentAfterLooks = sent.length;

// Sticky bar "Change something" → scrolls to the refine box.
await page.locator('iframe[title^="Live preview"]').scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, 250));
await page.waitForTimeout(500);
await page.screenshot({ path: join(outDir, "02-sticky-bar-change-something.png") });
await page.locator("[data-choose-bar]").getByRole("button", { name: "Change something" }).click();
await page.waitForTimeout(1200);
const refineFocused = await page.evaluate(() => document.activeElement?.id === "refine-text");
await page.locator("#refine-text").fill(feedback);
await page.screenshot({ path: join(outDir, "03-refine-box.png") });

slow = true;
await page.getByRole("button", { name: /Make this change|Show me 3 new looks/ }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: join(outDir, "04-refine-loading.png") });
const loadingText = (await page.locator('[role="status"]').first().textContent().catch(() => "")) ?? "";
await page.locator("[data-refine-round]").waitFor({ timeout: 300_000 });
slow = false;
await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 120_000 }).catch(() => undefined);
await page.waitForTimeout(3500);
const second = await cardInfo();
await page.locator("[data-choose-banner]").scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -20));
await page.screenshot({ path: join(outDir, "05-new-cards.png") });
await page.locator("#refine-looks").scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "06-refine-box-after-round-1.png") });
const sentAfterRefine = sent.length;

// Choose the first new look → one request with note + change_requests.
await page.locator("[data-look]").first().getByRole("button", { name: /Choose this look/ }).dblclick();
await page.locator("text=Sent! Check your email.").first().waitFor({ timeout: 300_000 });
await page.waitForTimeout(3000);
const form = sent.length ? await new Response(sent[0].body, { headers: { "content-type": sent[0].contentType } }).formData() : new FormData();
const fields = {};
for (const [key, value] of form.entries()) fields[key] = typeof value === "string" ? value.slice(0, 400) : `[file ${value.name} ${value.size} bytes]`;

const summary = {
  target,
  note,
  feedback,
  sentAfterLooks,
  sentAfterRefine,
  formcarryCalls: sent.length,
  everyFirstCardShowsNote: first.every((c) => c.request.includes(note.slice(0, 40))),
  everyNewCardShowsFeedback: second.every((c) => c.request.includes(feedback.slice(0, 40))),
  allNewIds: second.every((c) => !first.some((f) => f.id === c.id)),
  namesChanged: second.map((c) => c.name).join("|") !== first.map((c) => c.name).join("|"),
  refineFocused,
  loadingText: loadingText.slice(0, 120),
  first,
  second,
  fields: { note: fields.note, change_requests: fields.change_requests, chosen_look: fields.chosen_look, preview_url: fields.preview_url, picture: fields.picture },
};
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
