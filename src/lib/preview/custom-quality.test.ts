import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { customQualityProblems, fontSizePx, polishedScratchLayout, sampleHeroSubject } from "./custom-quality.ts";

describe("fontSizePx", () => {
  it("evaluates rem, px, vw and clamp at a 1280px desktop", () => {
    assert.equal(fontSizePx("16px"), 16);
    assert.equal(fontSizePx("2.4rem"), 38.4);
    assert.equal(fontSizePx("10vw", 1280), 128);
    const tiny = fontSizePx("clamp(1.1rem, 1.5vw, 1.4rem)", 1280);
    assert.ok(tiny != null && tiny < 30, `tiny clamp was ${tiny}`);
    const big = fontSizePx("clamp(2.8rem, 7vw, 5.5rem)", 1280);
    assert.ok(big != null && big >= 44, `big clamp was ${big}`);
  });
});

describe("customQualityProblems", () => {
  it("flags a tiny corner headline, tiny CTA, arc crop and empty tall hero (Bob's Custom Design)", () => {
    const css = `
      .hero{min-height:85vh;position:relative}
      .hero img{clip-path:ellipse(45% 60% at 85% 40%);border-radius:50%;width:40%}
      h1{font-size:clamp(1.1rem,1.6vw,1.35rem)}
      .btn{font-size:11px;padding:2px 6px}
    `;
    const html = `<main><section class="hero"><img src="@img:hero" alt="tree canopy against the sky"><div class="copy"><h1>Pull Up a Chair to Valley Life</h1><a class="btn" href="@page:contact">Contact City Hall</a></div></section></main>`;
    const problems = customQualityProblems(html, css, { alt: "tree canopy against the sky", hasBetterPhoto: true });
    const blob = problems.join(" ");
    assert.ok(/too small/i.test(blob), blob);
    assert.ok(/arc|circle|crop/i.test(blob), blob);
    assert.ok(/sky or foliage|weak crop/i.test(blob), blob);
  });

  it("accepts a polished full-bleed hero with large type and a tappable CTA", () => {
    const layout = polishedScratchLayout({
      name: "Pauls Valley, Oklahoma",
      headline: "Pull up a chair to valley life",
      tagline: "A small city with a wide main street.",
      cta: { label: "Contact City Hall", slug: "contact" },
      pages: [{ slug: "home", title: "Home" }, { slug: "about", title: "About" }, { slug: "contact", title: "Contact" }],
      fonts: { heading: "Oswald", body: "Work Sans" },
      palette: { primary: "#c2410c", accent: "#0f766e", background: "#fde8d0", surface: "#f8d4a8", text: "#1c1410", muted: "#6b4f3a" },
      photo: "hero",
      photoAlt: "downtown brick streets",
    });
    const problems = customQualityProblems(layout.html, layout.css, { alt: "downtown brick streets", hasBetterPhoto: false });
    assert.deepEqual(problems, []);
    assert.match(layout.css, /clamp\(2\.8rem/);
    assert.match(layout.css, /min-height:\s*48px/);
    assert.match(layout.html, /@img:hero/);
  });

  it("detects a mostly-sky photograph from its pixels", () => {
    const sky = png(80, 50, (x, y) => (y < 35 ? [160, 200, 235] : [70, 130, 60]));
    const sample = sampleHeroSubject(sky.data, sky.width, sky.height);
    assert.ok(sample.sky + sample.foliage >= 0.62, JSON.stringify(sample));
    const problems = customQualityProblems("<main><section class='hero'><h1>Hi</h1></section></main>", "h1{font-size:4rem}.btn{font-size:1.1rem;padding:.9rem 1.4rem;min-height:48px}", { sample, hasBetterPhoto: true });
    assert.ok(problems.some((p) => /sky or foliage/i.test(p)), problems.join(" "));
  });

  it("does not flag a varied downtown-like photograph", () => {
    const town = png(80, 50, (x, y) => {
      const brick = x % 7 < 3 ? 40 : 120;
      const band = y > 30 ? [brick, brick - 10, 50] : [80 + (x % 5) * 20, 70, 60];
      return band as [number, number, number];
    });
    const sample = sampleHeroSubject(town.data, town.width, town.height);
    const problems = customQualityProblems("<main><section class='hero'><h1>Hi</h1></section></main>", "h1{font-size:4rem}.btn{font-size:1.1rem;padding:.9rem 1.4rem;min-height:48px}", { sample, alt: "downtown brick streets" });
    assert.ok(!problems.some((p) => /sky or foliage/i.test(p)), JSON.stringify(sample) + problems.join(" "));
  });
});

function png(width: number, height: number, at: (x: number, y: number) => [number, number, number]): PNG {
  const img = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = at(x, y);
      const i = (y * width + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  return img;
}
