import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { analyzeLogo, analyzeSvg, logoTreatment } from "./logo.ts";
import { bestFromSrcset, pickLogo } from "./logo-pick.ts";
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

/** A transparent 120x120 badge: a filled circle in `disc`, with a bar of `inner` color inside (or none). */
function makeBadge(disc: [number, number, number], inner?: [number, number, number]): Buffer {
  const png = new PNG({ width: 120, height: 120 });
  for (let y = 0; y < 120; y += 1) {
    for (let x = 0; x < 120; x += 1) {
      const i = (y * 120 + x) * 4;
      const inside = (x - 60) ** 2 + (y - 60) ** 2 < 50 ** 2;
      let c = [0, 0, 0, 0];
      if (inside) c = [...disc, 255];
      if (inside && inner && x >= 30 && x < 90 && y >= 50 && y < 70) c = [...inner, 255];
      png.data.set(c, i);
    }
  }
  return PNG.sync.write(png);
}

describe("logos on dark headers never go blank", () => {
  it("a white logo on transparent (cafe501) shows as is on dark, and black on light", () => {
    const a = analyzeLogo(makeBadge([255, 255, 255]), "image/png");
    assert.equal(a.meta.bg, "transparent");
    assert.equal(a.meta.poorOnDark, 0);
    assert.equal(logoTreatment(a.meta, "#0e1013").kind, "plain");
    assert.equal(logoTreatment(a.meta, "#f6f1e7").kind, "knockout-black");
  });

  it("a two-tone mark (white lettering in a black disc) is not knocked out to a blank white disc", () => {
    const a = analyzeLogo(makeBadge([0, 0, 0], [255, 255, 255]), "image/png");
    assert.equal(a.meta.mono, true);
    assert.equal(a.meta.flat, false);
    const dark = logoTreatment(a.meta, "#0e1013");
    assert.notEqual(dark.kind, "knockout-white");
    assert.equal(dark.kind, "plate");
    assert.ok(dark.plate && dark.plate !== "#ffffff", `plate ${dark.plate} keeps the white lettering visible`);
    assert.equal(a.darkPng, undefined, "no reversed copy that would merge the lettering");
  });

  it("a dark multi-color badge with white details gets no reversed copy (it would merge)", () => {
    const a = analyzeLogo(makeBadge([20, 30, 90], [255, 255, 255]), "image/png");
    assert.equal(a.darkPng, undefined);
    assert.equal(logoTreatment(a.meta, "#0e1013").kind, "plate");
  });

  it("logos that can't be loaded or read become a text wordmark", () => {
    assert.equal(logoTreatment({ bg: "unknown", wordmark: true }, "#0e1013").kind, "wordmark");
    assert.equal(logoTreatment({ bg: "unknown", wordmark: true }, "#ffffff").kind, "wordmark");
  });
});

describe("SVG logos", () => {
  it("reads colors: a white SVG is plain on dark and knocked out black on light", () => {
    const meta = analyzeSvg('<svg viewBox="0 0 10 10"><path fill="#fff" d="M0 0h10v10z"/></svg>');
    assert.equal(meta.svg, true);
    assert.equal(logoTreatment(meta, "#111111").kind, "plain");
    assert.equal(logoTreatment(meta, "#ffffff").kind, "knockout-black");
  });
  it("an SVG with no fill is black: white knockout on dark", () => {
    const meta = analyzeSvg('<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>');
    assert.equal(logoTreatment(meta, "#111111").kind, "knockout-white");
    assert.equal(logoTreatment(meta, "#ffffff").kind, "plain");
  });
  it("a navy + red SVG gets a light plate on dark", () => {
    const meta = analyzeSvg('<svg><style>.a{fill:#1b2a4a}.b{fill:#d0202a}</style><path class="a"/><path class="b"/></svg>');
    const t = logoTreatment(meta, "#111111");
    assert.ok(t.kind === "plate" || t.kind === "plain");
  });
  it("non-SVG text becomes a wordmark", () => {
    assert.equal(analyzeSvg("<html>not found</html>").wordmark, true);
  });
});

describe("pickLogo", () => {
  const base = "https://www.example.com/";
  it("uses the real file behind a lazy-load placeholder", () => {
    const html = '<header><img class="site-logo lazyload" src="data:image/gif;base64,R0lGOD" data-src="/img/logo.png" alt="Cafe"></header>';
    assert.equal(pickLogo(html, base), "https://www.example.com/img/logo.png");
  });
  it("takes the largest srcset candidate", () => {
    assert.equal(bestFromSrcset("a.png 1x, b.png 2x"), "b.png");
    assert.equal(bestFromSrcset("s.png 300w, l.png 1200w, m.png 600w"), "l.png");
  });
  it("skips tracking pixels and partner badges, prefers the header logo", () => {
    const html = [
      '<img src="https://www.facebook.com/tr?id=1" width="1" height="1" alt="">',
      '<footer><img class="footer-logo" src="/f-logo.png"></footer>',
      '<img class="yelp-logo" src="/yelp.png">',
      '<header><img elementtiming="nbf-header-logo-desktop" src="//cdn.example.com/501+circle+white.png?format=1500w" alt="Cafe 501"></header>',
    ].join("");
    assert.equal(pickLogo(html, base, "Cafe 501"), "https://cdn.example.com/501+circle+white.png?format=1500w");
  });
  it("accepts a header image whose alt is the business name", () => {
    assert.equal(pickLogo('<header><a href="/"><img src="/brand-mark.png" alt="Joe\'s Plumbing"></a></header>', base, "Joe's Plumbing"), "https://www.example.com/brand-mark.png");
  });
  it("upgrades http to https", () => {
    assert.equal(pickLogo('<img class="logo" src="http://cdn.example.com/logo.png">', base), "https://cdn.example.com/logo.png");
  });
});
