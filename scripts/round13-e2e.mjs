#!/usr/bin/env node
/**
 * Round 13 E2E — Jason's test: "not enough public text" never dead-ends, period looks, no public Cursor hand-off,
 * honest "check your email", reply status in the admin list.
 *
 *   ADMIN_PATH=cp-e2e-7f3a9c1d5b2e ADMIN_PASSWORD=e2e-pass-123456 PREVIEW_MOCK=1 REPLY_WEBHOOK_URL=http://localhost:9998/hook REPLY_WEBHOOK_KEY=test-key npm run dev -- --port 8090
 *   MOCK_WEBHOOK_PORT=9998 EXPECT_AUTH="Bearer test-key" node scripts/mock-reply-webhook.mjs
 *   ADMIN_PATH=... ADMIN_PASSWORD=... APP_URL=http://localhost:8090 node scripts/round13-e2e.mjs /workspace/live-preview-shots/round13
 *
 * PREVIEW_MOCK=1 also serves the *.fixture.test sites in scripts/fixtures/sites (a blank JS shell, a Next.js shell with its
 * copy in __NEXT_DATA__, a Wix-like shell whose text is only in sitemap pages, a 1990s table site, a 403). Formcarry is intercepted.
 * Real-site checks (spacejam.com/1996 was a dead end before) run when REAL_SITES=1.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const outDir = process.argv[2] ?? "live-preview-shots/round13";
const base = process.env.APP_URL ?? "http://localhost:8090";
const cp = process.env.ADMIN_PATH;
const password = process.env.ADMIN_PASSWORD;
const WEBHOOK = process.env.WEBHOOK_STATE ?? "ok"; // ok | missing | failing (how the dev server was started)
const ONLY_THANKS = process.env.ONLY_THANKS === "1";
const JASON = "make this site look like it is from the late 90s or early 2000s";
mkdirSync(outDir, { recursive: true });
const checks = [];
const check = (name, pass, detail = "") => { checks.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await context.route("**/formcarry.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"code":200}' }));

async function openForm() {
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator('[data-mode="reimagine"]').click();
  return page;
}
async function fill(page, url, notes = "") {
  await page.locator("#site-url").fill(url);
  await page.locator("#site-email").fill("e2e-test@example.com");
  await page.locator("#site-notes").fill(notes);
  const box = page.locator('input[type="checkbox"]').filter({ hasNot: page.locator("[name]") }).last();
  if (!(await box.isChecked())) await box.check();
}
const submit = (page) => page.getByRole("button", { name: /Reimagine my site/i }).click();
async function waitLooks(page) {
  await page.locator("[data-look]").nth(2).waitFor({ timeout: 300_000 });
  await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 120_000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
}
const lookIds = (page) => page.locator("[data-look]").evaluateAll((els) => els.map((e) => e.getAttribute("data-look")));
const bodyOf = async (id) => (await fetch(`${base}/made/${id}`)).text();
const bodyClass = (html) => html.match(/<body[^>]*class="([^"]*)"/i)?.[1] ?? "";

if (!ONLY_THANKS) {
// ---- 1. Jason's exact request on a blank JS shell: no error, looks built from the request, soft notice, period looks.
{
  const page = await openForm();
  await fill(page, "https://blank-shell.fixture.test", JASON);
  await submit(page);
  await waitLooks(page);
  const text = await page.locator("body").innerText();
  check("Jason's request on a no-text site builds three looks (no dead end)", (await page.locator("[data-look]").count()) >= 3);
  check("It never says 'did not include enough public text'", !/did not (include|have) enough public text/i.test(text));
  check("A soft notice explains the site had little text", /very little text we can read/i.test(text));
  const ids = await lookIds(page);
  const classes = [];
  for (const id of ids.slice(0, 3)) classes.push(bodyClass(await bodyOf(id)));
  check("All three looks are period looks (era-web90s), each a different variant", classes.every((c) => /\bera-web90s\b/.test(c)) && new Set(classes.map((c) => c.match(/ev-\d/)?.[0])).size === 3, classes.map((c) => c.match(/era-\S+ ev-\d/)?.[0]).join(" | "));
  const css = await bodyOf(ids[0]);
  check("The period stylesheet is in the page (system fonts, bevel buttons, ridged borders)", /Times New Roman/.test(css) && /outset/.test(css) && /ridge/.test(css));
  await page.locator("[data-look]").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(outDir, "01-jason-late-90s-three-looks.png") });
  for (let i = 0; i < 3; i += 1) {
    const p2 = await context.newPage();
    await p2.setViewportSize({ width: 1280, height: 900 });
    await p2.goto(`${base}/made/${ids[i]}`, { waitUntil: "networkidle" });
    await p2.screenshot({ path: join(outDir, `02-era-look-${i + 1}.png`) });
    await p2.close();
  }
  await page.close();
}

