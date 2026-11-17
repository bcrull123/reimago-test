import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanBrief, customFontsHref, fallbackBrief, sanitizeCss, sanitizeCustomHtml, validateCustom, type ValidateContext } from "./custom-design.ts";
import { brandOnlyMatch, briefQueries, heroBrief } from "./hero-brief.ts";
import { passesBar, heroScore, type HeroCandidate } from "./hero-pick.ts";
import { findTargetLook, type LookRef } from "./look-edit.ts";
import type { SiteFacts } from "./types.ts";

// The stand-in AI's realistic answer (plain JS helper, loaded at run time so tsc doesn't type-check it).
const helper = "../../../scripts/fake-custom-design.mjs";
const { fakeDesign } = (await import(helper)) as { fakeDesign: (system: string, user: string, mode: string) => { css: string; html: string } };

const palette = { primary: "#ff5a36", accent: "#7c5cff", background: "#0b1026", surface: "#141a3a", text: "#f4f5ff", muted: "#b9bfe6" };
const site = {
  name: "Bob.me",
  kind: "community for startup founders",
  tagline: "How to Start your Business",
  phone: "(405) 555-0100",
  email: "hi@bob.me",
  pages: [
    { href: "@page:home", label: "Home" },
    { href: "@page:community", label: "Community" },
    { href: "@page:contact", label: "Contact" },
  ],
  cta: { label: "Join the community", href: "@page:contact" },
  images: [{ src: "@img:hero", shows: "a rocket", kind: "owner's art (keep)" }],
  services: ["Naming", "Domains", "Websites"],
  ownerAskedToKeep: "the rocket",
};
const prompt = (s: object) => `Creative brief: ${JSON.stringify({ concept: "The Launchpad", headline: "Your idea, cleared for launch." })}\nSite: ${JSON.stringify(s)}`;
const ctx: ValidateContext = { pages: ["home", "community", "contact"], cta: "contact", images: ["hero"], social: [], phone: "(405) 555-0100", email: "hi@bob.me", name: "Bob.me", keep: true, heroImage: true, palette };
const run = (mode: "ok" | "broken", over: Partial<ValidateContext> = {}) => {
  const d = fakeDesign("", prompt(site), mode) as { css: string; html: string };
  const stripped: string[] = [];
  const clean = sanitizeCustomHtml(d.html, { ...ctx, ...over });
  const css = sanitizeCss(d.css, ctx, stripped) + clean.css;
  return { html: clean.html, css, stripped: [...stripped, ...clean.stripped], problems: validateCustom(clean.html, css, { ...ctx, ...over }) };
};

describe("custom look: sanitize + validate", () => {
  it("a good from-scratch page passes", () => {
    const r = run("ok");
    assert.deepEqual(r.problems, []);
    assert.ok(r.html.includes("@img:hero") && r.html.includes("<svg"));
  });
  it("a broken draft is cleaned (script, handler, external image/link) and fails the checks (nav, contrast, width)", () => {
    const r = run("broken");
    assert.ok(!/<script|onclick|example\.com|evil\.example/.test(r.html), r.html.slice(-400));
    assert.ok(r.stripped.some((s) => /script/.test(s)) && r.stripped.some((s) => /handler/.test(s)));
    const all = r.problems.join(" ");
    assert.match(all, /missing: @page:community/);
    assert.match(all, /contrast below WCAG AA/);
    assert.match(all, /1400px/);
  });
  it("keep: the owner's picture must be on the page", () => {
    const d = fakeDesign("", prompt({ ...site, images: [] }), "ok") as { css: string; html: string };
    assert.match(validateCustom(d.html, d.css, ctx).join(" "), /keep their picture/);
  });
  it("links: invented phones and unknown pages go to the CTA page; tel of the business stays", () => {
    const out = sanitizeCustomHtml('<a href="tel:+19999999999">x</a><a href="tel:4055550100">y</a><a href="@page:pricing">z</a><a href="https://evil.example">w</a><a href="#top">t</a>', ctx);
    assert.equal((out.html.match(/@page:contact/g) ?? []).length, 3);
    assert.ok(out.html.includes('href="tel:4055550100"') && out.html.includes('href="#top"'));
  });
  it("css: no imports, font-faces or external urls", () => {
    const stripped: string[] = [];
    const css = sanitizeCss("@import url(https://x.com/a.css);@font-face{font-family:x;src:url(https://x.com/f.woff)}.a{background:url(https://x.com/i.png)}.b{background:url(@img:hero)}", { images: ["hero"] }, stripped);
    assert.ok(!/https/.test(css) && css.includes("url(@img:hero)"));
  });
  it("brief: model JSON cleaned, bad fonts and unreadable palettes replaced", () => {
    const fb = fallbackBrief("startup-community", "Bob.me", palette);
    const b = cleanBrief({ concept: "The Launchpad", typography: { heading: "Space Grotesk; } body{", body: "Inter" }, palette: { text: "#111111", background: "#121212" } }, fb);
    assert.equal(b.concept, "The Launchpad");
    assert.equal(b.typography.heading, fb.typography.heading);
    assert.equal(b.by, "ai");
    assert.ok(customFontsHref({ heading: "Space Grotesk", body: "Inter" }).includes("family=Space+Grotesk&family=Inter"));
  });
});

