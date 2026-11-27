import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyTheme } from "./theme-lean.ts";
import { diversifyDirections } from "./look-variety.ts";
import { mockDirections, normalizeDirection } from "./design.ts";
import {
  baseFamily,
  businessWhere,
  distinctnessScore,
  diversityIssues,
  enforceDiversity,
  fontCategory,
  layoutAxis,
  paletteDistance,
  placeFromFacts,
  syncCustomBrief,
} from "./look-diversity.ts";
import type { DesignDirection, SiteFacts, SitePalette } from "./types.ts";

const civicColors = ["#1b365d", "#c45a12"];
const pv: SiteFacts = {
  mode: "reimagine",
  sourceUrl: "https://www.paulsvalley.com/",
  host: "paulsvalley.com",
  name: "Pauls Valley, Oklahoma",
  tagline: "",
  description: "Welcome to the official Pauls Valley website.",
  logo: "",
  colors: civicColors,
  phone: "(405) 238-3308",
  email: "",
  address: "100 West Paul Ave. Pauls Valley, OK 73075",
  hours: [],
  services: ["Utilities", "Water Services", "Municipal Court", "Parks"],
  about: "Pauls Valley blends small-town charm with vibrant events.",
  testimonials: [],
  images: [],
  nav: [],
  pages: [],
  social: [],
  industry: "",
  notes: "",
};

const cream: SitePalette = { primary: "#1b365d", accent: "#c45a12", background: "#f7f1e8", surface: "#efe6d6", text: "#1a1a17", muted: "#5b574d" };

function threeAlike(): DesignDirection[] {
  return [0, 1, 2].map((i) =>
    normalizeDirection(
      {
        archetype: ["editorial", "dark-premium", "minimal-luxury"][i],
        name: ["Editorial", "Dark Premium", "Custom Design"][i],
        mood: "Warm, neighborly, civic-proud, sunlit and rooted",
        palette: { ...cream },
        fonts: { heading: ["DM Serif Display", "Cormorant Garamond", "Fraunces"][i], body: "Source Sans 3" },
        hero: "split",
        heroStyle: "caption",
        header: "light",
      },
      i,
      pv,
    ),
  );
}

