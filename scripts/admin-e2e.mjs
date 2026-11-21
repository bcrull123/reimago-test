#!/usr/bin/env node
/**
 * Round 12 E2E — secret-path admin control panel + server-side leads.
 *
 *   ADMIN_PATH=cp-e2e-7f3a9c1d5b2e ADMIN_PASSWORD=... PREVIEW_MOCK=1 REPLY_WEBHOOK_URL=http://localhost:9998/hook REPLY_WEBHOOK_KEY=test-key npm run dev
 *   MOCK_WEBHOOK_PORT=9998 EXPECT_AUTH="Bearer test-key" node scripts/mock-reply-webhook.mjs
 *   (start a FRESH server per run: the leads live in memory when there is no DATABASE_URL)
 *   ADMIN_PATH=... ADMIN_PASSWORD=... APP_URL=http://localhost:8090 node scripts/admin-e2e.mjs /workspace/live-preview-shots/round12
 *
 * Checks: /admin and a wrong path are the normal 404 (same status, no admin title); no link to the admin anywhere;
 * unsigned API calls are refused; login (wrong password, then right; cookie is rmg_admin, HttpOnly, Strict, path-scoped);
 * two real leads (Reimagine with two picks merging into ONE lead, and New site with a picked domain); the list, search,
 * filters, the detail drawer, status change, note, CSV export, and the phone layout. Formcarry is intercepted.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const outDir = process.argv[2] ?? "live-preview-shots/round12";
const base = process.env.APP_URL ?? "http://localhost:8090";
const cp = process.env.ADMIN_PATH;
const password = process.env.ADMIN_PASSWORD;
if (!cp || !password) {
  console.error("Set ADMIN_PATH and ADMIN_PASSWORD (the same test values the dev server was started with).");
  process.exit(2);
}
const target = process.env.REIMAGINE_TARGET ?? "https://www.morganplumbingokc.com/";
mkdirSync(outDir, { recursive: true });
const checks = [];
const check = (name, pass, detail = "") => { checks.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const shot = (page, name) => page.screenshot({ path: join(outDir, name) });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await context.newPage();
const formcarry = [];
await context.route("**/formcarry.com/**", async (route) => {
  formcarry.push(route.request().postDataBuffer()?.toString("latin1") ?? "");
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200 }) });
});

// ---- 1. Secrecy: normal 404s, no links.
const get = async (path, init) => { const r = await fetch(`${base}${path}`, { redirect: "manual", ...init }); return { status: r.status, text: await r.text(), headers: r.headers }; };
const plain404 = await get("/zzz-nothing-here");
const adminPlain = await get("/admin");
const wrong = await get("/cp-this-is-not-it-123");
check("/admin is the normal 404", adminPlain.status === 404 && !/Control panel|admin/i.test(adminPlain.text.replace(/<script[\s\S]*?<\/script>/g, "")), `status ${adminPlain.status}`);
check("A wrong secret path is the normal 404", wrong.status === 404 && plain404.status === 404 && !/Control panel/i.test(wrong.text));
check("Sub-paths under the secret path are 404 too", (await get(`/${cp}/nope`)).status === 404);
const wrongApi = await get("/cp-this-is-not-it-123/api/leads");
check("Admin API under a wrong path is 404 (no 401 hint)", wrongApi.status === 404, `${wrongApi.status}`);
const rightApi = await get(`/${cp}/api/leads`);
check("Admin API without a session is refused (401) and never returns data", rightApi.status === 401 && !/email/.test(rightApi.text));
const postNoHeader = await get(`/${cp}/api/login`, { method: "POST", body: JSON.stringify({ password }) });
check("A login POST without the admin header is refused (CSRF guard)", postNoHeader.status === 400, `${postNoHeader.status}`);
const home = await get("/");
check("Home page never mentions the secret path", !home.text.includes(cp) && !/href="\/admin/.test(home.text));
const robots = await get("/robots.txt");
const sitemap = await get("/sitemap.xml");
check("Not in robots.txt or sitemap.xml", !robots.text.includes(cp) && !sitemap.text.includes(cp), `robots ${robots.status}, sitemap ${sitemap.status}`);

// ---- 2. Make two leads through the real site.
async function newSiteLead() {
  const p = await context.newPage();
  await p.goto(base, { waitUntil: "networkidle" });
  await p.locator('[data-mode="newsite"]').click();
  await p.locator("#ns-name").fill("Riverside Plumbing");
  await p.locator("#ns-location").fill("Tulsa, Oklahoma");
  await p.locator("#ns-what").fill("Family-run plumbing repairs, drain cleaning and water heaters for homeowners.");
  await p.getByLabel("Get me a domain, email & hosting").check();
  await p.locator("#ns-email").fill("newsite-lead@example.com");
  await p.locator("[data-new-site-form] input[type=checkbox]").check();
  await p.locator("[data-build-new-site]").click();
  const modal = p.locator("[data-domain-modal]");
  await modal.waitFor({ timeout: 400_000 });
  await modal.locator("[data-domain-option]").first().waitFor({ timeout: 90_000 });
  const pick = await modal.locator("[data-domain-option]").first().getAttribute("data-domain-option");
  await modal.locator("[data-domain-option]").first().click();
  await modal.locator("[data-domain-use]").click();
  await modal.waitFor({ state: "detached", timeout: 5000 });
  await p.locator("[data-look]").first().getByRole("button", { name: /^(Chosen|Choose this look)$/ }).first().click();
  await p.getByText(/check your email/i).first().waitFor({ timeout: 300_000 });
  await p.waitForTimeout(2500);
  await p.close();
  return pick;
}
async function reimagineLead() {
  const p = await context.newPage();
  await p.goto(`${base}/?utm_source=newsletter&utm_campaign=nov-launch&ref=bob`, { waitUntil: "networkidle" });
  await p.locator('[data-mode="reimagine"]').click();
  await p.locator("#site-url").fill(target);
  await p.locator("#site-email").fill("reimagine-lead@example.com");
  await p.locator("#site-notes").fill("Make it feel premium and modern.");
  await p.locator('input[type="checkbox"]').filter({ hasNot: p.locator("[name]") }).last().check();
  await p.getByRole("button", { name: /Reimagine my site/i }).click();
  await p.locator("[data-look]").first().waitFor({ timeout: 300_000 });
  await p.locator('[role="status"]').waitFor({ state: "detached", timeout: 120_000 }).catch(() => undefined);
  await p.waitForTimeout(3000);
  const names = [];
  for (const i of [0, 1]) {
    const card = p.locator("[data-look]").nth(i);
    names.push((await card.innerText()).split("\n")[0]);
    await card.getByRole("button", { name: /^(Chosen|Choose this look)$/ }).first().click();
    await p.getByText(/check your email/i).first().waitFor({ timeout: 300_000 });
    await p.waitForTimeout(2000);
  }
  await p.close();
  return names;
}
const domain = await newSiteLead();
const names = await reimagineLead();
check("Formcarry still received both submissions (intercepted)", formcarry.length >= 3, `${formcarry.length} posts`);

// ---- 3. Admin: login.
await page.goto(`${base}/${cp}`, { waitUntil: "networkidle" });
const loginForm = page.locator("[data-admin-login]");
check("Secret path shows the sign-in form", (await loginForm.count()) === 1 && (await page.title()) === "Control panel");
check("Page is noindex", (await page.locator('meta[name="robots"]').getAttribute("content"))?.includes("noindex"));
await shot(page, "01-login.png");
await page.locator("#admin-password").fill("definitely-wrong");
await page.getByRole("button", { name: "Sign in" }).click();
await page.locator("[data-admin-error]").waitFor({ timeout: 10_000 });
check("Wrong password is refused with a message", /not right/i.test(await page.locator("[data-admin-error]").innerText()));
await page.locator("#admin-password").fill(password);
await page.getByRole("button", { name: "Sign in" }).click();
await page.locator("[data-leads-table]").waitFor({ timeout: 15_000 });
const cookie = (await context.cookies()).find((c) => c.name === "rmg_admin");
check("Session cookie rmg_admin: HttpOnly, SameSite=Strict, scoped to the secret path", cookie?.httpOnly && cookie.sameSite === "Strict" && cookie.path === `/${cp}`, JSON.stringify({ httpOnly: cookie?.httpOnly, sameSite: cookie?.sameSite, path: cookie?.path }));
check("No other (customer) cookie is set", !(await context.cookies()).some((c) => c.name === "rmg_customer"));
const navText = await page.locator("[data-admin-nav]").innerText();
check("Left nav: Leads active, Orders / Domains / Settings greyed", /Leads/.test(navText) && (await page.locator('[data-admin-nav-item][aria-disabled="true"]').count()) === 3);

// ---- 4. Leads list.
await page.waitForFunction(() => document.querySelectorAll("[data-leads-table] [data-lead-row]").length >= 2, null, { timeout: 15_000 });
const rows = page.locator("[data-leads-table] [data-lead-row]");
check("Exactly two leads: both submissions appear (one per mode); the two picks merged into one lead", (await rows.count()) === 2, `${await rows.count()} rows`);
const firstRow = await rows.nth(0).innerText();
const secondRow = await rows.nth(1).innerText();
check("Newest first (the Reimagine lead was made last)", /reimagine-lead@example.com/.test(firstRow) && /newsite-lead@example.com/.test(secondRow));
check("Reimagine row shows both picked looks and the site", firstRow.includes("(2)") && /morganplumbing/i.test(firstRow), firstRow.replace(/\s+/g, " "));
check("New-site row shows the business, the picked domain and status New", secondRow.includes("Riverside Plumbing") && secondRow.includes(domain) && /New/.test(secondRow), secondRow.replace(/\s+/g, " "));
check("Dates show a Chicago time", /\d{1,2}:\d{2} (AM|PM)/.test(firstRow) && /Chicago/.test(await page.locator("[data-lead-count]").innerText()));
await shot(page, "02-leads-list.png");

// ---- 5. Search + filters.
await page.locator("[data-filter-q]").fill("riverside");
await page.waitForFunction(() => document.querySelectorAll("[data-leads-table] [data-lead-row]").length === 1);
check("Search finds by business name", /newsite-lead/.test(await rows.first().innerText()));
await page.locator("[data-filter-q]").fill("");
await page.locator("[data-filter-mode]").selectOption("reimagine");
await page.locator("[data-leads-table] [data-lead-row]", { hasText: "reimagine-lead@example.com" }).waitFor();
await page.waitForFunction(() => document.querySelectorAll("[data-leads-table] [data-lead-row]").length === 1);
check("Mode filter", /reimagine-lead/.test(await rows.first().innerText()));
await shot(page, "03-filters.png");
await page.locator("[data-filter-mode]").selectOption("");
await page.locator("[data-filter-status]").selectOption("won");
await page.waitForFunction(() => document.querySelectorAll("[data-leads-table] [data-lead-row]").length === 0, null, { timeout: 10_000 });
check("Status filter (nothing is Won yet)", (await rows.count()) === 0);
await page.locator("[data-filter-status]").selectOption("");
await page.waitForFunction(() => document.querySelectorAll("[data-leads-table] [data-lead-row]").length === 2);
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
await page.locator("[data-filter-from]").fill("2099-01-01");
await page.waitForFunction(() => document.querySelectorAll("[data-leads-table] [data-lead-row]").length === 0, null, { timeout: 10_000 });
check("Date filter (from a future date: none)", (await rows.count()) === 0);
await page.locator("[data-filter-from]").fill(today);
await page.locator("[data-filter-to]").fill(today);
await page.waitForFunction(() => document.querySelectorAll("[data-leads-table] [data-lead-row]").length === 2);
check("Date filter (today in Chicago: both)", (await rows.count()) === 2);
await page.locator("[data-filter-from]").fill("");
await page.locator("[data-filter-to]").fill("");
await page.waitForFunction(() => document.querySelectorAll("[data-leads-table] [data-lead-row]").length === 2);

// ---- 6. Detail drawer (Reimagine lead with two picks).
await rows.nth(0).click();
const drawer = page.locator("[data-lead-drawer]");
await drawer.waitFor();
await page.waitForTimeout(2500);
const dtext = await drawer.innerText();
check("Drawer: contact, brief, two picks, all looks, change/utm/ref", /reimagine-lead@example.com/.test(dtext) && (await drawer.locator("[data-pick]").count()) === 2 && (await drawer.locator("[data-look-thumb]").count()) >= 3 && /utm source\s+newsletter/i.test(dtext) && /utm campaign\s+nov-launch/i.test(dtext) && /ref\s+bob/i.test(dtext), `${await drawer.locator("[data-pick]").count()} picks, ${await drawer.locator("[data-look-thumb]").count()} thumbs`);
check("Drawer: Formcarry + reply webhook status recorded per pick", /Formcarry: sent 200/.test(dtext) && /Reply webhook: (sent|failed|skipped)/.test(dtext), dtext.match(/Formcarry: [^\n]*/)?.[0]);
await shot(page, "04-detail-drawer.png");
await drawer.locator("[data-status='contacted']").click();
await page.waitForFunction(() => document.querySelector("[data-status='contacted']")?.getAttribute("aria-pressed") === "true");
await drawer.locator("[data-note-input]").fill("Called Bob, wants a quote for the redesign.");
await drawer.locator("[data-note-save]").click();
await drawer.locator("[data-notes] li").first().waitFor();
check("Status changed to Contacted and a note was added", /Called Bob/.test(await drawer.locator("[data-notes]").innerText()));
await shot(page, "05-status-note.png");
await page.locator("[data-drawer-close]").click();
check("Row shows the new status", /Contacted/.test(await rows.nth(0).innerText()));
await page.reload({ waitUntil: "networkidle" });
await page.locator("[data-leads-table] [data-lead-row]").first().waitFor();
check("Status and note survive a reload (stored server-side)", /Contacted/.test(await page.locator("[data-leads-table] [data-lead-row]").first().innerText()));
await page.locator("[data-filter-status]").selectOption("contacted");
await page.waitForFunction(() => document.querySelectorAll("[data-leads-table] [data-lead-row]").length === 1);
await page.locator("[data-filter-status]").selectOption("");
await page.waitForFunction(() => document.querySelectorAll("[data-leads-table] [data-lead-row]").length === 2);

