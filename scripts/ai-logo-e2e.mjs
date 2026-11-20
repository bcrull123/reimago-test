#!/usr/bin/env node
/**
 * Round 10b E2E — "Have AI make one" on Build a New Site.
 * Needs the app running (PREVIEW_MOCK=1 is enough: logos are the lettered stand-in marks).
 * Optional PREVIEW_LOGO_DELAY_MS on the server makes the progress ring visible long enough to screenshot.
 *
 *   node scripts/ai-logo-e2e.mjs /workspace/live-preview-shots/round10b-logo
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const outDir = process.argv[2] ?? "live-preview-shots/round10b-logo";
const base = process.env.APP_URL ?? "http://localhost:8080";
const NAME = process.env.BUSINESS ?? "Glow Studio";
const WHAT = process.env.WHAT ?? "Hair color and cuts for busy professionals";
mkdirSync(outDir, { recursive: true });

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
const formcarry = [];
await page.context().route("**/formcarry.com/**", async (route) => {
  formcarry.push(route.request().postDataBuffer()?.toString("latin1") ?? "");
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200 }) });
});

await page.goto(base, { waitUntil: "networkidle" });
await page.locator('[data-mode="newsite"]').click();
await page.locator("[data-new-site-form]").waitFor();
await page.locator("[data-ai-logo-link]").click();
await page.waitForTimeout(300);
const hint = (await page.locator("[data-logo-hint]").innerText().catch(() => "")) || "";
check("Hint when there is no name or domain yet", /business name/i.test(hint), hint.slice(0, 120));
await page.locator("[data-logo-field]").screenshot({ path: join(outDir, "01-hint-needs-name.png") });

await page.locator("#ns-name").fill(NAME);
await page.locator("#ns-location").fill(process.env.AREA ?? "Austin, Texas");
await page.locator("#ns-what").fill(WHAT);
await page.locator("#ns-style").fill(process.env.STYLE ?? "warm, modern");
await page.getByLabel("Get me a domain, email & hosting").check();
await page.locator("#ns-email").fill("e2e-test@example.com");
await page.locator("[data-new-site-form] input[type=checkbox]").check();

const t0 = Date.now();
await page.locator("[data-ai-logo-link]").click();
const ring = page.locator("[data-logo-progress]");
const ringVisible = await ring.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
if (ringVisible) {
  await page.waitForTimeout(400);
  await page.locator("[data-logo-field]").screenshot({ path: join(outDir, "02-progress-ring.png") });
  check("Progress ring and Stop while logos are made", (await page.locator("[data-logo-stop]").count()) === 1 && (await ring.locator("[data-progress-ring]").count()) === 1);
} else {
  check("Progress ring and Stop while logos are made", false, "the ring was gone too quickly to see (set PREVIEW_LOGO_DELAY_MS on the server)");
}

await page.locator("[data-logo-option]").first().waitFor({ timeout: 60_000 });
// Wait until the ring is gone so the tiles are settled.
await page.locator("[data-logo-progress]").waitFor({ state: "detached", timeout: 60_000 }).catch(() => undefined);
const tiles = page.locator("[data-logo-option]");
const count = await tiles.count();
const kinds = [];
for (let i = 0; i < count; i++) kinds.push(await tiles.nth(i).getAttribute("data-kind"));
check("About three logo options appear", count >= 3 && count <= 9, `${count} tiles (${kinds.join(", ")}) in ${Math.round((Date.now() - t0) / 1000)}s`);
check("First option is a styled name wordmark", kinds[0] === "wordmark", kinds.join(", "));
check("Other options include an icon + name mark", kinds.includes("icon_name"), kinds.join(", "));
await page.locator("[data-logo-field]").screenshot({ path: join(outDir, "03-logo-options.png") });

await tiles.first().click();
await page.waitForTimeout(400);
check("Picking a tile selects it", (await tiles.first().getAttribute("data-selected")) === "true");
const using = (await page.locator("[data-logo-field]").innerText()) ?? "";
check("Chosen logo is kept like an upload", /Using glow-studio-wordmark\.png/i.test(using), using.replace(/\s+/g, " ").slice(0, 160));
await page.locator("[data-logo-field]").screenshot({ path: join(outDir, "04-logo-selected.png") });

await page.screenshot({ path: join(outDir, "05-form-ready.png") });
await page.locator("[data-build-new-site]").click();
await page.locator("[data-look]").nth(2).waitFor({ timeout: 400_000 });
await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 300_000 }).catch(() => undefined);
check("Three looks built with the AI logo", (await page.locator("[data-look]").count()) >= 3);
await page.locator("[data-look]").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "06-looks-with-ai-logo.png") });

await page.locator("[data-look]").first().getByRole("button", { name: /^(Chosen|Choose this look)$/ }).first().click();
await page.getByText(/check your email/i).first().waitFor({ timeout: 300_000 });
await page.screenshot({ path: join(outDir, "07-sent.png") });
await page.waitForTimeout(2000);
await browser.close();

const body = formcarry.at(-1) ?? "";
const field = (name) => body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1];
check("Formcarry posted once", formcarry.length === 1, `${formcarry.length}`);
check("Formcarry mode=new_site", field("mode") === "new_site");
check("Formcarry business_name", field("business_name") === NAME);
check("Formcarry logo_source=ai", field("logo_source") === "ai", field("logo_source") ?? "(missing)");
check("Formcarry logo_url points at the made logo", /\/img\/ai-logo-/.test(field("logo_url") ?? ""), field("logo_url") ?? "");
check("Formcarry logo file attached", /name="logo"; filename="glow-studio-wordmark\.png"/.test(body));

writeFileSync(
  join(outDir, "summary.json"),
  JSON.stringify({ checks, formcarryFields: { mode: field("mode"), business_name: field("business_name"), logo_source: field("logo_source"), logo_url: field("logo_url") } }, null, 2),
);
const failed = checks.filter((c) => !c.pass).length;
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