// ---- 2. No text and no note: an inline "Tell us a bit about the business" field, not an error.
{
  const page = await openForm();
  await fill(page, "https://blank-shell.fixture.test", "");
  await submit(page);
  await page.locator('[data-recovery="thin"]').waitFor({ timeout: 60_000 });
  check("No text + no note shows the inline 'Tell us a bit about the business' field", /Tell us a bit about the business/.test(await page.locator('[data-recovery="thin"]').innerText()));
  check("The form stays editable (URL still there)", (await page.locator("#site-url").inputValue()).includes("blank-shell"));
  await page.screenshot({ path: join(outDir, "03-tell-us-a-bit-field.png") });
  await page.locator("#site-details").fill("Neighborhood bakery in Tulsa known for cinnamon rolls and sourdough.");
  await page.locator("[data-recovery-build]").click();
  await waitLooks(page);
  check("Building from the typed sentence works", (await page.locator("[data-look]").count()) >= 3);
  const usedIds = await lookIds(page);
  check("The typed sentence is used on the looks", /bakery|cinnamon|sourdough/i.test(await bodyOf(usedIds[0])));
  await page.screenshot({ path: join(outDir, "04-built-from-details.png") });
  await page.close();
}

// ---- 3. Skip: just the site's photos and colors.
{
  const page = await openForm();
  await fill(page, "https://blank-shell.fixture.test", "");
  await submit(page);
  await page.locator('[data-recovery="thin"]').waitFor({ timeout: 60_000 });
  await page.locator("[data-recovery-skip]").click();
  await waitLooks(page);
  check("'Skip: just use the site's photos and colors' builds looks", (await page.locator("[data-look]").count()) >= 3);
  check("…with the soft notice", /only its photos, colors and logo/i.test(await page.locator("body").innerText()));
  await page.close();
}

