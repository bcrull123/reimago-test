#!/usr/bin/env node
/**
 * Round 10f — card thumbnails must show the homepage (or a stored fallback), never a broken-image icon.
 *
 *   PREVIEW_MOCK=1 npm run dev
 *   node scripts/blank-thumb-e2e.mjs https://cafe501.com /workspace/live-preview-shots/round10f/cafe501
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const target = process.argv[2] ?? "https://cafe501.com/";
const outDir = process.argv[3] ?? "live-preview-shots/round10f";
const base = process.env.APP_URL ?? "http://localhost:8080";
mkdirSync(outDir, { recursive: true });

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
await page.context().route("**/formcarry.com/**", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200 }) }),
);

await page.goto(base, { waitUntil: "networkidle" });
await page.locator('[data-mode="reimagine"]').click();
await page.locator("#site-url").fill(target);
await page.locator("#site-email").fill("e2e-test@example.com");
await page.locator('input[type="checkbox"]').filter({ hasNot: page.locator("[name]") }).last().check();
await page.getByRole("button", { name: /Reimagine my site/i }).click();
await page.locator("[data-look]").nth(2).waitFor({ timeout: 400_000 });
await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 180_000 }).catch(() => undefined);
await page.waitForTimeout(5000);
await page.locator("[data-look]").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "01-cards.png") });

const cards = page.locator("[data-look]");
const n = await cards.count();
check("Three look cards rendered", n >= 3, `${n}`);

const thumbReport = [];
for (let i = 0; i < Math.min(n, 3); i++) {
  const card = cards.nth(i);
  const name = ((await card.locator("h3").first().textContent()) ?? "").trim();
  const thumb = card.locator("[data-look-thumb]");
  const mode = await thumb.getAttribute("data-thumb-mode");
  const iframe = thumb.locator("iframe");
  const fallback = thumb.locator("[data-thumb-fallback]");
  const placeholder = thumb.locator("[data-thumb-placeholder]");
  let iframeSrc = "";
  let iframeOk = false;
  if ((await iframe.count()) === 1) {
    iframeSrc = (await iframe.getAttribute("src")) ?? "";
    const frame = page.frameLocator(`[data-look="${await card.getAttribute("data-look")}"] iframe`);
    try {
      const body = await iframe.evaluate((el) => {
        const doc = el.contentDocument;
        if (!doc) return { readable: false };
        const imgs = [...doc.images].map((img) => ({ src: img.getAttribute("src") ?? "", w: img.naturalWidth, ok: img.naturalWidth > 0 }));
        return { readable: true, title: doc.title, text: (doc.body?.innerText ?? "").slice(0, 120), imgs, broken: imgs.filter((img) => !img.ok).length };
      });
      iframeOk = Boolean(body.readable && !/not on this server/i.test(body.text ?? "") && (body.imgs?.some((img) => img.ok) || /preview/i.test(body.text ?? "")));
      thumbReport.push({ name, mode, iframeSrc, ...body });
    } catch (error) {
      thumbReport.push({ name, mode, iframeSrc, error: String(error) });
    }
  } else {
    thumbReport.push({ name, mode, iframeSrc: "", fallback: await fallback.count(), placeholder: await placeholder.count() });
  }
  await thumb.screenshot({ path: join(outDir, `02-thumb-${i + 1}.png`) });
  check(`${name}: thumbnail is present`, (await thumb.count()) === 1);
  check(`${name}: iframe uses a same-origin /made/ path (or a fallback, not a foreign/http URL)`, mode !== "frame" || /^\/(?:hds-[^/]+\/)?made\/[a-f0-9]{16}/.test(iframeSrc.split("?")[0] ?? ""), iframeSrc);
  check(`${name}: shows a visible image (iframe or stored fallback, not a blank placeholder)`, mode === "frame" || mode === "img", `mode=${mode}`);
  if (mode === "frame") check(`${name}: preview page is readable and not a 404`, iframeOk, iframeSrc);
  if (mode === "img") check(`${name}: stored fallback image is shown`, (await fallback.count()) === 1);
}

// "Make it yummy" on the first card: thumb must stay visible and the hero must actually change.
const first = cards.first();
const beforeId = await first.getAttribute("data-look");
const beforeName = ((await first.locator("h3").first().textContent()) ?? "").trim();
const beforeThumb = await first.locator("[data-look-thumb]").screenshot({ path: join(outDir, "03-thumb-before-yummy.png") });
const beforeHero = await page.request.get(`${base}/made/${beforeId}/img/hero`).catch(() => undefined);
const beforeHeroBuf = beforeHero && beforeHero.ok() ? Buffer.from(await beforeHero.body()) : Buffer.alloc(0);
await first.locator("[data-card-edit-text]").fill("Make it yummy");
await first.locator("[data-card-edit-submit]").click();
const edited = await page.waitForFunction(
  (oldId) => {
    const card = document.querySelector("[data-look]");
    if (!card) return false;
    const busy = document.querySelector('[aria-busy="true"]');
    if (busy) return false;
    const id = card.getAttribute("data-look");
    const changed = card.querySelector("[data-look-changed], [data-look-photos]")?.textContent ?? "";
    return Boolean(id && id !== oldId && /photo|food|appetizing|yummy|art:/i.test(changed));
  },
  beforeId,
  { timeout: 300_000 },
).then(() => true).catch(() => false);
await page.waitForTimeout(4000);
await page.locator("[data-look]").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: join(outDir, "04-cards-after-yummy.png") });
const after = page.locator("[data-look]").first();
const afterId = await after.getAttribute("data-look");
const afterMode = await after.locator("[data-look-thumb]").getAttribute("data-thumb-mode");
const afterThumb = await after.locator("[data-look-thumb]").screenshot({ path: join(outDir, "05-thumb-after-yummy.png") });
const afterLine = ((await after.locator("[data-look-changed], [data-look-photos]").first().textContent().catch(() => "")) ?? "").trim();
const afterHero = await page.request.get(`${base}/made/${afterId}/img/hero`).catch(() => undefined);
const afterHeroBuf = afterHero && afterHero.ok() ? await afterHero.body() : Buffer.alloc(0);
const thumbsDiffer = afterThumb.length !== beforeThumb.length || !afterThumb.equals(beforeThumb);
const herosDiffer = afterHeroBuf.length > 0 && (afterHeroBuf.length !== beforeHeroBuf.length || !afterHeroBuf.equals(beforeHeroBuf));
check("Make it yummy: the card re-rendered (new look id or a photo change line)", edited || afterId !== beforeId || /photo|food|appetizing/i.test(afterLine), `before=${beforeId} after=${afterId} line=${afterLine}`);
check("Make it yummy: thumbnail stayed visible (iframe or stored image, not blank)", afterMode === "frame" || afterMode === "img", `mode=${afterMode}`);
check("Make it yummy: hero image actually changed", herosDiffer || thumbsDiffer, `hero ${beforeHeroBuf.length}B → ${afterHeroBuf.length}B · thumb ${beforeThumb.length}B → ${afterThumb.length}B`);
thumbReport.push({ yummy: true, beforeId, afterId, beforeName, afterMode, afterLine, herosDiffer, thumbsDiffer, beforeHeroBytes: beforeHeroBuf.length, afterHeroBytes: afterHeroBuf.length });

await browser.close();
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ target, checks, thumbReport }, null, 2));
const failed = checks.filter((c) => !c.pass).length;
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
