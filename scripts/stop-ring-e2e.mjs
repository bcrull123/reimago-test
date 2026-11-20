#!/usr/bin/env node
/**
 * Round 10 E2E — Stop button, progress ring, status copy, quick domain check.
 * 1) A made-up domain gets a friendly error within a few seconds (no long render).
 * 2) Reimagine starts: the segmented ring fills (screenshots), the status line rotates; Stop returns to the form
 *    with every input intact and the server's upstream AI call is aborted (fake AI logs it).
 * 3) A full run finishes; then a card edit is stopped the same way (the card's text stays).
 *   FAKE_SLOW_MS=4000 node scripts/stop-ring-e2e.mjs https://bob.me/ live-preview-shots/round10/stop-ring
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const target = process.argv[2] ?? "https://bob.me/";
const outDir = process.argv[3] ?? "live-preview-shots/round10/stop-ring";
const base = process.env.APP_URL ?? "http://localhost:8080";
const fakeLog = process.env.FAKE_LOG ?? "/tmp/fake.log";
mkdirSync(outDir, { recursive: true });
const checks = [];
const check = (name, pass, detail = "") => { checks.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.context().route("**/formcarry.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"code":200}' }));
await page.goto(base, { waitUntil: "networkidle" });
await page.locator('[data-mode="reimagine"]').click();
const fill = async (url) => {
  await page.locator("#site-url").fill(url);
  await page.locator("#site-email").fill("e2e-test@example.com");
  await page.locator("#site-notes").fill("Make it bolder");
  const box = page.locator('input[type="checkbox"]').filter({ hasNot: page.locator("[name]") }).last();
  if (!(await box.isChecked())) await box.check();
};

// 1) bad domain
await fill("https://this-domain-does-not-exist-reimago-e2e-4821.com/");
let t = Date.now();
await page.getByRole("button", { name: /Reimagine my site/i }).click();
await page.getByText(/We couldn't find/).waitFor({ timeout: 15_000 });
check("Bad domain: friendly error fast", Date.now() - t < 8000, `${Date.now() - t}ms · “${(await page.getByText(/We couldn't find/).innerText()).slice(0, 90)}”`);
await page.screenshot({ path: join(outDir, "01-bad-domain.png") });

// 2) start, watch the ring, Stop
await fill(target);
await page.getByRole("button", { name: /Reimagine my site/i }).click();
const ring = page.locator("[data-progress-ring]");
await ring.waitFor({ timeout: 10_000 });
const lines = new Set();
let f1 = 0;
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(1000);
  lines.add(await page.locator("[data-status-line]").innerText().catch(() => ""));
  if (i === 2) f1 = Number(await ring.getAttribute("data-fraction"));
}
const f2 = Number(await ring.getAttribute("data-fraction"));
await page.screenshot({ path: join(outDir, "02-ring-filling.png") });
check("Ring fills over time (capped ≤ 0.95)", f2 > f1 && f2 <= 0.95, `${f1} → ${f2}`);
check("Status line rotates / follows the stage", lines.size >= 2, [...lines].join(" | "));
const fakeBefore = readFileSync(fakeLog, "utf8").length;
await page.waitForTimeout(0);
t = Date.now();
await page.locator("[data-stop]").click();
await page.locator("[data-stopped]").waitFor({ timeout: 5000 });
check("Stop returns to the form at once", Date.now() - t < 3000, `${Date.now() - t}ms`);
check("Inputs intact after Stop", (await page.locator("#site-url").inputValue()) === target && (await page.locator("#site-email").inputValue()) === "e2e-test@example.com" && (await page.locator("#site-notes").inputValue()) === "Make it bolder");
check("Overlay gone after Stop", (await ring.count()) === 0);
await page.screenshot({ path: join(outDir, "03-stopped-form-intact.png") });
await page.waitForTimeout(6000);
// The server logs "[cancel] <step>" and stops that step's page fetches / AI calls; the next steps never start.
const devLog = process.env.SERVER_LOG ?? "/tmp/dev.log";
const cancelLine = readFileSync(devLog, "utf8").split("\n").find((l) => l.startsWith("[cancel]"));
const aborted = readFileSync(fakeLog, "utf8").slice(fakeBefore).split("\n").filter((l) => l.includes("aborted by the app"));
const lookStarted = /\[timing\] look 1/.test(readFileSync(devLog, "utf8"));
check("Server work stopped ([cancel] logged; no look was built after Stop)", Boolean(cancelLine) && !lookStarted, `${cancelLine ?? "no [cancel] line"}${aborted.length ? ` · upstream AI aborted: ${aborted.length}` : ""}`);

// 3) a full run, then stop a card edit
await page.getByRole("button", { name: /Reimagine my site/i }).click();
await page.locator("[data-look]").nth(2).waitFor({ timeout: 400_000 });
await page.locator('[role="status"][aria-live]').waitFor({ state: "detached", timeout: 300_000 }).catch(() => undefined);
await page.screenshot({ path: join(outDir, "04-looks.png") });
const card = page.locator("[data-look]").first();
const box = card.locator("input, textarea").first();
await box.fill("make the headline bigger");
await card.getByRole("button", { name: /^Change$/ }).click();
await ring.waitFor({ timeout: 10_000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: join(outDir, "05-edit-ring.png") });
await page.locator("[data-stop]").click();
await page.waitForTimeout(800);
check("Card edit: Stop closes the overlay", (await ring.count()) === 0);
check("Card edit: the typed change is still in the box", (await box.inputValue()) === "make the headline bigger");
await page.screenshot({ path: join(outDir, "06-edit-stopped.png") });
await browser.close();
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ checks }, null, 2));
const failed = checks.filter((c) => !c.pass).length;
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
