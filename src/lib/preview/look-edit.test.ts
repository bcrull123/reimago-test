import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import {
  addLevels,
  changedLine,
  cleanAdjustments,
  contrastRatio,
  findTargetLook,
  oklch,
  readAdjustments,
  relLum,
  tuneCss,
  tuneNumbers,
  tunePalette,
  variantLabel,
  variationScales,
  type LookRef,
  type LookTune,
  hasEditWork,
} from "./look-edit.ts";
import { editByWording, heroLuma, scrimFloor } from "./look-edit.server.ts";
import { cleanImageQueries, defaultImageQueries } from "./photo-queries.ts";
import { plannedFromOwner, requestedPhoto } from "./owner-request.ts";
import type { SiteFacts, SitePalette } from "./types.ts";

// Bob's round 2 (Pauls Valley, with the brick-streets note).
const looks: LookRef[] = [
  { id: "a1", name: "Brick Chronicle", archetype: "editorial", index: 0, background: "#f7f2e8", primary: "#8a2f1c" },
  { id: "b2", name: "Night Brick", archetype: "dark-premium", index: 1, background: "#0e1013", primary: "#c9a227" },
  { id: "c3", name: "Valley Stamp", archetype: "playful", index: 2, background: "#fff8e6", primary: "#1f6fb2" },
];

describe("findTargetLook: which look the owner means", () => {
  it("by name, exact and fuzzy (case, typos, missing words)", () => {
    assert.equal(findTargetLook("The Night Brick is best just a little too dark.", looks)?.id, "b2");
    assert.equal(findTargetLook("The night Brick was the best one and I said just a little to dark", looks)?.id, "b2");
    assert.equal(findTargetLook("night brik, a bit lighter", looks)?.id, "b2");
    assert.equal(findTargetLook("I like Brick Chronicle but bigger text", looks)?.id, "a1");
    assert.equal(findTargetLook("valley stamp is too busy", looks)?.id, "c3");
  });
  it("by description: the dark one, the second one, the middle one, the editorial one", () => {
    assert.equal(findTargetLook("the dark one, but lighter", looks)?.id, "b2");
    assert.equal(findTargetLook("the second one is close, a little lighter", looks)?.id, "b2");
    assert.equal(findTargetLook("the middle one with more contrast", looks)?.id, "b2");
    assert.equal(findTargetLook("the editorial one with bigger text", looks)?.id, "a1");
    assert.equal(findTargetLook("the first one, warmer", looks)?.id, "a1");
    assert.equal(findTargetLook("the last one but calmer", looks)?.id, "c3");
  });
  it("'this one' / 'the one I'm previewing' means the focused look", () => {
    assert.equal(findTargetLook("this one, just a little lighter", looks, "c3")?.id, "c3");
    assert.equal(findTargetLook("the one I'm previewing is too dark", looks, "b2")?.id, "b2");
  });
  it("feedback that names no look keeps the old behavior (3 new looks)", () => {
    assert.equal(findTargetLook("Use a photo of downtown pauls valley with the brick streets for the background", looks), undefined);
    assert.equal(findTargetLook("make it more modern", looks), undefined);
    assert.equal(findTargetLook("too dark overall", looks), undefined);
  });
  it("editByWording: Bob's exact words -> Night Brick, lighten slight", () => {
    const edit = editByWording("The Night Brick is best just a little too dark.", looks);
    assert.equal(edit.targetId, "b2");
    assert.deepEqual(edit.adjustments, [{ type: "lighten", amount: "slight" }]);
  });
  it("editByWording: “Have it say explore our Brick streets” captures the dictated headline", () => {
    const edit = editByWording("Have it say explore our Brick streets", looks, "b1");
    assert.equal(edit.copy?.headline, "explore our Brick streets");
  });
});

describe("readAdjustments: the requested change and how much", () => {
  const read = (t: string) => readAdjustments(t).map((a) => `${a.type}:${a.amount}`);
  it("brightness / darkness with amounts", () => {
    assert.deepEqual(read("just a little too dark"), ["lighten:slight"]);
    assert.deepEqual(read("a bit lighter"), ["lighten:slight"]);
    assert.deepEqual(read("lighter"), ["lighten:medium"]);
    assert.deepEqual(read("way too dark"), ["lighten:strong"]);
    assert.deepEqual(read("a little too bright"), ["darken:slight"]);
  });
  it("contrast, saturation, warmth, text, spacing, color, busyness", () => {
    assert.deepEqual(read("more contrast"), ["more-contrast:medium"]);
    assert.deepEqual(read("colors are a bit washed out"), ["saturate:slight"]);
    assert.deepEqual(read("warmer please"), ["warmer:medium"]);
    assert.deepEqual(read("bigger text"), ["bigger-text:medium"]);
    assert.deepEqual(read("more breathing room"), ["more-space:medium"]);
    assert.deepEqual(read("needs more color"), ["more-color:medium"]);
    assert.deepEqual(read("it's too busy"), ["less-busy:medium"]);
  });
  it("negations and copy/photo-only feedback produce no tweak", () => {
    assert.deepEqual(read("not too dark, it's perfect"), []);
    assert.deepEqual(read("Use a photo of downtown pauls valley with the brick streets for the background"), []);
  });
  it("cleanAdjustments keeps only known types and amounts", () => {
    assert.deepEqual(cleanAdjustments([{ type: "lighten", amount: "slight" }, { type: "explode", amount: "slight" }, { type: "darken", amount: "huge" }]), [
      { type: "lighten", amount: "slight" },
      { type: "darken", amount: "medium" },
    ]);
  });
});

