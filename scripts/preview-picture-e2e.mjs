#!/usr/bin/env node
/**
 * E2E for "send the form only when a look is chosen" + the lead picture.
 * Formcarry is intercepted (no real lead is sent). The script:
 *   1. submits the form and waits for the three looks; checks nothing was sent yet;
 *   2. screenshots the "Choose your favorite look" banner + cards, and the preview's sticky Choose bar;
 *   3. double-clicks "Choose this look" on look [lookIndex] (default 1 = the second look);
 *   4. checks exactly one Formcarry request, saves its `picture`, and checks the picture matches the
 *      chosen look's homepage better than the other looks'.
 *
 *   node scripts/preview-picture-e2e.mjs reimagine https://www.cafe501.com/ live-preview-shots/choose-cafe501 [lookIndex]
 *   node scripts/preview-picture-e2e.mjs wizard - live-preview-shots/choose-wizard [lookIndex]
 *   BREAK_CANVAS=1 node scripts/preview-picture-e2e.mjs reimagine https://bob.me/ out   # capture fails → picture_error, still sent
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const mode = process.argv[2] ?? "reimagine";
const target = process.argv[3] ?? "https://www.morganplumbingokc.com/";
const outDir = process.argv[4] ?? "live-preview-shots/picture";
const lookIndex = Number(process.argv[5] ?? 1);
const base = process.env.APP_URL ?? "http://localhost:8080";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const sent = [];
await page.context().route("**/formcarry.com/**", async (route) => {
  const request = route.request();
  sent.push({ at: Date.now(), contentType: request.headers()["content-type"] ?? "", body: request.postDataBuffer() ?? Buffer.alloc(0) });
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200, status: "success" }) });
});
// Slow the capture iframe's page load a little after choosing, so the confirmation overlay can be screenshotted.
let slowMade = false;
await page.route(/\/made\/[a-f0-9]{16}$/, async (route) => {
  if (slowMade && route.request().resourceType() === "document") await new Promise((r) => setTimeout(r, 2500));
  await route.continue();
});
const proxied = [];
page.on("request", (request) => /\/img\/remote\?u=/.test(request.url()) && proxied.push(decodeURIComponent(request.url().split("u=")[1] ?? "")));
page.on("console", (msg) => /error|warn/.test(msg.type()) && !/sandboxed/.test(msg.text()) && console.log(`[browser ${msg.type()}]`, msg.text().slice(0, 300)));
if (process.env.BREAK_CANVAS) {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.toDataURL = () => { throw new Error("canvas disabled by test"); };
    HTMLCanvasElement.prototype.toBlob = () => { throw new Error("canvas disabled by test"); };
  });
}

if (mode === "wizard") {
  const brief = {
    business_name: "Prairie Paws Grooming", what: "Dog and cat grooming salon in Edmond", industry: "Other", location: "Edmond, OK", existing_site: "",
    emulate_url_1: "", emulate_url_2: "", emulate_url_3: "", emulate_likes: [], emulate_note: "",
    goal: "Book an appointment", customers: "Busy pet owners in north OKC.", services: "Full groom\nBath and brush\nNail trim",
    pages: ["Home", "About", "Services/Products", "Contact"], style: "Warm", brand_color: "#2f7d6d",
    phone: "", contact_email: "", address: "", hours: "", domain_choice: "find", domain: "prairiepawsgrooming.net", domain_status: "selected-pending-checkout", domain_checkout_url: "",
    features: [], product_count: "", files_link: "", copy_text: "", video_link: "", anything_else: "", files_note: "", ai_suggested: [],
  };
  await page.addInitScript((value) => { window.__reimagoSeedBrief = { step: 14, brief: value }; }, brief);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByLabel("Create a New Site").check();
  await page.locator("#site-email").fill("e2e-test@example.com");
  await page.locator('input[type="checkbox"]').last().check();
  await page.getByRole("button", { name: "Build my new site" }).click();
} else {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator('[data-mode="reimagine"]').click();
  await page.locator("#site-url").fill(target);
  await page.locator("#site-email").fill("e2e-test@example.com");
  await page.locator("#site-notes").fill("Make it feel premium and modern.");
  await page.locator('input[type="checkbox"]').filter({ hasNot: page.locator("[name]") }).last().check();
  await page.getByRole("button", { name: /Reimagine my site/i }).click();
}

// 1. Looks appear — nothing sent.
const cards = page.locator("[data-look]");
await cards.nth(2).waitFor({ timeout: 300_000 });
await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 120_000 }).catch(() => undefined);
await page.waitForTimeout(4000);
const sentBeforeChoosing = sent.length;
const looks = await cards.evaluateAll((list) => list.map((card) => ({ id: card.getAttribute("data-look"), name: card.querySelector("h3")?.textContent })));
const promptText = await page.locator("text=Nothing is sent until you choose").first().textContent().catch(() => "");

// 2. Banner + cards; then the preview's sticky bar.
await page.locator("[data-choose-banner]").scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -24));
await page.screenshot({ path: join(outDir, "01-banner-and-cards.png") });
const chosen = looks[Math.min(lookIndex, looks.length - 1)];
const card = cards.nth(Math.min(lookIndex, looks.length - 1));
await card.getByRole("button", { name: /^(Preview|Previewing below)$/ }).click();
await page.waitForTimeout(1500);
const frame = page.locator('iframe[title^="Live preview"]');
await frame.scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, 300));
await page.waitForTimeout(800);
await page.screenshot({ path: join(outDir, "02-preview-sticky-bar.png") });
const barText = await page.locator("[data-choose-bar]").textContent();

// 3. Double click "Choose this look" on the card (plus one more click on the sticky bar while busy).
await card.scrollIntoViewIfNeeded();
slowMade = true;
const chooseButton = card.getByRole("button", { name: /Choose this look/ });
await chooseButton.dblclick();
await page.locator("[data-choose-bar] button").click({ force: true, timeout: 1000 }).catch(() => undefined);
await page.waitForTimeout(700);
await page.screenshot({ path: join(outDir, "03-choosing-overlay.png") });
const overlayText = (await page.locator('[role="status"]').first().textContent().catch(() => "")) ?? "";
await page.locator("text=/Sent! Check your email|email you shortly/").first().waitFor({ timeout: 300_000 });
slowMade = false;
await page.waitForTimeout(1500);
await page.locator("[data-choose-banner]").scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -24));
await page.screenshot({ path: join(outDir, "04-sent-confirmation.png") });
await page.waitForTimeout(4000);
// Clicking another look afterwards builds it but must not send again.
const other = (lookIndex + 1) % looks.length;
await cards.nth(other).getByRole("button", { name: /Choose this look/ }).click();
await page.waitForTimeout(500);
await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 300_000 }).catch(() => undefined);
await page.waitForTimeout(2000);

// 4. Exactly one request; save and check the picture.
const form = sent.length ? await new Response(sent[0].body, { headers: { "content-type": sent[0].contentType } }).formData() : new FormData();
const fields = {};
let picture = null;
for (const [key, value] of form.entries()) {
  if (typeof value === "string") fields[key] = value.length > 300 ? `${value.slice(0, 300)}…` : value;
  else if (key === "picture") picture = value;
  else fields[key] = `[file ${value.name} ${value.size} bytes]`;
}
let saved = "";
let pictureBytes = null;
if (picture) {
  pictureBytes = Buffer.from(await picture.arrayBuffer());
  saved = join(outDir, picture.name);
  writeFileSync(saved, pictureBytes);
  fields.picture = `[file ${picture.name} ${picture.type} ${pictureBytes.length} bytes ${pictureBytes.readUInt32BE(16)}x${pictureBytes.readUInt32BE(20)}]`;
}
// Which look does the picture show? Compare its top 1280x720 with each look's homepage.
const diffs = {};
if (pictureBytes) {
  const shot = PNG.sync.read(pictureBytes);
  const ref = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  for (const [i, look] of looks.entries()) {
    await ref.goto(`${base}/made/${look.id}`, { waitUntil: "networkidle" });
    const buf = await ref.screenshot();
    writeFileSync(join(outDir, `05-reference-look-${i + 1}.png`), buf);
    const other = PNG.sync.read(buf);
    let total = 0;
    let n = 0;
    for (let y = 0; y < 720; y += 4) {
      for (let x = 0; x < 1280; x += 4) {
        const a = (y * shot.width + x) * 4;
        const b = (y * other.width + x) * 4;
        total += Math.abs(shot.data[a] - other.data[b]) + Math.abs(shot.data[a + 1] - other.data[b + 1]) + Math.abs(shot.data[a + 2] - other.data[b + 2]);
        n += 3;
      }
    }
    diffs[`look ${i + 1} (${look.name})`] = Math.round((total / n) * 10) / 10;
  }
}
const best = Object.entries(diffs).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "";
const summary = {
  mode,
  target,
  sentBeforeChoosing,
  formcarryCalls: sent.length,
  chosen: `look ${lookIndex + 1} (${chosen.name})`,
  pictureMatchesChosen: best.startsWith(`look ${lookIndex + 1} `),
  pictureDiffs: diffs,
  previewUrlIsChosen: String(fields.preview_url ?? "").includes(chosen.id),
  promptText,
  barText,
  overlayText: overlayText.slice(0, 160),
  proxiedImages: proxied,
  saved,
  fields,
};
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
