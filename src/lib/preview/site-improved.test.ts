import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { arrangeLooks, composeImprovedPage, composeSunlitPage, isImprovedLook, SUNLIT_NAME } from "./site-improved.ts";
import { IMPROVED_NAME } from "./site-brand.ts";
import { mockDirections } from "./design.ts";
import type { SiteFacts, SitePlan } from "./types.ts";

const cafe: SiteFacts = {
  mode: "reimagine",
  sourceUrl: "https://cafe501.com/",
  host: "cafe501.com",
  name: "Cafe 501",
  tagline: "",
  description: "An American restaurant in Edmond.",
  logo: "",
  colors: ["#c45a12"],
  inks: ["#111111"],
  phone: "(405) 555-0501",
  email: "",
  address: "501 S Boulevard, Edmond, OK 73034",
  hours: ["Mon–Sat 11–9"],
  services: ["Brunch", "Lunch", "Dinner"],
  about: "Cafe 501 cooks from scratch.",
  testimonials: [{ author: "Sam", quote: "Best brunch in town." }],
  images: [],
  nav: [{ label: "Menu", url: "https://cafe501.com/menu" }],
  pages: [],
  social: [],
  industry: "restaurant",
  notes: "",
};

const plan: SitePlan = {
  name: "Cafe 501",
  tagline: "Come hungry.",
  summary: "An American restaurant in Edmond.",
  changes: [],
  palette: { primary: "#c45a12", accent: "#c45a12", background: "#111111", surface: "#1a1a1a", text: "#f4efe8", muted: "#c8c0b6" },
  fonts: { heading: "Inter", body: "Source Sans 3" },
  cta: { label: "Get in touch", slug: "contact" },
  pages: [
    { slug: "home", title: "Home", navLabel: "Home", purpose: "Welcome", sections: [] },
    { slug: "menu", title: "Menu", navLabel: "Menu", purpose: "The menu", sections: [] },
    { slug: "about", title: "About", navLabel: "About", purpose: "Our story", sections: [] },
    { slug: "contact", title: "Contact", navLabel: "Contact", purpose: "Reach us", sections: [] },
  ],
};

describe("arrangeLooks", () => {
  it("puts Your Site, Improved first, Dark Premium in the middle, Sunlit Cut last", () => {
    const looks = arrangeLooks(mockDirections(cafe, 0), cafe);
    assert.deepEqual(looks.map((d) => d.name), [IMPROVED_NAME, "Dark Premium", SUNLIT_NAME]);
    assert.equal(isImprovedLook(looks[0]!), true);
    assert.equal(looks[1]!.heroStyle, "cinematic");
    assert.equal(looks[2]!.heroStyle, "bleed");
    assert.ok(looks.every((d) => !d.custom));
  });
});

describe("composeImprovedPage", () => {
  it("leads with a photo hero, a View Menu button, a trust row, and food sections", () => {
    const sections = composeImprovedPage(plan.pages[0]!, cafe, plan, { hero: "hero", feature: "photo-2", services: [], photos: ["photo-1", "photo-2", "photo-3"] });
    assert.equal(sections[0]!.type, "hero-photo");
    assert.equal(sections[0]!.variant, "improved");
    assert.equal(sections[0]!.cta?.label, "View Menu");
    assert.equal(sections[0]!.image, "hero");
    assert.ok(sections.some((s) => s.type === "stat-bar" && s.variant === "trust"));
    assert.ok(sections.some((s) => s.variant === "blocks"));
  });
});

describe("composeSunlitPage", () => {
  it("uses a bleed hero and a color-blocked menu strip, not a tall serif stack over a small photo", () => {
    const sections = composeSunlitPage(plan.pages[0]!, cafe, plan, { hero: "hero", feature: "photo-2", services: [], photos: ["photo-1", "photo-2", "photo-3"] });
    assert.equal(sections[0]!.type, "hero-split");
    assert.equal(sections[0]!.variant, "bleed");
    assert.ok((sections[0]!.heading ?? "").split(/\s+/).length <= 5);
    assert.ok(sections.some((s) => s.variant === "blocks"));
  });
});