const night: SitePalette = { primary: "#c9a227", accent: "#e8d39a", background: "#0e1013", surface: "#171a1f", text: "#f3efe6", muted: "#a9a49a" };

describe("tunePalette: measurable, readable", () => {
  it("lighten slight raises background L (OKLCH) and relative luminance, text stays AA", () => {
    const out = tunePalette(night, { lighten: 1 });
    assert.ok(oklch(out.background).l > oklch(night.background).l + 0.04, `${out.background} not lighter`);
    assert.ok(relLum(out.background) > relLum(night.background) * 2, "background luminance did not rise");
    assert.ok(relLum(out.surface) > relLum(night.surface));
    assert.ok(contrastRatio(out.text, out.background) >= 7);
    assert.ok(contrastRatio(out.muted, out.background) >= 4.5);
    assert.ok(contrastRatio(out.text, out.surface) >= 4.5);
  });
  it("variations step monotonically (slight < 1.5x < 2x) and stay readable", () => {
    const l = [1, 1.5, 2].map((x) => relLum(tunePalette(night, { lighten: x }).background));
    assert.ok(l[0]! < l[1]! && l[1]! < l[2]!, String(l));
    for (const x of [1, 1.5, 2, 3]) {
      const p = tunePalette(night, { lighten: x });
      assert.ok(contrastRatio(p.text, p.background) >= 4.5, `lighten ${x}`);
    }
  });
  it("a light look lightened or darkened keeps AA text", () => {
    const light: SitePalette = { primary: "#1f3b2d", accent: "#d1492f", background: "#f7f2e8", surface: "#ece3d0", text: "#18170f", muted: "#5d584b" };
    for (const levels of [{ darken: 3 }, { lighten: 3 }, { "less-contrast": 2 }, { saturate: 3, warmer: 2 }]) {
      const p = tunePalette(light, levels);
      assert.ok(contrastRatio(p.text, p.background) >= 4.5, JSON.stringify(levels));
      assert.ok(contrastRatio(p.muted, p.background) >= 4.5, JSON.stringify(levels));
    }
  });
  it("saturate / warmer change chroma / hue; no tweak = same palette", () => {
    assert.ok(oklch(tunePalette(night, { saturate: 2 }).primary).c > oklch(night.primary).c);
    assert.deepEqual(tunePalette(night, {}), night);
  });
});

describe("tuneNumbers / tuneCss: overlay, photo filter, type, spacing", () => {
  it("lighten slight: lighter scrim, brighter photo", () => {
    const n = tuneNumbers({ lighten: 1 });
    assert.equal(n.scrim, 0.73);
    assert.equal(n.brightness, 1.11);
    const n2 = tuneNumbers({ lighten: 2 });
    assert.ok(n2.scrim < n.scrim && n2.brightness > n.brightness);
  });
  it("scrim never drops below the AA floor", () => {
    assert.equal(tuneNumbers({ lighten: 3 }, 0.8).scrim, 0.8);
  });
  it("css carries the overlay opacity and photo brightness", () => {
    const tune: LookTune = { levels: { lighten: 1 }, base: { name: "Night Brick", palette: night, motifs: [] }, variant: "lighter", changed: "x" };
    const css = tuneCss(tune);
    assert.match(css, /\.s-hero-photo::after\{[^}]*opacity:0\.73/);
    assert.match(css, /brightness\(1\.11\)/);
    assert.equal(tuneCss(undefined), "");
  });
  it("text and spacing scale; less busy hides decorations", () => {
    assert.match(tuneCss({ levels: { "bigger-text": 2 }, base: { name: "x", palette: night, motifs: [] }, variant: "", changed: "" }), /font-size/);
    assert.match(tuneCss({ levels: { "more-space": 2 }, base: { name: "x", palette: night, motifs: [] }, variant: "", changed: "" }), /padding/);
    assert.match(tuneCss({ levels: { "less-busy": 1 }, base: { name: "x", palette: night, motifs: [] }, variant: "", changed: "" }), /display:none/);
  });
});

