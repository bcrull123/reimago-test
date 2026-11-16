#!/usr/bin/env node
/**
 * End-to-end check of the live preview flow (looks → pick → full site) against a running server.
 *
 *   PREVIEW_MOCK=1 npm run dev            # in one shell (or real AI / fake AI server env)
 *   node scripts/live-preview-e2e.mjs https://www.example-local-business.com [outDir] [lookIndexToChoose]
 *
 * Formcarry requests are intercepted and answered locally, so no real lead email is sent.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const target = process.argv[2] ?? "https://www.morganplumbingokc.com/";
const outDir = process.argv[3] ?? "live-preview-shots";
const choose = Number(process.argv[4] ?? 1);
const base = process.env.APP_URL ?? "http://localhost:8080";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const formcarry = [];
await page.context().route("**/formcarry.com/**", async (route) => {
  formcarry.push({ url: route.request().url(), body: route.request().postData()?.slice(0, 4000) ?? "" });
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200, status: "success" }) });
});
page.on("console", (msg) => msg.type() === "error" && !/sandboxed/.test(msg.text()) && console.log("[browser]", msg.text()));

const LABELS = ["Reading your site", "Dreaming up looks", "Painting images", "Sending your preview link", "Building pages", "Polishing the homepage"];
const stages = new Set();
const watcher = setInterval(async () => {
  const text = await page.locator('[role="status"]').textContent().catch(() => null);
  if (!text) return;
  const head = text.slice(0, 60);
  for (const label of LABELS) if (head.includes(label)) stages.add(label);
  // The finish step shows one panel listing both of its steps.
  if (head.includes("Building your site in this look")) {
    stages.add("Building pages");
    stages.add("Polishing the homepage");
  }
}, 150);

const t0 = Date.now();
await page.goto(base, { waitUntil: "networkidle" });
await page.getByLabel("Reimagine My Website").check();
await page.locator("#site-url").fill(target);
await page.locator("#site-email").fill("e2e-test@example.com");
await page.locator("#site-notes").fill("Make it feel premium and modern, and make the phone number easy to tap.");
await page.locator('input[type="checkbox"]').filter({ hasNot: page.locator("[name]") }).last().check();
await page.getByRole("button", { name: /Reimagine my site/i }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: join(outDir, "00-progress.png") });
await page.locator("[data-look]").first().waitFor({ timeout: 300_000 });
await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 120_000 }).catch(() => undefined);
const looksSeconds = Math.round((Date.now() - t0) / 1000);
await page.waitForTimeout(4000);
await page.locator("text=Pick a look").scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "01-looks-picker.png") });

const looks = await page.locator("[data-look]").evaluateAll((cards) =>
  cards.map((card) => ({ id: card.getAttribute("data-look"), name: card.querySelector("h3")?.textContent, kind: card.querySelector("h3 + p")?.textContent })),
);
console.log("looks:", looks, `(${looksSeconds}s)`);

// Full-page homepage of every look, desktop + mobile.
// Full-page captures render below-the-fold content that a real visitor would scroll-reveal, so
// capture with reduced motion (the stylesheet then shows everything without scroll animations).
const site = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, reducedMotion: "reduce" });
for (const [i, look] of looks.entries()) {
  const url = `${base}/made/${look.id}`;
  await site.goto(url, { waitUntil: "networkidle" });
  await loadAll(site);
  await site.screenshot({ path: join(outDir, `02-look-${i + 1}-home-desktop.png`), fullPage: true });
  await mobile.goto(url, { waitUntil: "networkidle" });
  await loadAll(mobile);
  await mobile.screenshot({ path: join(outDir, `02-look-${i + 1}-home-mobile.png`), fullPage: true });
}

// Choose a look → build every page.
const chosen = looks[Math.min(choose, looks.length - 1)];
const card = page.locator(`[data-look="${chosen.id}"]`);
await card.getByRole("button", { name: "Preview", exact: true }).click();
await page.waitForTimeout(1500);
const t1 = Date.now();
await card.getByRole("button", { name: /Use this look/ }).click();
await page.waitForFunction(() => document.querySelectorAll("text") && [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Hand off to Cursor") || b.textContent?.includes("Send to Cursor")), null, { timeout: 300_000 });
clearInterval(watcher);
const finishSeconds = Math.round((Date.now() - t1) / 100) / 10;
await page.waitForTimeout(3000);
const frame = page.locator('iframe[title^="Live preview"]');
await frame.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "03-app-full-site-desktop.png") });
const src = await frame.getAttribute("src");
const pages = await page.locator("text=Pages:").locator("..").locator("button").allTextContents();
const polish = await page.locator("p", { hasText: /^\s*Designer polish/ }).first().locator("..").textContent({ timeout: 5000 }).catch(() => "");
console.log("chosen:", chosen.name, "preview url:", src, "pages:", pages, `(${finishSeconds}s)`);
await page.getByRole("button", { name: "Mobile" }).click();
await page.waitForTimeout(2000);
await page.locator('iframe[title^="Live preview"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "04-app-full-site-mobile.png") });
await page.getByRole("button", { name: "Desktop" }).click();
await page.waitForTimeout(1500);

// Click through links inside the sandboxed iframe.
const inner = page.frameLocator('iframe[title^="Live preview"]');
const navLinks = await inner.locator(".site-nav a").allTextContents();
const visited = [];
for (const label of navLinks.slice(1)) {
  await inner.locator(".site-nav a", { hasText: label }).first().click();
  await page.waitForTimeout(1200);
  const h1 = await inner.locator("h1").first().textContent().catch(() => "");
  const frameUrl = await page.locator('iframe[title^="Live preview"]').elementHandle().then((h) => h?.contentFrame()).then((f) => f?.url());
  visited.push({ label, h1: h1?.trim(), url: frameUrl });
}
console.log("clicked through:", JSON.stringify(visited));


/** Full-page screenshots never scroll, so lazy images would stay empty: load them all first. */
async function loadAll(p) {
  await p.evaluate(async () => {
    const imgs = [...document.images];
    for (const img of imgs) img.loading = "eager";
    await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((done) => { img.onload = img.onerror = done; setTimeout(done, 8000); }))));
  });
}

