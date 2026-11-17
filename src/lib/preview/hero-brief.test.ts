import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { briefQueries, heroBrief, LOW_QUALITY } from "./hero-brief.ts";
import { assignHeroes, heroScore, passesBar, type HeroCandidate } from "./hero-pick.ts";
import type { SiteFacts } from "./types.ts";

const base: SiteFacts = {
  mode: "reimagine",
  sourceUrl: "https://example.com/",
  host: "example.com",
  name: "",
  tagline: "",
  description: "",
  industry: "",
  services: [],
  phone: "",
  email: "",
  address: "",
  hours: [],
  social: [],
  colors: [],
  logo: "",
  images: [],
  pages: [],
  notes: "",
} as unknown as SiteFacts;
const town = { ...base, name: "Pauls Valley, Oklahoma", address: "Pauls Valley, Oklahoma" } as SiteFacts;
const plumber = { ...base, name: "Morgan Plumbing", services: ["Drain cleaning", "Water heaters"], address: "Oklahoma City, OK 73112" } as SiteFacts;
const restaurant = { ...base, name: "Cafe 501", tagline: "Mediterranean restaurant and bakery", services: ["Pizza", "Pasta"], address: "Edmond, OK" } as SiteFacts;

const good = { mean: 0.45, contrast: 0.25, saturation: 0.25, sky: 0.1, green: 0.1, warm: 0.05 };
const cand = (id: string, text: string, extra: Partial<HeroCandidate> = {}): HeroCandidate => ({ id, source: "google", text, width: 1920, height: 1280, stats: good as never, relevance: 2, ...extra });

describe("hero brief: what a good hero is depends on the business type (not town rules)", () => {
  it("reads the type", () => {
    assert.equal(heroBrief(town).category, "town");
    // A town's utility photos (a site photo on paulsvalley.com) are never its hero, even at the site photos' 6/10 bar.
    assert.ok(heroBrief(town).offTopic.test("A network of white industrial pipes with flanged joints"));
    assert.ok(!heroBrief(plumber).offTopic.test("A network of white industrial pipes with flanged joints"));
    assert.equal(heroBrief(plumber).category, "trades");
    assert.equal(heroBrief(restaurant).category, "restaurant");
    assert.equal(heroBrief({ ...base, name: "Smith & Jones", industry: "law firm" } as SiteFacts).category, "legal-finance");
    assert.equal(heroBrief({ ...base, name: "Bright Smiles Family Dentistry" } as SiteFacts).category, "medical");
    assert.equal(heroBrief({ ...base, name: "Acme" } as SiteFacts).category, "general");
  });
  it("queries come from the type, the town and the main service", () => {
    assert.ok(briefQueries(town, heroBrief(town)).some((q) => /Pauls Valley.*landmark/.test(q)));
    assert.ok(briefQueries(plumber, heroBrief(plumber)).some((q) => /Drain cleaning/.test(q)));
    assert.ok(briefQueries(restaurant, heroBrief(restaurant)).some((q) => /dining room Edmond/.test(q)));
  });
  it("generic low-quality words", () => {
    for (const t of ["gravel lot with utility poles", "cluttered storage room", "screenshot of the menu", "parking lot"]) assert.ok(LOW_QUALITY.test(t), t);
    assert.ok(!LOW_QUALITY.test("Historic downtown main street at dusk"));
  });
});

describe("quality gate: vision rating decides; below-bar photos never win while good ones exist", () => {
  it("Bob's Pauls Valley pool: airport, library interior and gravel lot lose to good town photos", () => {
    const pool = [
      cand("airport", "Front view of Pauls Valley Municipal Airport with building", { source: "site", appeal: 3 }),
      cand("library", "People sitting in a row, reading books and taking notes", { source: "site", appeal: 2 }),
      cand("gravel", "RV park gravel lot near Pauls Valley", { appeal: 3, relevance: 3 }),
      cand("hist", "Pauls Valley Historic District", { appeal: 8 }),
      cand("night", "Downtown Pauls Valley at night", { appeal: 9 }),
      cand("main", "Brick main street, downtown Pauls Valley", { appeal: 8 }),
    ];
    const picks = assignHeroes(pool, ["editorial", "dark-premium", "bold-photo"]);
    assert.deepEqual(picks.map((p) => p.id).sort(), ["hist", "main", "night"]);
    assert.equal(picks.find((p) => p.index === 1)?.id, "night", "Dark Premium gets the clear night shot, not the murky lot");
  });
  it("a plumber: the van and the pipe diagram fail; finished work wins (reused rather than a bad photo)", () => {
    const pool = [
      cand("van", "Plumbing van parked along the road", { appeal: 3 }),
      cand("pipes", "Pipes under the sink diagram", { appeal: 2 }),
      cand("bath", "Finished modern bathroom remodel", { appeal: 9 }),
      cand("kitchen", "Renovated modern kitchen with new sink", { appeal: 8 }),
    ];
    const picks = assignHeroes(pool, [undefined, undefined, undefined]);
    assert.equal(picks.length, 3);
    assert.ok(picks.every((p) => ["bath", "kitchen"].includes(p.id)));
  });
  it("without vision: off-topic and low-quality titles fail the bar", () => {
    const off = heroScore(cand("a", "Municipal airport hangar", { offTopic: true }));
    assert.ok(!passesBar(off));
    assert.ok(!passesBar(heroScore(cand("b", "gravel parking lot"))));
    assert.ok(passesBar(heroScore(cand("c", "Historic downtown main street buildings"))));
  });
});
