#!/usr/bin/env node
/**
 * End-to-end check of the live preview flow against a running dev/preview server.
 *
 *   PREVIEW_MOCK=1 npm run dev            # in one shell
 *   node scripts/live-preview-e2e.mjs https://www.example-local-business.com [outDir]
 *
 * Formcarry requests are intercepted and answered locally, so no real lead email is sent.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const target = process.argv[2] ?? "https://www.morganplumbingokc.com/";
const outDir = process.argv[3] ?? "live-preview-shots";
const base = process.env.APP_URL ?? "http://localhost:8080";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const formcarry = [];
await page.context().route("**/formcarry.com/**", async (route) => {
  formcarry.push({ url: route.request().url(), body: route.request().postData()?.slice(0, 4000) ?? "" });
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200, status: "success" }) });
});
page.on("console", (msg) => msg.type() === "error" && console.log("[browser]", msg.text()));

await page.goto(base, { waitUntil: "networkidle" });
await page.getByLabel("Reimagine My Website").check();
await page.locator("#site-url").fill(target);
await page.locator("#site-email").fill("e2e-test@example.com");
await page.locator("#site-notes").fill("Cleaner layout, make the phone number easy to tap.");
await page.locator('input[type="checkbox"]').filter({ hasNot: page.locator("[name]") }).last().check();
const stages = new Set();
const watcher = setInterval(async () => {
  const text = await page.locator('[role="status"]').textContent().catch(() => null);
  if (text) for (const label of ["Reading your site", "Planning pages", "Building pages", "Sending your preview link"]) if (text.includes(`${label}…`) && text.indexOf(label) < 40) stages.add(label);
}, 150);
await page.getByRole("button", { name: /Reimagine my site/i }).click();
await page.screenshot({ path: join(outDir, "00-progress.png") });
const frame = page.locator('iframe[title^="Live preview"]');
await frame.waitFor({ timeout: 180_000 });
clearInterval(watcher);
await page.waitForTimeout(2500);
await frame.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "01-app-desktop-preview.png") });

const src = await frame.getAttribute("src");
console.log("preview url:", src);
const pages = await page.locator("text=Pages:").locator("..").locator("button").allTextContents();
console.log("pages:", pages);

// Mobile toggle
await page.getByRole("button", { name: "Mobile" }).click();
await page.waitForTimeout(2000);
await page.locator('iframe[title^="Live preview"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "02-app-mobile-preview.png") });

// Click through links inside the sandboxed iframe.
await page.getByRole("button", { name: "Desktop" }).click();
await page.waitForTimeout(1500);
const inner = page.frameLocator('iframe[title^="Live preview"]');
const navLinks = await inner.locator(".site-nav a").allTextContents();
console.log("nav in iframe:", navLinks);
const visited = [];
for (const label of navLinks.slice(1)) {
  await inner.locator(".site-nav a", { hasText: label }).first().click();
  await page.waitForTimeout(1200);
  const h1 = await inner.locator("h1").first().textContent().catch(() => "");
  const frameUrl = page.frames().find((f) => f.url().includes("/made/"))?.url();
  visited.push({ label, h1: h1?.trim(), url: frameUrl });
}
console.log("clicked through:", JSON.stringify(visited, null, 2));

// Full-page screenshots of every preview page, desktop + mobile.
const site = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
const urls = [src, ...visited.map((v) => v.url).filter(Boolean)];
let i = 3;
for (const url of [...new Set(urls)]) {
  const slug = url.split("/made/")[1].split("/")[1] ?? "home";
  await site.goto(url, { waitUntil: "networkidle" });
  await site.screenshot({ path: join(outDir, `${String(i).padStart(2, "0")}-site-${slug}-desktop.png`), fullPage: true });
  await mobile.goto(url, { waitUntil: "networkidle" });
  await mobile.screenshot({ path: join(outDir, `${String(i).padStart(2, "0")}-site-${slug}-mobile.png`), fullPage: true });
  i += 1;
}
const summary = { target, previewUrl: src, stagesSeen: [...stages], pages, navLinks, visited, formcarry };
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log("formcarry intercepted:", formcarry.length);
await browser.close();
