import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assignHeroes, dHash, hamming, heroScore, isSignLike, moodFit, pixelStats, subjectOf, type HeroCandidate, type PixelStats } from "./hero-pick.ts";
import { cleanImageQueries, defaultImageQueries } from "./photo-queries.ts";
import type { SiteFacts } from "./types.ts";

/** A synthetic RGBA image: fn(x, y) -> [r, g, b]. */
function image(w: number, h: number, fn: (x: number, y: number) => [number, number, number]): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  return data;
}
// A "street": textured mid-grey buildings over a brick-red road, a strip of sky.
const street = (shift = 0) => image(300, 200, (x, y) => (y < 40 ? [150, 180, 220] : y > 130 ? [140 + ((x * 7 + y * 3) % 40), 70, 50] : [((x + shift) * 13) % 200 + 30, ((x + shift) * 13) % 200 + 30, ((x + shift) * 13) % 200 + 30]));

const good: PixelStats = { mean: 0.45, contrast: 0.26, sky: 0.15, green: 0.05, saturation: 0.15, warm: 0.02 };
const c = (id: string, text: string, over: Partial<HeroCandidate> = {}): HeroCandidate => ({ id, source: "google", text, width: 1920, height: 1280, stats: good, relevance: 2, ...over });

describe("pixels: brightness, contrast, sky, grass, perceptual hash", () => {
  it("measures a dim photo as dim and a flat one as flat", () => {
    const dim = pixelStats(image(200, 120, (x) => [20 + (x % 20), 25, 22]), 200, 120);
    assert.ok(dim.mean < 0.15, String(dim.mean));
    assert.ok(dim.contrast < 0.05);
    const s = pixelStats(street(), 300, 200);
    assert.ok(s.mean > 0.3 && s.contrast > 0.15, JSON.stringify(s));
  });
  it("sees a sky-dominated and a grass-dominated frame", () => {
    assert.ok(pixelStats(image(200, 120, () => [120, 170, 235]), 200, 120).sky > 0.9);
    assert.ok(pixelStats(image(200, 120, (x, y) => [60, 140 + ((x + y) % 30), 50]), 200, 120).green > 0.9);
  });
  it("dHash: the same picture at another size is near; a different picture is far", () => {
    // A smooth scene (light from the left, a dark doorway, a red road) and the same scene at half size.
    const scene = (w: number, h: number) => image(w, h, (x, y) => (y > h * 0.7 ? [150, 70, 50] : x > w * 0.4 && x < w * 0.55 && y > h * 0.3 ? [30, 30, 30] : [Math.round(220 - (x / w) * 150), Math.round(200 - (x / w) * 120), Math.round(190 - (y / h) * 60)]));
    const a = dHash(scene(300, 200), 300, 200);
    assert.ok(hamming(a, dHash(scene(150, 100), 150, 100)) <= 10, `${a} vs ${dHash(scene(150, 100), 150, 100)}`);
    const other = dHash(image(300, 200, (x, y) => (x < 150 ? [250, 250, 250] : [10, 10, 10 + (y % 5)])), 300, 200);
    assert.ok(hamming(a, other) > 10);
  });
});

describe("words: signs and subjects", () => {
  it("recognizes welcome signs, city limits, plaques and logos", () => {
    for (const t of ["Welcome to Pauls Valley sign", "Pauls Valley city limits", "entrance sign on Hwy 19", "historical marker", "City seal", "A large white sign with black lettering welcoming visitors"]) assert.ok(isSignLike(t), t);
    for (const t of ["Pauls Valley Historic District", "Downtown Pauls Valley at night", "Santa Fe Depot"]) assert.ok(!isSignLike(t), t);
  });
  it("buckets subjects", () => {
    assert.equal(subjectOf("Pauls Valley Santa Fe Depot"), "depot");
    assert.equal(subjectOf("Downtown Pauls Valley at night"), "night street");
    assert.equal(subjectOf("Brick main street, downtown"), "street");
    assert.equal(subjectOf("Wacker Park"), "park");
  });
});

describe("hero score: what makes a good hero", () => {
  it("a welcome sign ranks below downtown or landmark scenes", () => {
    const sign = heroScore(c("s", "Welcome to Pauls Valley sign", { relevance: 3 }));
    for (const t of ["Downtown Pauls Valley", "Pauls Valley Historic District", "Pauls Valley Santa Fe Depot"]) assert.ok(heroScore(c(t, t, { relevance: 0 })).score > sign.score, t);
    assert.ok(sign.sign && sign.why.some((w) => /sign/.test(w)));
  });
  it("dim, flat, sky- or grass-dominated photos are demoted (pixels, not words)", () => {
    const base = heroScore(c("p", "Wacker Park, Pauls Valley")).score;
    assert.ok(heroScore(c("d", "Wacker Park, Pauls Valley", { stats: { ...good, mean: 0.18 } })).score <= base - 4);
    assert.ok(heroScore(c("f", "Wacker Park, Pauls Valley", { stats: { ...good, contrast: 0.08 } })).score <= base - 3);
    assert.ok(heroScore(c("k", "Wacker Park, Pauls Valley", { stats: { ...good, sky: 0.7 } })).score <= base - 2);
    assert.ok(heroScore(c("g", "Wacker Park, Pauls Valley", { stats: { ...good, green: 0.7 } })).score <= base - 2);
  });
  it("a night street is dark by design (not demoted as dim) and suits a dark look", () => {
    const night = heroScore(c("n", "Downtown Pauls Valley at night", { stats: { ...good, mean: 0.13, contrast: 0.17 } }));
    assert.ok(!night.why.some((w) => /dim/.test(w)));
    assert.ok(moodFit(night, "dark-premium").fit > 0);
    assert.ok(moodFit(night, "editorial").fit < 0);
    assert.ok(moodFit(heroScore(c("h", "Pauls Valley Historic District")), "editorial").fit > 0);
  });
});