// ---- 4. Unreadable site (403): 'Build from your note instead'.
{
  const page = await openForm();
  await fill(page, "https://status403.fixture.test", "");
  await submit(page);
  await page.locator('[data-recovery="unreadable"]').waitFor({ timeout: 60_000 });
  const err = await page.locator('[role="alert"]').first().innerText();
  check("A blocked site shows its error plus 'Build from your note instead'", /403/.test(err) && /Build from your note instead/.test(await page.locator('[data-recovery="unreadable"]').innerText()), err.slice(0, 80));
  await page.screenshot({ path: join(outDir, "05-build-from-note-instead.png") });
  await page.locator("[data-recovery-build]").click();
  await page.getByText(/Tell us a bit about the business \(a sentence is plenty\)/).first().waitFor({ timeout: 10_000 });
  check("With no note and no sentence it asks for one instead of building from nothing", true);
  await page.locator("#site-details").fill("Dave's Auto Repair in Tulsa, brakes, oil changes and tune-ups since 1988.");
  await page.locator("[data-recovery-build]").click();
  await waitLooks(page);
  const text = await page.locator("body").innerText();
  check("Note-only build gives three looks and says so", (await page.locator("[data-look]").count()) >= 3 && /couldn't read/i.test(text));
  await page.close();
}
{
  const page = await openForm();
  await fill(page, "https://status403.fixture.test", JASON);
  await submit(page);
  await page.locator('[data-recovery="unreadable"]').waitFor({ timeout: 60_000 });
  await page.locator("[data-recovery-build]").click();
  await waitLooks(page);
  const ids = await lookIds(page);
  check("Blocked site + Jason's request: 'Build from your note instead' works with the note alone, as period looks", /\bera-web90s\b/.test(bodyClass(await bodyOf(ids[0]))), `${ids.length} looks; ${bodyClass(await bodyOf(ids[0]))}`);
  await page.close();
}

// ---- 5. Unknown domain keeps its friendly error and also offers the note path.
{
  const page = await openForm();
  await fill(page, "https://this-domain-does-not-exist-reimago-e2e-4821.com/", "Make it bolder");
  await submit(page);
  await page.locator('[data-recovery="unreachable"]').waitFor({ timeout: 30_000 });
  check("A domain that doesn't exist: friendly error + note option", /couldn't find/i.test(await page.locator('[role="alert"]').first().innerText()));
  await page.close();
}

// ---- 6. Sites that used to fail now read: Next.js shell (copy in __NEXT_DATA__), Wix-like (sitemap pages), 1990s table.
for (const [host, what] of [["js-shell", /Gentle family dentistry|Harbor Light Dental/i], ["wix-like", /Riverbend Yoga/i], ["oldtable", /Dave\W?s Auto Repair|fixed cars/i]]) {
  const page = await openForm();
  await fill(page, `https://${host}.fixture.test`, "");
  await submit(page);
  await waitLooks(page);
  const text = await page.locator("body").innerText();
  const html = await bodyOf((await lookIds(page))[0]);
  check(`${host}: builds without asking for help, no thin-site notice, and uses its real text`, (await page.locator("[data-look]").count()) >= 3 && !(await page.locator("[data-recovery]").count()) && !/very little text/i.test(text) && what.test(html), what.toString());
  if (host === "js-shell") await page.screenshot({ path: join(outDir, "06-nextjs-shell-read.png") });
  await page.close();
}

}
// ---- 7. Honest thank-you (webhook answers 200 in this run) + the admin list.
{
  const page = await openForm();
  await fill(page, "https://oldtable.fixture.test", JASON);
  await submit(page);
  await waitLooks(page);
  await page.locator("[data-look]").first().getByRole("button", { name: /^Choose this look$/ }).click();
  await page.locator("[data-sent-heading]").waitFor({ timeout: 120_000 });
  const heading = await page.locator("[data-sent-heading]").getAttribute("data-sent-heading");
  if (WEBHOOK === "ok") check("Webhook answered 2xx → 'Sent! Check your email.'", heading === "email" && /Check your email/.test(await page.locator("[data-sent-heading]").innerText()));
  else check(`Webhook ${WEBHOOK} → honest 'Got it! We'll email you shortly.' (never 'check your email')`, heading === "shortly" && /email you shortly/.test(await page.locator("[data-sent-heading]").innerText()) && !/Check your email/.test(await page.locator("body").innerText()), heading ?? "");
  await page.screenshot({ path: join(outDir, `07-thanks-${WEBHOOK}.png`) });
  const text = await page.locator("body").innerText();
  check("No 'Hand off to Cursor' / 'Send to Cursor' anywhere for the public", !/Hand off to Cursor|Send to Cursor/i.test(text));
  await page.close();
}
if (cp && password) {
  const api = async (path, init = {}, cookie = "") => {
    const r = await fetch(`${base}/${cp}/api/${path}`, { ...init, headers: { "content-type": "application/json", "x-rmg-admin": "1", ...(cookie ? { cookie } : {}) } , redirect: "manual" });
    return { status: r.status, json: await r.json().catch(() => ({})), cookie: r.headers.get("set-cookie") ?? "" };
  };
  const body = JSON.stringify({ host: "x.com", previewUrl: "https://x.com/made/abc", pages: ["Home: https://x.com/made/abc"] });
  const anon = await api("cursor-handoff", { method: "POST", body });
  check("Cursor hand-off without an admin session is refused (401)", anon.status === 401, `${anon.status}`);
  const login = await api("login", { method: "POST", body: JSON.stringify({ password }) });
  const cookie = (login.cookie.match(/rmg_admin=[^;]+/) ?? [""])[0];
  check("Admin login works", login.status === 200 && cookie.startsWith("rmg_admin="));
  const first = await api("cursor-handoff", { method: "POST", body }, cookie);
  check("With the admin session the hand-off route answers (no CURSOR_API_KEY → a clear 'not set' result, nothing launched)", first.status === 200 && first.json.ok === false && /CURSOR_API_KEY/.test(first.json.error ?? ""), JSON.stringify(first.json).slice(0, 120));
  let last = first;
  for (let i = 0; i < 6; i += 1) last = await api("cursor-handoff", { method: "POST", body }, cookie);
  check("It is rate limited (429 after 5 an hour)", last.status === 429, `${last.status}`);
  const listed = await api("leads", {}, cookie);
  check("Leads API reports the reply webhook state", listed.json.reply_webhook?.configured === (WEBHOOK !== "missing"), JSON.stringify(listed.json.reply_webhook));
  const pg = await context.newPage();
  await pg.goto(`${base}/${cp}`, { waitUntil: "networkidle" });
  await pg.locator('input[type="password"]').fill(password);
  await pg.getByRole("button", { name: /sign in/i }).click();
  await pg.locator("[data-leads-table]").waitFor({ timeout: 30_000 });
  const row = pg.locator("[data-lead-row]").first();
  await row.waitFor();
  const kind = { ok: "sent", missing: "skipped", failing: "failed" }[WEBHOOK];
  check(`Admin Leads list has a 'Reply email' column showing ${kind}`, (await pg.locator("[data-leads-table] th", { hasText: "Reply email" }).count()) === 1 && (await pg.locator(`[data-reply-status="${kind}"]`).count()) >= 1);
  check(WEBHOOK === "missing" ? "Admin banner says reply emails are OFF when REPLY_WEBHOOK_* is unset" : "No 'reply emails are OFF' banner when the webhook is set", (await pg.locator("[data-admin-webhook-warning]").count()) === (WEBHOOK === "missing" ? 1 : 0));
  await pg.screenshot({ path: join(outDir, `08-admin-leads-reply-column-${WEBHOOK}.png`) });
  await pg.setViewportSize({ width: 390, height: 844 });
  await pg.reload({ waitUntil: "networkidle" });
  await pg.screenshot({ path: join(outDir, `09-admin-leads-phone-${WEBHOOK}.png`) });
  await pg.close();
}

if (process.env.REAL_SITES === "1" && !ONLY_THANKS) {
  const page = await openForm();
  await fill(page, "https://www.spacejam.com/1996/", "");
  await submit(page);
  await waitLooks(page);
  check("Real 1996 table-based site (spacejam.com/1996, a dead end before) builds three looks", (await page.locator("[data-look]").count()) >= 3);
  await page.screenshot({ path: join(outDir, "10-real-spacejam-1996.png") });
  await page.close();
}

await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
