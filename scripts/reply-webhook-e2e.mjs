#!/usr/bin/env node
/**
 * E2E: "Choose this look" -> the app server posts to Email Bot's instant-reply webhook (a local stand-in,
 * scripts/mock-reply-webhook.mjs), alongside the browser's Formcarry submission (intercepted, never sent).
 * Formcarry fails the first time, so the visitor presses Choose again: both webhook posts must carry the same
 * submission_id. Start the app with REPLY_WEBHOOK_URL=http://localhost:9998/hook REPLY_WEBHOOK_KEY=<test key>.
 *
 *   node scripts/reply-webhook-e2e.mjs https://bob.me/ live-preview-shots/reply-webhook-e2e
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const target = process.argv[2] ?? "https://bob.me/";
const outDir = process.argv[3] ?? "live-preview-shots/reply-webhook-e2e";
const base = process.env.APP_URL ?? "http://localhost:8080";
const hookLog = process.env.MOCK_WEBHOOK_LOG ?? "/tmp/mock-reply-webhook.jsonl";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
const formcarry = [];
const formModes = [];
await page.context().route("**/formcarry.com/**", async (route) => {
  const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
  formcarry.push(body.length);
  formModes.push(body.match(/name="mode"\r\n\r\n([^\r]*)/)?.[1] ?? "");
  // First submission fails (the visitor is told to press Choose again); the second succeeds.
  const ok = formcarry.length > 1;
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ok ? { code: 200 } : { code: 500, message: "Simulated Formcarry failure" }) });
});
await page.goto(base, { waitUntil: "networkidle" });
await page.locator('[data-mode="reimagine"]').click();
await page.locator("#site-url").fill(target);
await page.locator("#site-email").fill("e2e-test@example.com");
await page.locator("#site-notes").fill(process.env.NOTE ?? "Keep the rocket");
await page.locator('input[type="checkbox"]').filter({ hasNot: page.locator("[name]") }).last().check();
await page.getByRole("button", { name: /Reimagine my site/i }).click();
await page.locator("[data-look]").nth(2).waitFor({ timeout: 400_000 });
await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 200_000 }).catch(() => undefined);
const card = page.locator("[data-look]").first();
const lookId = await card.getAttribute("data-look");
const choose = async () => {
  await card.getByRole("button", { name: /^(Chosen|Choose this look)$/ }).first().click();
};
await choose();
await page.getByText(/Press Choose this look again to resend/).waitFor({ timeout: 300_000 });
// Round 10: a failed submission never shows "Sent".
const sentShown = await page.getByText(/^Sent!/).count();
await page.screenshot({ path: join(outDir, "01-formcarry-failed-first.png") });
await choose();
await page.getByText(/check your email|inbox|on its way/i).first().waitFor({ timeout: 300_000 });
await page.screenshot({ path: join(outDir, "02-check-your-email.png") });
await page.waitForTimeout(8000);
await browser.close();

const posts = existsSync(hookLog) ? readFileSync(hookLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const ids = [...new Set(posts.map((p) => p.payload?.submission_id))];
const summary = {
  target,
  lookId,
  formcarryCalls: formcarry.length,
  formcarryModes: formModes,
  failureShowedSent: sentShown > 0,
  webhookPosts: posts.map((p) => ({ status: p.status, authOk: p.authOk, problems: p.problems, idempotencyKey: p.idempotencyKey, submission_id: p.payload?.submission_id })),
  sameSubmissionId: ids.length === 1,
  payload: posts.at(-1)?.payload,
};
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
