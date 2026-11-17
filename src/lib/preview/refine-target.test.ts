import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findBorrow, findLookRefs, findTargetLook, readAdjustments, type LookRef } from "./look-edit.ts";
import { diversifyDirections, HERO_STYLES } from "./look-variety.ts";
import { archetypesFor, mockDirections } from "./design.ts";
import { ARCHETYPE_LABEL } from "./archetype-label.ts";
import type { SiteFacts } from "./types.ts";

const pv: SiteFacts = {
  mode: "reimagine",
  sourceUrl: "https://www.paulsvalley.com/",
  host: "paulsvalley.com",
  name: "Pauls Valley, Oklahoma",
  tagline: "",
  description: "Welcome to the official Pauls Valley website.",
  logo: "",
  colors: [],
  phone: "(405) 238-3308",
  email: "",
  address: "778 100 West Paul Ave. Pauls Valley, OK 73075",
  hours: [],
  services: ["Utilities", "Water Services", "Municipal Court", "Parks", "Airport"],
  about: "Pauls Valley blends small-town charm with vibrant events and welcoming neighbors.",
  testimonials: [],
  images: [],
  nav: [],
  pages: [],
  social: [],
  industry: "",
  notes: "use a photo of downtown with brick streets for the background",
};


/** Bob's round: one name per look (its style). */
const looks: LookRef[] = [
  { id: "ed", name: "Editorial", archetype: "editorial", index: 0, background: "#f4efe6", primary: "#7a2e1d" },
  { id: "dp", name: "Dark Premium", archetype: "dark-premium", index: 1, background: "#121214", primary: "#c9a45c" },
  { id: "pl", name: "Playful", archetype: "playful", index: 2, background: "#fff6e0", primary: "#e4572e" },
];
/** An older session: creative names; the style label still works. */
const named: LookRef[] = [
  { id: "ed", name: "Brick Ledger", archetype: "editorial", index: 0 },
  { id: "dp", name: "Night Courthouse", archetype: "dark-premium", index: 1, background: "#121214" },
  { id: "pl", name: "Festival Stamp", archetype: "playful", index: 2 },
];

describe("refine targeting (Bob: 'Use editorials picture on dark premium', 'Make Dark Premium lighter')", () => {
  for (const [label, set] of [["style names", looks], ["creative names", named]] as const) {
    it(`cross-look: edits Dark Premium only, borrowing Editorial's picture (${label})`, () => {
      const b = findBorrow("Use editorials picture on dark premium", set);
      assert.deepEqual(b && { targetId: b.targetId, fromId: b.fromId, assets: b.assets }, { targetId: "dp", fromId: "ed", assets: ["photo"] });
      assert.equal(findTargetLook("Use editorials picture on dark premium", set)?.id, "dp");
    });
    it(`'Make Dark Premium lighter so you can see the image better.' targets Dark Premium, lighten, no borrow (${label})`, () => {
      const text = "Make Dark Premium lighter so you can see the image better.";
      assert.equal(findTargetLook(text, set)?.id, "dp");
      assert.equal(findBorrow(text, set), undefined);
      assert.ok(readAdjustments(text).some((a) => a.type === "lighten"));
    });
  }
  it("labels are case-insensitive and fuzzy; possessives count", () => {
    for (const text of ["DARK PREMIUM, a bit lighter", "dark-premium too dark", "the premium one, bigger text", "darkpremium lighter"]) assert.equal(findTargetLook(text, looks)?.id, "dp", text);
    for (const text of ["editorial's headline bigger", "Editoral, warmer", "the EDITORIAL one, more space"]) assert.equal(findTargetLook(text, named)?.id, "ed", text);
    assert.equal(findTargetLook("Playfull, less busy", named)?.id, "pl");
  });
  it("positions: first / the middle one / last", () => {
    assert.equal(findTargetLook("the first one, warmer", looks)?.id, "ed");
    assert.equal(findTargetLook("the middle one a bit lighter", looks)?.id, "dp");
    assert.equal(findTargetLook("make the last look less busy", looks)?.id, "pl");
  });
  it("other cross-look phrasings", () => {
    const cases: [string, string, string, string][] = [
      ["use the first one's photo on the middle one", "dp", "ed", "photo"],
      ["give dark premium the editorial colors", "dp", "ed", "palette"],
      ["Dark premium with the photo from editoral", "dp", "ed", "photo"],
      ["put Playful's fonts on Editorial", "ed", "pl", "fonts"],
    ];
    for (const [text, to, from, asset] of cases) {
      const b = findBorrow(text, looks);
      assert.equal(b?.targetId, to, text);
      assert.equal(b?.fromId, from, text);
      assert.ok(b?.assets.includes(asset as "photo"), text);
    }
  });
  it("a wish is not a look: 'make it more playful' names no look; no look named -> 3 new looks", () => {
    assert.equal(findTargetLook("make it more playful", looks), undefined);
    assert.equal(findTargetLook("Make the background darker", looks), undefined);
    assert.deepEqual(findLookRefs("use a photo of downtown pauls valley for the background", looks), []);
  });
});

describe("one name per look", () => {
  it("mock looks are named by their style only", () => {
    for (const d of mockDirections(pv, 0)) assert.equal(d.name, ARCHETYPE_LABEL[d.archetype]);
  });
});

describe("a regenerated round is visibly different", () => {
  it("archetypes: a new round prefers styles the last round didn't use", () => {
    const first = archetypesFor(pv, 0, { seed: 7 });
    const second = archetypesFor(pv, 1, { seed: 11, archetypes: first });
    assert.equal(new Set(second).size, 3);
    assert.ok(second.filter((a) => !first.includes(a)).length >= 2, `${first} -> ${second}`);
  });
  it("seeds vary the hero treatments (not always editorial->caption, dark->cinematic, playful->collage)", () => {
    const dirs = mockDirections(pv, 0).slice(0, 3);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) seen.add(diversifyDirections(dirs, seed).map((d) => d.heroStyle).join(","));
    assert.ok(seen.size >= 4, [...seen].join(" | "));
  });
  it("the last round's hero treatments are avoided when possible, and layouts stay distinct", () => {
    const dirs = mockDirections(pv, 0).slice(0, 3);
    const prev = diversifyDirections(dirs, 3);
    const next = diversifyDirections(dirs, 4, prev.map((d) => d.heroStyle!));
    for (const d of next) assert.ok(!prev.some((p) => p.heroStyle === d.heroStyle), `${d.heroStyle} repeated`);
    assert.equal(new Set(next.map((d) => d.layout)).size, 3);
    assert.ok(next.every((d) => HERO_STYLES.includes(d.heroStyle!)));
  });
});
