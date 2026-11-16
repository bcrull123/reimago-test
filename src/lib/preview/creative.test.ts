import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contrast, mockDirections, normalizeDirection, HEADING_FONTS, BODY_FONTS } from "./design.ts";
import { composeMockPage, normalizeSections, renderSection, statIsReal, type NormalizeContext, type RenderContext } from "./sections.ts";
import { renderSitePage, type StoredSite } from "./render.ts";
import type { SiteFacts, SitePlan } from "./types.ts";

const facts: SiteFacts = {
  mode: "reimagine",
  sourceUrl: "https://joesplumbing.com/",
  host: "joesplumbing.com",
  name: "Joe's Plumbing",
  tagline: "Family-owned plumbing since 1998",
  description: "Family-owned plumbing in Tulsa since 1998. Over 2,000 homes served.",
  logo: "",
  colors: ["#1f4e79"],
  phone: "(405) 555-0123",
  email: "hello@joesplumbing.com",
  address: "12 Main St, Tulsa, OK 74103",
  hours: ["Mon–Fri 8am–5pm"],
  services: ["Drain Cleaning", "Water Heaters", "Leak Repair", "Gas Lines"],
  about: "Joe started the business in 1998.",
  testimonials: [{ quote: "They fixed our water heater the same afternoon and cleaned up after.", author: "Dana R." }],
  images: [],
  nav: [],
  pages: [],
  social: [],
  industry: "plumbing",
  notes: "",
};

const plan: SitePlan = {
  tagline: "Plumbing done right",
  summary: "",
  changes: [],
  cta: { label: "Get a quote", slug: "contact" },
  pages: [
    { slug: "home", title: "Home", navLabel: "Home", purpose: "", sections: [] },
    { slug: "services", title: "Services", navLabel: "Services", purpose: "", sections: [] },
    { slug: "contact", title: "Contact", navLabel: "Contact", purpose: "", sections: [] },
  ],
} as unknown as SitePlan;

const nctx = (page = "home"): NormalizeContext => ({
  slugs: ["home", "services", "contact"],
  phone: facts.phone,
  email: facts.email,
  images: ["hero", "photo-1"],
  testimonials: facts.testimonials,
  corpus: `${facts.description} ${facts.about}`,
  page,
});

describe("normalizeDirection", () => {
  it("keeps creative choices but forces curated fonts and readable colors", () => {
    const d = normalizeDirection(
      {
        name: "Copper & Steam",
        archetype: "dark-premium",
        palette: { primary: "#c9a227", accent: "#e8d39a", background: "#0e1013", surface: "#171a1f", text: "#151515", muted: "#202020" },
        fonts: { heading: "Comic Sans MS", body: "Manrope" },
        motifs: ["glow", "not-a-motif", "grain"],
        hero: "photo",
        header: "<script>",
      },
      0,
      facts,
    );
    assert.equal(d.name, "Copper & Steam");
    assert.equal(d.archetype, "dark-premium");
    assert.ok(HEADING_FONTS.includes(d.fonts.heading), "heading font from the curated list");
    assert.ok(BODY_FONTS.includes(d.fonts.body));
    assert.deepEqual(d.motifs, ["glow", "grain"]);
    assert.equal(d.hero, "photo");
    assert.ok(["light", "dark", "overlay"].includes(d.header));
    assert.ok(contrast(d.palette.text, d.palette.background) >= 7, "text readable on background");
  });

  it("mock directions give three distinct archetypes", () => {
    const looks = mockDirections(facts, 0);
    assert.equal(looks.length, 3);
    assert.equal(new Set(looks.map((l) => l.archetype)).size, 3);
  });
});

