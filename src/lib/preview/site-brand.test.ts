import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { finalizeBlurb, startsLowercase } from "./blurb.ts";
import { brandAccents, brandInks, improvedCtas, improvedMood, improvedPalette, isTextGraphicLabel, isUiAccent, isWordmarkLike, pageIsDarkBrand } from "./site-brand.ts";
import type { SiteFacts } from "./types.ts";

const cafe = {
  mode: "reimagine",
  sourceUrl: "https://cafe501.com/",
  host: "cafe501.com",
  name: "Cafe 501",
  tagline: "",
  description: "Lunch, dinner, and brunch in Edmond.",
  logo: "",
  colors: ["#c45a12"],
  inks: ["#111111", "#fafafa"],
  phone: "(405) 555-0501",
  email: "",
  address: "501 S Boulevard, Edmond, OK 73034",
  hours: ["Mon–Sat 11–9"],
  services: ["Brunch", "Lunch", "Dinner"],
  about: "An American restaurant.",
  testimonials: [],
  images: [],
  nav: [{ label: "Menu", url: "https://cafe501.com/menu" }, { label: "Reservations", url: "https://cafe501.com/reservations" }],
  pages: [],
  social: [],
  industry: "restaurant",
  notes: "",
} as SiteFacts;

describe("blurb", () => {
  it("capitalizes a lowercase start and never cuts mid-sentence", () => {
    const raw = "daylong shared table where neighbors linger over plates and the light falls just so across the boulevard every afternoon in Edmond";
    const out = finalizeBlurb(raw, 80);
    assert.equal(out[0], "D");
    assert.equal(startsLowercase(out), false);
    assert.match(out, /[.!?]$/);
    assert.doesNotMatch(out, / just$/);
  });
});

describe("site brand", () => {
  it("keeps Cafe 501's black ground and a View Menu CTA", () => {
    assert.ok(brandInks(["background:#111111;color:#fff", "#111"], "#111111").includes("#111111"));
    const p = improvedPalette(cafe);
    const l = (hex: string) => {
      const h = hex.replace("#", "");
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return (r * 299 + g * 587 + b * 114) / 1000;
    };
    assert.ok(l(p.background) < 40, p.background);
    const ctas = improvedCtas(cafe);
    assert.equal(ctas.primary.label, "View Menu");
    const mood = improvedMood(cafe);
    assert.match(mood, /^Your current Cafe 501 look/);
    assert.match(mood, /black brand/);
    assert.match(mood, /View Menu/);
  });

  it("reads a Squarespace black homepage (Cafe 501) even when the CSS also has #fff", () => {
    const css = `:root{--white-hsl:0,0%,100%;--black-hsl:0,0%,0%;--siteBackgroundColor:hsla(var(--white-hsl),1)}:root{--siteBackgroundColor:hsla(var(--black-hsl),1)} .x{color:#fff;background:#000}`;
    const html = `<section data-section-theme="black"></section><section data-section-theme="black"></section><section data-section-theme="bright"></section>`;
    const inks = brandInks([css, html], "", html);
    assert.ok(inks[0] && ["#000000", "#000"].includes(inks[0]), String(inks));
    const p = improvedPalette({ name: "Cafe 501", colors: ["#f0523d"], inks });
    const l = (hex: string) => {
      const h = hex.replace("#", "");
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return (r * 299 + g * 587 + b * 114) / 1000;
    };
    assert.ok(l(p.background) < 40, p.background);
  });

  it("does not treat a CSS selector [data-section-theme=black] as a dark homepage", () => {
    const css = `[data-section-theme="black"]{--siteBackgroundColor:hsla(var(--black-hsl),1)} body{background:#fff;color:#000}`;
    assert.equal(pageIsDarkBrand([css], css), false);
    const inks = brandInks([css], "", "<body class=\"light\"></body>");
    const p = improvedPalette({ name: "Pauls Valley", colors: ["#1b365d"], inks, darkBrand: false });
    const l = (hex: string) => {
      const h = hex.replace("#", "");
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return (r * 299 + g * 587 + b * 114) / 1000;
    };
    assert.ok(l(p.background) > 200, p.background);
  });

  it("rejects cropped typography as hero art", () => {
    assert.equal(isTextGraphicLabel("FES ED"), true);
    assert.equal(isTextGraphicLabel("event lettering close crop"), true);
    assert.equal(isTextGraphicLabel(" griddle cakes and eggs "), false);
    assert.equal(isTextGraphicLabel("cafe-501-wordmark-banner.png"), true);
    assert.equal(isWordmarkLike("Cafe 501", "Cafe 501"), true);
    assert.equal(isWordmarkLike("CAFE 501 header logo", "Cafe 501"), true);
    assert.equal(isWordmarkLike("Cafe 501 dining room", "Cafe 501"), false);
    assert.equal(isWordmarkLike("Cafe Ed white.png cafe ed white", "Cafe 501"), false);
    assert.equal(isWordmarkLike("https://images.squarespace-cdn.com/content/v1/x/Cafe+501+Ed+white.png", "Cafe 501"), true);
    assert.equal(isWordmarkLike("background fx https://www.cafe501.com/ https://cafe501.com/menu", "Cafe 501"), false);
  });

  it("uses Cafe 501's CSS accent (slate navy), not Squarespace tooltip red or player yellow", () => {
    assert.equal(isUiAccent("#f0523d"), true);
    assert.equal(isUiAccent("#ffff00"), true);
    assert.equal(isUiAccent("#00b2ff"), true);
    assert.equal(isUiAccent("#243450"), false);
    const css = `:root{--accent-hsl: 218.18181818,37.28813559%,23.1372549%;--sqsp-palette-accent-color: hsla(218.18181818,37.28813559%,23.1372549%,1);--primaryButtonBackgroundColor: hsla(var(--accent-hsl),1)} .reject:hover{background-color:#f0523d} .plyr__control{color:#00b2ff} .x{color:#ffff00}`;
    const accents = brandAccents([css]);
    const navy = accents.find((c) => {
      const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
      return b > r && b >= g && r < 80 && b < 120;
    });
    assert.ok(navy, `expected a slate navy accent, got ${accents.join(", ")}`);
    assert.ok(!accents.includes("#f0523d") && !accents.includes("#ffff00") && !accents.includes("#00b2ff"), String(accents));
    const p = improvedPalette({ name: "Cafe 501", colors: accents, inks: ["#000000", "#ffffff"], darkBrand: true });
    const hex = (h: string) => h.toLowerCase();
    assert.ok(!["#f0523d", "#ffff00", "#00b2ff"].includes(hex(p.accent)), p.accent);
    assert.ok(!["#f0523d", "#ffff00", "#00b2ff"].includes(hex(p.primary)), p.primary);
    // The swatch stays in the slate family (hue ~218), not a gold fallback.
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [r, g, b] = rgb(p.accent.startsWith("#") && p.accent.length === 7 ? p.accent : "#243450");
    assert.ok(b > r && b >= g, `accent ${p.accent} should stay blue-slate`);
  });
});
