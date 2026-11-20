import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ringFraction, statusLines } from "./status-copy.ts";

describe("round 10: progress ring + status copy", () => {
  it("fills by elapsed / average, capped at 95% until done", () => {
    assert.equal(ringFraction(0, 60_000), 0);
    assert.equal(ringFraction(30_000, 60_000), 0.5);
    assert.equal(ringFraction(120_000, 60_000), 0.95);
    assert.equal(ringFraction(10_000, 0), 0);
  });
  it("has lively lines for each real stage, with new-site and edit variants", () => {
    assert.ok(statusLines("reimagine", "read").includes("Reading your site…"));
    assert.ok(statusLines("reimagine", "read").some((l) => /best photos/.test(l)));
    assert.ok(statusLines("reimagine", "dream").some((l) => /three fresh looks/.test(l)));
    assert.ok(statusLines("reimagine", "paint").some((l) => /Polishing the details/.test(l)));
    assert.ok(statusLines("newsite", "read").every((l) => !/your site/.test(l)), "a new site has no site to read");
    assert.ok(statusLines("edit", "").length >= 2);
  });
});
