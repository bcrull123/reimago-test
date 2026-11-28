import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanFeedback, cleanRequest, latestRequest, ownerRequestRule, parseOwnerIntents, requestHints, requestedPhoto, requestedScene, sceneToFind } from "./owner-request.ts";
import { mockDirections } from "./design.ts";
import { composeMockPage } from "./sections.ts";
import type { SiteFacts, SitePlan } from "./types.ts";

const facts: SiteFacts = {
  mode: "reimagine",
  sourceUrl: "https://joesplumbing.com/",
  host: "joesplumbing.com",
  name: "Joe's Plumbing",
  tagline: "",
  description: "Family-owned plumbing in Tulsa.",
  logo: "",
  colors: ["#1f4e79"],
  phone: "",
  email: "",
  address: "",
  hours: [],
  services: ["Drain Cleaning", "Water Heaters", "Leak Repair"],
  about: "Joe started the business.",
  testimonials: [{ quote: "Fixed it the same day.", author: "Dana R." }],
  images: [],
  nav: [],
  pages: [],
  social: [],
  industry: "plumbing",
  notes: "",
};

const plan = {
  tagline: "Plumbing done right",
  summary: "",
  changes: [],
  cta: { label: "Get a quote", slug: "contact" },
  pages: [
    { slug: "home", title: "Home", navLabel: "Home", purpose: "", sections: [] },
    { slug: "contact", title: "Contact", navLabel: "Contact", purpose: "", sections: [] },
  ],
} as unknown as SitePlan;

describe("owner request", () => {
  it("cleans and caps the note and feedback", () => {
    assert.equal(cleanRequest("  make it <b>dark</b>\n\n```ignore```  ", 100), "make it b dark /b ignore");
    assert.equal(cleanRequest("x".repeat(900), 800).length, 800);
    const rounds = cleanFeedback(["1", "2", "3", "4", "5", "6", "", 7]);
    assert.deepEqual(rounds, ["2", "3", "4", "5", "6"]);
  });

  it("builds a high-priority rule that keeps the safety rules on top", () => {
    assert.equal(ownerRequestRule({ notes: "" }), "");
    const rule = ownerRequestRule({ notes: "More red", feedback: ["Darker please", "Add a gallery"] });
    assert.match(rule, /OWNER'S REQUEST — HIGH PRIORITY/);
    assert.match(rule, /"More red"/);
    assert.match(rule, /2\. "Add a gallery"/);
    assert.match(rule, /never permit invented facts/);
    assert.equal(latestRequest({ notes: "More red", feedback: ["Darker please"] }), "Darker please");
  });

  it("reads colors, scheme, tone and sections (latest feedback first, negations ignored)", () => {
    const hints = requestHints({ notes: "I want it playful, no red", feedback: ["make it dark with navy and gold and add a gallery"] });
    assert.deepEqual(hints.colors.map((c) => c.name), ["navy", "gold"]);
    assert.equal(hints.scheme, "dark");
    assert.ok(hints.archetypes.includes("dark-premium"));
    assert.ok(hints.archetypes.includes("playful"));
    assert.deepEqual(hints.sections, ["gallery"]);
    assert.ok(hints.applied.length >= 3);
    assert.equal(requestHints({ notes: "less dark, lighter and airy" }).scheme, "light");
  });

  it("treats “Make it yummy” in style notes as a find-a-food-photo request", () => {
    assert.equal(requestedScene({ notes: "Make it yummy" }), "appetizing food");
    assert.equal(sceneToFind({ notes: "Make it yummy" }), "appetizing food");
    assert.equal(requestedScene({ notes: "", feedback: ["make it more appetizing"] }), "appetizing food");
  });
});

describe("mock mode follows the request", () => {
  it("puts requested colors in every palette and asked-for tones first", () => {
    const looks = mockDirections({ ...facts, notes: "Use red, make it playful" }, 0);
    assert.equal(looks[0]!.archetype, "playful");
    assert.ok(looks.filter((l) => l.palette.primary === "#b3261e").length >= 2);
    const plain = mockDirections(facts, 0);
    assert.notEqual(plain[0]!.archetype, "playful");
  });

  it("dark feedback darkens the light looks; light feedback drops the dark look", () => {
    const dark = mockDirections({ ...facts, feedback: ["make everything dark"] }, 1);
    for (const look of dark) assert.ok(parseInt(look.palette.background.slice(1, 3), 16) < 0x40, look.palette.background);
    const light = mockDirections({ ...facts, feedback: ["lighter please, no dark backgrounds"] }, 0);
    assert.ok(!light.some((l) => l.archetype === "dark-premium"));
  });

  it("adds requested sections that real facts can fill", () => {
    const design = mockDirections(facts, 0).find((d) => d.archetype === "editorial") ?? mockDirections(facts, 0)[0]!;
    const before = composeMockPage(plan.pages[0]!, facts, plan, design, { hero: "hero", services: [], photos: ["photo-1", "photo-2", "photo-3"] }).map((s) => s.type);
    const after = composeMockPage(plan.pages[0]!, { ...facts, feedback: ["add a gallery and a how it works section"] }, plan, design, {
      hero: "hero",
      services: [],
      photos: ["photo-1", "photo-2", "photo-3"],
    }).map((s) => s.type);
    assert.ok(after.includes("gallery"));
    assert.ok(after.includes("process"));
    assert.equal(after.at(-1), "cta-band");
    assert.ok(after.length > before.length || before.includes("gallery"));
  });
});

describe("r16b request intents", () => {
  const notes = "Keep the black brand, show the food, and make a clear menu button";

  it("parses brand color, food hero, and a View Menu CTA, and never calls it horror", () => {
    const intents = parseOwnerIntents({ notes });
    assert.equal(intents.brandColor?.name, "black");
    assert.equal(intents.hero?.subject, "food");
    assert.equal(intents.hero?.intent, "find");
    assert.equal(intents.cta, "View Menu");
    assert.equal(intents.themeLabel, undefined);
    assert.deepEqual(intents.applied, ["black brand colors", "food as the hero photo", "a clear View Menu button"]);
    assert.doesNotMatch(intents.applied.join(" · "), /horror|macabre|moody/);
    const hints = requestHints({ notes });
    assert.equal(hints.applied.join(" · "), "black brand colors · food as the hero photo · a clear View Menu button");
    const photo = requestedPhoto({ notes });
    assert.equal(photo.subject, "food");
    assert.equal(photo.intent, "find");
    assert.equal(sceneToFind({ notes }), "food");
  });

  it("still reads an actual horror request, and a dark/moody request without horror", () => {
    const horror = requestHints({ notes: "make it spooky, a haunted freak show" });
    assert.ok(horror.applied.some((a) => /horror/i.test(a)), horror.applied.join(" · "));
    const moody = requestHints({ notes: "make it dark and moody" });
    assert.ok(moody.applied.some((a) => /dark/i.test(a)));
    assert.ok(!moody.applied.some((a) => /horror|macabre/i.test(a)), moody.applied.join(" · "));
  });
});
