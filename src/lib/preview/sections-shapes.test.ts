import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SECTION_EXAMPLE_LIST, checkSections, sectionTypeOf, type NormalizeContext } from "./sections.ts";
import { SECTION_TYPES } from "./types.ts";

const ctx: NormalizeContext = {
  slugs: ["home", "services", "about", "contact"],
  phone: "(405) 555-0123",
  email: "hello@joesplumbing.com",
  images: ["hero", "feature", "photo-1", "photo-2", "photo-3"],
  testimonials: [{ quote: "They fixed our water heater the same afternoon and cleaned up after.", author: "Dana R." }],
  corpus: "Family-owned plumbing in Tulsa since 1998. Over 2,000 homes served. 25 years. Rated 4.9.",
  page: "home",
};

const types = (raw: unknown) => checkSections(raw, ctx).sections.map((s) => s.type);

describe("sectionTypeOf", () => {
  it("maps case, camelCase, snake_case, spaces, and decorated names onto library ids", () => {
    assert.equal(sectionTypeOf("hero-photo"), "hero-photo");
    assert.equal(sectionTypeOf("HeroPhoto"), "hero-photo");
    assert.equal(sectionTypeOf("hero_split"), "hero-split");
    assert.equal(sectionTypeOf("Services Grid"), "services-grid");
    assert.equal(sectionTypeOf("faq-section"), "faq");
    assert.equal(sectionTypeOf("section-cta-band"), "cta-band");
    assert.equal(sectionTypeOf("CTA Band (gradient)"), "cta-band");
    assert.equal(sectionTypeOf("testimonials"), "reviews");
    assert.equal(sectionTypeOf("hero-photo-overlay"), "hero-photo");
    assert.equal(sectionTypeOf("banana"), undefined);
  });
});

describe("checkSections tolerates real-model shapes", () => {
  it("accepts every documented example as-is", () => {
    for (const type of SECTION_TYPES) {
      const { sections, rejected } = checkSections({ sections: [SECTION_EXAMPLE_LIST[type]] }, ctx);
      assert.equal(sections.length, 1, `${type}: ${rejected.join("; ")}`);
    }
  });

  it("reads the type from section/kind/component keys", () => {
    assert.deepEqual(
      types({
        sections: [
          { section: "hero-photo", heading: "Fixed today" },
          { kind: "services-grid", items: [{ title: "Drains" }] },
          { component: "CtaBand", heading: "Call us" },
        ],
      }),
      ["hero-photo", "services-grid", "cta-band"],
    );
  });

  it("flattens props/content nesting and alias field names", () => {
    const { sections } = checkSections(
      {
        sections: [
          { type: "hero_split", props: { headline: "Plumbing *done right*", subheadline: "Since 1998", button: { text: "Get a quote", href: "/contact" } } },
          { type: "process", content: { steps: [{ name: "Call", description: "Tell us" }, { name: "Visit", description: "We come" }] } },
          { type: "faq", data: { faqs: [{ question: "Do you do gas lines?", answer: "Yes." }] } },
        ],
      },
      ctx,
    );
    assert.equal(sections[0]?.heading, "Plumbing *done right*");
    assert.equal(sections[0]?.text, "Since 1998");
    assert.deepEqual(sections[0]?.cta, { label: "Get a quote", page: "contact" });
    assert.equal(sections[1]?.items?.length, 2);
    assert.equal(sections[1]?.items?.[0]?.title, "Call");
    assert.equal(sections[2]?.items?.[0]?.text, "Yes.");
  });

  it("accepts sections keyed by type, or a map of sections, or a nested wrapper", () => {
    assert.deepEqual(types({ sections: [{ "hero-photo": { heading: "Hi" } }, { "cta-band": { heading: "Go" } }] }), ["hero-photo", "cta-band"]);
    assert.deepEqual(types({ sections: { "hero-type": { heading: "Hi" }, statement: { text: "We show up." } } }), ["hero-type", "statement"]);
    assert.deepEqual(types({ page: { sections: [{ type: "hero-photo", heading: "Hi" }] } }), ["hero-photo"]);
    assert.deepEqual(types([{ type: "hero-photo", heading: "Hi" }]), ["hero-photo"]);
  });

  it("coerces strings and arrays: string CTA, text arrays, string items, string tones", () => {
    const { sections } = checkSections(
      {
        sections: [
          { type: "hero-photo", heading: "Hi", text: ["One.", "Two."], cta: "Book now", tone: "Dark" },
          { type: "marquee", items: ["Drains", "Heaters"], tone: "accent" },
        ],
      },
      ctx,
    );
    assert.equal(sections[0]?.text, "One.\nTwo.");
    assert.equal(sections[0]?.cta?.label, "Book now");
    assert.equal(sections[0]?.tone, "dark");
    assert.equal(sections[1]?.items?.length, 2);
    assert.equal(sections[1]?.tone, "brand");
  });

  it("keeps partially valid sections instead of dropping them", () => {
    const { sections } = checkSections(
      {
        sections: [
          { type: "hero-photo", heading: "Hi" },
          { type: "services-grid", heading: "What we do", text: "Drains\nWater heaters\nLeaks" },
          { type: "faq", heading: "Questions", text: "Call us with anything." },
          { type: "hero-split", heading: "A second hero with copy" },
        ],
      },
      ctx,
    );
    assert.deepEqual(
      sections.map((s) => s.type),
      ["hero-photo", "services-grid", "rich-text", "feature-split"],
    );
    assert.equal(sections[1]?.items?.length, 3);
  });

  it("still enforces the safety rules and says why", () => {
    const { sections, rejected, total } = checkSections(
      {
        sections: [
          { type: "hero-photo", heading: "Hi" },
          { type: "stat-bar", items: [{ title: "99%", text: "invented" }, { title: "500", text: "invented" }] },
          { type: "mystery-widget", heading: "?" },
          { heading: "no type at all" },
        ],
      },
      { ...ctx, testimonials: [] },
    );
    assert.equal(total, 4);
    assert.equal(sections.length, 1);
    assert.equal(rejected.length, 3);
    assert.match(rejected[0]!, /stat-bar: fewer than 2 numbers/);
    assert.match(rejected[1]!, /unknown section type type="mystery-widget"/);
    assert.match(rejected[2]!, /no section type/);
  });

  it("explains a missing list", () => {
    const { rejected } = checkSections({ answer: "sorry" }, ctx);
    assert.match(rejected[0]!, /no section list found \(top-level keys: answer\)/);
  });
});
