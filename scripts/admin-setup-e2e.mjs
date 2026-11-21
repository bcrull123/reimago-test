#!/usr/bin/env node
/**
 * Round 12b E2E — first-run /setup, save-this screen, change password, path regenerate,
 * /setup becomes 404, memory-store refusal, and env ADMIN_* still taking precedence.
 *
 * Start a fresh Postgres-protocol database (pglite-socket is fine) and three dev servers:
 *
 *   # 1. unclaimed (DATABASE_URL, no ADMIN_*):
 *   DATABASE_URL=... node scripts/with-app-env.mjs vite dev --host 0.0.0.0 --port 8092
 *
 *   # 2. memory (no DATABASE_URL, no ADMIN_*):
 *   node scripts/with-app-env.mjs vite dev --host 0.0.0.0 --port 8093
 *
 *   # 3. env override (same DATABASE_URL + ADMIN_PATH + ADMIN_PASSWORD), started AFTER setup has claimed:
 *   DATABASE_URL=... ADMIN_PATH=cp-env-12b-override-xx ADMIN_PASSWORD=env-password-12b \
 *     node scripts/with-app-env.mjs vite dev --host 0.0.0.0 --port 8094
 *
 *   SETUP_URL=http://localhost:8092 MEMORY_URL=http://localhost:8093 ENV_URL=http://localhost:8094 \
 *     ENV_ADMIN_PATH=cp-env-12b-override-xx ENV_ADMIN_PASSWORD=env-password-12b \
 *     node scripts/admin-setup-e2e.mjs /workspace/live-preview-shots/round12b
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const outDir = process.argv[2] ?? "live-preview-shots/round12b";
const setupBase = process.env.SETUP_URL ?? "http://localhost:8092";
const memoryBase = process.env.MEMORY_URL ?? "http://localhost:8093";
const envBase = process.env.ENV_URL ?? "http://localhost:8094";
const envPath = process.env.ENV_ADMIN_PATH ?? "cp-env-12b-override-xx";
const envPassword = process.env.ENV_ADMIN_PASSWORD ?? "env-password-12b";
const email = "owner@example.com";
const password = "setup-password-12b";
const nextPassword = "changed-password-12b";
mkdirSync(outDir, { recursive: true });
const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const shot = (page, name) => page.screenshot({ path: join(outDir, name), fullPage: true });
const get = async (base, path, init) => {
  const r = await fetch(`${base}${path}`, { redirect: "manual", ...init });
  return { status: r.status, text: await r.text(), headers: r.headers };
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await context.newPage();

// ---- 1. Unclaimed install: /setup is the form; /admin is the normal 404.
const plain404 = await get(setupBase, "/zzz-nothing-here");
const admin404 = await get(setupBase, "/admin");
const setupPage = await get(setupBase, "/setup");
check("/admin is the normal 404 on an unclaimed install", admin404.status === 404 && !/Control panel|Set up your control panel/i.test(admin404.text.replace(/<script[\s\S]*?<\/script>/g, "")));
check("/setup is available and noindex", setupPage.status === 200 && /Set up your control panel/.test(setupPage.text) && /noindex/.test(setupPage.text), `status ${setupPage.status}`);
check("A random path is still the normal 404", plain404.status === 404);

await page.goto(`${setupBase}/setup`, { waitUntil: "networkidle" });
check("Setup form: email, password, confirm, optional brand", (await page.locator("[data-setup-form]").count()) === 1 && (await page.locator("#setup-email").count()) === 1 && (await page.locator("#setup-password").count()) === 1 && (await page.locator("[data-setup-brand]").count()) === 1);
check("SETUP_CODE field is hidden when the env is unset", (await page.locator("#setup-code").count()) === 0);
await shot(page, "01-setup.png");

await page.locator("#setup-email").fill(email);
await page.locator("#setup-password").fill("short");
await page.locator("#setup-confirm").fill("short");
await page.locator("[data-setup-submit]").click();
await page.locator("[data-setup-error]").waitFor({ timeout: 10_000 });
check("Short password is refused with a message", /at least 10/i.test(await page.locator("[data-setup-error]").innerText()));

await page.locator("#setup-password").fill(password);
await page.locator("#setup-confirm").fill("does-not-match-12");
await page.locator("[data-setup-submit]").click();
await page.locator("[data-setup-error]").waitFor({ timeout: 10_000 });
check("Mismatched passwords are refused", /do not match/i.test(await page.locator("[data-setup-error]").innerText()));

await page.locator("#setup-confirm").fill(password);
await page.locator("[data-setup-submit]").click();
await page.locator("[data-setup-save]").waitFor({ timeout: 20_000 });
const adminUrl = (await page.locator("[data-admin-url]").innerText()).trim();
const adminPath = new URL(adminUrl).pathname.replace(/^\//, "");
check("Save-this screen shows the full admin URL (cp- + random)", /^cp-[a-f0-9]{32}$/.test(adminPath) && adminUrl.startsWith(setupBase), adminUrl);
check("Save-this screen has a Copy button and a note to bookmark", (await page.locator("[data-copy-admin-url]").count()) === 1 && /bookmark/i.test(await page.locator("body").innerText()));
await shot(page, "02-save-this.png");

// A second claim (from another tab / API) is a 404.
const second = await get(setupBase, "/setup/api", {
  method: "POST",
  headers: { "content-type": "application/json", "x-rmg-admin": "1" },
  body: JSON.stringify({ email: "other@example.com", password: "another-password-12", confirm: "another-password-12" }),
});
check("A second setup submit is a 404 (first claim wins)", second.status === 404, `${second.status}`);

const openHref = await page.locator("[data-open-admin]").getAttribute("href");
check("Open control panel link points at the new address", openHref === adminUrl, openHref ?? "");
await page.goto(adminUrl, { waitUntil: "networkidle" });
await page.locator("[data-admin-nav]").waitFor({ timeout: 15_000 });
check("Opening the control panel from the save screen signs the owner in", (await page.locator("[data-admin-login]").count()) === 0 && (await page.locator("[data-leads-table], [data-leads-empty]").count()) >= 1);
const cookie = (await context.cookies()).find((c) => c.name === "rmg_admin");
check("Session cookie rmg_admin is scoped to the generated path", cookie?.httpOnly && cookie.path === `/${adminPath}`, JSON.stringify({ path: cookie?.path, httpOnly: cookie?.httpOnly, sameSite: cookie?.sameSite }));

// ---- 2. Settings: change password, then regenerate the path.
await page.locator('[data-admin-nav-item="settings"]').click();
await page.locator("[data-admin-settings]").waitFor();
check("Settings shows the admin address and a change-password form", (await page.locator("[data-admin-url]").innerText()).includes(adminPath) && (await page.locator("[data-change-password]").count()) === 1);
check("Settings does not show an env-override banner (this install used /setup)", (await page.locator("[data-env-override]").count()) === 0);
await shot(page, "03-settings.png");

await page.locator("[data-pw-current]").fill("wrong-current-password");
await page.locator("[data-pw-next]").fill(nextPassword);
await page.locator("[data-pw-confirm]").fill(nextPassword);
await page.locator("[data-pw-save]").click();
await page.locator("[data-settings-error], [data-pw-ok]").waitFor({ timeout: 10_000 });
check("Wrong current password is refused", /current password is not right/i.test((await page.locator("[data-settings-error]").innerText().catch(() => ""))));

await page.locator("[data-pw-current]").fill(password);
await page.locator("[data-pw-next]").fill(nextPassword);
await page.locator("[data-pw-confirm]").fill(nextPassword);
await page.locator("[data-pw-save]").click();
await page.locator("[data-pw-ok]").waitFor({ timeout: 10_000 });
check("Password is changed", /Password saved/i.test(await page.locator("[data-pw-ok]").innerText()));
await shot(page, "04-password-changed.png");

await page.locator("[data-admin-signout]:visible").first().click();
await page.locator("[data-admin-login]").waitFor({ timeout: 10_000 });
await page.locator("#admin-password").fill(password);
await page.getByRole("button", { name: "Sign in" }).click();
await page.locator("[data-admin-error]").waitFor({ timeout: 10_000 });
check("The old password no longer signs in", /not right/i.test(await page.locator("[data-admin-error]").innerText()));
await page.locator("#admin-password").fill(nextPassword);
await page.getByRole("button", { name: "Sign in" }).click();
await page.locator("[data-admin-nav]").waitFor({ timeout: 15_000 });
check("The new password signs in", (await page.locator("[data-admin-login]").count()) === 0);

await page.locator('[data-admin-nav-item="settings"]').click();
await page.locator("[data-regen-start]").click();
await page.locator("[data-regen-confirm]").waitFor();
await page.locator("[data-regen-path]").click();
await page.locator("[data-open-admin]").waitFor({ timeout: 10_000 });
const newUrl = (await page.locator("[data-admin-url]").innerText()).trim();
const newPath = new URL(newUrl).pathname.replace(/^\//, "");
check("A new admin path is generated and shown to copy", newPath !== adminPath && /^cp-[a-f0-9]{32}$/.test(newPath), `${adminPath} -> ${newPath}`);
await shot(page, "05-new-path.png");
await page.locator("[data-open-admin]").click();
await page.locator("[data-admin-nav]").waitFor({ timeout: 15_000 });
check("The new address works (still signed in)", new URL(page.url()).pathname.replace(/\/$/, "").endsWith(newPath));
const oldPath = await get(setupBase, `/${adminPath}`);
check("The previous admin path is now the normal 404", oldPath.status === 404, `${oldPath.status}`);

const setupAfter = await get(setupBase, "/setup");
check("/setup is the normal 404 after the install is claimed", setupAfter.status === 404 && !/Set up your control panel/.test(setupAfter.text.replace(/<script[\s\S]*?<\/script>/g, "")), `status ${setupAfter.status}`);
await page.goto(`${setupBase}/setup`, { waitUntil: "networkidle" });
await shot(page, "06-setup-claimed-404.png");

// ---- 3. Memory store: /setup refuses to create a password.
await page.goto(`${memoryBase}/setup`, { waitUntil: "networkidle" });
await page.locator("[data-setup-no-store]").waitFor({ timeout: 15_000 });
check("Without DATABASE_URL, /setup refuses with a clear 'needs a database' message", /DATABASE_URL/i.test(await page.locator("[data-setup-no-store]").innerText()) && (await page.locator("[data-setup-form]").count()) === 0);
await shot(page, "07-no-store.png");
const memClaim = await get(memoryBase, "/setup/api", {
  method: "POST",
  headers: { "content-type": "application/json", "x-rmg-admin": "1" },
  body: JSON.stringify({ email, password, confirm: password }),
});
check("A memory-store setup POST does not create a login", memClaim.status === 400 && /DATABASE_URL|database/i.test(memClaim.text), `${memClaim.status} ${memClaim.text.slice(0, 120)}`);

// ---- 4. Env override: /setup 404, env login works, the in-app path does not, Settings explains the override.
const envSetup = await get(envBase, "/setup");
check("When ADMIN_PATH and ADMIN_PASSWORD are set, /setup is the normal 404", envSetup.status === 404 && !/Set up your control panel/.test(envSetup.text.replace(/<script[\s\S]*?<\/script>/g, "")));
const dbPathOnEnv = await get(envBase, `/${newPath}`);
check("The in-app admin path is 404 while env is set (env path takes precedence)", dbPathOnEnv.status === 404, `${dbPathOnEnv.status}`);

const envCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const envPage = await envCtx.newPage();
await envPage.goto(`${envBase}/${envPath}`, { waitUntil: "networkidle" });
await envPage.locator("[data-admin-login]").waitFor({ timeout: 15_000 });
await envPage.locator("#admin-password").fill(nextPassword);
await envPage.getByRole("button", { name: "Sign in" }).click();
await envPage.locator("[data-admin-error]").waitFor({ timeout: 10_000 });
check("The in-app password does not sign in when env ADMIN_PASSWORD is set", /not right/i.test(await envPage.locator("[data-admin-error]").innerText()));
await envPage.locator("#admin-password").fill(envPassword);
await envPage.getByRole("button", { name: "Sign in" }).click();
await envPage.locator("[data-admin-nav]").waitFor({ timeout: 15_000 });
check("The env password still signs in at the env ADMIN_PATH", (await envPage.locator("[data-admin-login]").count()) === 0);
await envPage.locator('[data-admin-nav-item="settings"]').click();
await envPage.locator("[data-env-override]").waitFor({ timeout: 10_000 });
check("Settings explains that env takes priority and hides change-password", /ADMIN_PASSWORD/.test(await envPage.locator("[data-env-override]").innerText()) && (await envPage.locator("[data-change-password]").count()) === 0);
await shot(envPage, "08-env-override.png");
await envPage.close();
await envCtx.close();

await browser.close();
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ setupBase, memoryBase, envBase, adminPath, newPath, checks }, null, 2));
const failed = checks.filter((c) => !c.pass).length;
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
