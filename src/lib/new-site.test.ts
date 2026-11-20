import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bareHost, briefForFacts, emptyNewSite, newSiteProblem } from "./new-site.ts";

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
