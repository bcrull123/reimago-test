/**
 * Round 14 e2e (mock AI): Bob's freak show input must not show the refine error,
 * looks must lean into the horror theme, and a free-form "show ey" card edit
 * must not dead-end. Also runs a normal restaurant and a plumbing business.
 *
 *   APP_URL=http://localhost:8090 CHROME_PATH=/usr/bin/google-chrome \
 *     node scripts/round14-e2e.mjs /workspace/live-preview-shots/round14
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = process.env.APP_URL || "http://localhost:8090";
const outDir = process.argv[2] || "/workspace/live-preview-shots/round14";
mkdirSync(outDir, { recursive: true });
const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
await context.route("**/formcarry.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"code":200}' }));

async function openNewSite() {
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator('[data-mode="newsite"], [data-mode="new_site"], button:has-text("Build a New Site")').first().click();
  return page;
}

async function fillNewSite(page, { name, city, what, style, email = "e2e-test@example.com" }) {
  await page.locator("#ns-name").fill(name);
  await page.locator("#ns-location").fill(city);
  await page.locator("#ns-what").fill(what);
  if (style) await page.locator("#ns-style").fill(style);
  const get = page.getByText(/Get me a domain/i).first();
  if (await get.count()) await get.click();
  const emailBox = page.locator("#ns-email, input[name='email'][type='email']").first();
  await emailBox.fill(email);
  const terms = page.locator('input[type="checkbox"]').last();
  if (!(await terms.isChecked())) await terms.check();
}

async function waitLooks(page) {
  // Domain pop-up may cover the looks; dismiss it if present.
  await page.locator("[data-look]").nth(2).waitFor({ timeout: 180_000 });
  await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 60_000 }).catch(() => undefined);
  const close = page.locator("[data-domain-close], [data-domain-modal] button:has-text('Skip for now'), [data-domain-modal] button:has-text('Close')").first();
  if (await page.locator("[data-domain-modal]").count()) {
    if (await close.count()) await close.click();
    else await page.locator("[data-domain-modal]").press("Escape").catch(() => undefined);
    await page.locator("[data-domain-modal]").waitFor({ state: "detached", timeout: 10_000 }).catch(() => undefined);
  }
  await page.waitForTimeout(800);
}

const lookIds = (page) => page.locator("[data-look]").evaluateAll((els) => els.map((e) => e.getAttribute("data-look")));
const bodyOf = async (id) => (await fetch(`${base}/made/${id}`)).text();

// 1. Bob's exact freak show input
{
  const page = await openNewSite();
  await fillNewSite(page, {
    name: "freak show resturant",
    city: "liversworth, tn",
    what: "We serve eyeballs and brains",
    style: "scarry",
  });
  await page.getByRole("button", { name: /Build my new site/i }).click();
  await waitLooks(page);
  const body = await page.locator("body").innerText();
  check("No refine dead-end on the first New Site build", !/couldn't tell what to change/i.test(body));
  check("Looks are ready (three cards)", (await page.locator("[data-look]").count()) >= 3);
  await page.screenshot({ path: join(outDir, "01-freakshow-cards.png"), fullPage: true });
  const ids = await lookIds(page);
  const fonts = [];
  for (let i = 0; i < ids.length; i++) {
    const html = await bodyOf(ids[i]);
    const font = html.match(/--hf:[^;]*"([^"]+)"/)?.[1] || html.match(/family=([A-Za-z+\-]+)[:&]/)?.[1]?.replace(/\+/g, " ") || "";
    const cls = html.match(/<body[^>]*class="([^"]*)"/)?.[1] ?? "";
    fonts.push(font || cls);
    await page.locator(`[data-look="${ids[i]}"]`).scrollIntoViewIfNeeded();
    // open preview
    const btn = page.locator(`[data-look="${ids[i]}"]`).getByRole("button", { name: /Preview/i }).first();
    if (await btn.count()) await btn.click().catch(() => undefined);
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(outDir, `02-freakshow-look-${i + 1}.png`), fullPage: false });
    const themed = /Creepster|Eater|Nosifer|Pirata One|New Rocker|Griffy|Special Elite/i.test(html) || /#0b0b0d|#8b1018|#140a0c|#0b0b0d/i.test(html);
    check(`Look ${i + 1} leans into the horror theme (fonts or dark palette)`, themed, font || cls.slice(0, 80));
  }
  // Change boxes should start empty (placeholder only)
  const values = await page.locator("[data-card-edit-text]").evaluateAll((els) => els.map((e) => e.value));
  check("Change boxes are empty on first paint (not prefilled with 'show ey')", values.every((v) => !String(v).trim()), JSON.stringify(values));

  // Submit a free-form "show ey" on the second card — must not show the old error
  const box = page.locator("[data-card-edit]").nth(1);
  const input = box.locator("[data-card-edit-text]");
  await input.click();
  await input.fill("show ey");
  await box.locator("[data-card-edit-submit]").click();
  await page.waitForTimeout(3000);
  const after = await page.locator("body").innerText();
  check("Free-form 'show ey' on a card does not show the refine error", !/couldn't tell what to change/i.test(after));
  await page.screenshot({ path: join(outDir, "03-show-ey-no-error.png"), fullPage: true });
  await page.close();
}

// 2. Normal restaurant
{
  const page = await openNewSite();
  await fillNewSite(page, {
    name: "Maple Street Bakery",
    city: "Tulsa, OK",
    what: "Family-run bakery known for sourdough and Saturday cinnamon rolls.",
    style: "warm and friendly",
  });
  await page.getByRole("button", { name: /Build my new site/i }).click();
  await waitLooks(page);
  await page.screenshot({ path: join(outDir, "04-normal-bakery.png"), fullPage: true });
  const ids = await lookIds(page);
  const html = ids[0] ? await bodyOf(ids[0]) : "";
  check("A normal bakery is not forced into Creepster / horror fonts", !/Creepster|Eater|Nosifer/i.test(html));
  await page.close();
}

// 3. Normal business
{
  const page = await openNewSite();
  await fillNewSite(page, {
    name: "Riverside Plumbing",
    city: "Austin, Texas",
    what: "Emergency plumbing repairs and water heaters for homeowners on the east side.",
    style: "trustworthy navy and copper",
  });
  await page.getByRole("button", { name: /Build my new site/i }).click();
  await waitLooks(page);
  await page.screenshot({ path: join(outDir, "05-normal-plumbing.png"), fullPage: true });
  check("A plumbing business builds three looks", (await page.locator("[data-look]").count()) >= 3);
  await page.close();
}

await browser.close();
const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
