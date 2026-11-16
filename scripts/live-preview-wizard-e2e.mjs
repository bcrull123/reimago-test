#!/usr/bin/env node
/**
 * E2E for the Create a New Site wizard -> live preview path.
 * Seeds the wizard's saved brief (review step), clicks "Build my new site",
 * waits for the three looks, then chooses one (argv[3], default 0) to build every page.
 * Formcarry is intercepted, so no real lead is sent.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const outDir = process.argv[2] ?? "live-preview-shots/wizard";
const base = process.env.APP_URL ?? "http://localhost:8080";
mkdirSync(outDir, { recursive: true });
const brief = {
  business_name: "Prairie Paws Grooming",
  what: "Dog and cat grooming salon in Edmond",
  industry: "Other",
  location: "Edmond, OK",
  existing_site: "",
  emulate_url_1: "https://www.tartinebakery.com/", emulate_url_2: "", emulate_url_3: "", emulate_likes: ["Colors", "Fonts"], emulate_note: "Calm, warm and premium.",
  goal: "Book an appointment",
  customers: "Busy pet owners in north OKC who want gentle, fear-free grooming.",
  services: "Full groom\nBath and brush\nNail trim\nDe-shedding treatment\nPuppy's first groom",
  pages: ["Home", "About", "Services/Products", "Contact"],
  style: "Warm",
  brand_color: "#2f7d6d",
  phone: "",
  contact_email: "",
  address: "",
  hours: "Tue–Sat 8am–5pm",
  domain_choice: "find", domain: "prairiepawsgrooming.net", domain_status: "selected-pending-checkout", domain_checkout_url: "",
  features: ["Booking"], product_count: "", files_link: "", copy_text: "", video_link: "",
  anything_else: "", files_note: "", ai_suggested: [],
};
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const formcarry = [];
await page.context().route("**/formcarry.com/**", async (route) => {
  formcarry.push(route.request().postData()?.slice(0, 6000) ?? "");
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200 }) });
});
// The wizard keeps answers in memory only; this test hook seeds it at the review step.
await page.addInitScript((value) => { window.__reimagoSeedBrief = { step: 14, brief: value }; }, brief);
await page.goto(base, { waitUntil: "networkidle" });
await page.getByLabel("Create a New Site").check();
await page.locator("#site-email").fill("e2e-test@example.com");
await page.locator('input[type="checkbox"]').last().check();
await page.getByRole("button", { name: "Build my new site" }).click();
const cards = page.locator("[data-look]");
await cards.nth(2).waitFor({ timeout: 300_000 });
await page.waitForTimeout(3000);
await cards.first().scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "01-app-wizard-looks.png") });
const lookNames = await cards.locator("h3").allTextContents();
await cards.nth(Number(process.argv[3] ?? 0)).getByRole("button", { name: /Choose this look/ }).click();
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Hand off to Cursor|Send to Cursor/.test(b.textContent ?? "")), null, { timeout: 300_000 });
const frame = page.locator('iframe[title^="Live preview"]');
await page.waitForTimeout(2500);
await frame.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "02-app-wizard-preview.png") });
const src = await frame.getAttribute("src");
const site = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
await site.goto(src, { waitUntil: "networkidle" });
await site.screenshot({ path: join(outDir, "03-site-home.png"), fullPage: true });
const links = await site.locator(".site-nav a").evaluateAll((els) => els.map((el) => el.href));
for (const [i, href] of links.slice(1).entries()) {
  const res = await site.goto(href, { waitUntil: "networkidle" });
  console.log(href, res?.status(), await site.locator("h1").first().textContent());
  await site.screenshot({ path: join(outDir, `0${i + 4}-site-${href.split("/").pop()}.png`), fullPage: true });
}
// A reload starts fresh (no looks, no preview), but the preview link still works.
await page.addInitScript(() => { delete window.__reimagoSeedBrief; });
await page.reload({ waitUntil: "networkidle" });
const looksAfterReload = await page.locator("[data-look]").count();
const framesAfterReload = await page.locator('iframe[title^="Live preview"]').count();
const linkStatus = (await site.goto(src, { waitUntil: "domcontentloaded" }))?.status();
await page.screenshot({ path: join(outDir, "09-after-reload.png") });
console.log("after reload: looks", looksAfterReload, "preview frames", framesAfterReload, "preview link status", linkStatus);
const hasPreviewUrl = formcarry.some((body) => body.includes('name="preview_url"') && body.includes("/made/"));
console.log("looks:", lookNames, "preview:", src, "formcarry posts:", formcarry.length, "preview_url included:", hasPreviewUrl);
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ looks: lookNames, previewUrl: src, links, formcarryPosts: formcarry.length, hasPreviewUrl, looksAfterReload, framesAfterReload, linkStatus }, null, 2));
await browser.close();
