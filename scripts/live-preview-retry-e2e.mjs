#!/usr/bin/env node
/**
 * E2E for the AI fallback reporting and "Retry with AI" (use with scripts/fake-ai-server.mjs and FAKE_FAIL).
 *
 *   node scripts/live-preview-retry-e2e.mjs https://bob.me/ outDir [signalFile]
 *
 * Builds the three looks, records each card's AI error text, then (if signalFile is given) waits for
 * that file to exist — restart the fake AI without failures meanwhile — and clicks "Retry with AI"
 * on the first failed card. Formcarry is intercepted, so no real lead is sent.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const target = process.argv[2] ?? "https://bob.me/";
const outDir = process.argv[3] ?? "live-preview-shots/retry";
const signal = process.argv[4];
const base = process.env.APP_URL ?? "http://localhost:8080";
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.context().route("**/formcarry.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"code":200}' }));
const t0 = Date.now();
await page.goto(base, { waitUntil: "networkidle" });
await page.locator('[data-mode="reimagine"]').click();
await page.locator("#site-url").fill(target);
await page.locator("#site-email").fill("e2e-test@example.com");
await page.locator('input[type="checkbox"]').filter({ hasNot: page.locator("[name]") }).last().check();
await page.getByRole("button", { name: /Reimagine my site/i }).click();
await page.locator("[data-look]").nth(2).waitFor({ timeout: 300_000 });
await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 120_000 }).catch(() => undefined);
const seconds = Math.round((Date.now() - t0) / 1000);
await page.waitForTimeout(3000);
await page.locator("text=Pick a look").scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "01-looks.png") });
const cards = async () =>
  page.locator("[data-look]").evaluateAll((list) =>
    list.map((card) => ({ name: card.querySelector("h3")?.textContent, aiError: card.querySelector(".bg-amber-50 p")?.textContent ?? null })),
  );
const before = await cards();
console.log(`looks in ${seconds}s`, JSON.stringify(before, null, 1));
let after = null;
if (signal) {
  console.log("waiting for", signal);
  while (!existsSync(signal)) await page.waitForTimeout(500);
  const button = page.getByRole("button", { name: "Retry with AI" }).first();
  if (await button.count()) {
    const t1 = Date.now();
    await button.click();
    await page.waitForFunction(() => ![...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Retrying with AI")), null, { timeout: 200_000 });
    await page.waitForTimeout(3000);
    after = await cards();
    console.log(`after retry (${Math.round((Date.now() - t1) / 1000)}s)`, JSON.stringify(after, null, 1));
    const error = await page.locator("p.text-sm").filter({ hasText: /AI still failed|retry failed/i }).allTextContents();
    if (error.length) console.log("error shown:", error);
    await page.screenshot({ path: join(outDir, "02-after-retry.png") });
  }
}
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ target, seconds, before, after }, null, 2));
await browser.close();
