import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isBetter, mergeScores, parseAiScores, structuralMisses, structuralScore, withTotal } from "./qa.ts";
import type { DesignDirection, Section, SitePalette } from "./types.ts";

const light: SitePalette = { primary: "#1d3b2a", accent: "#c8553d", background: "#f6f1e7", surface: "#ece4d3", text: "#1a1a17", muted: "#5b574d" };
const dark: SitePalette = { primary: "#8b1018", accent: "#e8c547", background: "#0b0b0d", surface: "#1a1214", text: "#f4eee6", muted: "#b9aea3" };

function dir(over: Partial<DesignDirection> = {}): DesignDirection {
  return {
    id: "look-1",
    name: "Editorial",
    archetype: "editorial",
    mood: "A calm, modern bakery.",
    rationale: "Fits a typical bakery.",
    palette: { ...light },
    fonts: { heading: "Cormorant Garamond", body: "Libre Franklin" },
    imagery: "daylight bakery counter",
    heroSubject: "a tray of cinnamon rolls",
    featureScene: "a kitchen",
    motifs: ["thin-rules"],
    radius: "soft",
    buttons: "pill",
    heroStyle: "framed",
    hero: "split",
    header: "light",
    footer: "columns",
    headline: "Sourdough, still warm",
    layout: "editorial",
    ...over,
  };
}

function sections(over: Partial<Section>[] = []): Section[] {
  const base: Section[] = [
    { type: "hero-split", tone: "dark", heading: "Sourdough, still warm at 7 a.m.", text: "Family-run bakery on Maple Street.", cta: { label: "See this week's bakes", page: "menu" } },
    { type: "statement", tone: "light", heading: "Baked before dawn", text: "We start the ovens at four so the cinnamon rolls are ready for Saturday." },
    { type: "services-grid", tone: "light", heading: "What we bake", items: [{ title: "Sourdough", text: "A two-day loaf." }, { title: "Cinnamon rolls", text: "Saturday only." }] },
    { type: "reviews", tone: "tint", heading: "From regulars", text: "The best loaf in Tulsa." },
    { type: "cta-band", tone: "dark", heading: "Come hungry this weekend", cta: { label: "Visit us", page: "contact" } },
  ];
  return over.length ? over.map((o, i) => ({ ...base[Math.min(i, base.length - 1)]!, ...o })) : base;
}

describe("structuralScore", () => {
  it("scores a normal bakery look highly on style match (no horror fonts)", () => {
    const scores = structuralScore({ design: dir(), sections: sections(), facts: { name: "Maple Street Bakery", notes: "warm and friendly" } });
    assert.ok(scores.styleMatch >= 70, `styleMatch ${scores.styleMatch}`);
    assert.ok(scores.total >= 60, `total ${scores.total}`);
    assert.ok(scores.contrast >= 60, `contrast ${scores.contrast}`);
    assert.equal(structuralMisses({ design: dir(), sections: sections(), scores }).length, 0);
  });

  it("rewards a dark, themed horror look when the brief is 'scarry'", () => {
    const horror = dir({
      name: "Midnight Cabinet",
      mood: "Unsettling carnival sideshow",
      imagery: "a dim sideshow tent",
      palette: { ...dark },
      fonts: { heading: "Creepster", body: "Libre Franklin" },
    });
    const look: Section[] = [
      { type: "hero-photo", tone: "dark", heading: "Eyeballs, brains, and a midnight bill", text: "The freak show resturant in Liversworth.", cta: { label: "Step inside", page: "menu" } },
      { type: "statement", tone: "dark", heading: "What we serve", text: "Eyeballs and brains, plated under a single bulb." },
      { type: "cta-band", tone: "dark", heading: "Buy a ticket", cta: { label: "Reserve a table", page: "contact" } },
    ];
    const good = structuralScore({ design: horror, sections: look, facts: { name: "freak show resturant", notes: "scarry", description: "We serve eyeballs and brains" } });
    const lightBakeryOnHorrorBrief = structuralScore({
      design: dir(),
      sections: sections(),
      facts: { name: "freak show resturant", notes: "scarry", description: "We serve eyeballs and brains" },
    });
    assert.ok(good.styleMatch >= 80, `horror styleMatch ${good.styleMatch}`);
    assert.ok(lightBakeryOnHorrorBrief.styleMatch < 50, `mismatched styleMatch ${lightBakeryOnHorrorBrief.styleMatch}`);
    assert.ok(structuralMisses({ design: dir(), sections: sections(), scores: lightBakeryOnHorrorBrief }).some((m) => /theme|style/i.test(m)));
  });

  it("flags a generic welcome headline and bland copy", () => {
    const weak: Section[] = [
      { type: "page-hero", tone: "light", heading: "Welcome", text: "Welcome to our one-stop shop. We are proud to serve the community." },
      { type: "statement", tone: "light", heading: "About", text: "Quality you can trust." },
    ];
    const scores = structuralScore({ design: dir({ fonts: { heading: "Libre Franklin", body: "Libre Franklin" } }), sections: weak });
    assert.ok(scores.hierarchy < 55, `hierarchy ${scores.hierarchy}`);
    assert.ok(scores.blandness < 70, `blandness ${scores.blandness}`);
    const misses = structuralMisses({ design: dir({ fonts: { heading: "Libre Franklin", body: "Libre Franklin" } }), sections: weak, scores });
    assert.ok(misses.some((m) => /headline|generic|bland|font|call to action/i.test(m)), misses.join("; "));
  });
});