describe("enforceDiversity", () => {
  it("forces light / dark / saturated bases, three font categories, and three layouts on a cream-serif civic site", () => {
    const { directions, log } = enforceDiversity(threeAlike(), pv);
    assert.deepEqual(directions.map((d) => baseFamily(d.palette)), ["light", "dark", "saturated"]);
    assert.deepEqual(directions.map((d) => fontCategory(d.fonts.heading)), ["serif-display", "geometric-sans", "condensed-display"]);
    assert.deepEqual(directions.map((d) => layoutAxis(d)), ["split", "full-bleed", "bento"]);
    assert.equal(diversityIssues(directions).length, 0, log.join(" | "));
    assert.ok(paletteDistance(directions[0]!.palette, directions[1]!.palette) >= 0.12);
    assert.ok(luminanceOk(directions[1]!.palette.background) < 0.28, "Dark Premium must actually be dark");
    assert.ok(log.some((l) => /assigned|regenerated|ok:/.test(l)));
  });

  it("still works on mock Pauls Valley directions (including brand navy + orange)", () => {
    const raw = diversifyDirections(mockDirections(pv, 0));
    const { directions, log } = enforceDiversity(raw, pv);
    assert.equal(new Set(directions.map((d) => baseFamily(d.palette))).size, 3, log.join(" | "));
    assert.equal(new Set(directions.map((d) => fontCategory(d.fonts.heading))).size, 3);
    assert.equal(new Set(directions.map((d) => layoutAxis(d))).size, 3);
    assert.equal(diversityIssues(directions).length, 0, log.join(" | "));
  });

  it("keeps horror palettes and fonts (scarry) and does not force a light bakery look", () => {
    const freak: SiteFacts = { ...pv, name: "freak show resturant", colors: [], notes: "scarry", description: "We serve eyeballs and brains" };
    const raw = applyTheme(diversifyDirections(mockDirections(freak, 0)), freak);
    const { directions, log } = enforceDiversity(raw, freak);
    assert.ok(log.some((l) => /theme=horror/.test(l)));
    for (const d of directions) {
      assert.match(d.fonts.heading, /Creepster|Eater|Nosifer|Pirata One|New Rocker|Griffy/);
      assert.ok(baseFamily(d.palette) === "dark" || /#8b1018|#5c0c12|#0b0b0d|#140a0c/i.test(d.palette.background) || luminanceOk(d.palette.background) < 0.45);
    }
    assert.ok(!directions.some((d) => fontCategory(d.fonts.heading) === "serif-display" && /Playfair|Fraunces|Cormorant|DM Serif/.test(d.fonts.heading)));
  });

  it("syncCustomBrief copies the enforced palette and fonts onto the custom brief", () => {
    const [custom] = enforceDiversity(threeAlike(), pv).directions.slice(2);
    const withBrief = {
      ...custom!,
      custom: { brief: { concept: "Town Front Porch", typography: { heading: "Fraunces", body: "Work Sans", notes: "" }, palette: cream, metaphor: "", mood: "sunlit", composition: "", motion: "", illustration: "", headline: "Hi", by: "fallback" as const } },
    };
    const synced = syncCustomBrief(withBrief);
    assert.equal(synced.custom?.brief.typography.heading, custom!.fonts.heading);
    assert.equal(synced.custom?.brief.palette.background, custom!.palette.background);
    assert.notEqual(synced.custom?.brief.typography.heading, "Fraunces");
    assert.match(synced.mood, /Town Front Porch/);
    assert.doesNotMatch(synced.mood, /cream letterhead/i);
  });

  it("aligns name, description, swatches and fonts from the same final look; Custom Design uses its concept", () => {
    const raw = [0, 1, 2].map((i) =>
      normalizeDirection(
        {
          archetype: ["editorial", "minimal-luxury", "playful"][i],
          name: ["Editorial", "Minimal Luxury", "Custom Design"][i],
          mood: "Warm, neighborly, civic-proud, sunlit and rooted",
          palette: { ...cream },
          fonts: { heading: "DM Serif Display", body: "Source Sans 3" },
          hero: "split",
          heroStyle: "caption",
          header: "light",
        },
        i,
        pv,
      ),
    );
    raw[2] = { ...raw[2]!, custom: { brief: { concept: "Shared Front Porch", typography: { heading: "Fraunces", body: "Work Sans", notes: "" }, palette: cream, metaphor: "a wide open front porch where paths meet, neighbors linger, and the whole town lays out", mood: "Bold, graphic, and colorful — not a cream letterhead. Direct and neighborly.", composition: "", motion: "", illustration: "", headline: "Hi", by: "fallback" } } };
    const { directions } = enforceDiversity(raw, pv);
    assert.deepEqual(directions.map((d) => d.name), ["Editorial", "Dark Premium", "Custom Design"]);
    assert.equal(directions[1]!.archetype, "dark-premium");
    assert.match(directions[1]!.mood, /cinematic|after-dark|Pauls Valley/i);
    assert.doesNotMatch(directions[1]!.mood, /minimal luxury|quiet, precise/i);
    assert.match(directions[2]!.mood, /Shared Front Porch/i);
    assert.doesNotMatch(directions.map((d) => d.mood).join(" "), /cream letterhead/i);
    // Name, mood, fonts and palette come from the same assigned slot.
    assert.equal(baseFamily(directions[1]!.palette), "dark");
    assert.equal(fontCategory(directions[1]!.fonts.heading), "geometric-sans");
    const synced = syncCustomBrief(directions[2]!);
    assert.match(synced.mood, /Shared Front Porch/i);
    assert.doesNotMatch(synced.mood, /cream letterhead/i);
  });

  it("writes Cafe 501 card blurbs for this restaurant, not a fixed style template", () => {
    const cafe: SiteFacts = {
      ...pv,
      sourceUrl: "https://cafe501.com/",
      host: "cafe501.com",
      name: "Cafe 501",
      description: "An American restaurant in Edmond, Oklahoma.",
      address: "501 S Boulevard, Edmond, OK 73034",
      industry: "restaurant",
      services: ["Brunch", "Lunch", "Dinner"],
    };
    const editorialMood = "Like a beloved local magazine spread—sunlit, conversational, and quietly proud of the neighborhood table. It should feel like reading the brunch section over coffee.";
    const raw = [0, 1, 2].map((i) =>
      normalizeDirection(
        {
          archetype: ["editorial", "dark-premium", "playful"][i],
          name: ["Editorial", "Dark Premium", "Custom Design"][i],
          mood: i === 0 ? editorialMood : "Cinematic and confident after dark: deep ground, warm metallic light, photography that glows, short punchy lines.",
          palette: { ...cream },
          fonts: { heading: "DM Serif Display", body: "Source Sans 3" },
          hero: "split",
          heroStyle: "caption",
          header: "light",
        },
        i,
        cafe,
      ),
    );
    raw[2] = { ...raw[2]!, custom: { brief: { concept: "Neighborhood Table", typography: { heading: "Oswald", body: "Work Sans", notes: "" }, palette: cream, metaphor: "", mood: "Bold, graphic, and colorful — not a cream letterhead.", composition: "", motion: "", illustration: "", headline: "Linger longer over Edmond's best plates", by: "fallback" } } };
    const { directions } = enforceDiversity(raw, cafe);
    assert.equal(directions[0]!.name, "Editorial");
    assert.equal(directions[0]!.mood, editorialMood);
    assert.equal(directions[1]!.name, "Dark Premium");
    assert.match(directions[1]!.mood, /Cafe 501/);
    assert.match(directions[1]!.mood, /Edmond/);
    assert.doesNotMatch(directions[1]!.mood, /Cinematic and confident after dark:/);
    assert.equal(directions[2]!.name, "Custom Design");
    assert.match(directions[2]!.mood, /Neighborhood Table/i);
    assert.ok(!directions.some((d) => /cream letterhead/i.test(d.mood)));
    assert.equal(businessWhere(cafe), "Cafe 501 in Edmond, OK");
  });

  it("reads the city from a civic or restaurant address", () => {
    assert.equal(placeFromFacts(pv), "Pauls Valley, OK");
    assert.equal(placeFromFacts({ address: "501 S Boulevard, Edmond, OK 73034" }), "Edmond, OK");
  });
});

describe("distinctnessScore", () => {
  it("penalizes three cream-serif siblings and rewards the enforced set", () => {
    const alike = threeAlike();
    assert.ok(distinctnessScore(alike[0]!, alike.slice(1)) <= 50, "sameness should score low");
    const { directions } = enforceDiversity(alike, pv);
    assert.ok(distinctnessScore(directions[0]!, directions.slice(1)) >= 80);
    assert.equal(distinctnessScore(directions[0]!, []), 80);
  });
});

function luminanceOk(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
