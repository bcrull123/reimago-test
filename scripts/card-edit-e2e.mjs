#!/usr/bin/env node
/**
 * E2E of the per-card "Change this look" box (round 8, Bob: "a box in each sample site at the bottom so it is more
 * clear to the system which one is being modified"):
 *   1. round 1 with no note; every card has its own box (desktop and a 390 px phone screenshot);
 *   2. middle card's box: CARD_EDIT (default "make the image daylight and raise text contrast") -> ONLY that card
 *      changes: same style name, same hero photo bytes, 3 variation chips, a "Changed:" line with daylight; the other
 *      two cards keep their ids AND their homepage HTML byte for byte;
 *   3. Custom Design's box: CUSTOM_EDIT (default "make the photo daylight, more contrast") -> only that card changes,
 *      still "Custom Design" and from scratch (1 version, no chips); the other two byte-identical;
 *   4. middle card's box with Bob's exact words ("Use Bold Photo and make the image in daylight. adjust the text to
 *      show contrast.") -> that card switches to the Bold Photo style (explicitly asked) and keeps its photo; others
 *      byte-identical.
 * Formcarry is intercepted and nothing is chosen, so no lead is sent. Exits 1 when a check fails.
 *
 *   node scripts/card-edit-e2e.mjs https://www.paulsvalley.com/ live-preview-shots/card-edit
 *   (env: APP_URL, CHROME_PATH, NOTE, CARD_EDIT, CUSTOM_EDIT, STYLE_EDIT)
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const target = process.argv[2] ?? "https://www.paulsvalley.com/";
const outDir = process.argv[3] ?? "live-preview-shots/card-edit";
const base = process.env.APP_URL ?? "http://localhost:8080";
const note = process.env.NOTE ?? "";
const cardText = process.env.CARD_EDIT ?? "make the image daylight and raise text contrast";
const customText = process.env.CUSTOM_EDIT ?? "make the photo daylight, more contrast";
const styleText = process.env.STYLE_EDIT ?? "Use Bold Photo and make the image in daylight. adjust the text to show contrast.";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
const sent = [];
await page.context().route("**/formcarry.com/**", async (route) => {
  sent.push(route.request().url());
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200 }) });
});
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};
const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

const readCards = () =>
  page.locator("[data-look]").evaluateAll((list) =>
    list.map((card) => ({
      id: card.getAttribute("data-look"),
      name: card.querySelector("[data-look-name]")?.getAttribute("data-look-name"),
      title: card.querySelector("[data-look-name]")?.textContent?.trim(),
      variants: [...card.querySelectorAll("[data-look-variants] button")].map((b) => b.textContent.trim()),
      photos: card.querySelector("[data-look-photos]")?.textContent?.trim(),
      changed: card.querySelector("[data-look-changed]")?.textContent?.trim() ?? null,
      box: Boolean(card.querySelector("[data-card-edit] [data-card-edit-text]")),
      boxStyle: card.querySelector("[data-card-edit]")?.getAttribute("data-card-style"),
      // The card's content (the "Previewing below" focus marker moves to the edited card, so it is left out).
      html: (() => {
        const copy = card.cloneNode(true);
        copy.removeAttribute("class");
        copy.querySelectorAll("[aria-pressed]").forEach((b) => b.remove());
        return copy.outerHTML;
      })(),
    })),
  );

/** The look's homepage HTML and its hero photo bytes, straight from the server. */
async function fingerprint(id) {
  const res = await page.request.get(`${base}/made/${id}`);
  const html = await res.text();
  const hero = await page.request.get(`${base}/made/${id}/img/hero`).catch(() => undefined);
  return { html: sha(html), hero: hero && hero.ok() ? sha(await hero.body()) : null, filter: (html.match(/filter:[^;}]*brightness\([^;}]*/) ?? [""])[0].slice(0, 120) };
}