describe("score helpers", () => {
  it("parses and merges AI scores without letting them hide a contrast miss", () => {
    const structural = withTotal({ hierarchy: 80, typeScale: 80, spacing: 80, contrast: 20, styleMatch: 80, mobile: 80, blandness: 80, distinctness: 80 });
    const ai = parseAiScores({ hierarchy: 99, contrast: 99, junk: "no" });
    assert.equal(ai?.hierarchy, 99);
    assert.ok(ai && !("junk" in ai));
    const merged = mergeScores(structural, ai);
    // 0.7 * 99 + 0.3 * 20 = 75.3 → 75, not a free 99
    assert.equal(merged.contrast, 75);
    assert.equal(merged.hierarchy, Math.round(99 * 0.7 + 80 * 0.3));
  });

  it("isBetter prefers the higher total, then contrast + style + hierarchy", () => {
    const a = withTotal({ hierarchy: 70, typeScale: 70, spacing: 70, contrast: 70, styleMatch: 70, mobile: 70, blandness: 70, distinctness: 70 });
    const b = { ...a, total: a.total + 1 };
    assert.equal(isBetter(b, a), true);
    assert.equal(isBetter(a, b), false);
    const sameTotalBetterContrast = { ...a, contrast: 90, hierarchy: 50, styleMatch: 90 };
    // totals are equal; contrast+style+hierarchy 90+90+50=230 vs 70*3=210
    assert.equal(isBetter(sameTotalBetterContrast, a), true);
  });
});


describe("sibling sameness", () => {
  it("lowers distinctness when a look shares its palette, serif and layout with a sibling", () => {
    const one = dir({ fonts: { heading: "DM Serif Display", body: "Libre Franklin" } });
    const two = dir({ name: "Also Editorial", fonts: { heading: "Fraunces", body: "Source Sans 3" } });
    const low = structuralScore({ design: one, sections: sections(), siblings: [two] });
    const high = structuralScore({
      design: dir({
        name: "Night",
        palette: dark,
        fonts: { heading: "Space Grotesk", body: "Manrope" },
        hero: "photo",
        heroStyle: "cinematic",
      }),
      sections: sections(),
      siblings: [one],
    });
    assert.ok(low.distinctness < 70, `alike distinctness ${low.distinctness}`);
    assert.ok(high.distinctness >= 80, `different distinctness ${high.distinctness}`);
    assert.ok(high.total !== low.total || high.distinctness !== low.distinctness);
  });
});
