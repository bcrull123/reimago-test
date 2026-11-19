import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { artOfPage, largestSrcset } from "./site-art.ts";
import { fullSizeUrls, isAlphaPng, photoKey, sitePhotoRefs, sizeClass, SITE_HERO_MIN_W } from "./site-photos.ts";
import { assignHeroes, type HeroCandidate } from "./hero-pick.ts";
import { photosLine } from "./image-prompts.ts";
import { signaturePrompt, signatureSubject } from "./signature-hero.server.ts";
import type { PreviewTrace, SiteFacts } from "./types.ts";

const page = "https://www.example-town.gov/";

describe("round 9: collecting the site's own photos", () => {
  it("takes the largest srcset entry", () => {
    assert.equal(largestSrcset("a-400.jpg 400w, a-1600.jpg 1600w, a-800.jpg 800w"), "a-1600.jpg");
    assert.equal(largestSrcset("a.jpg 1x, a@2x.jpg 2x"), "a@2x.jpg");
    assert.equal(largestSrcset(""), "");
  });
  it("finds img (srcset / lazy), picture, CSS backgrounds, og:image and linked full-size photos; skips url(#…) references", () => {
    const html = `
      <meta property="og:image" content="/share.jpg">
      <img src="data:image/gif;base64,AAA" data-src="/lazy-park.jpg" alt="Wacker Park fountain">
      <img src="/thumb.jpg" srcset="/park-400.jpg 400w, /park-1600.jpg 1600w" alt="City park">
      <picture><source srcset="/festival-800.webp 800w, /festival-2000.webp 2000w"><img src="/festival.jpg" alt="Festival"></picture>
      <div data-bg="/downtown-bg.jpg" class="hero-banner"></div>
      <section style="background-image:url('/main-street.jpg')"></section>
      <svg><rect fill="url(#grad)"/></svg>
      <div style="background:url(#section-divider-1)"></div>
      <a href="/gallery/lake-full.jpg"><img src="/gallery/lake-thumb.jpg" alt="Lake at sunset"></a>`;
    const urls = artOfPage(html, page, true).map((a) => a.url.replace(page, "/"));
    for (const u of ["/share.jpg", "/lazy-park.jpg", "/park-1600.jpg", "/festival-2000.webp", "/downtown-bg.jpg", "/main-street.jpg", "/gallery/lake-full.jpg"]) assert.ok(urls.includes(u), `${u} in ${urls.join(" ")}`);
    assert.ok(!urls.some((u) => u.includes("#")), "no url(#…) references");
  });
  it("skips logos, icons, social badges, screenshots and tiny images; dedupes size variants; homepage first", () => {
    const facts = {
      sourceUrl: page,
      logo: "https://www.example-town.gov/logo.png",
      images: ["https://www.example-town.gov/park-300x200.jpg"],
      imageText: {},
      siteArt: [
        { url: "https://www.example-town.gov/logo.png", label: "logo", kind: "logo" as const, page, home: true },
        { url: "https://www.example-town.gov/icons/facebook.png", label: "facebook", kind: "img" as const, page, home: true },
        { url: "https://www.example-town.gov/spacer.gif", label: "", kind: "img" as const, page, home: true },
        { url: "https://www.example-town.gov/Screen-Shot-2024.png", label: "screen shot at pm", kind: "img" as const, page, home: true },
        { url: "https://www.example-town.gov/tiny.jpg", label: "tiny", kind: "img" as const, page, home: true, width: 80, height: 60 },
        { url: "https://www.example-town.gov/gallery/park.jpg", label: "A park with a circular flower bed", kind: "img" as const, page: `${page}parks`, home: false },
        { url: "https://www.example-town.gov/park.jpg", label: "City park", kind: "img" as const, page, home: true },
      ],
    } as unknown as SiteFacts;
    const { refs, skipped } = sitePhotoRefs(facts);
    assert.deepEqual(refs.map((r) => r.url.replace(page, "/")), ["/park.jpg", "/gallery/park.jpg"]);
    assert.ok(skipped.logo && skipped["logo / icon / social"] && skipped["screenshot / document"] && skipped.tiny && skipped["icon / svg / gif"]);
    assert.equal(photoKey("https://x.com/a/park-300x200.jpg"), photoKey("https://x.com/a/park.jpg"));
  });
  it("tries the CDN's full-size file first", () => {
    assert.deepEqual(fullSizeUrls("https://www.x.com/wp-content/uploads/park-300x200.jpg"), ["https://www.x.com/wp-content/uploads/park.jpg", "https://www.x.com/wp-content/uploads/park-300x200.jpg"]);
    assert.match(fullSizeUrls("https://images.squarespace-cdn.com/content/v1/a/b/park.jpg")[0]!, /format=1500w/);
    assert.deepEqual(fullSizeUrls("https://x.com/park.jpg"), ["https://x.com/park.jpg"]);
  });
  it("allows smaller hero photos (≥800px wide, landscape) with a treatment; portraits go to sections", () => {
    assert.equal(SITE_HERO_MIN_W, 800);
    assert.deepEqual(sizeClass(900, 600), { usable: true, hero: true, small: true, why: undefined });
    assert.equal(sizeClass(2500, 1667).small, false);
    assert.equal(sizeClass(1500, 2000).hero, true, "a big portrait (a plated dish) can lead a hero");
    assert.equal(sizeClass(900, 1400).hero, false);
    assert.equal(sizeClass(1500, 2000).usable, true);
    assert.equal(sizeClass(600, 400).usable, false);
    assert.equal(sizeClass(3000, 500).usable, false);
  });
  it("a PNG with an alpha channel is a graphic, not a photo", () => {
    const png = Buffer.alloc(40);
    png[25] = 6;
    assert.equal(isAlphaPng(png, "image/png"), true);
    png[25] = 2;
    assert.equal(isAlphaPng(png, "image/png"), false);
  });
});

