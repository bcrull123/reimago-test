#!/usr/bin/env node
/**
 * Round 10d E2E — Build a New Site stays a quick page; "Add more details" is collapsed until opened, then
 * optional services, hours, pages, contact, social links and photos go into the looks and Formcarry.
 *
 *   PREVIEW_MOCK=1 npm run dev
 *   node scripts/more-details-e2e.mjs /workspace/live-preview-shots/round10d-details
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";

const outDir = process.argv[2] ?? "live-preview-shots/round10d-details";
const base = process.env.APP_URL ?? "http://localhost:8080";
const NAME = process.env.BUSINESS ?? "Glow Studio";
const WHAT = process.env.WHAT ?? "Hair color and cuts for busy professionals";
mkdirSync(outDir, { recursive: true });

function pngPhoto(w = 900, h = 600) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3;
    raw[o] = 200 + (x % 40);
    raw[o + 1] = 120 + (y % 50);
    raw[o + 2] = 90;
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
const formcarry = [];
await page.context().route("**/formcarry.com/**", async (route) => {
  formcarry.push(route.request().postDataBuffer()?.toString("latin1") ?? "");
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200 }) });
});

await page.goto(base, { waitUntil: "networkidle" });
await page.locator('[data-mode="newsite"]').click();
await page.locator("[data-new-site-form]").waitFor();
check("Add more details is on the form, collapsed", (await page.locator("[data-more-details-toggle]").getAttribute("aria-expanded")) === "false");
check("Extra fields are hidden until opened", (await page.locator("[data-more-details-fields]").count()) === 0);
check("Quick form still has name, what, and no required extras", (await page.locator("#ns-name").count()) === 1 && (await page.locator("#ns-services").count()) === 0);
await page.locator("[data-new-site-form]").screenshot({ path: join(outDir, "01-collapsed.png") });

await page.locator("#ns-name").fill(NAME);
await page.locator("#ns-location").fill("Austin, Texas");
await page.locator("#ns-what").fill(WHAT);
await page.locator("#ns-style").fill("warm, modern");
await page.getByLabel("Get me a domain, email & hosting").check();

await page.locator("[data-more-details-toggle]").click();
await page.locator("[data-more-details-fields]").waitFor();
check("Add more details expands the extra fields", (await page.locator("[data-more-details-toggle]").getAttribute("aria-expanded")) === "true");
await page.locator("#ns-services").fill("Color\nCuts\nHighlights");
await page.locator("#ns-hours").fill("Tue–Sat 10–6\nSun 11–3");
await page.locator("#ns-phone").fill("(512) 555-0199");
await page.locator("#ns-contact-email").fill("hi@glowstudio.com");
await page.locator("#ns-address").fill("100 South Congress, Austin, TX");
await page.locator("#ns-social").fill("instagram.com/glowstudio\nhttps://www.facebook.com/glowstudio");
await page.locator('[data-ns-pages] [data-chip="Home"]').click();
await page.locator('[data-ns-pages] [data-chip="Contact"]').click();
await page.locator('[data-ns-pages] [data-chip="Services/Products"]').click();
await page.locator('[data-ns-goals] [data-chip="Book an appointment"]').click();
await page.locator("#ns-photos").setInputFiles({ name: "studio.jpg", mimeType: "image/png", buffer: pngPhoto() });
await page.locator("#ns-email").fill("e2e-test@example.com");
await page.locator("[data-new-site-form] input[type=checkbox]").check();
await page.locator("[data-more-details-fields]").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: join(outDir, "02-details-open.png") });
check("Photo listed after upload", /studio\.jpg/i.test(await page.locator("[data-ns-photos]").innerText()));

await page.locator("[data-build-new-site]").click();
await page.locator("[data-look]").nth(2).waitFor({ timeout: 400_000 });
await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 300_000 }).catch(() => undefined);
check("Three looks built with the extra details", (await page.locator("[data-look]").count()) >= 3);
await page.locator("[data-look]").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "03-looks.png") });

await page.locator("[data-look]").first().getByRole("button", { name: /^(Chosen|Choose this look)$/ }).first().click();
await page.getByText(/check your email/i).first().waitFor({ timeout: 300_000 });
await page.screenshot({ path: join(outDir, "04-sent.png") });
await page.waitForTimeout(2000);
await browser.close();

const body = formcarry.at(-1) ?? "";
const field = (name) =>
  body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`))?.[1]?.replace(/\r\n/g, "\n");
check("Formcarry posted once", formcarry.length === 1, `${formcarry.length}`);
check("Formcarry mode=new_site", field("mode") === "new_site");
check("Formcarry services", /Color/.test(field("services") ?? "") && /Highlights/.test(field("services") ?? ""), field("services") ?? "");
check("Formcarry hours", /Tue/.test(field("hours") ?? ""), field("hours") ?? "");
check("Formcarry phone", /555-0199/.test(field("phone") ?? ""), field("phone") ?? "");
check("Formcarry pages", /Contact/.test(field("pages") ?? "") && /Services/.test(field("pages") ?? ""), field("pages") ?? "");
check("Formcarry social", /instagram\.com\/glowstudio/.test(field("social") ?? ""), field("social") ?? "");
check("Formcarry photo_urls", /\/img\/upload-photo-/.test(field("photo_urls") ?? ""), field("photo_urls") ?? "");
check("Formcarry photos file attached", /name="photos"; filename="studio\.jpg"/.test(body));
check("Formcarry goal", field("goal") === "Book an appointment");

writeFileSync(
  join(outDir, "summary.json"),
  JSON.stringify({
    checks,
    formcarryFields: {
      mode: field("mode"),
      services: field("services"),
      hours: field("hours"),
      phone: field("phone"),
      pages: field("pages"),
      social: field("social"),
      photo_urls: field("photo_urls"),
      goal: field("goal"),
    },
  }, null, 2),
);
const failed = checks.filter((c) => !c.pass).length;
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
