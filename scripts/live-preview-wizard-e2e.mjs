#!/usr/bin/env node
/**
 * E2E for the Create a New Site wizard -> live preview path.
 * Seeds the wizard's saved brief (review step) and clicks "Build my new site".
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
  emulate_url_1: "", emulate_url_2: "", emulate_url_3: "", emulate_likes: [], emulate_note: "",
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
  domain_choice: "later", domain: "",
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
await page.addInitScript((value) => localStorage.setItem("reimago-create-brief-v1", JSON.stringify({ step: 14, brief: value })), brief);
await page.goto(base, { waitUntil: "networkidle" });
await page.getByLabel("Create a New Site").check();
await page.locator("#site-email").fill("e2e-test@example.com");
await page.locator('input[type="checkbox"]').last().check();
await page.getByRole("button", { name: "Build my new site" }).click();
const frame = page.locator('iframe[title^="Live preview"]');
await frame.waitFor({ timeout: 180_000 });
await page.waitForTimeout(2500);
await frame.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "01-app-wizard-preview.png") });
const src = await frame.getAttribute("src");
const site = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await site.goto(src, { waitUntil: "networkidle" });
await site.screenshot({ path: join(outDir, "02-site-home.png"), fullPage: true });
const links = await site.locator(".site-nav a").evaluateAll((els) => els.map((el) => el.href));
for (const [i, href] of links.slice(1).entries()) {
  const res = await site.goto(href, { waitUntil: "networkidle" });
  console.log(href, res?.status(), await site.locator("h1").first().textContent());
  await site.screenshot({ path: join(outDir, `0${i + 3}-site-${href.split("/").pop()}.png`), fullPage: true });
}
const hasPreviewUrl = formcarry.some((body) => body.includes('name="preview_url"') && body.includes("/made/"));
console.log("preview:", src, "formcarry posts:", formcarry.length, "preview_url included:", hasPreviewUrl);
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ previewUrl: src, links, formcarryPosts: formcarry.length, hasPreviewUrl }, null, 2));
await browser.close();
