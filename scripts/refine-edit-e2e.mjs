#!/usr/bin/env node
/**
 * E2E of Bob's steps on the refine box (one name per look: its style, e.g. "Dark Premium"):
 *   1. submit the site WITH his note ("use a photo of downtown pauls valley with the brick streets for the
 *      background"; NOTE="" for none) -> round 1;
 *   2. "Use editorials picture on dark premium" -> ONLY the Dark Premium card changes (same name, same place),
 *      now with Editorial's hero photo; the other two cards are untouched (same ids, same renders);
 *   3. "Make Dark Premium lighter so you can see the image better." -> ONLY Dark Premium changes again, in place,
 *      with 3 lighter variations (chips) and a "Changed:" line; the others untouched;
 *   3b. when round 1 has the from-scratch "Custom Design" card: "Make the custom one darker" (CUSTOM_EDIT) -> only that
 *      card changes, in place, still from scratch, with a darker page;
 *   4. refine with no look named (ROUND2, default "Show me something different") -> 3 NEW looks that must differ
 *      visibly from round 1 (styles / names, hero treatments, hero photos), not a reshuffle.
 * Screenshots every step plus before/after boards; measures luminance (WCAG relative luminance, CIE L*).
 * Formcarry is intercepted and nothing is chosen, so no lead is sent. Exits 1 when a check fails.
 *
 *   node scripts/refine-edit-e2e.mjs https://www.paulsvalley.com/ live-preview-shots/refine-targeted
 *   (env: APP_URL, CHROME_PATH, NOTE, ROUND2, BORROW, LIGHTEN)
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const target = process.argv[2] ?? "https://www.paulsvalley.com/";
const outDir = process.argv[3] ?? "live-preview-shots/refine-targeted";
const base = process.env.APP_URL ?? "http://localhost:8080";
const note = process.env.NOTE ?? "use a photo of downtown pauls valley with the brick streets for the background";
const round2 = process.env.ROUND2 ?? "Show me something different";
const borrowText = process.env.BORROW ?? "Use editorials picture on dark premium";
const lightenText = process.env.LIGHTEN ?? "Make Dark Premium lighter so you can see the image better.";
const customText = process.env.CUSTOM_EDIT ?? "Make the custom one darker";
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

const readCards = () =>
  page.locator("[data-look]").evaluateAll((list) =>
    list.map((card) => ({
      id: card.getAttribute("data-look"),
      name: card.querySelector("[data-look-name]")?.getAttribute("data-look-name"),
      title: card.querySelector("[data-look-name]")?.textContent?.trim(),
      variants: [...card.querySelectorAll("[data-look-variants] button")].map((b) => b.textContent.trim()),
      layout: card.querySelector("[data-look-layout]")?.textContent?.trim(),
      photos: card.querySelector("[data-look-photos]")?.textContent?.trim(),
      changed: card.querySelector("[data-look-changed]")?.textContent?.trim() ?? null,
    })),
  );

async function waitForCards(ok, what) {
  const deadline = Date.now() + 400_000;
  for (;;) {
    const ids = await page.locator("[data-look]").evaluateAll((l) => l.map((c) => c.getAttribute("data-look")));
    if (ids.length >= 3 && ok(ids)) break;
    if (Date.now() > deadline) throw new Error(`${what} never appeared`);
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);
}

async function refine(text, ok) {
  await page.locator("#refine-text").fill(text);
  await page.getByRole("button", { name: /Make this change|Show me 3 new looks/ }).click();
  await waitForCards(ok, `cards after “${text}”`);
}
// Luminance of a PNG region: mean WCAG relative luminance and mean CIE L*.
function measure(png, y0, y1) {
  let sumY = 0;
  let sumL = 0;
  let n = 0;
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  for (let y = Math.max(0, y0); y < Math.min(png.height, y1); y += 2) {
    for (let x = 0; x < png.width; x += 2) {
      const i = (y * png.width + x) * 4;
      const Y = 0.2126 * lin(png.data[i]) + 0.7152 * lin(png.data[i + 1]) + 0.0722 * lin(png.data[i + 2]);
      sumY += Y;
      sumL += Y > 216 / 24389 ? 116 * Math.cbrt(Y) - 16 : (24389 / 27) * Y;
      n += 1;
    }
  }
  return { relLum: +(sumY / n).toFixed(4), Lstar: +(sumL / n).toFixed(1) };
}

async function shootLook(id, prefix) {
  const site = await browser.newPage({ viewport: { width: 1280, height: 880 }, reducedMotion: "reduce" });
  await site.goto(`${base}/made/${id}`, { waitUntil: "networkidle" });
  await site.waitForTimeout(800);
  const top = await site.screenshot({ path: join(outDir, `${prefix}-top.png`) });
  await site.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 100));
    }
    window.scrollTo(0, 0);
  });
  await site.waitForLoadState("networkidle");
  await site.waitForTimeout(600);
  const heroHeight = await site.locator("main section, section").first().evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
  const full = await site.screenshot({ path: join(outDir, `${prefix}-full.png`), fullPage: true });
  const info = await site.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.body).color,
    heroAfterOpacity: getComputedStyle(document.querySelector(".s-hero-photo") ?? document.body, "::after").opacity,
    heroFilter: getComputedStyle(document.querySelector(".s-hero-photo .bgimg img, .s-hero-split .media img") ?? document.body).filter,
    h1: document.querySelector("h1")?.textContent?.trim(),
    heroImg: document.querySelector("main section img")?.src,
    heroClass: document.querySelector("main section")?.className,
    ribbon: document.querySelector(".preview-ribbon")?.textContent?.trim(),
    custom: document.body.classList.contains("custom-look"),
  }));
  const heroHash = info.heroImg ? createHash("sha256").update(await (await site.request.get(info.heroImg)).body()).digest("hex").slice(0, 16) : null;
  await site.close();
  const topPng = PNG.sync.read(top);
  const fullPng = PNG.sync.read(full);
  return { id, ...info, heroHash, hero: measure(topPng, 0, topPng.height), backgrounds: measure(fullPng, Math.round(heroHeight), fullPng.height), wholePage: measure(fullPng, 0, fullPng.height) };
}

const sideBySide = async (files, name, width, labels = []) => {
  const imgs = files.map((f, i) => `<figure><figcaption>${labels[i] ?? ""}</figcaption><img src="data:image/png;base64,${readFileSync(join(outDir, f)).toString("base64")}"></figure>`).join("");
  const board = await browser.newPage({ viewport: { width, height: 400 } });
  await board.setContent(`<style>body{margin:0;display:flex;gap:14px;background:#ddd;align-items:flex-start;padding:14px;font:600 20px system-ui}figure{margin:0;flex:1}figcaption{padding:0 0 8px}img{width:100%;display:block;box-shadow:0 2px 8px rgba(0,0,0,.25)}</style>${imgs}`);
  await board.screenshot({ path: join(outDir, name), fullPage: true });
  await board.close();
};

// ---- Round 1: Bob's note.
await page.goto(base, { waitUntil: "networkidle" });
await page.locator('[data-mode="reimagine"]').click();
await page.locator("#site-url").fill(target);
await page.locator("#site-email").fill("e2e-test@example.com");
if (note) await page.locator("#site-notes").fill(note);
await page.locator('input[type="checkbox"]').filter({ hasNot: page.locator("[name]") }).last().check();
await page.getByRole("button", { name: /Reimagine my site/i }).click();
await page.locator("[data-look]").nth(2).waitFor({ timeout: 400_000 });
await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 200_000 }).catch(() => undefined);
await page.waitForTimeout(3000);
await page.locator("[data-look]").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "01-round1-cards.png") });
const round1 = await readCards();
for (const [i, c] of round1.entries()) c.look = await shootLook(c.id, `01-round1-look-${i + 1}`);
const treat = (c) => `${c.look.heroClass?.match(/s-hero-[a-z]+/)?.[0]} ${c.look.heroClass?.match(/v-[a-z]+/)?.[0]}`;
const label = (c) => `${c.name} · ${c.look.heroClass?.match(/s-hero-[a-z]+/)?.[0] ?? ""} ${c.look.heroClass?.match(/v-[a-z]+/)?.[0] ?? ""}`;
await sideBySide(round1.map((_, i) => `01-round1-look-${i + 1}-top.png`), "01-round1-tops.png", 2400, round1.map(label));
check(round1.every((c) => c.title === c.name && !/[·,]/.test(c.title)), `one name per card: ${round1.map((c) => c.title).join(" | ")}`);

// ---- Step 2: "Use editorials picture on dark premium" -> only Dark Premium changes, with Editorial's photo.
const before3 = round1;
const darkBefore = before3.find((c) => c.name === "Dark Premium");
const editorial = before3.find((c) => c.name === "Editorial");
check(Boolean(darkBefore && editorial), `round 1 has Dark Premium and Editorial (${before3.map((c) => c.name).join(", ")})`);
await refine(borrowText, (ids) => ids.filter((id, i) => id !== before3[i]?.id).length === 1);
await page.locator("[data-refine-round]").scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "03-borrow-cards.png") });
const round3 = await readCards();
for (const [i, c] of round3.entries()) c.look = c.id === before3[i].id ? before3[i].look : await shootLook(c.id, `03-borrow-look-${i + 1}`);
const at3 = before3.indexOf(darkBefore);
check(round3.every((c, i) => (i === at3 ? c.id !== before3[i].id : c.id === before3[i].id)), `borrow: only card ${at3 + 1} (Dark Premium) changed; others same ids`);
check(round3[at3].name === "Dark Premium", `borrow: edited card keeps its name (${round3[at3].title})`);
check(round3[at3].look.heroHash === editorial.look.heroHash, `borrow: Dark Premium now shows Editorial's hero photo (${round3[at3].look.heroHash} vs ${editorial.look.heroHash}; was ${darkBefore.look.heroHash})`);
check(/photo from/i.test(round3[at3].changed ?? ""), `borrow: Changed line: ${round3[at3].changed}`);
check(treat(round3[at3]) === treat(darkBefore), `borrow: same layout (${treat(darkBefore)} -> ${treat(round3[at3])})`);
await sideBySide([`01-round1-look-${at3 + 1}-top.png`, `03-borrow-look-${at3 + 1}-top.png`, `01-round1-look-${before3.indexOf(editorial) + 1}-top.png`], "03-borrow-before-after.png", 2400, ["Dark Premium before", "Dark Premium after (Editorial's picture)", "Editorial (unchanged)"]);

// ---- Step 3: "Make Dark Premium lighter so you can see the image better."
await refine(lightenText, (ids) => ids[at3] !== round3[at3].id && ids.filter((id, i) => id !== round3[i]?.id).length === 1);
await page.locator("[data-refine-round]").scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "04-lighten-cards.png") });
const round4 = await readCards();
for (const [i, c] of round4.entries()) c.look = c.id === round3[i].id ? round3[i].look : await shootLook(c.id, `04-lighten-look-${i + 1}`);
check(round4.every((c, i) => (i === at3 ? c.id !== round3[i].id : c.id === round3[i].id)), `lighten: only Dark Premium changed; the other two are the same looks`);
check(round4[at3].name === "Dark Premium", `lighten: same name (${round4[at3].title})`);
check(round4[at3].variants.length === 3, `lighten: 3 variation chips (${round4[at3].variants.join(" / ")})`);
check(/^Changed:.*lighten/i.test(round4[at3].changed ?? ""), `lighten: ${round4[at3].changed}`);
check(round4[at3].look.hero.relLum > round3[at3].look.hero.relLum, `lighten: hero brighter (${round3[at3].look.hero.relLum} -> ${round4[at3].look.hero.relLum})`);
check(round4[at3].look.heroHash === round3[at3].look.heroHash, "lighten: same photo kept");
// Variation chips swap in place.
const chips = page.locator(`[data-look="${round4[at3].id}"] [data-look-variants] button`);
await chips.nth(2).click();
await page.waitForTimeout(1500);
const afterChip = await readCards();
check(afterChip[at3].id !== round4[at3].id && afterChip.every((c, i) => i === at3 || c.id === round4[i].id), `variation chip swaps only that card (${afterChip[at3].title})`);
await page.locator("[data-look]").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "05-variation-chip-cards.png") });
await sideBySide([`03-borrow-look-${at3 + 1}-top.png`, `04-lighten-look-${at3 + 1}-top.png`], "04-lighten-before-after.png", 2200, ["Dark Premium before", `After: ${round4[at3].title}`]);
await sideBySide(round4.map((c, i) => (i === at3 ? `04-lighten-look-${i + 1}-top.png` : c.id === round1[i].id ? `01-round1-look-${i + 1}-top.png` : `03-borrow-look-${i + 1}-top.png`)), "04-lighten-all-three.png", 2400, round4.map((c) => c.title));
// ---- Step 3b: "Make the custom one darker" -> only the from-scratch card changes, in place, still from scratch.
let afterCustom = afterChip;
const atC = afterChip.findIndex((c) => c.name === "Custom Design");
if (atC >= 0) {
  afterChip[atC].look = await shootLook(afterChip[atC].id, `05-custom-before-${atC + 1}`);
  await refine(customText, (ids) => ids[atC] !== afterChip[atC].id && ids.filter((id, i) => id !== afterChip[i]?.id).length === 1);
  await page.locator("[data-refine-round]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(outDir, "05b-custom-edit-cards.png") });
  afterCustom = await readCards();
  const editedLook = await shootLook(afterCustom[atC].id, `05b-custom-after-${atC + 1}`);
  check(afterCustom.every((c, i) => (i === atC ? c.id !== afterChip[i].id : c.id === afterChip[i].id)), `custom edit: only the Custom Design card changed`);
  check(afterCustom[atC].name === "Custom Design", `custom edit: same name (${afterCustom[atC].title})`);
  check(afterChip[atC].look.custom && editedLook.custom, `custom edit: still the from-scratch page (${afterChip[atC].look.custom} -> ${editedLook.custom})`);
  check(editedLook.wholePage.relLum < afterChip[atC].look.wholePage.relLum, `custom edit: darker page (${afterChip[atC].look.wholePage.relLum} -> ${editedLook.wholePage.relLum})`);
  check(/^Changed:/i.test(afterCustom[atC].changed ?? ""), `custom edit: ${afterCustom[atC].changed}`);
  await sideBySide([`05-custom-before-${atC + 1}-top.png`, `05b-custom-after-${atC + 1}-top.png`], "05b-custom-before-after.png", 2200, ["Custom Design before", `After: ${customText}`]);
} else console.log("(no Custom Design card in round 1: custom edit step skipped)");
// ---- Step 4: no look named -> three new looks, visibly different from what is on screen (and round 1).
await refine(round2, (ids) => !ids.some((id) => afterCustom.some((c) => c.id === id)));
await page.locator("[data-look]").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "06-regenerated-cards.png") });
const round2Cards = await readCards();
for (const [i, c] of round2Cards.entries()) c.look = await shootLook(c.id, `06-regenerated-look-${i + 1}`);
await sideBySide(round2Cards.map((_, i) => `06-regenerated-look-${i + 1}-top.png`), "06-regenerated-tops.png", 2400, round2Cards.map(label));
await sideBySide(["01-round1-tops.png", "06-regenerated-tops.png"], "06-round1-vs-regenerated.png", 2400, ["Round 1", "Regenerated round (no look named)"]);
const newNames = round2Cards.filter((c) => !round1.some((p) => p.name === c.name)).length;
const newTreatments = round2Cards.filter((c) => !round1.some((p) => treat(p) === treat(c))).length;
const newPhotos = round2Cards.filter((c) => c.look.heroHash && !round1.some((p) => p.look.heroHash === c.look.heroHash)).length;
check(newNames >= 2, `regenerated round has ≥2 new looks (styles): ${round1.map((c) => c.name).join(", ")} -> ${round2Cards.map((c) => c.name).join(", ")}`);
check(newTreatments >= 2, `regenerated round has ≥2 new hero treatments: ${round1.map(treat).join(", ")} -> ${round2Cards.map(treat).join(", ")}`);
check(newPhotos >= 2, `regenerated round has ≥2 hero photos not shown in round 1 (${newPhotos})`);

check(sent.length === 0, `no Formcarry calls (${sent.length})`);

const strip = (cards) => cards.map((c) => ({ id: c.id, name: c.name, title: c.title, variants: c.variants, changed: c.changed, layout: c.layout, photos: c.photos, heroClass: c.look?.heroClass, heroHash: c.look?.heroHash, heroLum: c.look?.hero }));
const summary = { target, steps: [note || "(no note)", borrowText, lightenText, round2], formcarryCalls: sent.length, failures, round1: strip(round1), borrow: strip(round3), lighten: strip(round4), regenerated: strip(round2Cards) };
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ failures, round1: round1.map(label), borrow: round3.map((c) => c.title), lighten: round4.map((c) => c.title), regenerated: round2Cards.map(label) }, null, 2));
await browser.close();
process.exit(failures.length ? 1 : 0);
