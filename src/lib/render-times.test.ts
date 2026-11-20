import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MS, rollingAverage } from "./render-times.server.ts";

describe("round 10: render durations", () => {
  it("averages the last 20 finished renders per kind, defaults with no history", () => {
    assert.equal(rollingAverage([], "edit"), DEFAULT_MS.edit);
    assert.equal(rollingAverage([60_000, 90_000], "round1"), 75_000);
    const many = [...Array(30).fill(1000), ...Array(20).fill(50_000)];
    assert.equal(rollingAverage(many, "newsite"), 50_000);
  });
});
