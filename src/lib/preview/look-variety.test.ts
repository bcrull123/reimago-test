import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { arrangeSections, diversifyDirections, lookSignature, similarities } from "./look-variety.ts";
import { mockDirections, normalizeDirection } from "./design.ts";
import { composeMockPage, renderSection } from "./sections.ts";
import type { SiteFacts, SitePlan } from "./types.ts";

// Bob's Pauls Valley run: three looks that were the same except wording and colors.
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
const plan = {
  tagline: "Explore & connect",
  summary: "",
  changes: [],
  cta: { label: "Contact City Hall", slug: "contact" },
  pages: [
    { slug: "home", title: "Home", navLabel: "Home", purpose: "", sections: [] },
    { slug: "services", title: "Services", navLabel: "Services", purpose: "", sections: [] },
    { slug: "about", title: "About", navLabel: "About", purpose: "", sections: [] },
    { slug: "contact", title: "Contact", navLabel: "Contact", purpose: "", sections: [] },
  ],
} as unknown as SitePlan;
const available = ["hero", "photo-1", "photo-2", "photo-3", "photo-4", "photo-5"];

function threeLooks(directions = diversifyDirections(mockDirections(pv, 0))) {
  return directions.map((design) => {
    const sections = arrangeSections(
      composeMockPage(plan.pages[0]!, pv, plan, design, { hero: "hero", services: [], photos: available.filter((n) => n.startsWith("photo-")) }),
      design,
      available,
      pv.services,
    );
    return { design, sections, sig: lookSignature(design, sections, "pauls-valley-historic-district.jpg") };
  });
}

describe("three looks are clearly different", () => {
  it("each look gets its own hero treatment, header, buttons, footer and section recipe", () => {
    const looks = diversifyDirections(mockDirections(pv, 0));
    for (const key of ["heroStyle", "header", "buttons", "footer", "layout"] as const) {
      assert.equal(new Set(looks.map((l) => l[key])).size, 3, `${key}: ${looks.map((l) => l[key]).join(", ")}`);
    }
    // The dark premium look gets the cinematic full-bleed hero; editorial gets the captioned split.
    for (const l of looks) {
      if (l.archetype === "dark-premium") assert.equal(l.heroStyle, "cinematic");
      if (l.archetype === "editorial") assert.equal(l.heroStyle, "caption");
    }
  });

  it("re-rolls when the AI art director proposes three look-alikes", () => {
    const same = [0, 1, 2].map((i) =>
      normalizeDirection({ archetype: ["dark-premium", "bold-photo", "editorial"][i], hero: "photo", header: "overlay", buttons: "pill", footer: "minimal", heroStyle: "cinematic" }, i, pv),
    );
    const fixed = diversifyDirections(same);
    assert.equal(new Set(fixed.map((l) => l.heroStyle)).size, 3);
    assert.equal(new Set(fixed.map((l) => l.header)).size, 3);
    assert.equal(new Set(fixed.map((l) => l.buttons)).size, 3);
    // The new fields survive the round trip through the browser (previewLook re-normalizes the direction).
    const again = normalizeDirection(JSON.parse(JSON.stringify(fixed[2])), 2, pv);
    assert.equal(again.heroStyle, fixed[2]!.heroStyle);
    assert.equal(again.layout, fixed[2]!.layout);
    assert.equal(again.header, fixed[2]!.header);
  });

  it("Pauls Valley mock looks share no hero variant, header, buttons, section sequence or photo treatment", () => {
    const looks = threeLooks();
    const heroes = looks.map((l) => l.sig.hero);
    assert.deepEqual(new Set(heroes).size, 3, heroes.join(" | "));
    for (let a = 0; a < 3; a += 1) {
      for (let b = a + 1; b < 3; b += 1) {
        assert.deepEqual(similarities(looks[a]!.sig, looks[b]!.sig), [], `${looks[a]!.design.name} vs ${looks[b]!.design.name}: ${JSON.stringify([looks[a]!.sig, looks[b]!.sig])}`);
      }
    }
    // Below the fold: the bold look opens with a services ticker, the showcase look has a photo mosaic.
    const bold = looks.find((l) => l.design.layout === "bold")!;
    assert.equal(bold.sections[1]!.type, "marquee");
    const showcase = looks.find((l) => l.design.layout === "showcase")!;
    assert.ok(showcase.sections.some((s) => s.type === "gallery"));
  });

  it("renders the three hero treatments differently (caption, cinematic, tilted collage with a second photo)", () => {
    const looks = threeLooks();
    const ctx = {
      name: pv.name,
      industry: "",
      phone: pv.phone,
      email: "",
      address: pv.address,
      hours: [],
      images: new Set(available),
      imageAlt: () => "Pauls Valley",
      imageCaption: (n: string) => (n === "hero" ? "Pauls Valley Historic District · Photo: Crimsonedge34, CC BY-SA 3.0" : undefined),
      page: "home",
    };
    const html = Object.fromEntries(looks.map((l) => [l.design.heroStyle, renderSection(l.sections[0]!, ctx)]));
    assert.match(html.caption!, /s-hero-split[^"]*v-caption[\s\S]*<figcaption>Pauls Valley Historic District · Photo: Crimsonedge34, CC BY-SA 3\.0<\/figcaption>/);
    assert.match(html.cinematic!, /s-hero-photo t-dark v-cinematic/);
    assert.match(html.collage!, /v-collage[\s\S]*class="media tile"/);
  });

  it("without a hero photo, every look falls back to the typographic hero, still in its own variant", () => {
    const looks = diversifyDirections(mockDirections(pv, 0)).map((design) =>
      arrangeSections(composeMockPage(plan.pages[0]!, pv, plan, design, { services: [], photos: [] }), design, [], pv.services),
    );
    assert.deepEqual(new Set(looks.map((s) => `${s[0]!.type}/${s[0]!.variant}`)).size, 3);
  });
});