describe("round 9: each look leads with a different site photo", () => {
  const site = (id: string, text: string, appeal = 6): HeroCandidate => ({ id, source: "site", text, width: 1500, height: 1000, relevance: 1, appeal });
  it("three park photos of the site go to the three looks, before any Google photo", () => {
    const google: HeroCandidate = { id: "g", source: "google", text: "downtown historic main street", width: 2000, height: 1300, relevance: 3, appeal: 9 };
    const picks = assignHeroes([google, site("p1", "A park with a circular flower bed"), site("p2", "A water park with slides", 8), site("p3", "Lakeside park picnic tables", 5)], ["editorial", "dark-premium", "playful"]);
    assert.deepEqual(new Set(picks.map((p) => p.id)), new Set(["p1", "p2", "p3"]));
  });
});

describe("round 9: the card line", () => {
  const trace = (status: PreviewTrace["images"][number]["status"], extra: Partial<PreviewTrace["images"][number]> = {}): PreviewTrace => ({
    request: { note: "", feedback: [] },
    steps: [],
    images: [{ name: "hero", slot: "hero", scene: "x", prompt: "", status, ...extra }],
    sitePhotos: { found: 19, heroSized: 14, used: 4, heroOwn: status === "your site's photo" },
  });
  it("says “your site's own” with the counts", () => {
    assert.equal(photosLine(trace("your site's photo", { credit: { title: "A park with a circular flower bed", author: "", license: "", licenseUrl: "", sourceUrl: "u", provider: "your site" } }), 4), "Photo: your site's own (“A park with a circular flower bed”) · 19 photos found on your site, 4 used here");
  });
  it("Google says why", () => {
    assert.match(photosLine(trace("preview photo (Google Images)"), 4), /from Google Images .* 19 photos found on your site, none left for this hero, 4 used in sections/);
  });
  it("a reimagined signature graphic", () => {
    assert.match(photosLine(trace("signature reimagined", { signature: { subject: "rocket", from: "signature graphic" } }), 0), /^Art: your rocket, reimagined by Grok Imagine/);
    assert.match(photosLine(trace("signature original", { signature: { subject: "rocket", from: "signature graphic" } }), 0), /^Art: your rocket from your site/);
  });
});

describe("round 9: reimagining the signature graphic", () => {
  it("names the graphic", () => {
    assert.equal(signatureSubject("Blast off rocket transparent bg", "signature graphic"), "rocket");
    assert.equal(signatureSubject("Acme", "logo"), "logo");
    assert.equal(signatureSubject("happy-dog-mascot.png", "signature graphic"), "mascot");
    assert.equal(signatureSubject("Smith Plumbing truck", "signature graphic"), "truck");
  });
  it("asks Imagine for a cinematic version of the same graphic, no text", () => {
    const p = signaturePrompt("rocket", { name: "Bob.me" }, { mood: "bold", archetype: "dark-premium", palette: { primary: "#111111", accent: "#ff6600" } as never });
    assert.match(p, /same rocket/);
    assert.match(p, /keep its identity/);
    assert.match(p, /cinematic/);
    assert.match(p, /No text/);
  });
});
