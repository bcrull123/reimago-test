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
import { arrangeLooks } from "./site-improved.ts";
import { IMPROVED_NAME, SUNLIT_NAME, isTextGraphicLabel } from "./site-brand.ts";
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

function arranged(facts: SiteFacts, raw?: DesignDirection[]): DesignDirection[] {
  return arrangeLooks(raw ?? threeAlike(), facts);
}

describe("enforceDiversity", () => {
  it("orders Your Site, Improved / Dark Premium / Sunlit Cut and keeps Improved's brand", () => {
    const { directions, log } = enforceDiversity(arranged(pv), pv);
    assert.deepEqual(directions.map((d) => d.name), [IMPROVED_NAME, "Dark Premium", SUNLIT_NAME]);
    assert.equal(directions[0]!.improved, true);
    assert.equal(baseFamily(directions[1]!.palette), "dark");
    assert.equal(fontCategory(directions[1]!.fonts.heading), "geometric-sans");
    assert.equal(layoutAxis(directions[1]!), "full-bleed");
    assert.equal(directions[1]!.heroStyle, "cinematic");
    assert.equal(layoutAxis(directions[2]!), "edge-bleed");
    assert.equal(directions[2]!.heroStyle, "bleed");
    assert.equal(directions[2]!.fonts.heading, "Fraunces");
    assert.ok(luminanceOk(directions[1]!.palette.background) < 0.28, "Dark Premium must actually be dark");
    // No leftover icy blue / lime swatches on Dark Premium.
    assert.doesNotMatch(directions[1]!.palette.primary, /#8cb4ff/i);
    assert.doesNotMatch(`${directions[1]!.palette.primary}${directions[1]!.palette.accent}`, /#00ff00|#22c55e|#8cb4ff/i);
    assert.ok(log.some((l) => /assigned|ok:|identity/.test(l)));
  });

  it("does not force Improved off a light civic brand, and still makes Sunlit Cut a distinct light look", () => {
    const { directions, log } = enforceDiversity(arranged(pv, diversifyDirections(mockDirections(pv, 0))), pv);
    assert.equal(directions[0]!.name, IMPROVED_NAME);
    assert.ok(baseFamily(directions[0]!.palette) !== "dark", log.join(" | "));
    assert.equal(baseFamily(directions[1]!.palette), "dark");
    assert.equal(directions[2]!.name, SUNLIT_NAME);
    assert.equal(layoutAxis(directions[2]!), "edge-bleed");
    assert.ok(paletteDistance(directions[0]!.palette, directions[2]!.palette) > 0.01);
    assert.notEqual(directions[0]!.fonts.heading, directions[2]!.fonts.heading);
  });

  it("keeps horror fonts on the two creative looks; Improved on a reimagine follows brand more than the theme skin", () => {
    const freak: SiteFacts = { ...pv, name: "freak show resturant", colors: [], notes: "scarry", description: "We serve eyeballs and brains" };
    const raw = applyTheme(diversifyDirections(mockDirections(freak, 0)), freak);
    const { directions, log } = enforceDiversity(arranged(freak, raw), freak);
    assert.ok(log.some((l) => /theme=horror/.test(l)));
    assert.equal(directions[0]!.name, IMPROVED_NAME);
    for (const d of directions.slice(1)) {
      assert.match(d.fonts.heading, /Creepster|Eater|Nosifer|Pirata One|New Rocker|Griffy/);
    }
  });

  it("syncCustomBrief still copies palette and fonts onto a custom brief when one exists", () => {
    const dark = enforceDiversity(arranged(pv), pv).directions[1]!;
    const withBrief = {
      ...dark,
      name: "Custom Design",
      custom: { brief: { concept: "Town Front Porch", typography: { heading: "Fraunces", body: "Work Sans", notes: "" }, palette: cream, metaphor: "", mood: "sunlit", composition: "", motion: "", illustration: "", headline: "Hi", by: "fallback" as const } },
    };
    const synced = syncCustomBrief(withBrief);
    assert.equal(synced.custom?.brief.typography.heading, dark.fonts.heading);
    assert.equal(synced.custom?.brief.palette.background, dark.palette.background);
    assert.match(synced.mood, /Town Front Porch/);
    assert.doesNotMatch(synced.mood, /cream letterhead/i);
  });

  it("writes Cafe 501 card blurbs for this restaurant; Improved stays first and black-branded", () => {
    const cafe: SiteFacts = {
      ...pv,
      sourceUrl: "https://cafe501.com/",
      host: "cafe501.com",
      name: "Cafe 501",
      description: "An American restaurant in Edmond, Oklahoma.",
      address: "501 S Boulevard, Edmond, OK 73034",
      industry: "restaurant",
      services: ["Brunch", "Lunch", "Dinner"],
      inks: ["#111111"],
      colors: ["#c45a12"],
      nav: [{ label: "Menu", url: "https://cafe501.com/menu" }],
    };
    const { directions } = enforceDiversity(arranged(cafe), cafe);
    assert.deepEqual(directions.map((d) => d.name), [IMPROVED_NAME, "Dark Premium", SUNLIT_NAME]);
    assert.match(directions[0]!.mood, /Cafe 501/);
    assert.match(directions[0]!.mood, /black brand|your food|View Menu/i);
    assert.equal(directions[0]!.mood[0], "Y");
    assert.ok(luminanceOk(directions[0]!.palette.background) < 0.2, "Improved keeps Cafe 501's black ground");
    assert.match(directions[1]!.mood, /Cafe 501/);
    assert.match(directions[1]!.mood, /Edmond/);
    assert.doesNotMatch(directions[1]!.mood, /Cinematic and confident after dark:/);
    assert.match(directions[2]!.mood, /Cafe 501|appetite|food|sunlit/i);
    assert.ok(directions.every((d) => d.mood[0] === d.mood[0]!.toUpperCase()));
    assert.ok(!directions.some((d) => /cream letterhead/i.test(d.mood)));
    assert.equal(businessWhere(cafe), "Cafe 501 in Edmond, OK");
  });

  it("reads the city from a civic or restaurant address", () => {
    assert.equal(placeFromFacts(pv), "Pauls Valley, OK");
    assert.equal(placeFromFacts({ address: "501 S Boulevard, Edmond, OK 73034" }), "Edmond, OK");
  });
});

describe("distinctnessScore", () => {
  it("rewards the enforced Improved / Dark Premium / Sunlit Cut set", () => {
    const { directions } = enforceDiversity(arranged(pv), pv);
    assert.ok(distinctnessScore(directions[1]!, [directions[0]!, directions[2]!]) >= 70);
    assert.ok(distinctnessScore(directions[2]!, [directions[0]!, directions[1]!]) >= 70);
    assert.equal(distinctnessScore(directions[0]!, []), 80);
  });
});

describe("text-graphic rejection", () => {
  it("flags cropped typography like FES ED", () => {
    assert.equal(isTextGraphicLabel("FES ED"), true);
    assert.equal(isTextGraphicLabel("cropped typography on a poster"), true);
    assert.equal(isTextGraphicLabel("A plate of pasta with basil"), false);
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