describe("assignHeroes: three looks, three different subjects", () => {
  // Bob's round 1: three versions of the welcome sign (Google x2 + the site's), a dim park, downtown and the depot.
  const signHash = "8496a4a6e44845b3";
  const bob: HeroCandidate[] = [
    c("g1", "Welcome to Pauls Valley sign", { hash: signHash, relevance: 3 }),
    c("g2", "Pauls Valley, Oklahoma - gateway", { hash: "8494a4a6e44865ab", relevance: 2.6 }), // same sign, other size
    c("site1", "A large white sign with black lettering welcoming visitors", { source: "site", relevance: 3 }),
    c("g3", "Pauls Valley welcome sign, Established 1857", { hash: "3960bac7474f0787", relevance: 2.2 }),
    c("park", "Wacker Park, Pauls Valley", { stats: { ...good, mean: 0.19 }, hash: "3b3f3d1f4f5f5337", relevance: 2 }),
    c("hist", "Pauls Valley Historic District", { hash: "32343464e9fd9bba", relevance: 1.6 }),
    c("night", "Downtown Pauls Valley at night", { stats: { ...good, mean: 0.12, contrast: 0.16 }, hash: "474b544a4d57cb6b", relevance: 1.3 }),
    c("depot", "Pauls Valley Santa Fe Depot", { hash: "0f0f210106100a52", relevance: 0.4 }),
  ];
  it("picks three different non-sign scenes, and the dim park loses", () => {
    const picks = assignHeroes(bob, ["editorial", "bold-photo", "dark-premium"]);
    assert.equal(picks.length, 3);
    assert.equal(new Set(picks.map((p) => p.id)).size, 3);
    assert.deepEqual(picks.map((p) => p.id).filter((id) => ["g1", "g2", "g3", "site1", "park"].includes(id)), []);
    assert.equal(picks[2]!.id, "night", "dark premium gets the night street");
    assert.equal(picks[0]!.id, "hist", "editorial gets the daytime historic building");
    assert.ok(picks.every((p) => p.reason.includes("score")));
  });
  it("without archetypes: still three different subjects", () => {
    const picks = assignHeroes(bob, [undefined, undefined, undefined]);
    assert.equal(new Set(picks.map((p) => p.subject)).size, 3);
  });
  it("a sign is used at most once, even when little else is left", () => {
    const picks = assignHeroes([bob[0]!, bob[1]!, bob[2]!, bob[3]!, bob[5]!], [undefined, undefined, undefined]);
    assert.equal(picks.filter((p) => ["g1", "g2", "g3", "site1"].includes(p.id)).length, 1);
    assert.ok(picks.length === 2, "the third look falls back instead of repeating the sign");
  });
  it("near-duplicate pixels count as the same subject (and inherit the sign penalty)", () => {
    const picks = assignHeroes([bob[0]!, bob[1]!, bob[5]!, bob[7]!], [undefined, undefined, undefined]);
    assert.ok(!(picks.some((p) => p.id === "g1") && picks.some((p) => p.id === "g2")));
    assert.ok(!picks.some((p) => p.id === "g2"), "the 'gateway' copy of the sign is demoted like the sign");
  });
  it("a site photo wins only when it beats the Google photos on the same score", () => {
    const strongSite = c("site-court", "Garvin County Courthouse downtown", { source: "site", relevance: 1.5 });
    assert.ok(assignHeroes([...bob, strongSite], [undefined, undefined, undefined]).some((p) => p.id === "site-court"));
    const weakSite = c("site-pipes", "A network of white industrial pipes", { source: "site", relevance: 0.5, stats: { ...good, mean: 0.2 } });
    assert.ok(!assignHeroes([...bob, weakSite], [undefined, undefined, undefined]).some((p) => p.id === "site-pipes"));
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

describe("proactive queries: the best-looking scenes, not the name", () => {
  it("a town: downtown, historic district, main street", () => {
    assert.deepEqual(defaultImageQueries(town), ["downtown Pauls Valley Oklahoma", "Pauls Valley historic district", "Pauls Valley Oklahoma main street"]);
  });
  it("a business: its work, storefront and team", () => {
    const q = defaultImageQueries({ ...town, name: "Morgan Plumbing", host: "morganplumbingokc.com", industry: "plumbing", services: ["Plumbing repair"], address: "123 Main St, Oklahoma City, OK 73102" });
    assert.ok(q.some((x) => /plumber at work/.test(x)) && q.some((x) => /storefront/.test(x)), q.join(" | "));
  });
  it("drops planner queries that return signs, logos or maps", () => {
    assert.deepEqual(cleanImageQueries(["Welcome to Pauls Valley", "Pauls Valley city limits sign", "Pauls Valley logo", "Pauls Valley Oklahoma main street"]), ["Pauls Valley Oklahoma main street"]);
  });
});
