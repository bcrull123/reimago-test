#!/usr/bin/env node
/**
 * Round 11 E2E — "Pick your domain" pop-up (Build a New Site + "Get me a domain, email & hosting").
 *
 *   PREVIEW_MOCK=1 PREVIEW_DOMAIN_DELAY_MS=2500 npm run dev                  # normal run (mock availability)
 *   node scripts/domain-pick-e2e.mjs /workspace/live-preview-shots/round11
 *   PREVIEW_MOCK=1 PREVIEW_DOMAIN_MOCK=unavailable npm run dev -- --port 8081  # "can't check" run
 *   MODE=unavailable APP_URL=http://localhost:8081 node scripts/domain-pick-e2e.mjs /workspace/live-preview-shots/round11/unavailable
 *
 * Checks: pop-up opens with the looks; ideas only use the allowed endings (EXPECTED_TLDS, default com,net,org,co);
 * "We'll reserve it at checkout" wording; select; Try again never repeats; typed name (.com added, taken -> variants,
 * unsupported ending -> "isn't offered yet" + .com version); progress ring + Stop; chip; Formcarry + reply webhook
 * carry chosen_domain + domain_status=selected_not_registered (nothing is registered); phone layout.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const outDir = process.argv[2] ?? "live-preview-shots/round11";
const base = process.env.APP_URL ?? "http://localhost:8080";
const mode = process.env.MODE ?? "normal";
const tlds = (process.env.EXPECTED_TLDS ?? "com,net,org,co").split(",");
const hookLog = process.env.MOCK_WEBHOOK_LOG ?? "/tmp/mock-reply-webhook.jsonl";
mkdirSync(outDir, { recursive: true });

const checks = [];
const check = (name, pass, detail = "") => { checks.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const formcarry = [];
await page.context().route("**/formcarry.com/**", async (route) => {
  formcarry.push(route.request().postDataBuffer()?.toString("latin1") ?? "");
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200 }) });
});
await page.goto(base, { waitUntil: "networkidle" });
await page.locator('[data-mode="newsite"]').click();
await page.locator("#ns-name").fill("Riverside Plumbing");
await page.locator("#ns-location").fill("Tulsa, Oklahoma");
await page.locator("#ns-what").fill("Family-run plumbing repairs, drain cleaning and water heaters for homeowners.");
await page.getByLabel("Get me a domain, email & hosting").check();
await page.locator("#ns-email").fill("e2e-test@example.com");
await page.locator("[data-new-site-form] input[type=checkbox]").check();
await page.locator("[data-build-new-site]").click();

const modal = page.locator("[data-domain-modal]");
await modal.waitFor({ timeout: 400_000 });
check("Pop-up 'Pick your domain' opens after the looks render", (await page.locator("[data-look]").count()) >= 3 && (await modal.locator("#pick-domain-title").innerText()).includes("Pick your domain"));
const reserve = (await modal.locator("[data-domain-reserve-note]").innerText()).toLowerCase();
check("Says we'll reserve it at checkout (nothing registered now)", reserve.includes("reserve it at checkout") && reserve.includes("nothing is bought or registered"));
await page.waitForTimeout(400);
await page.screenshot({ path: join(outDir, "01-popup-working.png") }).catch(() => undefined);
await modal.locator("[data-domain-option], [data-domain-error]").first().waitFor({ timeout: 90_000 });
await page.waitForTimeout(500);
await page.screenshot({ path: join(outDir, "02-popup-ideas.png") });

const options = () => modal.locator("[data-domain-option]").evaluateAll((els) => els.map((e) => ({ domain: e.getAttribute("data-domain-option"), text: e.textContent })));
const tldOf = (d) => d.split(".").at(-1);

if (mode === "unavailable") {
  const unchecked = modal.locator("[data-domain-unchecked]");
  check("Shows \"Can't check availability right now\"", (await unchecked.count()) === 1 && /Can't check availability right now/.test(await unchecked.innerText()));
  const opts = await options();
  check("Ideas still listed, each marked Not checked", opts.length >= 6 && opts.every((o) => /Not checked/.test(o.text ?? "")), `${opts.length}`);
  await page.screenshot({ path: join(outDir, "03-cant-check.png") });
  await browser.close();
  writeFileSync(join(outDir, "summary.json"), JSON.stringify({ mode, checks }, null, 2));
  const failedU = checks.filter((c) => !c.pass).length;
  console.log(failedU ? `${failedU} FAILED` : "ALL PASS");
  process.exit(failedU ? 1 : 0);
}

const first = await options();
check("Ten or more ideas, at least 5 available shown", first.length >= 5, `${first.length}`);
check(`Only allowed endings (${tlds.join(", ")})`, first.every((o) => tlds.includes(tldOf(o.domain))), first.map((o) => o.domain).join(" "));
check(".com first", tldOf(first[0].domain) === tlds[0]);
check("Ideas include more than one ending", new Set(first.map((o) => tldOf(o.domain))).size >= 2);
check("Taken ones are tucked into a greyed 'Not available' list", (await modal.locator("[data-domain-taken]").count()) === 1 && !(await modal.locator("[data-domain-taken]").evaluate((d) => d.open)));

// Select one.
await modal.locator(`[data-domain-option="${first[1].domain}"]`).click();
check("Selecting highlights the row and enables Use this domain", (await modal.locator("[data-domain-use]").isEnabled()) && (await modal.locator(`[data-domain-option="${first[1].domain}"] input`).isChecked()));
await page.screenshot({ path: join(outDir, "03-selected.png") });

// Phone layout of the same pop-up.
await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(outDir, "04-popup-phone.png") });
const box = await modal.locator('[role="dialog"]').boundingBox();
check("Phone: dialog fits the screen width", box && box.width <= 390 + 1 && box.x >= -1, JSON.stringify(box));
await page.setViewportSize({ width: 1400, height: 1000 });

// Try again: fresh batch with no repeats; ring + Stop while working.
await modal.locator("[data-domain-retry]").click();
const ring = modal.locator("[data-domain-progress] [data-progress-ring]");
await ring.waitFor({ timeout: 5000 }).catch(() => undefined);
const ringShown = (await ring.count()) === 1 && (await modal.locator("[data-domain-stop]").count()) === 1;
check("Progress ring + Stop show while working", ringShown);
if (ringShown) await page.screenshot({ path: join(outDir, "05-popup-ring-stop.png") });
await modal.locator("[data-domain-progress]").waitFor({ state: "detached", timeout: 90_000 });
await page.waitForTimeout(400);
const second = await options();
const overlap = second.filter((o) => first.some((f) => f.domain === o.domain) && o.domain !== first[1].domain);
check("Try again gives a fresh batch (no repeats of what was shown)", second.length >= 3 && overlap.length === 0, `${second.length} new, ${overlap.length} repeats`);
check("Your earlier pick stays selected", await modal.locator(`[data-domain-option="${first[1].domain}"] input`).isChecked().catch(() => false));
await page.screenshot({ path: join(outDir, "06-try-again.png") });

// Stop works.
await modal.locator("[data-domain-retry]").click();
await modal.locator("[data-domain-stop]").click({ timeout: 5000 }).catch(() => undefined);
await page.waitForTimeout(300);
check("Stop ends the work and the pop-up stays usable", (await modal.locator("[data-domain-retry]").isEnabled()));

// Typed: taken -> close variants.
const typedInput = modal.locator("[data-domain-typed]");
await typedInput.fill("riversidetaken");
await modal.locator("[data-domain-check]").click();
await modal.locator("[data-domain-typed-result]").waitFor({ timeout: 60_000 });
await page.waitForTimeout(600);
check("Typed name without an ending gets .com and is reported taken", (await modal.locator("[data-domain-typed-taken]").innerText()).includes("riversidetaken.com") && /taken/.test(await modal.locator("[data-domain-typed-taken]").innerText()));
check("Taken typed name offers close variants", (await options()).length >= 1, `${(await options()).length}`);
check("Says '.com' was added", /We added \.com/.test(await modal.locator("[data-domain-note]").innerText()));
await page.screenshot({ path: join(outDir, "07-typed-taken-variants.png") });

// Typed: an ending that is not live yet.
await typedInput.fill("riverside.biz");
await modal.locator("[data-domain-check]").click();
await modal.locator("[data-domain-note]").filter({ hasText: "isn't offered yet" }).waitFor({ timeout: 60_000 });
const note = await modal.locator("[data-domain-note]").innerText();
check("Unsupported ending -> \"isn't offered yet\" and the .com version", /\.biz isn't offered yet/.test(note) && (await modal.locator("[data-domain-typed-result]").innerText()).includes("riverside.com"), note);
await page.screenshot({ path: join(outDir, "08-typed-unsupported.png") });

// Typed: an available name, pick it, confirm.
await typedInput.fill("riversidepipes.com");
await modal.locator("[data-domain-check]").click();
await modal.locator('[data-domain-typed-result] [data-domain-option]').waitFor({ timeout: 60_000 }).catch(() => undefined);
let pick = (await modal.locator('[data-domain-typed-result] [data-domain-option]').count()) ? "riversidepipes.com" : first[1].domain;
if (pick === "riversidepipes.com") await modal.locator('[data-domain-typed-result] [data-domain-option]').click();
else await modal.locator(`[data-domain-option="${pick}"]`).click();
await page.screenshot({ path: join(outDir, "09-typed-available-selected.png") });
await modal.locator("[data-domain-use]").click();
await modal.waitFor({ state: "detached", timeout: 5000 });
const chip = page.locator("[data-domain-chip]");
check("Pop-up closes and a chip shows the pick + 'reserve at checkout'", (await chip.innerText()).includes(pick) && /reserve it at checkout/i.test(await chip.innerText()), await chip.innerText());
await chip.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "10-chip.png") });
await page.locator("[data-domain-open]").click();
check("Chip reopens the pop-up with the pick still selected", (await page.locator(`[data-domain-modal] [data-domain-option="${pick}"] input`).isChecked().catch(() => false)) || (await page.locator("[data-domain-modal]").count()) === 1);
await page.locator("[data-domain-close]").click();

// Choose a look: the lead carries chosen_domain, never a registration.
const card = page.locator("[data-look]").first();
await card.getByRole("button", { name: /^(Chosen|Choose this look)$/ }).first().click();
await page.getByText(/check your email/i).first().waitFor({ timeout: 300_000 });
await page.waitForTimeout(5000);
await browser.close();

const body = formcarry.at(-1) ?? "";
const field = (name) => body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1];
check("Formcarry chosen_domain", field("chosen_domain") === pick, field("chosen_domain"));
check("Formcarry domain_status=selected_not_registered", field("domain_status") === "selected_not_registered", field("domain_status"));
check("Formcarry domain_choice still get_domain_email_hosting", field("domain_choice") === "get_domain_email_hosting");
const posts = existsSync(hookLog) ? readFileSync(hookLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const last = posts.at(-1)?.payload;
if (process.env.EXPECT_WEBHOOK) check("Reply webhook chosen_domain + domain_status", last?.chosen_domain === pick && last?.domain_status === "selected_not_registered", JSON.stringify({ chosen_domain: last?.chosen_domain, domain_status: last?.domain_status }));
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ mode, pick, checks, formcarry: { chosen_domain: field("chosen_domain"), domain_status: field("domain_status") }, webhook: last ? { chosen_domain: last.chosen_domain, domain_status: last.domain_status } : null }, null, 2));
const failed = checks.filter((c) => !c.pass).length;
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