let n = 5;
const imageChecks = [];
for (const url of [...new Set([src, ...visited.map((v) => v.url).filter(Boolean)])]) {
  const slug = url.split("/made/")[1].split("/")[1] ?? "home";
  const response = await site.goto(url, { waitUntil: "networkidle" });
  await loadAll(site);
  const csp = response?.headers()["content-security-policy"] ?? "";
  const imgs = await site.locator("img").evaluateAll((list) => list.map((img) => ({ src: img.currentSrc, ok: img.complete && img.naturalWidth > 0 })));
  imageChecks.push({ slug, csp: /script-src 'none'/.test(csp), images: imgs.length, broken: imgs.filter((i) => !i.ok).map((i) => i.src) });
  await site.screenshot({ path: join(outDir, `${String(n).padStart(2, "0")}-site-${slug}-desktop.png`), fullPage: true });
  await mobile.goto(url, { waitUntil: "networkidle" });
  await loadAll(mobile);
  await mobile.screenshot({ path: join(outDir, `${String(n).padStart(2, "0")}-site-${slug}-mobile.png`), fullPage: true });
  n += 1;
}
const summary = { target, looks, looksSeconds, chosen, finishSeconds, previewUrl: src, stagesSeen: [...stages], pages, polish, navLinks, visited, imageChecks, formcarry };
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log("stages:", [...stages]);
console.log("images:", JSON.stringify(imageChecks));
console.log("formcarry intercepted:", formcarry.length, formcarry.map((f) => /preview_url/.test(f.body)));
await browser.close();
