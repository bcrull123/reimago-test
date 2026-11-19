import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assignHeroes, heroScore, passesBar, SITE_BAR, type HeroCandidate } from "./hero-pick.ts";
import { rejectReason, watermarkedSource } from "./google-photo.ts";

const cand = (over: Partial<HeroCandidate>): HeroCandidate => ({ id: "x", source: "google", text: "photo", width: 1800, height: 1000, relevance: 2, ...over });

describe("the business's own photos come first (Bob: use the actual photos on the site)", () => {
  it("a site photo rated 5/10 passes (round 9); a Google photo rated 6/10 does not", () => {
    assert.equal(SITE_BAR, 5);
    assert.equal(passesBar(heroScore(cand({ source: "site", appeal: 5, text: "our team at work" }))), true);
    assert.equal(passesBar(heroScore(cand({ source: "site", appeal: 4, text: "our team at work" }))), false);
    assert.equal(passesBar(heroScore(cand({ source: "google", appeal: 6, text: "team at work" }))), false);
  });
  it("a passing site photo wins over a better-rated Google photo", () => {
    const site = cand({ id: "https://bob.me/img/founders.jpg", source: "site", appeal: 7, text: "founders meetup" });
    const google = cand({ id: "https://example.com/stock.jpg", source: "google", appeal: 9, text: "business people at a whiteboard" });
    const picks = assignHeroes([google, site], [undefined]);
    assert.equal(picks[0]?.source, "site");
    assert.match(picks[0]!.reason, /the business's own photo/);
  });
  it("with three looks, every passing site photo is used before Google fills the rest", () => {
    const sites = [1, 2].map((n) => cand({ id: `https://site/${n}.jpg`, source: "site", appeal: 6, text: n === 1 ? "storefront" : "workshop interior" }));
    const googles = [1, 2, 3].map((n) => cand({ id: `https://g/${n}.jpg`, appeal: 8, text: ["main street", "courthouse", "aerial skyline"][n - 1]! }));
    const picks = assignHeroes([...googles, ...sites], [undefined, undefined, undefined]);
    assert.equal(picks.filter((p) => p.source === "site").length, 2);
  });
  it("an off-topic or sign-like site photo still fails", () => {
    assert.equal(passesBar(heroScore(cand({ source: "site", appeal: 8, offTopic: true }))), false);
    assert.equal(passesBar(heroScore(cand({ source: "site", appeal: 8, text: "welcome sign" }))), false);
  });
});

describe("watermarked stock is rejected everywhere", () => {
  it("by URL, domain or title (vecteezy, shutterstock, istock, getty, alamy, dreamstime, depositphotos, 123rf, adobe stock)", () => {
    for (const t of ["https://static.vecteezy.com/system/resources/previews/1/business-people.jpg", "Business people at whiteboard - Vecteezy", "Shutterstock 12345", "iStock photo", "Getty Images", "alamy-stock-photo", "Dreamstime.com", "Depositphotos_1234", "123RF", "Adobe Stock"])
      assert.equal(watermarkedSource(t), true, t);
    assert.equal(watermarkedSource("Pauls Valley historic district", "https://commons.wikimedia.org/x.jpg"), false);
  });
  it("Google results from Vecteezy are dropped before download", () => {
    const img = { title: "Business people at whiteboard", imageUrl: "https://static.vecteezy.com/x/whiteboard.jpg", imageWidth: 1920, imageHeight: 1080, link: "https://www.vecteezy.com/photo/1", domain: "www.vecteezy.com", source: "Vecteezy", position: 1 };
    assert.equal(rejectReason(img), "stock / watermarked");
  });
  it("a photo vision saw a watermark on never passes, however well rated", () => {
    assert.equal(passesBar(heroScore(cand({ appeal: 9, watermark: true, text: "office meeting" }))), false);
    assert.equal(passesBar(heroScore(cand({ source: "site", appeal: 9, watermark: true }))), false);
  });
});

describe("the site's signature graphic (bob.me's rocket) is a site asset", () => {
  it("finds a big transparent illustration, not the logo or icons", async () => {
    const { signatureCandidates, isSignatureArt } = await import("./site-art.ts");
    const art = [
      { url: "https://bob.me/logo.png", label: "bob.me logo", kind: "img" as const, page: "https://bob.me/", home: true },
      { url: "https://bob.me/icons/facebook.png", label: "facebook icon", kind: "img" as const, page: "https://bob.me/", home: true },
      { url: "https://bob.me/rocket.png", label: "Blast off rocket transparent bg", kind: "img" as const, page: "https://bob.me/", home: true, width: 440, height: 360 },
      { url: "https://bob.me/tiny.png", label: "sparkle", kind: "img" as const, page: "https://bob.me/", home: true, width: 32, height: 32 },
      { url: "https://bob.me/circle.png", label: "circle", kind: "img" as const, page: "https://bob.me/", home: true, width: 491, height: 478 },
    ];
    const c = signatureCandidates(art, "https://bob.me/logo.png");
    assert.equal(c[0]!.url, "https://bob.me/rocket.png");
    assert.ok(!c.some((a) => /logo|facebook|tiny|circle/.test(a.url)), "decorative shapes are not a signature graphic");
    assert.ok(isSignatureArt({ cutout: true, width: 440, height: 360, type: "image/png" }));
    assert.ok(!isSignatureArt({ cutout: false, width: 1600, height: 900, type: "image/jpeg" }), "a photo is not a signature graphic");
    assert.ok(!isSignatureArt({ cutout: true, width: 120, height: 120, type: "image/png" }), "too small (an icon)");
    assert.ok(!isSignatureArt({ cutout: true, width: 1800, height: 300, type: "image/png" }), "a banner strip");
    assert.ok(!isSignatureArt({ cutout: true, width: 1831, height: 761, type: "image/png" }), "a wide wordmark is a logo, not a signature graphic");
  });
});