async function waitFor(ok, what) {
  const deadline = Date.now() + 300_000;
  for (;;) {
    const cards = await readCards();
    if (cards.length >= 3 && ok(cards)) break;
    if (Date.now() > deadline) throw new Error(`${what} never appeared`);
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2500);
  return readCards();
}

async function editCard(index, text, shot) {
  const before = await readCards();
  const prints = await Promise.all(before.map((c) => fingerprint(c.id)));
  const form = page.locator("[data-card-edit]").nth(index);
  await form.scrollIntoViewIfNeeded();
  await form.locator("[data-card-edit-text]").fill(text);
  await page.screenshot({ path: join(outDir, `${shot}-typed.png`) });
  await form.locator("[data-card-edit-submit]").click();
  const after = await waitFor((cards) => cards[index]?.id !== before[index]?.id, `card ${index + 1} after “${text}”`);
  const afterPrints = await Promise.all(after.map((c) => fingerprint(c.id)));
  await page.locator("[data-look]").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(outDir, `${shot}-cards.png`) });
  for (const i of [0, 1, 2]) {
    if (i === index) continue;
    check(after[i].id === before[i].id, `${shot}: card ${i + 1} keeps its id (${before[i].id})`);
    check(afterPrints[i].html === prints[i].html, `${shot}: card ${i + 1} homepage byte-identical (${prints[i].html})`);
    check(after[i].html === before[i].html, `${shot}: card ${i + 1} card content identical`);
  }
  return { before, after, prints, afterPrints };
}

// ---- Round 1 (no note).
await page.goto(base, { waitUntil: "networkidle" });
await page.getByLabel("Reimagine My Website").check();
await page.locator("#site-url").fill(target);
await page.locator("#site-email").fill("e2e-test@example.com");
if (note) await page.locator("#site-notes").fill(note);
await page.locator('input[type="checkbox"]').filter({ hasNot: page.locator("[name]") }).last().check();
await page.getByRole("button", { name: /Reimagine my site/i }).click();
await page.locator("[data-look]").nth(2).waitFor({ timeout: 400_000 });
await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 200_000 }).catch(() => undefined);
await page.waitForTimeout(3000);
const round1 = await readCards();
await page.locator("[data-look]").first().evaluate((el) => el.scrollIntoView({ block: "start" }));
await page.waitForTimeout(800);
await page.screenshot({ path: join(outDir, "01-round1-card-boxes.png") });
await page.locator("[data-look]").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "01-round1-cards.png"), fullPage: true });
check(round1.length === 3 && round1.every((c) => c.box), `every card has its own “Change this look” box (${round1.map((c) => c.box).join(",")})`);
check(round1.every((c) => c.boxStyle === c.name), "each box carries its card's style name");
// Round 8b: labelled "What would you change?", right under the description and colors (visible without scrolling).
const labels = await page.locator("[data-card-edit] label").allTextContents();
check(labels.length === 3 && labels.every((l) => /What would you change\?/.test(l)), `box label: ${labels.map((l) => l.trim()).join(" | ")}`);
const placement = await page.locator("[data-look]").evaluateAll((cards) =>
  cards.map((card) => {
    const top = card.getBoundingClientRect().top;
    const box = card.querySelector("[data-card-edit]")?.getBoundingClientRect();
    return box ? Math.round(box.bottom - top) : -1;
  }),
);
check(placement.every((d) => d > 0 && d < 1000), `box is within the first 1000 px of each card (bottom edge at ${placement.join(", ")} px)`);
check((await page.locator("[data-look-mockup]").count()) === 0, "Custom Design card shows no mockup / built thumbnails");
const pbox = page.locator("[data-preview-edit]");
check((await pbox.count()) === 1, "the full-size rendering has its own “What would you change?” box");
check((await pbox.getAttribute("data-card-style")) === round1[0].name, `…for the look being previewed (${await pbox.getAttribute("data-card-style")})`);
await pbox.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "01c-rendering-box.png") });
const stamp = (await page.locator("[data-build-stamp]").textContent())?.trim();
check(/^Build [0-9a-f]{7} /.test(stamp ?? ""), `footer build stamp: ${stamp}`);
check(await page.locator("#refine-text").count() === 1, "the global refine box is still there (fallback)");
// Phone: the box sits under each card, full width.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(2500);
const box2 = page.locator("[data-card-edit]").nth(1);
await box2.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "01b-phone-card-box.png") });
const bb = await box2.boundingBox();
const btn = box2.locator("[data-card-edit-submit]");
const btnText = (await btn.innerText()).trim();
const btnBox = await btn.boundingBox();
check(btnText === "Change" && btnBox && btnBox.width > 80 && btnBox.height >= 40, `phone: the Change button shows its label (“${btnText}”, ${btnBox ? `${Math.round(btnBox.width)}x${Math.round(btnBox.height)}` : "none"})`);
check(bb && bb.width > 300 && bb.x >= 0 && bb.x + bb.width <= 390, `phone: the box fits the screen (${bb ? `${Math.round(bb.x)}+${Math.round(bb.width)}` : "none"})`);
await page.locator("[data-look]").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "01d-phone-round1.png") });
await page.setViewportSize({ width: 1400, height: 1100 });
await page.waitForTimeout(1500);

