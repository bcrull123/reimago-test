import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEra, cleanEraTag, detectEra, eraCss, eraDirective, wantsVintage, withEra } from "./era-style.ts";
import { designClasses, siteCss } from "./theme.ts";
import { mockDirections, normalizeDirection } from "./design.ts";
import { ownerRequestRule } from "./owner-request.ts";
import { heroBrief } from "./hero-brief.ts";
import type { SiteFacts } from "./types.ts";

const facts = (notes: string, feedback: string[] = []): SiteFacts =>
  ({
    mode: "reimagine", sourceUrl: "https://joes.com", host: "joes.com", name: "Joe's Plumbing", tagline: "", description: "Plumbing in Tulsa.", logo: "", colors: [], phone: "", email: "",
    address: "", hours: [], services: ["Plumbing"], about: "", testimonials: [], images: [], nav: [], pages: [], social: [], industry: "plumbing", notes, feedback,
  }) as SiteFacts;

describe("detectEra", () => {
  it("reads Jason's sentence", () => {
    const e = detectEra({ notes: "make this site look like it is from the late 90s or early 2000s" });
    assert.equal(e?.id, "web90s");
  });
  for (const phrase of ["make it 90s", "early 2000s vibes", "Y2K please", "like a Geocities page", "retro", "web 1.0", "nineties", "old school internet", "Windows 98 look", "the 1990s"]) {
    it(`finds "${phrase}"`, () => assert.equal(detectEra({ notes: phrase })?.id, "web90s"));
  }
  it("finds brutalist", () => assert.equal(detectEra({ notes: "go brutalist" })?.id, "brutalist"));
  it("respects negation", () => {
    assert.equal(detectEra({ notes: "not retro, keep it modern" }), undefined);
    assert.equal(detectEra({ notes: "no 90s look please" }), undefined);
  });
  it("does not fire on ordinary words", () => {
    for (const t of ["make it bolder", "add a gallery", "we open at 8 and close at 5", "call 555-1990 for a quote", "navy and gold"]) assert.equal(detectEra({ notes: t }), undefined, t);
  });
  it("the latest feedback wins over the note", () => {
    assert.equal(detectEra({ notes: "make it 90s", feedback: ["go brutalist"] })?.id, "brutalist");
    assert.equal(detectEra({ notes: "go brutalist", feedback: ["actually make it look late 90s"] })?.id, "web90s");
  });
});

describe("wantsVintage", () => {
  it("is on for era requests and vintage words only", () => {
    assert.equal(wantsVintage({ notes: "make it 90s" }), true);
    assert.equal(wantsVintage({ notes: "use an old photo, vintage feel" }), true);
    assert.equal(wantsVintage({ notes: "make it bolder" }), false);
  });
  it("lets vintage photos through the hero brief only when asked", () => {
    assert.equal(heroBrief(facts("make it bolder")).offTopic.test("vintage photo of a van"), true);
    assert.equal(heroBrief(facts("make it look 90s")).offTopic.test("vintage photo of a van"), false);
    assert.equal(heroBrief(facts("make it look 90s")).allowVintage, true);
  });
});

describe("prompts", () => {
  it("adds an explicit ERA DIRECTION to the owner-request rule", () => {
    const rule = ownerRequestRule(facts("make it look late 90s"));
    assert.match(rule, /ERA DIRECTION/);
    assert.match(rule, /Times New Roman/);
    assert.doesNotMatch(ownerRequestRule(facts("make it bolder")), /ERA DIRECTION/);
  });
  it("withEra appends to a request string", () => {
    assert.match(withEra("make it 90s", facts("make it 90s")), /^make it 90s ERA DIRECTION/);
    assert.equal(withEra("bolder", facts("bolder")), "bolder");
    assert.equal(eraDirective(facts("")), "");
  });
});

describe("applyEra", () => {
  const looks = mockDirections(facts("make it look like it is from the late 90s or early 2000s"), 0);
  const era = applyEra(looks, facts("make it look like it is from the late 90s or early 2000s"));
  it("puts a period look on all three, each a different variant", () => {
    assert.equal(era.length, 3);
    assert.deepEqual(era.map((d) => d.era?.variant), [0, 1, 2]);
    assert.ok(era.every((d) => d.era?.id === "web90s" && d.buttons === "square" && d.radius === "sharp"));
    assert.equal(new Set(era.map((d) => d.palette.background)).size, 3);
  });
  it("leaves looks alone without an era", () => {
    const plain = mockDirections(facts("make it bolder"), 0);
    assert.deepEqual(applyEra(plain, facts("make it bolder")), plain);
  });
  it("survives the browser round trip", () => {
    const back = normalizeDirection(JSON.parse(JSON.stringify(era[1])), 1, facts(""));
    assert.deepEqual(back.era, { id: "web90s", variant: 1 });
    assert.equal(cleanEraTag({ id: "nope" }), undefined);
  });
  it("renders era classes and CSS (bevel buttons, ridged borders, system fonts), nothing for plain looks", () => {
    const d = era[0]!;
    assert.match(designClasses(d, false), /\bera era-web90s ev-0\b/);
    const css = siteCss({ palette: d.palette, fonts: d.fonts, design: d });
    assert.match(css, /outset/);
    assert.match(css, /ridge/);
    assert.match(css, /Times New Roman/);
    const plain = mockDirections(facts(""), 0)[0]!;
    assert.doesNotMatch(siteCss({ palette: plain.palette, fonts: plain.fonts, design: plain }), /body\.era/);
    assert.equal(eraCss(undefined), "");
  });
  it("all variants of both eras are readable (text on background and surface at 4.5:1)", async () => {
    const { ERA_VARIANTS } = await import("./era-style.ts");
    const { contrast } = await import("./design.ts");
    for (const id of ["web90s", "brutalist"] as const) {
      for (const v of ERA_VARIANTS[id]) {
        assert.ok(contrast(v.palette.text, v.palette.background) >= 4.5, `${id}/${v.name} text on bg`);
        assert.ok(contrast(v.palette.text, v.palette.surface) >= 4.5, `${id}/${v.name} text on surface`);
        assert.ok(contrast(v.palette.muted, v.palette.background) >= 4.5, `${id}/${v.name} muted on bg`);
      }
    }
  });
});
