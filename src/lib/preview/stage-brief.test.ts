import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { briefFromDirection, briefJson, differsHowFor } from "./stage-brief.ts";
import type { DesignDirection, SitePalette } from "./types.ts";

const palette: SitePalette = { primary: "#1d3b2a", accent: "#c8553d", background: "#f6f1e7", surface: "#ece4d3", text: "#1a1a17", muted: "#5b574d" };

function dir(over: Partial<DesignDirection> = {}): DesignDirection {
  return {
    id: "look-1",
    name: "Editorial",
    archetype: "editorial",
    mood: "A calm, modern bakery.",
    rationale: "Fits a typical bakery.",
    palette: { ...palette },
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
    headline: "Come *hungry* tonight",
    ...over,
  };
}

describe("briefFromDirection", () => {
  it("reads 'scarry' as a horror theme and records the style word", () => {
    const brief = briefFromDirection(dir({ name: "Midnight Cabinet", mood: "Unsettling carnival", imagery: "a dim sideshow tent" }), {
      name: "freak show resturant",
      notes: "scarry",
      description: "We serve eyeballs and brains",
    });
    assert.equal(brief.theme, "horror");
    assert.ok(brief.styleWords?.some((w) => /scarry/.test(w)));
    assert.equal(brief.archetype, "editorial");
    assert.equal(brief.name, "Midnight Cabinet");
  });

  it("leaves a normal bakery without a theme so later steps do not force horror", () => {
    const brief = briefFromDirection(dir(), {
      name: "Maple Street Bakery",
      description: "Family-run bakery known for sourdough.",
      notes: "warm and friendly",
    });
    assert.equal(brief.theme, undefined);
    assert.ok(!brief.styleWords?.length);
  });

  it("serializes with a stable key order for the same input (prompt cache)", () => {
    const a = briefFromDirection(dir({ era: { id: "web90s", variant: 0 } }));
    const b = briefFromDirection(dir({ era: { id: "web90s", variant: 0 } }));
    assert.equal(briefJson(a), briefJson(b));
    assert.match(briefJson(a), /"web90s"/);
  });

  it("tells each look how it must differ from the others", () => {
    const looks = [dir({ name: "Editorial", heroStyle: "framed" }), dir({ name: "Bold Photo", archetype: "bold-photo", hero: "photo", heroStyle: "cinematic" }), dir({ name: "Custom Design", archetype: "minimal-luxury", hero: "type" })];
    const line = differsHowFor(looks, 0);
    assert.match(line, /Bold Photo/);
    assert.match(line, /Custom Design/);
    assert.ok(!/“Editorial”/.test(line));
  });
});