describe("Wolf River Bob (round 5): brand-name matches are not relevance", () => {
  const bob = { mode: "reimagine", sourceUrl: "https://bob.me/", host: "bob.me", name: "Bob.me", tagline: "How to Start your Business", description: "", industry: "", services: ["Bob.me Golf Hat", "Bob.me White Hat", "Bob.me Golf Shirt", "Specs", "Description", "Forum Description", "Report"], phone: "", email: "", address: "", hours: [], social: [], colors: [], logo: "", images: [], pages: [], notes: "" } as unknown as SiteFacts;
  it("bob.me reads as a startup community, and never searches its name or its merch", () => {
    const b = heroBrief(bob);
    assert.equal(b.category, "startup-community");
    const q = briefQueries(bob, b);
    assert.ok(q.length && q.every((x) => !/\bbob\b|hat/i.test(x)), JSON.stringify(q));
  });
  it("a photo matched only by the brand word is off-topic, and an unrated free-license photo never passes", () => {
    assert.ok(brandOnlyMatch("Wolf River Bob 10-1974", bob, ["startup founders working together"]));
    assert.ok(!brandOnlyMatch("Founders working together at a startup meetup", bob, ["startup founders working together"]));
    assert.ok(heroBrief(bob).offTopic.test("Wolf River Bob 10-1974 portrait"));
    const web: HeroCandidate = { id: "w", source: "web", text: "Wolf River Bob 10-1974", width: 1920, height: 1280, relevance: 1.5, stats: { mean: 0.45, contrast: 0.25, saturation: 0.25, sky: 0.1, green: 0.1, warm: 0.05 } as never };
    assert.ok(!passesBar(heroScore(web)));
    assert.ok(!passesBar(heroScore({ ...web, appeal: 8, offTopic: true })), "off-topic fails even with a high rating");
  });
});

describe("refine targets the custom look", () => {
  const looks: LookRef[] = [
    { id: "a", name: "Editorial", archetype: "editorial", index: 0 },
    { id: "b", name: "Dark Premium", archetype: "dark-premium", index: 1 },
    { id: "c", name: "Custom Design", archetype: "playful", index: 2, custom: true },
  ];
  it("“make the custom one darker”, “custom design”, “the from-scratch one”", () => {
    assert.equal(findTargetLook("make the custom one darker", looks)?.id, "c");
    assert.equal(findTargetLook("Custom Design is too bright", looks)?.id, "c");
    assert.equal(findTargetLook("the from-scratch one, a bit lighter", looks)?.id, "c");
    assert.equal(findTargetLook("make the playful one darker", looks)?.id, undefined);
    assert.equal(findTargetLook("make dark premium lighter", looks)?.id, "b");
  });
});

