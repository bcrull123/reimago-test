import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contrast } from "./design.ts";
import { applyTheme, detectTheme, themeDirective, typoGloss, typoGlossFor, withTheme } from "./theme-lean.ts";
import type { DesignDirection, SitePalette } from "./types.ts";

const palette: SitePalette = { primary: "#1d3b2a", accent: "#c8553d", background: "#f6f1e7", surface: "#ece4d3", text: "#1a1a17", muted: "#5b574d" };

function dir(over: Partial<DesignDirection> = {}): DesignDirection {
  return {
    id: "look-1",
    name: "Editorial",
    archetype: "editorial",
    mood: "A calm, modern restaurant.",
    rationale: "Fits a typical eatery.",
    palette: { ...palette },
    fonts: { heading: "Cormorant Garamond", body: "Libre Franklin" },
    imagery: "daylight dining room",
    heroSubject: "a set table",
    featureScene: "a kitchen",
    motifs: ["thin-rules"],
    radius: "soft",
    buttons: "pill",
    heroStyle: "framed",
    hero: "split",
    header: "light",
    footer: "columns",
    headline: "Come *hungry* tonight",
    ...over,
  };
}

describe("typo gloss", () => {
  it("reads scarry as scary and resturant as restaurant, without rewriting other words", () => {
    assert.deepEqual(typoGloss("scarry resturant in town"), ['"scarry" is read as "scary"', '"resturant" is read as "restaurant"']);
    assert.deepEqual(typoGloss("warm and trustworthy"), []);
  });
});

describe("detectTheme", () => {
  it("catches Bob's freak show brief, including the misspelling scarry", () => {
    const facts = {
      name: "freak show resturant",
      tagline: "We serve eyeballs and brains",
      description: "We serve eyeballs and brains",
      notes: "Style: scarry",
    };
    const hit = detectTheme(facts);
    assert.ok(hit);
    assert.equal(hit!.id, "horror");
    assert.match(hit!.phrase, /scarry|eyeballs|brains|freak/i);
    const rule = themeDirective(facts);
    assert.match(rule, /THEME DIRECTION/);
    assert.match(rule, /scarry/i);
    assert.match(typoGlossFor(facts).join(" "), /scary/);
    assert.match(withTheme("Style: scarry", facts), /THEME DIRECTION/);
  });

  it("does not theme a normal restaurant or a plain business site", () => {
    assert.equal(detectTheme({ name: "Riverside Plumbing", description: "Emergency repairs in Tulsa", notes: "warm and trustworthy. Navy and copper." }), undefined);
    assert.equal(detectTheme({ name: "Maple Street Bakery", description: "Family-run bakery", notes: "" }), undefined);
    assert.equal(themeDirective({ notes: "make it bolder" }), "");
  });
});

describe("applyTheme", () => {
  it("forces dark themed palettes and creepy display fonts on all three looks, and keeps them distinct", () => {
    const facts = { name: "freak show resturant", notes: "Style: scarry", description: "We serve eyeballs and brains" };
    const out = applyTheme([dir(), dir({ name: "Bold Photo", archetype: "bold-photo" }), dir({ name: "Custom Design" })], facts);
    assert.equal(out.length, 3);
    const fonts = new Set(out.map((d) => d.fonts.heading));
    assert.equal(fonts.size, 3);
    for (const d of out) {
      assert.ok(contrast(d.palette.text, d.palette.background) >= 4.5, d.fonts.heading);
      assert.ok(contrast(d.palette.muted, d.palette.background) >= 4.5, d.fonts.heading);
      assert.match(d.fonts.heading, /Creepster|Eater|Nosifer|Pirata One|New Rocker|Griffy/);
      assert.ok(d.palette.background !== palette.background, "must leave the generic beige palette");
    }
  });

  it("leaves a normal business alone and does not override an era look's palette", () => {
    const plain = applyTheme([dir()], { name: "Riverside Plumbing", notes: "" });
    assert.equal(plain[0]!.fonts.heading, "Cormorant Garamond");
    assert.equal(plain[0]!.palette.background, palette.background);
    const era = applyTheme([dir({ era: { id: "web90s", variant: 0 } })], { notes: "Style: scarry" });
    assert.equal(era[0]!.palette.background, palette.background);
    assert.match(era[0]!.mood, /macabre|carnival|sideshow|cabinet/i);
  });
});
