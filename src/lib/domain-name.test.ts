import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeDomain } from "./domain-name.ts";
import { CREATE_STEP_IDS } from "./create-steps.ts";

describe("normalizeDomain", () => {
  it("strips scheme, www, path, port, case, and a trailing dot", () => {
    assert.equal(normalizeDomain("https://www.Northline.com/about?x=1").domain, "northline.com");
    assert.equal(normalizeDomain("  HTTP://WWW.bob.me:8080/ ").domain, "bob.me");
    assert.equal(normalizeDomain("shop.example.co.uk.").domain, "shop.example.co.uk");
    assert.equal(normalizeDomain("my-dentist.org").domain, "my-dentist.org");
    assert.equal(normalizeDomain("xn--bcher-kva.com").domain, "xn--bcher-kva.com");
  });
  it("rejects things that are not domains", () => {
    for (const bad of ["", "northline", "north line.com", "-north.com", "north-.com", "north..com", "north.c", "north.123", "north_line.com"]) {
      assert.ok(normalizeDomain(bad).error, `expected an error for ${JSON.stringify(bad)}`);
    }
  });
});

describe("create wizard steps", () => {
  it("asks for the domain first, exactly once", () => {
    assert.equal(CREATE_STEP_IDS[0], "domain");
    assert.equal(CREATE_STEP_IDS.filter((id) => id === "domain").length, 1);
    assert.equal(CREATE_STEP_IDS.length, 14);
  });
});