describe("contrast: inherited backgrounds", () => {
  it("“01” in accent on the step card's surface is caught (Pauls Valley browser check, round 5)", () => {
    const town = { primary: "#b5452b", accent: "#e8a33d", background: "#fbf4e8", surface: "#f3e6cf", text: "#2a1d14", muted: "#5e4a3a" };
    const css = ".steps li{background:var(--surface);color:var(--text)}.steps li b{color:var(--accent)}@media (max-width:720px){.x{display:block}}";
    const problems = validateCustom("<header><nav></nav></header>", css, { ...ctx, pages: [], keep: false, heroImage: false, palette: town });
    assert.match(problems.join(" "), /\.steps li b: #e8a33d on #f3e6cf/);
  });
});

describe("contrast: fixed automatically, never a reason to fall back", () => {
  const pal = { primary: "#e85d04", accent: "#e85d04", background: "#fff8f0", surface: "#ffffff", text: "#1a1a1a", muted: "#555555" };
  it("Bob's round 2 failure (.cta-nav #ffffff on #e85d04 = 3.50:1) is fixed by darkening the button, same hue", async () => {
    const { autoFixContrast } = await import("./custom-design.ts");
    const css = ".cta-nav{background:#e85d04;color:#ffffff;padding:1rem}.btn{background:var(--primary);color:#fff}@media (max-width:720px){.cta-nav{background:#e85d04;color:#fff}}.steps li{background:var(--surface)}.steps li b{color:#ffb38a}";
    const out = autoFixContrast(css, pal);
    assert.ok(out.fixes.length >= 3, out.fixes.join(" | "));
    const problems = validateCustom("<header><nav></nav></header>", out.css, { ...ctx, pages: [], keep: false, heroImage: false, palette: pal });
    assert.doesNotMatch(problems.join(" "), /contrast/i);
    const bg = out.css.match(/\.cta-nav\{background:(#[0-9a-f]{6})/)![1]!;
    assert.notEqual(bg, "#e85d04");
    // Still orange: red channel dominant, darker.
    assert.ok(parseInt(bg.slice(1, 3), 16) > parseInt(bg.slice(5, 7), 16));
    assert.match(out.css, /padding:1rem/);
  });
  it("contrast problems are not structural", async () => {
    const { isStructuralProblem } = await import("./custom-design.ts");
    assert.equal(isStructuralProblem("Text contrast below WCAG AA: .btn: #ffffff on #e85d04 = 3.50:1 (needs 4.5:1)."), false);
    assert.equal(isStructuralProblem("There must be a <footer>."), true);
  });
});

describe("Imagine first, then Grok builds", () => {
  const brief = { ...fallbackBrief("startup-community", "Bob.me", palette), headline: "Light the rocket. Build with peers." };
  const cctx = {
    name: "Bob.me",
    tagline: "How to Start your Business",
    description: "",
    services: ["Naming", "Domains", "Websites"],
    phone: "(405) 555-0100",
    email: "",
    address: "",
    hours: [],
    social: [],
    pages: [
      { slug: "home", label: "Home" },
      { slug: "groups", label: "Groups" },
      { slug: "contact", label: "Contact" },
    ],
    cta: { label: "Get in touch", slug: "contact" },
    images: [
      { name: "hero", alt: "founders meetup in our space", kind: "the business's own photo" as const },
      { name: "photo-1", alt: "our coworking floor", kind: "the business's own photo" as const },
    ],
    request: "include a rocket",
    category: "startup-community",
    kind: "community for startup founders",
    hasLogo: true,
  };
  it("the mockup prompt has the real name, nav, headline, button, the site's own photos and the owner's request", async () => {
    const { mockupPrompt } = await import("./custom-design.ts");
    const p = mockupPrompt(cctx, brief);
    for (const want of ["Bob.me", "Home, Groups, Contact", "Light the rocket. Build with peers.", "Get in touch", "founders meetup in our space", "the business's real photo", "our coworking floor", "include a rocket", "no watermark"]) assert.ok(p.includes(want), want);
    assert.ok(p.length <= 3600);
  });
  it("keep: the mockup must show the owner's own picture whole", async () => {
    const { mockupPrompt } = await import("./custom-design.ts");
    assert.match(mockupPrompt({ ...cctx, keep: "the rocket" }, brief), /owner's own picture: the rocket .*WHOLE/);
  });
  it("the vision build prompt asks to match the mockup, use the real photo files and keeps the technical contract", async () => {
    const { mockupBuildPrompt, MOCKUP_MARKER } = await import("./custom-design.ts");
    const p = mockupBuildPrompt(cctx, brief);
    assert.ok(p.system.startsWith(MOCKUP_MARKER));
    assert.match(p.system, /REAL files given/);
    assert.match(p.system, /region by region/);
    assert.match(mockupBuildPrompt(cctx, brief, "Colors sampled from the mockup's pixels (match them): hero area #101820 (dark)").system, /hero area #101820/);
    assert.match(p.system, /never try to reproduce photo pixels/);
    assert.match(p.system, /Technical contract/);
    assert.match(p.system, /"assets"/);
    assert.match(p.user, /the business's own photo/);
  });
});

describe("mockup fidelity (render-free)", () => {
  // A 100x100 RGBA mockup: dark navy header + hero, an orange band at the bottom.
  const W = 100, H = 100;
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1)
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      const [r, g, b] = y >= 75 ? [255, 90, 54] : [11, 16, 38];
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  it("samples the mockup's bands and main colors from its pixels", async () => {
    const { mockupColors, mockupColorsText } = await import("./custom-design.ts");
    const m = mockupColors(px, W, H);
    assert.deepEqual(m.bands.map((b) => b.tone), ["dark", "dark", "mid"]);
    assert.ok(m.palette.length >= 2);
    assert.match(mockupColorsText(m), /hero area #0[0-9a-f]{5} \(dark\)/);
  });
  it("a page that follows the mockup scores high; a plain white one scores low and says what differs", async () => {
    const { mockupColors, fidelityScore } = await import("./custom-design.ts");
    const m = mockupColors(px, W, H);
    const html = `<header class="top"></header><main><section class="hero"></section><section class="band"></section></main><footer></footer>`;
    const good = fidelityScore(m, html, `body{background:#0b1026;color:#fff}.band{background:#ff5a36;color:#000}`, palette);
    const plain = fidelityScore(m, html, `body{background:#ffffff;color:#111}.hero{background:#ffffff}.band{background:#f4f4f4}`, { ...palette, background: "#ffffff", surface: "#f4f4f4", primary: "#222222", accent: "#444444" });
    assert.ok(good.score >= 80, `good ${good.score}`);
    assert.ok(plain.score < 60, `plain ${plain.score}`);
    assert.ok(plain.diff.some((d) => /hero area is dark/.test(d)));
  });
});
