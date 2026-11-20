#!/usr/bin/env node
/**
 * Round 10e — the landing form no longer has the Reimago illustration beside it.
 * A marketing bubble sits there instead (above the form on phones). Header stays text-only by default.
 *
 *   PREVIEW_MOCK=1 npm run dev
 *   node scripts/marketing-bubble-e2e.mjs /workspace/live-preview-shots/round10e
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const outDir = process.argv[2] ?? "live-preview-shots/round10e";
const base = process.env.APP_URL ?? "http://localhost:8080";
mkdirSync(outDir, { recursive: true });

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });

const desktop = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await desktop.goto(base, { waitUntil: "networkidle" });
await desktop.screenshot({ path: join(outDir, "01-desktop.png") });
await desktop.locator("[data-marketing-bubble]").screenshot({ path: join(outDir, "03-bubble.png") });
await desktop.locator("header").first().screenshot({ path: join(outDir, "04-header.png") });

check("No Reimago logo left of the form", (await desktop.locator("main img[src='/reimago-logo.png']").count()) === 0);
const bubble = desktop.locator("[data-marketing-bubble]");
check("Marketing bubble is visible on desktop", await bubble.isVisible());
const bubbleText = await bubble.innerText();
check("Bubble headline: FREE to start", /FREE\s+to start/i.test(bubbleText));
check("Bubble: Save cost", /Save cost/i.test(bubbleText));
check("Bubble: Update automatically", /Update your site automatically/i.test(bubbleText));
check("Bubble: AI-designed in minutes", /AI-designed/i.test(bubbleText));
check("Bubble: Domain, email & hosting", /Domain, email & hosting/i.test(bubbleText));
check("Bubble has no Reimago name or logo", !/reimago/i.test(bubbleText) && (await desktop.locator("[data-marketing-bubble] img").count()) === 0);
const header = desktop.locator("[data-site-header-brand]");
check("Header shows domain text", /reimago/i.test(await header.innerText()));
check("Header has no logo image by default", (await header.locator("img").count()) === 0);
check("Two mode buttons still there", (await desktop.locator('[data-mode-choices] [role="radio"]').count()) === 2);
const bubbleBox = await bubble.boundingBox();
const formBox = await desktop.locator("form").first().boundingBox();
check("Bubble sits left of the form on desktop", Boolean(bubbleBox && formBox && bubbleBox.x + bubbleBox.width - 12 <= formBox.x + 24), bubbleBox && formBox ? `bubble right=${Math.round(bubbleBox.x + bubbleBox.width)} form left=${Math.round(formBox.x)}` : "missing box");
check("Form is not squeezed on desktop", Boolean(formBox && formBox.width >= 600), formBox ? `${Math.round(formBox.width)}px` : "");

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(base, { waitUntil: "networkidle" });
await phone.screenshot({ path: join(outDir, "02-phone.png"), fullPage: true });
check("No form-side Reimago logo on phone", (await phone.locator("main img[src='/reimago-logo.png']").count()) === 0);
check("Bubble visible on phone", await phone.locator("[data-marketing-bubble]").isVisible());
const pBubble = await phone.locator("[data-marketing-bubble]").boundingBox();
const pForm = await phone.locator("form").first().boundingBox();
check("Bubble stacks above the form on phone", Boolean(pBubble && pForm && pBubble.y + pBubble.height - 8 <= pForm.y + 24), pBubble && pForm ? `bubble bottom=${Math.round(pBubble.y + pBubble.height)} form top=${Math.round(pForm.y)}` : "missing box");
check("Form is readable on phone (not squeezed)", Boolean(pForm && pForm.width >= 300), pForm ? `${Math.round(pForm.width)}px` : "");
check("Two mode buttons still there on phone", (await phone.locator('[data-mode-choices] [role="radio"]').count()) === 2);

await browser.close();
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ checks }, null, 2));
const failed = checks.filter((c) => !c.pass).length;
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