describe("normalizeSections", () => {
  it("drops invented stats, reviews, contacts, images and links", () => {
    const sections = normalizeSections(
      {
        sections: [
          { type: "stats", items: [{ title: "1998", text: "Since" }, { title: "2,000+", text: "Homes" }, { title: "10,000+", text: "Fake" }, { title: "4.9★", text: "Fake" }] },
          { type: "hero", heading: "Call (212) 555-0199 or mail fake@example.com", image: "https://evil.example/x.jpg", cta: { label: "Go", page: "/nope" } },
          { type: "testimonials", items: [{ title: "Jane", text: "Best plumber in the galaxy!" }, { title: "Dana", text: "They fixed our water heater the same afternoon and cleaned up after." }] },
          { type: "marquee-of-doom", items: ["x"] },
          { type: "services", items: [{ title: "Drains", image: "photo-1", icon: "wrench" }, { title: "Leaks", image: "nope" }] },
        ],
      },
      nctx(),
    );
    assert.equal(sections[0]!.type, "hero-split", "hero is moved first");
    assert.doesNotMatch(sections[0]!.heading ?? "", /212|fake@example/);
    assert.equal(sections[0]!.image, undefined);
    assert.ok(["home", "services", "contact"].includes(sections[0]!.cta!.page));
    const stats = sections.find((s) => s.type === "stat-bar")!;
    assert.deepEqual(stats.items!.map((i) => i.title), ["1998", "2,000+"]);
    const reviews = sections.find((s) => s.type === "reviews")!;
    assert.deepEqual(reviews.items!.map((i) => i.title), ["Dana R."]);
    assert.equal(sections.some((s) => (s.type as string) === "marquee-of-doom"), false);
    const services = sections.find((s) => s.type === "services-grid")!;
    assert.equal(services.items![0]!.image, "photo-1");
    assert.equal(services.items![1]!.image, undefined);
  });

  it("turns a homepage hero into a page hero on inner pages", () => {
    const sections = normalizeSections([{ type: "hero-photo", heading: "Services" }], nctx("services"));
    assert.equal(sections[0]!.type, "page-hero");
  });

  it("statIsReal needs every number to appear in the facts", () => {
    assert.equal(statIsReal("25+ years", "Since 1998 we have 25 trucks"), true);
    assert.equal(statIsReal("98%", "Since 1998"), false);
    assert.equal(statIsReal("Fast", "anything"), false);
  });
});

describe("renderSection", () => {
  const rctx: RenderContext = {
    name: facts.name,
    industry: "plumbing",
    phone: facts.phone,
    email: facts.email,
    address: facts.address,
    hours: facts.hours,
    images: new Set(["hero"]),
    imageAlt: () => "A plumber at work",
    page: "home",
  };

  it("escapes text and only allows *emphasis*", () => {
    const html = renderSection({ type: "hero-split", tone: "light", heading: "Pipes <img src=x onerror=alert(1)> *fixed*", image: "hero" }, rctx);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img/);
    assert.match(html, /<em>fixed<\/em>/);
    assert.match(html, /src="@img:hero"/);
  });

  it("FAQ uses details/summary and reviews carousel has no script", () => {
    const faq = renderSection({ type: "faq", tone: "light", items: [{ title: "Q?", text: "A." }] }, rctx);
    assert.match(faq, /<details/);
    assert.match(faq, /<summary/);
    const reviews = renderSection({ type: "reviews", tone: "tint", items: [{ title: "Dana R.", text: "Great." }] }, rctx);
    assert.doesNotMatch(reviews, /<script/i);
  });
});

describe("renderSitePage v3", () => {
  const design = mockDirections(facts, 0)[0]!;
  const home = composeMockPage(plan.pages[0]!, facts, plan, design, { hero: "hero", services: [], photos: [] });
  const site: StoredSite = {
    version: 3,
    id: "0123456789abcdef",
    createdAt: "2026-11-16T12:00:00.000Z",
    mode: "reimagine",
    mock: true,
    host: facts.host,
    sourceUrl: facts.sourceUrl,
    name: facts.name,
    tagline: facts.tagline,
    logo: "",
    phone: facts.phone,
    email: facts.email,
    address: facts.address,
    hours: facts.hours,
    social: [],
    palette: design.palette,
    fonts: design.fonts,
    cta: plan.cta,
    pages: [
      { slug: "home", title: "Home", navLabel: "Home", body: "", sections: home },
      { slug: "services", title: "Services", navLabel: "Services", body: "", pending: true },
      { slug: "contact", title: "Contact", navLabel: "Contact", body: "", sections: [{ type: "page-hero", tone: "tint", heading: "Contact" }, { type: "contact-block", tone: "light" }] },
    ],
    design,
    images: { hero: { name: "hero", type: "image/jpeg", source: "generated", alt: "A plumber at work" } },
  };

  it("renders the homepage with stored images and relative page links, no scripts", () => {
    const html = renderSitePage(site, "home")!;
    assert.ok(home.length >= 4, "mock homepage has several sections");
    assert.doesNotMatch(html, /<script/i);
    assert.match(html, /src="0123456789abcdef\/img\/hero"/);
    assert.match(html, /href="0123456789abcdef\/contact"/);
    assert.match(html, /fonts.googleapis.com\/css2/);
    assert.match(html, new RegExp(`a-${design.archetype}`));
    assert.doesNotMatch(html, /@img:|@page:/);
  });

  it("shows a pending page until the look is chosen", () => {
    assert.match(renderSitePage(site, "services")!, /built when you choose this look/);
  });

  it("keeps the Formcarry contact form on the contact page", () => {
    const html = renderSitePage(site, "contact")!;
    assert.match(html, /action="https:\/\/formcarry.com\/s\/NipZS0fF4w4"/);
    assert.match(html, /name="mode" value="preview_contact"/);
    assert.match(html, /name="_gotcha"/);
    assert.match(html, /src="img\/hero"|<form/);
    assert.match(html, /href="tel:\+14055550123"/);
  });
});