// ---- 7. New-site lead drawer.
await page.locator("[data-leads-table] [data-lead-row]").nth(1).click();
await page.locator("[data-lead-drawer]").waitFor();
await page.waitForTimeout(1500);
const ns = await page.locator("[data-lead-drawer]").innerText();
check("New-site drawer: business, area, domain picked-not-registered, no hidden fields", /Riverside Plumbing/.test(ns) && /Tulsa/.test(ns) && ns.includes(domain) && /not registered/i.test(ns));
await shot(page, "06-detail-newsite.png");
await page.locator("[data-drawer-close]").click();

// ---- 8. CSV export (uses the session cookie).
const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-admin-csv]").click()]);
const csvPath = join(outDir, "leads-export.csv");
await download.saveAs(csvPath);
const csv = (await import("node:fs")).readFileSync(csvPath, "utf8");
const csvLines = csv.replace(/^\uFEFF/, "").trim().split(/\r\n/);
check("CSV export: header + 2 leads, with the picked domain, both looks and the Chicago time", csvLines.length === 3 && csv.includes(domain) && csvLines[0].startsWith("id,created_at_chicago") && /newsite-lead/.test(csv) && /Contacted|contacted/.test(csv), `${csvLines.length - 1} rows, file ${download.suggestedFilename()}`);

