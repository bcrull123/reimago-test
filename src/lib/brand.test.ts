import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BRAND, brandNameParts } from "./brand.ts";

describe("round 10e: clone brand config", () => {
  it("defaults to reimago.ai text, no header logo, and the current orange", () => {
    assert.equal(BRAND.name, "reimago.ai");
    assert.equal(BRAND.logoUrl, "");
    assert.equal(BRAND.color, "#f89800");
  });
  it("splits a domain-style name so the last part can take the brand color", () => {
    assert.deepEqual(brandNameParts("reimago.ai"), { head: "reimago", mark: ".ai" });
    assert.deepEqual(brandNameParts("Studio"), { head: "Studio", mark: "" });
  });
});