describe("labels", () => {
  const lighten = [{ type: "lighten" as const, amount: "slight" as const }];
  it("names stay; the variant says how", () => {
    assert.equal(variantLabel(lighten, 0), "lighter");
    assert.equal(variantLabel(lighten, 1), "a bit lighter still");
    assert.equal(variantLabel(lighten, 2), "noticeably lighter");
  });
  it("Changed: line with the amount", () => {
    assert.equal(changedLine(lighten, 1, true), "Changed: lightened backgrounds and photo overlay (slight)");
    assert.equal(changedLine(lighten, 2, true), "Changed: lightened backgrounds and photo overlay (medium)");
  });
  it("variation scales and cumulative levels (no drift)", () => {
    assert.deepEqual(variationScales(lighten), [1, 1.5, 2]);
    assert.deepEqual(addLevels({ lighten: 1 }, lighten, 1), { lighten: 2 });
  });
});

describe("hero photo luma and the AA scrim floor", () => {
  const png = (v: number) => {
    const p = new PNG({ width: 20, height: 20 });
    p.data.fill(v);
    for (let i = 3; i < p.data.length; i += 4) p.data[i] = 255;
    return PNG.sync.write(p);
  };
  it("measures a bright photo as bright, a dark one as dark", () => {
    assert.ok((heroLuma(png(240), "image/png", { x0: 0, x1: 1, y0: 0, y1: 1 }) ?? 0) > 0.9);
    assert.ok((heroLuma(png(20), "image/png", { x0: 0, x1: 1, y0: 0, y1: 1 }) ?? 1) < 0.1);
  });
  it("a dark photo needs no overlay; a bright one keeps most of it", () => {
    assert.equal(scrimFloor(0.2, 1.11, 0.72), 0);
    assert.ok(scrimFloor(0.9, 1.11, 0.72) > 0.9);
    assert.equal(scrimFloor(undefined, 1.1, 0.72), 0.6);
  });
});

const town: SiteFacts = {
  mode: "reimagine",
  sourceUrl: "https://www.paulsvalley.com/",
  host: "paulsvalley.com",
  name: "Pauls Valley, Oklahoma",
  tagline: "",
  description: "",
  logo: "",
  colors: [],
  phone: "",
  email: "",
  address: "100 S Walnut St, Pauls Valley, OK 73075",
  hours: [],
  services: [],
  about: "",
  testimonials: [],
  images: [],
  nav: [],
  pages: [],
  social: [],
  industry: "",
  notes: "",
};

describe("proactive image queries (round 1, no note)", () => {
  it("cleans planner output: 2-3 plain queries, no operators", () => {
    assert.deepEqual(cleanImageQueries(["downtown Pauls Valley Oklahoma brick streets", "site:wikipedia.org Pauls Valley landmark", '"plumber"', "x", "Downtown Pauls Valley Oklahoma brick streets", "plumber at work", "fourth one here"]), [
      "downtown Pauls Valley Oklahoma brick streets",
      "Pauls Valley landmark",
      "plumber at work",
    ]);
  });
  it("defaults without AI: town landmarks, or the trade in its town", () => {
    const q = defaultImageQueries(town);
    assert.ok(q.length >= 2 && q.every((x) => /Pauls Valley/.test(x)), q.join(" | "));
    const plumber = defaultImageQueries({ ...town, name: "Morgan Plumbing", host: "morganplumbingokc.com", industry: "plumbing", services: ["Plumbing repair"], address: "123 Main St, Oklahoma City, OK 73102" });
    assert.ok(plumber.some((x) => /at work/.test(x)), plumber.join(" | "));
  });
});

describe("round 1 with no note: the planner's subject is not the owner's request (Bob's 'as you asked')", () => {
  it("no note -> no subject, even when the planner read 'keep the welcome sign' off the site", () => {
    const facts = { ...town, photoSubject: "pauls valley welcome sign", photoIntent: "keep" as const };
    assert.equal(plannedFromOwner(facts, "pauls valley welcome sign"), false);
    assert.deepEqual(requestedPhoto(facts), { intent: "none" });
  });
  it("an owner note about it still counts", () => {
    const facts = { ...town, notes: "keep the welcome sign", photoSubject: "pauls valley welcome sign", photoIntent: "keep" as const };
    assert.equal(requestedPhoto(facts).intent, "keep");
  });
});


describe("hasEditWork (round 14: free-form notes must not error)", () => {
  it("is false for a named look with no change verb (e.g. prefilled 'show ey')", () => {
    assert.equal(hasEditWork({ adjustments: [], copy: undefined, photo: undefined, borrow: undefined, restyle: undefined }), false);
  });
  it("is true when a concrete tweak is present", () => {
    assert.equal(hasEditWork({ adjustments: [{ type: "lighten", amount: "slight" }] }), true);
    assert.equal(hasEditWork({ adjustments: [], photo: "eyeballs in jars" }), true);
  });
});
