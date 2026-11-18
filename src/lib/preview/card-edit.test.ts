import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { customTuneCss, lightingOnly, readAdjustments, requestedStyle, tuneNumbers, wantsNewPhoto, type LookRef, type LookTune } from "./look-edit.ts";
import { planEdit } from "./look-edit.server.ts";

// Bob's round 8 (Pauls Valley): Editorial / Dark Premium / Custom Design.
const looks: LookRef[] = [
  { id: "a".repeat(16), name: "Editorial", archetype: "editorial", index: 0, background: "#f4efe6", primary: "#1f4d3a" },
  { id: "b".repeat(16), name: "Dark Premium", archetype: "dark-premium", index: 1, background: "#0e1116", primary: "#c9a36b" },
  { id: "c".repeat(16), name: "Custom Design", archetype: "playful", index: 2, background: "#f6efe2", primary: "#1f4d3a", custom: true },
];
const bob = "Use Bold Photo and make the image in daylight. adjust the text to show contrast.";

describe("per-card “Change this look” box (round 8)", () => {
  it("reads Bob's wording as daylight + more contrast on the CURRENT photo, not a new photo", () => {
    const types = readAdjustments(bob).map((a) => a.type);
    assert.ok(types.includes("daylight"), JSON.stringify(types));
    assert.ok(types.includes("more-contrast"), JSON.stringify(types));
    assert.ok(readAdjustments("make the image daylight and raise text contrast").some((a) => a.type === "more-contrast"));
    assert.equal(wantsNewPhoto(bob), false);
    assert.equal(wantsNewPhoto("make the image daylight and raise text contrast"), false);
    assert.equal(wantsNewPhoto("use a different photo of the depot"), true);
    assert.equal(wantsNewPhoto("a photo of main street"), true);
    assert.ok(lightingOnly("daylight scene"));
    assert.ok(!lightingOnly("historic district"));
  });

  it("daylight brightens and warms the photo and lightens the overlay; palette untouched", () => {
    const n = tuneNumbers({ daylight: 2 });
    assert.ok(n.brightness > 1.15 && n.saturate > 1 && n.sepia > 0 && n.scrim < 1, JSON.stringify(n));
  });

  it("the card's box targets that card even when the words name another style (no fuzzy matching)", async () => {
    const edit = await planEdit(bob, looks, undefined, false, looks[1]!.id);
    assert.equal(edit.targetId, looks[1]!.id);
    assert.match(edit.how ?? "", /card 2/);
    assert.equal(edit.photo, undefined);
    assert.ok(edit.adjustments.some((a) => a.type === "daylight"));
    // "Use Bold Photo" typed in Dark Premium's own box is an explicit style switch for THAT card only.
    assert.equal(edit.restyle, "bold-photo");
    const kept = await planEdit("make the image daylight and raise text contrast", looks, undefined, false, looks[1]!.id);
    assert.equal(kept.restyle, undefined, "no style named: the style stays");
    const other = await planEdit("Editorial, a little lighter", looks, undefined, false, looks[1]!.id);
    assert.equal(other.targetId, looks[1]!.id, "the card's box wins over a name in the text");
  });

  it("Custom Design's box edits Custom Design (never restyled), with a photo filter for its own HTML", async () => {
    const edit = await planEdit("make the photo daylight, more contrast", looks, undefined, false, looks[2]!.id);
    assert.equal(edit.targetId, looks[2]!.id);
    assert.equal(edit.restyle, undefined);
    const tune: LookTune = { levels: { daylight: 2, "more-contrast": 2 }, base: { palette: { primary: "#000000", accent: "#000000", background: "#ffffff", surface: "#ffffff", text: "#000000", muted: "#333333" }, motifs: [], name: "Custom Design" } };
    const css = customTuneCss(tune);
    assert.match(css, /img\[src\$="\/img\/hero"\]/);
    assert.match(css, /brightness\(/);
    assert.doesNotMatch(css, /brand-art|art-1|logo/);
  });

  it("only full style names count as a style switch", () => {
    assert.equal(requestedStyle("make it Bold Photo", "dark-premium"), "bold-photo");
    assert.equal(requestedStyle("switch to Warm Craft style", "editorial"), "warm-craft");
    assert.equal(requestedStyle("make the photo bold", "dark-premium"), undefined);
    assert.equal(requestedStyle("use Dark Premium", "dark-premium"), undefined, "its own style is not a switch");
  });
});
