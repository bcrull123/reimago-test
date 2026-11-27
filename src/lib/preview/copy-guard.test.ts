import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findUnfortunatePhrasing, rewriteUnfortunateText, guardSections, isFoodSite } from "./copy-guard.ts";
import { structuralMisses, structuralScore } from "./qa.ts";
import type { DesignDirection, Section } from "./types.ts";

const cafe = {
  name: "Cafe 501",
  industry: "restaurant",
  description: "American restaurant in Edmond, known for brunch, lunch, and dinner.",
  address: "501 S Boulevard, Edmond, OK 73034",
  host: "cafe501.com",
};

describe("copy-guard", () => {
  it("is a food site for Cafe 501", () => {
    assert.equal(isFoodSite(cafe), true);
  });

  it("rewrites “Dinner that lingers after dark”", () => {
    const hits = findUnfortunatePhrasing("Dinner that lingers after dark", cafe);
    assert.ok(hits.some((h) => h.phrase === "linger"), hits.map((h) => h.phrase).join(","));
    const out = rewriteUnfortunateText("Dinner that lingers after dark", cafe);
    assert.equal(out.changed, true);
    assert.equal(findUnfortunatePhrasing(out.text, cafe).length, 0, out.text);
    assert.match(out.text, /dinner/i);
    assert.doesNotMatch(out.text, /linger/i);
  });

  it("rewrites “Linger longer over Edmond's best plates”", () => {
    const out = rewriteUnfortunateText("Linger longer over Edmond's best plates", cafe);
    assert.equal(out.changed, true);
    assert.equal(findUnfortunatePhrasing(out.text, cafe).length, 0, out.text);
    assert.doesNotMatch(out.text, /linger/i);
    assert.match(out.text, /Edmond|plates/i);
  });

  it("rewrites linger in section headings via guardSections", () => {
    const sections = [
      { type: "hero-split", heading: "Dinner that lingers after dark", text: "Linger longer over Edmond's best plates" },
    ];
    const { sections: next, rewrites } = guardSections(sections, cafe, "Dark Premium");
    assert.ok(rewrites.length >= 2);
    assert.doesNotMatch(next[0]!.heading ?? "", /linger/i);
    assert.doesNotMatch(next[0]!.text ?? "", /linger/i);
  });

  it("flags lingering dinner copy as a QA miss", () => {
    const design = {
      name: "Dark Premium",
      archetype: "dark-premium",
      mood: "cinematic",
      fonts: { heading: "Space Grotesk", body: "Manrope" },
      palette: { primary: "#8cb4ff", accent: "#e8b86d", background: "#0e1628", surface: "#182234", text: "#f3efe6", muted: "#b9b5ad" },
    } as unknown as DesignDirection;
    const sections = [{ type: "hero-photo", heading: "Dinner that lingers after dark", text: "Short punchy lines." }] as Section[];
    const scores = structuralScore({ design, sections, facts: cafe });
    const misses = structuralMisses({ design, sections, scores, facts: cafe });
    assert.ok(misses.some((m) => /unfortunate phrasing/i.test(m) && /linger/i.test(m)), misses.join(" | "));
  });

  it("lets a clean food headline through", () => {
    const line = "Edmond's table for brunch and beyond";
    assert.equal(findUnfortunatePhrasing(line, cafe).length, 0);
    assert.equal(rewriteUnfortunateText(line, cafe).changed, false);
  });

  it("rewrites “to die for” on a healthcare site", () => {
    const clinic = { name: "Valley Clinic", industry: "healthcare", description: "A family medical clinic." };
    const out = rewriteUnfortunateText("Care to die for", clinic);
    assert.equal(out.changed, true);
    assert.doesNotMatch(out.text, /die/i);
  });
});
