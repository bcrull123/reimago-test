#!/usr/bin/env node
/**
 * E2E for the lead picture: submit the form, intercept Formcarry (no real lead is sent), pull the
 * `picture` file out of the multipart body and save it, so you can look at what the email bot gets.
 *
 *   node scripts/preview-picture-e2e.mjs reimagine https://www.cafe501.com/ live-preview-shots/picture-cafe501
 *   node scripts/preview-picture-e2e.mjs wizard - live-preview-shots/picture-wizard
 *   BREAK_CANVAS=1 node scripts/preview-picture-e2e.mjs reimagine https://bob.me/ out   # capture fails → picture_error, still sent
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const mode = process.argv[2] ?? "reimagine";
const target = process.argv[3] ?? "https://www.morganplumbingokc.com/";
const outDir = process.argv[4] ?? "live-preview-shots/picture";
const base = process.env.APP_URL ?? "http://localhost:8080";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const sent = [];
await page.context().route("**/formcarry.com/**", async (route) => {
  const request = route.request();
  sent.push({ contentType: request.headers()["content-type"] ?? "", body: request.postDataBuffer() ?? Buffer.alloc(0) });
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200, status: "success" }) });
});
const stages = new Set();
const proxied = [];
page.on("request", (request) => /\/img\/remote\?u=/.test(request.url()) && proxied.push(decodeURIComponent(request.url().split("u=")[1] ?? "")));
page.on("console", (msg) => /error|warn/.test(msg.type()) && !/sandboxed/.test(msg.text()) && console.log(`[browser ${msg.type()}]`, msg.text().slice(0, 300)));
if (process.env.BREAK_CANVAS) {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.toDataURL = () => { throw new Error("canvas disabled by test"); };
    HTMLCanvasElement.prototype.toBlob = () => { throw new Error("canvas disabled by test"); };
  });
}
const t0 = Date.now();
if (mode === "wizard") {
  const brief = {
    business_name: "Prairie Paws Grooming", what: "Dog and cat grooming salon in Edmond", industry: "Other", location: "Edmond, OK", existing_site: "",
    emulate_url_1: "", emulate_url_2: "", emulate_url_3: "", emulate_likes: [], emulate_note: "",
    goal: "Book an appointment", customers: "Busy pet owners in north OKC.", services: "Full groom\nBath and brush\nNail trim",
    pages: ["Home", "About", "Services/Products", "Contact"], style: "Warm", brand_color: "#2f7d6d",
    phone: "", contact_email: "", address: "", hours: "", domain_choice: "find", domain: "prairiepawsgrooming.net", domain_status: "selected-pending-checkout", domain_checkout_url: "",
    features: [], product_count: "", files_link: "", copy_text: "", video_link: "", anything_else: "", files_note: "", ai_suggested: [],
  };
  await page.addInitScript((value) => { window.__reimagoSeedBrief = { step: 14, brief: value }; }, brief);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByLabel("Create a New Site").check();
  await page.locator("#site-email").fill("e2e-test@example.com");
  await page.locator('input[type="checkbox"]').last().check();
  await page.getByRole("button", { name: "Build my new site" }).click();
} else {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByLabel("Reimagine My Website").check();
  await page.locator("#site-url").fill(target);
  await page.locator("#site-email").fill("e2e-test@example.com");
  await page.locator('input[type="checkbox"]').filter({ hasNot: page.locator("[name]") }).last().check();
  await page.getByRole("button", { name: /Reimagine my site/i }).click();
}
const watcher = setInterval(async () => {
  const text = await page.locator('[role="status"]').textContent().catch(() => null);
  if (text?.includes("Preparing your preview image")) {
    if (!stages.has("picture")) await page.screenshot({ path: join(outDir, "00-preparing-image.png") }).catch(() => undefined);
    stages.add("picture");
  }
}, 100);
const deadline = Date.now() + 360_000;
while (!sent.length && Date.now() < deadline) await page.waitForTimeout(250);
clearInterval(watcher);
if (!sent.length) throw new Error("Formcarry was never called.");
const seconds = Math.round((Date.now() - t0) / 1000);
const form = await new Response(sent[0].body, { headers: { "content-type": sent[0].contentType } }).formData();
const fields = {};
let picture = null;
for (const [key, value] of form.entries()) {
  if (typeof value === "string") fields[key] = value.length > 300 ? `${value.slice(0, 300)}…` : value;
  else if (key === "picture") picture = value;
  else fields[key] = `[file ${value.name} ${value.size} bytes]`;
}
let saved = "";
if (picture) {
  const bytes = Buffer.from(await picture.arrayBuffer());
  saved = join(outDir, picture.name);
  writeFileSync(saved, bytes);
  fields.picture = `[file ${picture.name} ${picture.type} ${bytes.length} bytes ${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}]`;
}
let storedMatches = null;
if (fields.picture_url) {
  const res = await fetch(fields.picture_url.replace(/^https?:\/\/[^/]+/, base));
  const stored = Buffer.from(await res.arrayBuffer());
  storedMatches = res.ok && picture ? stored.equals(Buffer.from(await picture.arrayBuffer())) : false;
}
await page.waitForTimeout(1500);
const thanks = await page.locator("text=We got the brief").first().textContent().catch(() => "");
await page.screenshot({ path: join(outDir, "01-after-submit.png") });
// The page itself, for comparison with the captured picture.
if (fields.preview_url) {
  const site = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  await site.goto(fields.preview_url.replace(/^https?:\/\/[^/]+/, base), { waitUntil: "networkidle" });
  await site.screenshot({ path: join(outDir, "02-reference-top.png") });
}
const summary = { mode, target, seconds, formcarryCalls: sent.length, saved, storedMatches, preparingStageSeen: stages.has("picture"), proxiedImages: proxied, thanks, fields };
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