// ---- 2. middle card: daylight + contrast, same photo.
const mid = await editCard(1, cardText, "02-middle");
const m0 = mid.before[1];
const m1 = mid.after[1];
check(m1.name === m0.name, `middle card keeps its style name: ${m0.name} -> ${m1.name}`);
check(m1.variants.length === 3, `middle card has 3 variation chips (${m1.variants.join(" | ")})`);
check(/daylight/i.test(m1.changed ?? ""), `Changed line names daylight: ${m1.changed}`);
check(!/new photo/i.test(m1.changed ?? ""), "no new photo was searched");
check(mid.afterPrints[1].hero === mid.prints[1].hero, `middle card keeps the same hero photo bytes (${mid.prints[1].hero})`);
check(Boolean(mid.afterPrints[1].filter), `the photo is adjusted with CSS filters (${mid.afterPrints[1].filter})`);

// ---- 3. Custom Design's own box.
const customIndex = mid.after.findIndex((c) => /custom/i.test(c.name ?? ""));
let cus;
if (customIndex >= 0) {
  cus = await editCard(customIndex, customText, "03-custom");
  const c1 = cus.after[customIndex];
  check(c1.name === "Custom Design", `Custom Design keeps its name (${c1.name})`);
  check(c1.variants.length <= 1, `Custom Design: one version, no chips (${c1.variants.length})`);
  check(cus.afterPrints[customIndex].hero === cus.prints[customIndex].hero, "Custom Design keeps the same hero photo bytes");
} else check(false, "round 1 has a Custom Design card");

// ---- 4. Bob's exact words in the middle box: explicit style switch for that card only.
const sty = await editCard(1, styleText, "04-middle-bold-photo");
check(sty.after[1].name === "Bold Photo", `asked for Bold Photo in the middle box: ${sty.before[1].name} -> ${sty.after[1].name}`);
check(sty.afterPrints[1].hero === sty.prints[1].hero, "…and it keeps the same hero photo");
check(!/new photo/i.test(sty.after[1].changed ?? ""), `…with no new photo search: ${sty.after[1].changed}`);

check(sent.length === 0, `no Formcarry calls (${sent.length})`);
const strip = (cards) => cards.map((c) => ({ ...c, html: undefined }));
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ target, steps: [cardText, customText, styleText], formcarryCalls: sent.length, failures, round1: strip(round1), middle: strip(mid.after), custom: cus ? strip(cus.after) : null, style: strip(sty.after) }, null, 2));
console.log(JSON.stringify({ failures, round1: round1.map((c) => c.name), middle: mid.after.map((c) => `${c.name}${c.changed ? ` [${c.changed}]` : ""}`), custom: cus?.after.map((c) => c.name), style: sty.after.map((c) => c.name) }, null, 2));
await browser.close();
process.exit(failures.length ? 1 : 0);
