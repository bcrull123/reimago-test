import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requestedPhoto, sceneToFind } from "./owner-request.ts";
import { artOfPage, collectSiteArt, fileWords, matchSiteArt, sanitizeSvg, visionCandidates } from "./site-art.ts";
import { photosLine } from "./image-prompts.ts";
import { arrangeSections, layoutLine } from "./look-variety.ts";
import type { DesignDirection, PreviewTrace, Section } from "./types.ts";

// Bob's note on bob.me (e1243ee): every look got a Wikimedia "rocket" (Success Rockets logo, Tesla Roadster, NASA lab).
const BOB = "Keep the rocket";

describe("keep vs find", () => {
  const keep: [string, string][] = [
    [BOB, "the rocket"],
    ["keep the rocket please", "the rocket"],
    ["Please keep the rocket image", "the rocket"],
    ["Don't lose the rocket", "the rocket"],
    ["don’t lose our mascot", "mascot"],
    ["Retain the rocket graphic", "the rocket"],
    ["Preserve the rocket illustration from my site", "the rocket"],
    ["leave the rocket", "the rocket"],
    ["still use the rocket", "the rocket"],
    ["use the same rocket", "the rocket"],
    ["the rocket from my site", "the rocket"],
    ["the rocket on our homepage should stay", "the rocket"],
    ["our rocket", "rocket"],
    ["I like my rocket, keep it", "rocket"],
    ["Keep the rocket but make it darker", "the rocket"],
    ["Make it more modern. Keep the rocket.", "the rocket"],
    ["Use our storefront as the hero image", "storefront"],
    ["keep our truck photo", "truck"],
  ];
  for (const [note, subject] of keep) {
    it(`${JSON.stringify(note)} keeps ${JSON.stringify(subject)} (site only)`, () => {
      assert.deepEqual(requestedPhoto({ notes: note }), { subject, intent: "keep", from: "note wording" });
      assert.equal(sceneToFind({ notes: note }), undefined, "nothing to search the web for or generate");
    });
  }
  const find: [string, string][] = [
    ["put a picture of the red bricks as the background", "the red bricks"],
    ["use the brick streets", "the brick streets"],
    ["we want the old courthouse in the background", "the old courthouse"],
    ["a picture of our town's brick streets", "town's brick streets"],
  ];
  for (const [note, subject] of find) {
    it(`${JSON.stringify(note)} finds ${JSON.stringify(subject)}`, () => assert.deepEqual(requestedPhoto({ notes: note }), { subject, intent: "find", from: "note wording" }));
  }
  for (const note of ["keep it simple", "keep the same colors", "keep the logo", "leave out the pipes", "no need to keep the clipart", ""]) {
    it(`${JSON.stringify(note)} names no photo`, () => assert.equal(requestedPhoto({ notes: note }).intent, "none"));
  }
  it("the AI planner's intent: keep wins; the owner's keep words win over a planner 'find'", () => {
    assert.deepEqual(requestedPhoto({ notes: "that launch thing up top is great, it stays", photoSubject: "rocket", photoIntent: "keep" }), { subject: "rocket", intent: "keep", from: "AI planner" });
    assert.equal(requestedPhoto({ notes: BOB, photoSubject: "rocket", photoIntent: "find" }).intent, "keep");
    assert.equal(requestedPhoto({ notes: "show a rocket launch", photoSubject: "rocket launch", photoIntent: "find" }).intent, "find");
  });
});

// The parts of bob.me's homepage that matter (Elementor image box; the rocket is a 440x360 transparent PNG).
const BOBME = `<html><head><meta property="og:image" content="https://bob.me/wp-content/uploads/2021/04/share.jpg"></head><body>
<img width="833" height="217" src="https://bob.me/wp-content/uploads/2021/04/bobdotme-logo-v2.1.png" class="bb-logo" alt="">
<figure class="elementor-image-box-img"><a href="https://bob.me/register/"><img decoding="async" src="https://bob.me/wp-content/uploads/elementor/thumbs/rocket_transparent-bg-p65h8jtiue3itp4ksz7aa4634a26hhg47mz85aa32o.png" title="rocket_transparent-bg" alt="Blast off" loading="lazy" /></a></figure>
<img src="https://bob.me/wp-content/uploads/avatars/1/6085890b331ec-bpthumb.png" class="avatar" width="40" height="40" alt="Profile photo of WebHero" />
<img src="{{data.avatar_url}}" alt="">
<img width="300" height="300" src="https://bob.me/wp-content/uploads/2021/04/whitehat-300x300.png" alt="Bob.Me White Hat">
<script>var x = '<img src="https://bob.me/rocket-in-script.png">';</script>
</body></html>`;

