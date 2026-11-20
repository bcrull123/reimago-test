import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bareHost, briefForFacts, emptyNewSite, extraDetailsCount, extraLeadFields, newSiteProblem, parseSocialLinks } from "./new-site.ts";

describe("round 10: Build a New Site", () => {
  const ok = { ...emptyNewSite(), business_name: "Riverside Plumbing", what: "Plumbing repairs for homeowners on the east side", domain_choice: "get" as const };
  it("asks for the name, what it does, and a domain choice", () => {
    assert.match(newSiteProblem(emptyNewSite()), /business name/);
    assert.match(newSiteProblem({ ...ok, what: "" }), /what the business does/);
    assert.match(newSiteProblem({ ...ok, domain_choice: "" }), /I have a domain/);
    assert.match(newSiteProblem({ ...ok, domain_choice: "have", domain: "not a domain" }), /Enter your domain/);
    assert.equal(newSiteProblem({ ...ok, domain_choice: "have", domain: "https://www.riverside-plumbing.com/" }), "");
    assert.equal(newSiteProblem(ok), "");
  });
  it("cleans the owner's domain", () => {
    assert.equal(bareHost("https://www.Example.com/about?x=1"), "Example.com");
  });
  it("maps to the brief keys the site facts are built from (any business, nothing hard coded)", () => {
    const f = briefForFacts({ ...ok, location: "Austin, Texas", style: "warm, navy and copper" });
    assert.equal(f.business_name, "Riverside Plumbing");
    assert.match(String(f.what), /Plumbing repairs/);
    assert.equal(f.location, "Austin, Texas");
    assert.equal(f.style, "warm, navy and copper");
    assert.equal(f.domain, "", "“get me a domain” sends no domain");
    const salon = briefForFacts({ ...ok, business_name: "Glow Studio", what: "Hair color and cuts", domain_choice: "have", domain: "https://glowstudio.com/" });
    assert.equal(salon.domain, "glowstudio.com");
    assert.equal(salon.domain_status, "owned");
    assert.equal(briefForFacts(ok, "https://reimago.ai/made/0123456789abcdef/img/upload-logo").logo_url, "https://reimago.ai/made/0123456789abcdef/img/upload-logo");
  });
});

describe("round 10d: optional Add more details", () => {
  const ok = { ...emptyNewSite(), business_name: "Glow Studio", what: "Hair color and cuts for busy professionals", domain_choice: "get" as const };
  it("does not require the extra fields, and counts only what was filled", () => {
    assert.equal(newSiteProblem(ok), "");
    assert.equal(extraDetailsCount(ok), 0);
    assert.equal(extraDetailsCount({ ...ok, phone: "512-555-0199", services: "Color\nCuts", pages: ["Home", "Contact"] }, 2), 4);
  });
  it("maps services, contact, hours, pages, social links and photos for the looks and the lead", () => {
    const brief = {
      ...ok,
      services: "Color\nCuts, Highlights",
      hours: "Tue–Sat 10–6\nSun 11–3",
      phone: "(512) 555-0199",
      contact_email: "hi@glowstudio.com",
      address: "100 South Congress, Austin, TX",
      pages: ["Home", "Services/Products", "Contact"],
      social: "instagram.com/glowstudio\nhttps://www.facebook.com/glowstudio",
      goal: "Book an appointment",
      features: ["Booking", "Contact form"],
    };
    const photos = ["https://reimago.ai/made/0123456789abcdef/img/upload-photo-1"];
    const f = briefForFacts(brief, "", photos);
    assert.deepEqual(f.services, brief.services);
    assert.deepEqual(f.pages, ["Home", "Services/Products", "Contact"]);
    assert.equal(f.phone, "(512) 555-0199");
    assert.equal(f.contact_email, "hi@glowstudio.com");
    assert.equal(f.address, "100 South Congress, Austin, TX");
    assert.equal(f.hours, "Tue–Sat 10–6\nSun 11–3");
    assert.deepEqual(f.social, ["https://instagram.com/glowstudio", "https://www.facebook.com/glowstudio"]);
    assert.deepEqual(f.photo_urls, photos);
    assert.deepEqual(f.features, ["Booking", "Contact form"]);
    assert.equal(f.goal, "Book an appointment");
    const lead = extraLeadFields(brief, photos);
    assert.match(lead.services, /Color/);
    assert.match(lead.pages, /Contact/);
    assert.equal(lead.photo_urls, photos[0]);
    assert.match(lead.social, /instagram\.com\/glowstudio/);
  });
  it("parses social links generically, and ignores junk", () => {
    assert.deepEqual(parseSocialLinks("instagram.com/anybiz\nnot a link\nhttps://linkedin.com/company/anybiz"), [
      "https://instagram.com/anybiz",
      "https://linkedin.com/company/anybiz",
    ]);
  });
});
