#!/usr/bin/env node
/**
 * Render checks for the from-scratch look (Bob, round 5), in a real browser:
 *   node scripts/custom-look-check.mjs <base url> <look id> <outDir>
 * At 1280x800 and 390x844: the page is not blank, nothing overflows sideways, every link/image token was
 * resolved, images loaded, the preview ribbon and legal line are there, the nav reaches every page, and every
 * visible text element meets WCAG AA contrast against its effective background (text over photos is reported
 * separately). Screenshots: custom-1280-top.png, custom-390-top.png, custom-1280-full.png. Exits 1 on failure.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const [base, id, out] = process.argv.slice(2);
if (!base || !id || !out) {
  console.error("usage: custom-look-check.mjs <base url> <look id> <outDir>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const report = { id, sizes: {} };
let ok = true;
for (const [w, h, tag] of [
  [1280, 800, "1280"],
  [390, 844, "390"],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${base}/made/${id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2600); // one-shot load animations settle
  const r = await page.evaluate(() => {
    const lum = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return undefined;
      const [r, g, b, a = 1] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return { l: [r, g, b].map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0), a };
    };
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const bgOf = (el) => {
      for (let e = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.backgroundImage !== "none") return { image: true };
        const c = lum(cs.backgroundColor);
        if (c && c.a > 0.9) return { l: c.l };
      }
      return { l: 1 };
    };
    const low = [];
    const overPhoto = [];
    let checked = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest(".preview-ribbon,.rx-legal,svg")) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
      if (!own) continue;
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!rect.width || !rect.height || cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.2) continue;
      const fg = lum(cs.color);
      if (!fg) continue;
      checked += 1;
      const bg = bgOf(el);
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      if (bg.image) {
        overPhoto.push(el.textContent.trim().slice(0, 40));
        continue;
      }
      const r = ratio(fg.l, bg.l);
      if (r < (large ? 3 : 4.5)) low.push(`${el.tagName.toLowerCase()} “${el.textContent.trim().slice(0, 40)}” ${r.toFixed(2)}:1`);
    }
    const html = document.documentElement.outerHTML;
    const navLinks = [...document.querySelectorAll("header nav a")].map((a) => a.getAttribute("href"));
    return {
      text: document.body.innerText.replace(/\s+/g, " ").length,
      overflow: document.documentElement.scrollWidth - innerWidth,
      unresolved: (html.match(/@(?:page|img|brand):[a-z0-9-]+/g) ?? []).slice(0, 5),
      brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute("src")),
      ribbon: Boolean(document.querySelector(".preview-ribbon")),
      legal: Boolean(document.querySelector(".rx-legal")),
      scripts: document.querySelectorAll("script").length,
      h1: document.querySelectorAll("h1").length,
      navLinks,
      ctaInHero: Boolean(document.querySelector("h1")?.closest("section")?.querySelector("a[href]")),
      contrastChecked: checked,
      lowContrast: low.slice(0, 8),
      textOverPhoto: overPhoto.slice(0, 5),
      custom: document.body.classList.contains("custom-look"),
    };
  });
  const pass = r.custom && r.text > 400 && r.overflow <= 1 && !r.unresolved.length && !r.brokenImages.length && r.ribbon && r.legal && !r.scripts && r.h1 === 1 && r.ctaInHero && !r.lowContrast.length;
  report.sizes[tag] = { ...r, pass };
  if (!pass) ok = false;
  console.log(`[check] ${tag}: ${pass ? "PASS" : "FAIL"} ${JSON.stringify(r)}`);
  await page.screenshot({ path: `${out}/custom-${tag}-top.png` });
  if (tag === "1280") await page.screenshot({ path: `${out}/custom-1280-full.png`, fullPage: true });
  await page.close();
}
await browser.close();
writeFileSync(`${out}/custom-check.json`, JSON.stringify(report, null, 1));
process.exit(ok ? 0 : 1);