describe("finding the owner's art on their site", () => {
  it("file names lose hashes and size suffixes", () => {
    assert.equal(fileWords("https://bob.me/wp-content/uploads/elementor/thumbs/rocket_transparent-bg-p65h8jtiue3itp4ksz7aa4634a26hhg47mz85aa32o.png"), "rocket transparent bg");
    assert.equal(fileWords("https://x.com/u/2021/04/whitehat-300x300.png"), "whitehat");
  });

  it("bob.me: the rocket is the Elementor image box (alt “Blast off”, named by its file), not a web photo", () => {
    const art = collectSiteArt([{ url: "https://bob.me/", html: BOBME }], [], "https://bob.me/wp-content/uploads/2021/04/bobdotme-logo-v2.1.png");
    assert.ok(!art.some((a) => a.url.includes("{{") || a.url.includes("rocket-in-script")), "no templates or script strings");
    const [best] = matchSiteArt("the rocket", art);
    assert.equal(best?.url, "https://bob.me/wp-content/uploads/elementor/thumbs/rocket_transparent-bg-p65h8jtiue3itp4ksz7aa4634a26hhg47mz85aa32o.png");
    assert.match(best!.label, /Blast off/);
    assert.equal(best!.home, true);
    assert.deepEqual(matchSiteArt("the dinosaur", art), []);
  });

  it("reads inline SVG labels, CSS backgrounds, <picture> sources and og:image", () => {
    const rocketSvg = `<svg width="400" height="300" viewBox="0 0 400 300"><title>Rocket launch</title><g id="rocket-body"><path d="${"M0 0L10 10".repeat(40)}"/></g></svg>`;
    const html = `<svg width="24" height="24"><title>rocket icon</title><path d="M0 0"/></svg>${rocketSvg}
      <div class="hero-mascot" style="background-image:url('/img/owl-mascot.png')"></div>
      <picture><source srcset="/img/storefront-night.webp 1x"><img src="/img/front.jpg" alt="Our shop"></picture>
      <style>.cta-banner{background:url(/img/team-photo.jpg) center/cover}</style>`;
    const art = artOfPage(html, "https://x.com/", true, [{ href: "https://x.com/site.css", text: ".site-header .truck-bg{background-image:url('../img/red-truck.png')}" }]);
    const svg = matchSiteArt("the rocket", art)[0];
    assert.equal(svg?.kind, "svg", "the big drawing, not the 24px icon");
    assert.ok(svg?.svg?.includes("rocket-body"));
    assert.equal(matchSiteArt("the owl", art)[0]?.url, "https://x.com/img/owl-mascot.png");
    assert.equal(matchSiteArt("storefront", art)[0]?.url, "https://x.com/img/storefront-night.webp");
    assert.equal(matchSiteArt("the team", art)[0]?.url, "https://x.com/img/team-photo.jpg");
    assert.equal(matchSiteArt("our red truck", art)[0]?.url, "https://x.com/img/red-truck.png");
  });

  it("vision candidates: real pictures, homepage first; no avatars, SVGs or tiny icons", () => {
    const art = collectSiteArt([{ url: "https://bob.me/", html: BOBME }], [], "");
    const urls = visionCandidates(art).map((a) => a.url);
    assert.ok(urls.some((u) => u.includes("rocket_transparent")));
    assert.ok(!urls.some((u) => u.includes("avatars")));
  });

  it("inline SVG is made safe before it is stored", () => {
    const safe = sanitizeSvg(`<svg onload="alert(1)"><script>alert(1)</script><a href="https://evil.example"><path d="M0 0" onclick="x()"/></a><use href="#a"/><image href="https://t.example/p.png"/><foreignObject><div>x</div></foreignObject></svg>`)!;
    assert.doesNotMatch(safe, /script|onload|onclick|evil|t\.example|foreignObject/i);
    assert.match(safe, /href="#a"/);
    assert.match(safe, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });
});

describe("the card and the hero", () => {
  const trace = (status: PreviewTrace["images"][number]["status"]): PreviewTrace => ({
    request: { note: BOB, feedback: [], scene: "the rocket", intent: "keep" },
    steps: [],
    images: [{ name: "hero", slot: "hero", scene: "the rocket", prompt: "", status }],
  });
  it("says it kept the rocket, or that it couldn't find one (and swapped nothing in)", () => {
    assert.equal(photosLine(trace("kept from your site"), 2), "Photo: kept your rocket from your site, as you asked");
    assert.match(photosLine(trace("not found on your site"), 2), /^Couldn't find a rocket on your site to keep/);
  });

  it("kept art is shown whole on a color panel in every treatment (never full-bleed, duotone or cropped)", () => {
    const hero: Section = { type: "hero-split", tone: "light", heading: "Hi", image: "hero" };
    for (const heroStyle of ["caption", "cinematic", "collage"] as const) {
      const design = { heroStyle, layout: "editorial", header: "light", buttons: "square", footer: "minimal" } as unknown as DesignDirection;
      const [first] = arrangeSections([hero, { type: "faq", tone: "light" }], design, ["hero", "photo-1"], [], true);
      assert.equal(first!.type, "hero-split", heroStyle);
      assert.equal(first!.fit, "cutout");
      assert.equal(first!.image, "hero");
      assert.equal(first!.variant, heroStyle);
      assert.match(layoutLine(design, `hero-split/${heroStyle}/cutout`)!, /your art shown whole/);
    }
  });
  it("with a note request the two template looks compose the art differently (not two rockets on a panel)", () => {
    const hero: Section = { type: "hero-split", tone: "light", heading: "Hi", image: "hero" };
    const shape = (heroStyle: string) => {
      const design = { heroStyle, layout: "editorial", header: "light", buttons: "square", footer: "minimal" } as unknown as DesignDirection;
      const [first] = arrangeSections([hero, { type: "faq", tone: "light" }], design, ["hero", "photo-1"], [], true);
      assert.equal(first!.fit, "cutout");
      return `${first!.type}/${first!.variant}/${first!.tone}/${first!.reverse ? "left" : "right"}`;
    };
    // Every pair of hero styles the round can hand the two template looks ends up composed differently.
    const styles = ["poster", "cinematic", "panorama", "framed", "caption", "collage"];
    for (const a of styles) for (const b of styles) if (a !== b) assert.notEqual(shape(a), shape(b), `${a} vs ${b}`);
    assert.equal(shape("panorama"), "hero-type/panorama/light/right");
  });
});