// ---- 9. Phone layout.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
await shot(page, "07-phone-list.png");
const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
check("Phone: no sideways scroll on the leads list", noOverflow);
await page.locator("[data-leads-cards] [data-lead-row]").first().click();
await page.locator("[data-lead-drawer]").waitFor();
await page.waitForTimeout(1500);
await shot(page, "08-phone-drawer.png");
const box = await page.locator("[data-lead-drawer]").boundingBox();
check("Phone: drawer fills the width", box && box.width <= 391 && box.x >= -1, JSON.stringify(box));
await page.locator("[data-drawer-close]").click();
await page.setViewportSize({ width: 1400, height: 950 });

// ---- 10. Sign out ends the session.
await page.locator("[data-admin-signout]:visible").first().click();
await page.locator("[data-admin-login]").waitFor({ timeout: 10_000 });
const after = await page.evaluate(async (path) => (await fetch(`/${path}/api/leads`, { credentials: "same-origin" })).status, cp);
check("After sign out the API is refused again", after === 401, `${after}`);
await shot(page, "09-signed-out.png");

// ---- 11. Brute force lockout.
let last = 0;
for (let i = 0; i < 7; i++) {
  last = (await fetch(`${base}/${cp}/api/login`, { method: "POST", headers: { "x-rmg-admin": "1", "content-type": "application/json" }, body: JSON.stringify({ password: `wrong-${i}` }) })).status;
}
check("Login is rate limited after repeated wrong passwords (429)", last === 429, `${last}`);

await browser.close();
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ base, checks }, null, 2));
const failed = checks.filter((c) => !c.pass).length;
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
