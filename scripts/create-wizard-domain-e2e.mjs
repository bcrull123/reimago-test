#!/usr/bin/env node
/**
 * Screenshots + checks for the Create a New Site wizard's domain-first step.
 *   node scripts/create-wizard-domain-e2e.mjs outDir
 * Never registers anything: "Select" only records the choice. Formcarry is intercepted.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const outDir = process.argv[2] ?? "live-preview-shots/wizard-domain";
const base = process.env.APP_URL ?? "http://localhost:8080";
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
await page.context().route("**/formcarry.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"code":200}' }));
const checks = {};
async function open() {
  // A fresh load (answers are kept in memory only).
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByLabel("Create a New Site").check();
  await page.getByRole("heading", { name: "Do you already have a domain?" }).waitFor();
}

// 1. The question.
await open();
checks.firstStep = await page.locator("text=Step 1 of 14").count();
await page.getByRole("heading", { name: "Do you already have a domain?" }).scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "01-step1-question.png") });

// 2. Yes path: bad input is rejected, a messy URL is normalized.
await page.getByLabel("Yes, I have one").check();
await page.locator("#owned-domain").fill("north line");
await page.getByRole("button", { name: "Continue" }).click();
checks.invalidError = await page.locator("p.text-danger").first().textContent();
checks.stayedOnStep1 = await page.locator("text=Step 1 of 14").count();
await page.locator("#owned-domain").fill("https://www.NorthlineDental.com/about");
await page.locator("#owned-domain").blur();
checks.normalized = await page.locator("#owned-domain").inputValue();
await page.screenshot({ path: join(outDir, "02-yes-path-filled.png") });
await page.getByRole("button", { name: "Continue" }).click();
await page.getByRole("heading", { name: "Business name" }).waitFor();
checks.yesBadge = await page.locator("[data-domain-badge]").textContent();
await page.screenshot({ path: join(outDir, "03-yes-next-step-badge.png") });

// 3. No path: search, results, Select.
await open();
await page.getByLabel("No, help me find one").check();
await page.getByRole("button", { name: "Continue" }).click();
checks.noSelectionError = await page.locator("p.text-danger").first().textContent();
await page.locator("#domain-search").fill("prairiepawsgrooming");
await page.getByRole("button", { name: "Check availability" }).click();
await page.locator('[aria-label="Domain availability"] li').first().waitFor({ timeout: 60_000 });
checks.note = await page.locator('[data-step="domain"] p.text-muted').first().textContent().catch(() => "");
checks.offers = await page.locator('[aria-label="Domain availability"] li').allTextContents();
await page.screenshot({ path: join(outDir, "04-no-path-results.png") });
const select = page.getByRole("button", { name: "Select", exact: true }).first();
const row = await select.locator("xpath=ancestor::li").locator("span").first().textContent();
await select.click();
checks.selected = row;
await page.screenshot({ path: join(outDir, "05-no-path-selected.png") });
await page.getByRole("button", { name: "Continue" }).click();
await page.getByRole("heading", { name: "Business name" }).waitFor();
checks.noBadge = await page.locator("[data-domain-badge]").textContent();
await page.screenshot({ path: join(outDir, "06-later-step-selected-domain.png") });

// 4. Skip through to review: the domain is listed once, and step 12 is Features (no second domain step).
const seen = [];
for (let i = 0; i < 13; i += 1) {
  seen.push(
    await page.evaluate(() => [...document.querySelectorAll("span")].find((el) => /^Step \d+ of 14$/.test(el.textContent ?? ""))?.nextElementSibling?.textContent ?? ""),
  );
  await page.getByRole("button", { name: "Skip" }).click();
}
checks.titles = seen;
// The first title is Business name (we are past step 1); no later step may ask for the domain again.
checks.domainAskedTwice = seen.some((t) => /domain/i.test(t ?? ""));
await page.getByText("Domain.", { exact: false }).first().scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "07-review-domain.png") });
checks.reviewDomain = await page.locator("li").filter({ hasText: "Domain." }).first().textContent();
// 5. Reload: everything starts fresh, and nothing was left in localStorage.
await page.reload({ waitUntil: "networkidle" });
await page.getByLabel("Create a New Site").check();
await page.getByRole("heading", { name: "Do you already have a domain?" }).waitFor();
checks.afterReloadStep1 = await page.locator("text=Step 1 of 14").count();
checks.afterReloadChoice = await page.locator('input[name="has-domain"]:checked').count();
checks.storageKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("reimago-")));
console.log(JSON.stringify(checks, null, 1));
writeFileSync(join(outDir, "summary.json"), JSON.stringify(checks, null, 2));
await browser.close();
