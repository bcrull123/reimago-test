#!/usr/bin/env node
/**
 * Round 10 E2E — the two big choices and "Build a New Site" (no source site).
 * Screenshots both button states (desktop + phone), fills the new-site form (with a logo upload), builds the three
 * looks, chooses one, and checks the Formcarry submission (intercepted, never sent) carries mode=new_site, the
 * business details and the domain choice; and the reply webhook (scripts/mock-reply-webhook.mjs) got mode=new_site.
 *
 *   node scripts/new-site-e2e.mjs live-preview-shots/round10/new-site
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";

const outDir = process.argv[2] ?? "live-preview-shots/round10/new-site";
const base = process.env.APP_URL ?? "http://localhost:8080";
const hookLog = process.env.MOCK_WEBHOOK_LOG ?? "/tmp/mock-reply-webhook.jsonl";
const NAME = process.env.BUSINESS ?? "Riverside Plumbing";
const WHAT = process.env.WHAT ?? "Family-run plumbing repairs, drain cleaning and water heaters for homeowners on the east side.";
mkdirSync(outDir, { recursive: true });

/** A small solid PNG as the stand-in logo. */
function pngLogo() {
  const w = 120, h = 120;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 20; raw[o + 1] = 60 + (x % 60); raw[o + 2] = 140; }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const checks = [];
const check = (name, pass, detail = "") => { checks.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });

// Phone: buttons stack, the arrow turns vertical.
const phone = await browser.newPage({ viewport: { width: 390, height: 900 } });
await phone.goto(base, { waitUntil: "networkidle" });
const choicesPhone = phone.locator("[data-mode-choices]");
await choicesPhone.scrollIntoViewIfNeeded();
await phone.waitForTimeout(350); await choicesPhone.screenshot({ path: join(outDir, "00-phone-none-selected.png") });
await phone.locator('[data-mode="newsite"]').click();
await phone.waitForTimeout(350); await choicesPhone.screenshot({ path: join(outDir, "00-phone-build-new-selected.png") });
await phone.close();

const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
const formcarry = [];
await page.context().route("**/formcarry.com/**", async (route) => {
  formcarry.push(route.request().postDataBuffer()?.toString("latin1") ?? "");
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200 }) });
});
await page.goto(base, { waitUntil: "networkidle" });
const choices = page.locator("[data-mode-choices]");
await choices.scrollIntoViewIfNeeded();
await page.waitForTimeout(350); await choices.screenshot({ path: join(outDir, "01-choices-none-selected.png") });
// Keyboard: Tab to the group, then arrow keys move the selection.
await page.locator('[data-mode="reimagine"]').focus();
await page.keyboard.press("Space");
check("Reimagine My Site selects with the keyboard", (await page.locator('[data-mode="reimagine"]').getAttribute("aria-checked")) === "true");
await page.waitForTimeout(350); await choices.screenshot({ path: join(outDir, "02-choices-reimagine-selected.png") });
await page.keyboard.press("ArrowRight");
check("Arrow key moves to Build a New Site", (await page.locator('[data-mode="newsite"]').getAttribute("aria-checked")) === "true" && (await page.locator('[data-mode="reimagine"]').getAttribute("aria-checked")) === "false");
await page.waitForTimeout(350); await choices.screenshot({ path: join(outDir, "03-choices-build-new-selected.png") });
check("Exactly two choices, role=radio", (await page.locator('[data-mode-choices] [role="radio"]').count()) === 2);
check("No checkbox/radio inputs in the choice row", (await page.locator("[data-mode-choices] input").count()) === 0);
check("Pick one arrow between the buttons", (await page.locator("[data-pick-one] svg").count()) === 1 && /Pick one/.test((await page.locator("[data-pick-one]").innerText()) ?? ""));
const bg = async (sel) => page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundColor);
check("Selected and unselected look different", (await bg('[data-mode="newsite"]')) !== (await bg('[data-mode="reimagine"]')), `${await bg('[data-mode="newsite"]')} vs ${await bg('[data-mode="reimagine"]')}`);
check("No URL field in new-site mode", (await page.locator("#site-url").count()) === 0);

await page.locator("#ns-name").fill(NAME);
await page.locator("#ns-location").fill(process.env.AREA ?? "Austin, Texas");
await page.locator("#ns-what").fill(WHAT);
await page.locator("#ns-style").fill(process.env.STYLE ?? "Warm and trustworthy. Navy and copper.");
await page.locator("#ns-logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: pngLogo() });
await page.getByLabel("Get me a domain, email & hosting").check();
await page.locator("#ns-email").fill("e2e-test@example.com");
await page.locator("[data-new-site-form] input[type=checkbox]").check();
await page.screenshot({ path: join(outDir, "04-new-site-form.png"), fullPage: false });
const t0 = Date.now();
await page.locator("[data-build-new-site]").click();
await page.waitForTimeout(1500);
await page.screenshot({ path: join(outDir, "05-building.png") });
await page.locator("[data-look]").nth(2).waitFor({ timeout: 400_000 });
await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 300_000 }).catch(() => undefined);
check("Three looks built with no source site", (await page.locator("[data-look]").count()) >= 3, `${Math.round((Date.now() - t0) / 1000)}s`);
await page.locator("[data-look]").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "06-looks.png") });
const card = page.locator("[data-look]").first();
await card.getByRole("button", { name: /^(Chosen|Choose this look)$/ }).first().click();
await page.getByText(/check your email/i).first().waitFor({ timeout: 300_000 });
await page.screenshot({ path: join(outDir, "07-sent.png") });
await page.waitForTimeout(6000);
await browser.close();

const body = formcarry.at(-1) ?? "";
const field = (name) => body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1];
check("Formcarry posted once", formcarry.length === 1, `${formcarry.length}`);
check("Formcarry mode=new_site", field("mode") === "new_site");
check("Formcarry business_name", field("business_name") === NAME);
check("Formcarry what_and_who", (field("what_and_who") ?? "").startsWith(WHAT.slice(0, 20)));
check("Formcarry domain_choice", field("domain_choice") === "get_domain_email_hosting");
check("Formcarry logo attached", /name="logo"; filename=/.test(body) && /\/img\/upload-logo/.test(field("logo_url") ?? ""));
check("Formcarry chosen_look + preview_url", Boolean(field("chosen_look")) && /^https?:/.test(field("preview_url") ?? ""));
const posts = existsSync(hookLog) ? readFileSync(hookLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const last = posts.at(-1)?.payload;
if (process.env.EXPECT_WEBHOOK) check("Reply webhook got mode=new_site + business + domain choice", last?.mode === "new_site" && last?.business_name === NAME && last?.domain_choice === "get", JSON.stringify({ mode: last?.mode, business_name: last?.business_name, domain_choice: last?.domain_choice }));
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ checks, formcarryFields: { mode: field("mode"), business_name: field("business_name"), domain_choice: field("domain_choice"), domain: field("domain"), chosen_look: field("chosen_look") }, webhook: last ? { mode: last.mode, business_name: last.business_name, domain_choice: last.domain_choice } : null }, null, 2));
const failed = checks.filter((c) => !c.pass).length;
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
