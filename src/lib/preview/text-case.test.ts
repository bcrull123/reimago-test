import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanCaption,
  headlineCaseFor,
  isHumanCaption,
  normalizeHeadline,
  normalizeLead,
  properNounsFrom,
  readDictatedCopy,
  toSentenceCase,
  toTitleCase,
} from "./text-case.ts";

const proper = properNounsFrom({ name: "Pauls Valley, Oklahoma" });

describe("normalizeHeadline", () => {
  it("sentence-cases Bob's raw refine “explore our Brick streets”", () => {
    assert.equal(normalizeHeadline("explore our Brick streets", "sentence", proper), "Explore our brick streets");
  });

  it("title-cases the same phrase consistently", () => {
    assert.equal(normalizeHeadline("explore our Brick streets", "title", proper), "Explore Our Brick Streets");
  });

  it("preserves Pauls Valley, Oklahoma, and OSU", () => {
    assert.equal(toSentenceCase("welcome to pauls valley, oklahoma", proper), "Welcome to Pauls Valley, Oklahoma");
    assert.equal(toTitleCase("a weekend at osu in oklahoma", proper), "A Weekend at OSU in Oklahoma");
    assert.match(normalizeLead("visit osu this fall in pauls valley.", proper), /OSU/);
    assert.match(normalizeLead("visit osu this fall in pauls valley.", proper), /Pauls Valley/);
  });

  it("matches the look: editorial stays sentence when the current heading is sentence case", () => {
    assert.equal(headlineCaseFor({ archetype: "editorial", fonts: { heading: "Libre Caslon Display" } }, "Where the Valley unites us all"), "sentence");
    assert.equal(headlineCaseFor({ archetype: "dark-premium", fonts: { heading: "Space Grotesk" } }, "Explore and Connect in Pauls Valley"), "title");
    // Condensed / all-caps looks store title case; CSS applies uppercase.
    assert.equal(headlineCaseFor({ archetype: "playful", fonts: { heading: "Oswald" } }), "title");
  });
});

describe("readDictatedCopy", () => {
  it("reads Bob's “Have it say explore our Brick streets”", () => {
    const copy = readDictatedCopy("Have it say explore our Brick streets");
    assert.equal(copy?.headline, "explore our Brick streets");
  });

  it("reads a quoted change-the-headline request", () => {
    const copy = readDictatedCopy("change the headline to “Dinner after dark”");
    assert.equal(copy?.headline, "Dinner after dark");
  });
});

describe("isHumanCaption", () => {
  it("rejects leaked alt/class junk from the Custom Design Art line", () => {
    assert.equal(isHumanCaption("Marquee path group yui text hitbox focus"), false);
    assert.equal(cleanCaption("Marquee path group yui text hitbox focus"), undefined);
    assert.equal(cleanCaption("A park with a circular flower bed"), "A park with a circular flower bed");
    assert.ok(isHumanCaption("Downtown aerial view"));
  });
});
