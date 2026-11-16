import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { analyzeLogo, logoTreatment } from "./logo.ts";
import { parseJsonObject } from "../ai-json.ts";

/** A 120x40 logo: background (or transparent), a dark bar, and an optional red dot. */
function makeLogo(bg: [number, number, number, number], ink: [number, number, number], accent = false): Buffer {
  const png = new PNG({ width: 120, height: 40 });
  for (let y = 0; y < 40; y += 1) {
    for (let x = 0; x < 120; x += 1) {
      const i = (y * 120 + x) * 4;
      let c: number[] = bg;
      if (x >= 20 && x < 80 && y >= 12 && y < 28) c = [...ink, 255];
      if (accent && x >= 88 && x < 100 && y >= 16 && y < 28) c = [220, 20, 60, 255];
      png.data[i] = c[0]!;
      png.data[i + 1] = c[1]!;
      png.data[i + 2] = c[2]!;
      png.data[i + 3] = c[3]!;
    }
  }
  return PNG.sync.write(png);
}

describe("logo analysis", () => {
  it("keys out a white box behind a single-color logo and knocks it out white on dark headers", () => {
    const a = analyzeLogo(makeLogo([255, 255, 255, 255], [30, 40, 70]), "image/png");
    assert.equal(a.meta.bg, "cleared");
    assert.equal(a.meta.mono, true);
    const out = PNG.sync.read(a.png!);
    assert.equal(out.data[3], 0, "corner is transparent after keying");
    assert.ok(out.width < 120, "padding was trimmed");
    assert.equal(logoTreatment(a.meta, "#0e1013").kind, "knockout-white");
    assert.equal(logoTreatment(a.meta, "#ffffff").kind, "plain");
  });

  it("clears the white box behind a multi-color logo and makes a dark-surface copy", () => {
    const a = analyzeLogo(makeLogo([255, 255, 255, 255], [30, 40, 70], true), "image/png");
    assert.equal(a.meta.bg, "cleared");
    assert.equal(a.meta.mono, false);
    assert.ok(a.darkPng);
    assert.deepEqual(logoTreatment({ ...a.meta, darkImage: "logo-dark" }, "#0e1013"), { kind: "plain", image: "logo-dark" });
    assert.equal(logoTreatment(a.meta, "#ffffff").kind, "plain");
  });

  it("puts a logo in a colored box on a rounded plate of that color on dark headers", () => {
    const a = analyzeLogo(makeLogo([245, 220, 120, 255], [30, 40, 70], true), "image/png");
    assert.equal(a.meta.bg, "solid");
    assert.deepEqual(logoTreatment(a.meta, "#0e1013"), { kind: "plate", plate: a.meta.bgColor });
  });

  it("makes a reversed copy of a transparent two-color logo for dark surfaces", () => {
    const a = analyzeLogo(makeLogo([0, 0, 0, 0], [30, 40, 70], true), "image/png");
    assert.equal(a.meta.bg, "transparent");
    assert.ok(a.darkPng, "dark copy made");
    const dark = PNG.sync.read(a.darkPng!);
    const at = (x: number, y: number) => [...dark.data.subarray((y * dark.width + x) * 4, (y * dark.width + x) * 4 + 3)];
    // Find a navy pixel (now white) and the red dot (kept red).
    const pixels = Array.from({ length: dark.width * dark.height }, (_, i) => at(i % dark.width, Math.floor(i / dark.width)));
    assert.ok(pixels.some((p) => p[0] === 255 && p[1] === 255 && p[2] === 255), "navy lettering turned white");
    assert.ok(pixels.some((p) => p[0] === 220 && p[1] === 20), "red accent kept");
    assert.deepEqual(logoTreatment({ ...a.meta, darkImage: "logo-dark" }, "#0e1013"), { kind: "plain", image: "logo-dark" });
  });

  it("unknown formats get a light plate on dark surfaces and multiply on light ones", () => {
    assert.deepEqual(logoTreatment(undefined, "#111111"), { kind: "plate", plate: "#ffffff" });
    assert.equal(logoTreatment({ bg: "unknown" }, "#ffffff").kind, "multiply");
  });
});

describe("parseJsonObject", () => {
  it("extracts JSON from fences and prose, tolerating trailing commas", () => {
    assert.deepEqual(parseJsonObject('Sure!\n```json\n{"sections": [{"type": "faq",},],}\n```\nHope that helps {x}'), { sections: [{ type: "faq" }] });
    assert.deepEqual(parseJsonObject('{"a": "brace } in string", "b": 1} trailing'), { a: "brace } in string", b: 1 });
  });

  it("explains cut-off answers", () => {
    assert.throws(() => parseJsonObject('{"sections": [{"type": "hero-split", "heading": "Hi'), /cut off/);
    assert.throws(() => parseJsonObject("I cannot help with that."), /not JSON/);
  });
});
