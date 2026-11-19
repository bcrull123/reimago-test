import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  captionMatch,
  mergePhotoRequest,
  photoOutcomeNote,
  photoRequestLabel,
  photoRequestQueries,
  photoVariantLabel,
  readAdjustments,
  readPhotoRequest,
  wantsNewPhoto,
  illustrationFits,
  illustrationPrompt,
  type LookRef,
} from "./look-edit.ts";
import { planEdit } from "./look-edit.server.ts";
import { findRequestedPhoto, sameAsCurrent, sha1Of, type RequestCandidate, type RequestDeps } from "./photo-request.server.ts";
import type { GoogleImage } from "./google-photo.ts";

// Round 8c: Bob's Editorial box on paulsvalley.
const bob = "change the photo to one of the brick streets, maybe Pine Street";
const place = { city: "Pauls Valley", state: "Oklahoma" };

describe("round 8c: reading a new-photo request", () => {
  it("keeps Bob's subject and the street he named", () => {
    assert.deepEqual(readPhotoRequest(bob), { subject: "brick streets", named: ["Pine Street"] });
    assert.deepEqual(readPhotoRequest("Change the photo to one of the brick streets maybe pine street"), { subject: "brick streets", named: ["Pine Street"] });
    assert.equal(wantsNewPhoto(bob), true);
  });
  it("works for other subjects", () => {
    assert.equal(readPhotoRequest("use a photo of our blue truck")?.subject, "blue truck");
    assert.equal(readPhotoRequest("change the picture to the patio at night")?.subject, "patio at night");
    assert.equal(readPhotoRequest("swap the hero image for the courthouse")?.subject, "courthouse");
  });
  it("is not fooled by lighting or contrast tweaks", () => {
    for (const t of ["make the image daylight and raise text contrast", "a photo with more contrast", "make the photo daylight, more contrast", "Use Bold Photo and make the image in daylight."]) {
      assert.equal(readPhotoRequest(t), undefined, t);
    }
    assert.equal(wantsNewPhoto("a photo with more contrast"), false);
    assert.ok(readAdjustments("a photo with more contrast").length);
  });
  it("never lets the planner's generic town subject replace the owner's words", () => {
    assert.deepEqual(mergePhotoRequest(bob, "downtown Pauls Valley"), { subject: "brick streets", named: ["Pine Street"] });
    assert.equal(mergePhotoRequest("change it to something nicer", "downtown Pauls Valley"), undefined);
  });
  it("labels the card with the requested subject", () => {
    assert.equal(photoRequestLabel(readPhotoRequest(bob)!), "brick street (Pine St)");
  });
  it("searches most specific first, loosening step by step, never the town's generic query", () => {
    const q = photoRequestQueries(readPhotoRequest(bob)!, place);
    assert.deepEqual(q, ['"Pine Street" Pauls Valley brick', '"Pine Street" Pauls Valley Oklahoma', '"brick street" Pauls Valley Oklahoma', "brick street Pauls Valley", "brick street Oklahoma", "brick street"]);
    assert.ok(q.every((s) => /brick|pine/i.test(s)));
    assert.ok(!q.includes("downtown pauls valley oklahoma"));
  });
  it("matches captions to the name, the subject, or neither", () => {
    const r = readPhotoRequest(bob)!;
    assert.equal(captionMatch("Pine Street, Pauls Valley", r), "named");
    assert.equal(captionMatch("Brick-paved streets, downtown historic district", r), "subject");
    assert.equal(captionMatch("Red brick road through town", r), "subject");
    assert.equal(captionMatch("Downtown Pauls Valley at night", r), "none");
    assert.equal(captionMatch("Pine trees", r), "none");
  });
  it("says honestly what was found", () => {
    const r = readPhotoRequest(bob)!;
    assert.equal(photoOutcomeNote(r, "named"), "new photo: brick street (Pine St)");
    assert.match(photoOutcomeNote(r, "subject", "red brick road"), /^couldn't find Pine Street; used a brick street photo/);
    assert.equal(photoOutcomeNote(r, "nothing"), "Couldn't find a brick street / Pine Street photo, so I kept your current photo");
    assert.equal(photoOutcomeNote(r, "none"), photoOutcomeNote(r, "nothing"));
    assert.equal(photoOutcomeNote(r, "illustrated"), "Art: brick street, illustrated by Grok Imagine (not a real photo of Pine Street)");
    assert.match(photoOutcomeNote(r, "weak", "brick building"), /^new photo: its caption says brick street/);
    assert.equal(photoVariantLabel(r, "named"), "new photo: brick street (Pine St)");
    assert.equal(photoVariantLabel(r, "subject"), "new photo: brick street (no Pine St found)");
    assert.equal(photoVariantLabel(r, "none"), "same photo (no brick street found)");
    assert.equal(photoVariantLabel(r, "nothing"), "same photo (no brick street found)");
    assert.equal(photoVariantLabel(r, "illustrated"), "art: brick street (illustrated)");
  });
});

describe("round 8c: the planner path keeps the owner's subject", () => {
  const looks: LookRef[] = [
    { id: "a".repeat(16), name: "Editorial", archetype: "editorial", index: 0, background: "#f4efe6", primary: "#1f4d3a" },
    { id: "b".repeat(16), name: "Dark Premium", archetype: "dark-premium", index: 1, background: "#0e1116", primary: "#c9a36b" },
  ];
  it("wording-only reading from the card box", async () => {
    const edit = await planEdit(bob, looks, undefined, false, "a".repeat(16));
    assert.equal(edit.targetId, "a".repeat(16));
    assert.deepEqual(edit.photoRequest, { subject: "brick streets", named: ["Pine Street"] });
    assert.equal(edit.photo, "brick street (Pine St)");
  });
});

// ---- findRequestedPhoto with fake search / fetch / vision ----
const g = (title: string, n: number, w = 1920, h = 1280): GoogleImage => ({ title, imageUrl: `https://img.example/${n}.jpg`, imageWidth: w, imageHeight: h, link: `https://page.example/${n}`, domain: "commons.wikimedia.org", source: "Wikimedia Commons" }) as GoogleImage;
const hex = (n: number) => n.toString(16).padStart(2, "0").repeat(8);
function deps(results: Record<string, GoogleImage[]>, judge?: RequestDeps["judge"], seen: string[] = []): RequestDeps {
  return {
    search: async (q) => {
      seen.push(q);
      return results[q] ?? [];
    },
    fetch: async (url) => ({ url, bytes: Buffer.from(url), type: "image/jpeg", width: 1920, height: 1280 }),
    // Every photo hashes apart, except "dup" ones which hash like the current hero.
    hash: (b) => (b.toString().includes("dup") ? hex(0) : hex(Number(b.toString().match(/(\d+)\.jpg/)?.[1] ?? 1) * 37 % 255)),
    judge,
  };
}
const req = readPhotoRequest(bob)!;
const deadline = () => Date.now() + 60_000;

describe("round 8c: findRequestedPhoto", () => {
  it("tries the specific queries first and says honestly when Pine Street isn't found", async () => {
    const seen: string[] = [];
    const town = [g("Downtown Pauls Valley", 1), g("Pauls Valley water tower", 2)];
    const bricks = [g("Red brick road through town", 3), g("A brick paved street in a small town", 4), g("View along a brick-paved street", 5)];
    const r = await findRequestedPhoto(req, place, { own: [], current: { urls: ["https://img.example/1.jpg"] } }, deps({ '"Pine Street" Pauls Valley brick': town, '"Pine Street" Pauls Valley Oklahoma': town, '"brick street" Pauls Valley Oklahoma': bricks }, undefined, seen), { deadline: deadline(), googleEnabled: true });
    assert.deepEqual(seen.slice(0, 3), ['"Pine Street" Pauls Valley brick', '"Pine Street" Pauls Valley Oklahoma', '"brick street" Pauls Valley Oklahoma']);
    assert.equal(r.match, "subject");
    assert.match(r.pick!.caption, /brick/i);
    assert.match(r.note, /^couldn't find Pine Street; used a brick street photo/);
  });
  it("prefers a photo that names Pine Street, even rated a bit lower", async () => {
    const judge: RequestDeps["judge"] = async (_r, _c, items) => items.map((c) => (/pine street/i.test(c.caption) ? { shows: "named" as const, rating: 6 } : /brick/i.test(c.caption) ? { shows: "subject" as const, rating: 9 } : { shows: "none" as const, rating: 9 }));
    const r = await findRequestedPhoto(req, place, { own: [], current: { urls: [] } }, deps({ '"Pine Street" Pauls Valley brick': [g("Brick street downtown", 7), g("Pine Street looking north, Pauls Valley", 8)] }, judge), { deadline: deadline(), googleEnabled: true });
    assert.equal(r.match, "named");
    assert.match(r.pick!.caption, /Pine Street/);
    assert.equal(r.note, "new photo: brick street (Pine St)");
  });
  it("skips photos below the quality minimum even when they match", async () => {
    const judge: RequestDeps["judge"] = async (_r, _c, items) => items.map((c) => (/pine/i.test(c.caption) ? { shows: "named" as const, rating: 3 } : { shows: "subject" as const, rating: 7 }));
    const r = await findRequestedPhoto(req, place, { own: [], current: { urls: [] } }, deps({ '"Pine Street" Pauls Valley brick': [g("Pine Street blurry", 9), g("Brick street", 10)] }, judge), { deadline: deadline(), googleEnabled: true });
    assert.equal(r.match, "subject");
    assert.match(r.pick!.caption, /^Brick street/);
  });
  it("never reuses the current photo or a near-duplicate", async () => {
    const dup: RequestCandidate = { id: "https://img.example/dup.jpg", from: "another look", caption: "Brick street downtown", photo: { url: "x", bytes: Buffer.from("dup"), type: "image/jpeg", width: 1920, height: 1280 }, hash: hex(0), level: 0, caption_match: "none" };
    const r = await findRequestedPhoto(req, place, { own: [dup], current: { urls: ["https://img.example/11.jpg"], hash: hex(0) } }, deps({ '"brick street" Pauls Valley Oklahoma': [g("Brick street (current)", 11), g("Brick road", 12)] }), { deadline: deadline(), googleEnabled: true });
    assert.equal(r.pick?.id, "https://img.example/12.jpg");
  });
  it("uses a matching photo from the site or another look before Google", async () => {
    const own: RequestCandidate = { id: "https://site.example/brick.jpg", from: "your site", caption: "Our shop on the brick street", photo: { url: "y", bytes: Buffer.from("own 13.jpg"), type: "image/jpeg", width: 1600, height: 1000 }, level: 0, caption_match: "none" };
    const r = await findRequestedPhoto(req, place, { own: [own], current: { urls: [] } }, deps({ '"brick street" Pauls Valley Oklahoma': [g("Brick road", 14)] }), { deadline: deadline(), googleEnabled: true });
    assert.equal(r.pick?.from, "your site");
  });
  it("round 9b: never swaps in a photo that doesn't show the request (no 'closest match')", async () => {
    const r = await findRequestedPhoto(req, place, { own: [], current: { urls: [] } }, deps({ "brick street": [g("Downtown Pauls Valley at dusk", 15)] }), { deadline: deadline(), googleEnabled: true });
    assert.equal(r.match, "nothing");
    assert.equal(r.pick, undefined);
    assert.equal(r.note, "Couldn't find a brick street / Pine Street photo, so I kept your current photo");
  });
  it("round 9b: a caption that names it but vision says no is a weak match, used only after real matches", async () => {
    const mk = (n: number, caption: string): RequestCandidate => ({ id: `https://site.example/${n}.jpg`, from: "your site", caption, photo: { url: `https://site.example/${n}.jpg`, bytes: Buffer.from(`own ${n}.jpg`), type: "image/jpeg", width: 1600, height: 1000 }, level: 0, caption_match: "none" });
    const weak = mk(31, "Historic brick street sign at the depot");
    const real = mk(32, "Main Street storefronts");
    const lines: string[] = [];
    const judge: RequestDeps["judge"] = async (_r, _c, items) => items.map((c) => (c.id === real.id ? { shows: "subject" as const, rating: 7 } : { shows: "none" as const, rating: 8 }));
    const d = { ...deps({}, judge), log: (l: string) => lines.push(l) };
    const r1 = await findRequestedPhoto(req, place, { own: [weak, real], current: { urls: [] } }, d, { deadline: deadline(), googleEnabled: false });
    assert.equal(r1.pick?.id, real.id);
    assert.ok(lines.some((l) => /caption names it \(subject\) but vision says none → weak match/.test(l)));
    const r2 = await findRequestedPhoto(req, place, { own: [weak], current: { urls: [] } }, deps({}, judge), { deadline: deadline(), googleEnabled: false });
    assert.equal(r2.match, "weak");
    assert.equal(r2.pick?.id, weak.id);
    // A passing mention ("a water park with … a brick wall") is not even a weak match.
    const park = mk(33, "A water park with water slides beside a brick wall");
    const r3 = await findRequestedPhoto(req, place, { own: [park], current: { urls: [] } }, deps({}, judge), { deadline: deadline(), googleEnabled: false });
    assert.equal(r3.pick, undefined);
  });
  it("keeps the current photo when nothing at all turns up", async () => {
    const r = await findRequestedPhoto(req, place, { own: [], current: { urls: [] } }, deps({}), { deadline: deadline(), googleEnabled: true });
    assert.equal(r.match, "nothing");
    assert.equal(r.pick, undefined);
    assert.match(r.note, /so I kept your current photo/);
  });
});

describe("round 8c: card wording", () => {
  it("never cuts a word in half", async () => {
    const { shortWhat } = await import("./photo-request.server.ts");
    assert.equal(shortWhat("brick-paved streets, downtown historic district"), "brick-paved streets, downtown historic");
    assert.equal(shortWhat("red brick road"), "red brick road");
  });
});

// ---- Round 9b: Bob's real run (f6c6f14 paste-in on 1523036): the welcome sign was already the Editorial hero ----
describe("round 9b: the current hero is never the 'new' photo", () => {
  const site = (n: string, caption: string, bytes = `site ${n}`): RequestCandidate => ({ id: `https://images.squarespace-cdn.com/content/v1/abc/${n}.jpg?format=1500w`, from: "your site", caption, photo: { url: `https://images.squarespace-cdn.com/content/v1/abc/${n}.jpg?format=1500w`, bytes: Buffer.from(bytes), type: "image/webp", width: 1500, height: 998 }, level: 0, caption_match: "none" });
  const sign = site("sign", "A large white sign with black lettering welcoming visitors to Pauls Valley", "WELCOME-SIGN-BYTES");
  const others = [
    site("pipes", "A network of white industrial pipes with flanged joints"),
    site("people", "People sitting in a row, reading books and taking notes"),
    site("boutique", "Interior of a boutique shop with clothing, accessories"),
    site("airport", "Front view of Pauls Valley Municipal Airport with building"),
  ];
  // Vision (as in Bob's log): none of them shows a brick street; the sign rates 6.
  const judge: RequestDeps["judge"] = async (_r, _c, items) => items.map((c) => ({ shows: "none" as const, rating: /sign/.test(c.id) ? 6 : /people/.test(c.id) ? 4 : 7 }));
  const noHash: RequestDeps = { ...deps({}, judge), hash: () => undefined };
  it("Bob's exact case: a WebP hero (no image hash), alt = the town name, no URL stored — excluded by its bytes; current photo kept", async () => {
    const lines: string[] = [];
    const current = { urls: [], sha1: [sha1Of(Buffer.from("WELCOME-SIGN-BYTES"))], captions: [] };
    const r = await findRequestedPhoto(req, place, { own: [sign, ...others], current }, { ...noHash, log: (l) => lines.push(l) }, { deadline: deadline(), googleEnabled: false });
    assert.notEqual(r.pick?.id, sign.id);
    assert.equal(r.pick, undefined);
    assert.equal(r.match, "nothing");
    assert.equal(r.note, "Couldn't find a brick street / Pine Street photo, so I kept your current photo");
    assert.ok(lines.some((l) => /skipped the current photo \(same file\)/.test(l)));
    assert.equal(photoVariantLabel(req, r.match), "same photo (no brick street found)");
  });
  it("excluded by its address at another size (format=750w vs 1500w)", () => {
    assert.equal(sameAsCurrent(sign, { urls: ["https://images.squarespace-cdn.com/content/v1/abc/sign.jpg?format=750w"] }), "same picture at another size");
  });
  it("excluded by its caption (a specific one, not just the town name)", () => {
    assert.equal(sameAsCurrent(sign, { urls: [], captions: ["A large white sign with black lettering welcoming visitors to Pauls Valley"] }), "same caption");
    assert.equal(sameAsCurrent(others[0]!, { urls: [], captions: ["Pauls Valley"] }), undefined);
  });
  it("excluded by a near-duplicate image hash", () => {
    assert.equal(sameAsCurrent({ ...sign, hash: hex(0) }, { urls: [], hash: hex(1) }), "near-duplicate");
  });
  it("another look's copy of the same picture is not a 'new' photo either", async () => {
    const copy: RequestCandidate = { ...sign, id: "look2/hero", from: "another look", caption: "Pauls Valley, Oklahoma", photo: { ...sign.photo, url: "look2/hero" } };
    const judge2: RequestDeps["judge"] = async (_r, _c, items) => items.map(() => ({ shows: "subject" as const, rating: 8 }));
    const r = await findRequestedPhoto(req, place, { own: [copy], current: { urls: [], sha1: [sha1Of(Buffer.from("WELCOME-SIGN-BYTES"))] } }, { ...deps({}, judge2), hash: () => undefined }, { deadline: deadline(), googleEnabled: false });
    assert.equal(r.pick, undefined);
  });
});

describe("round 9b: illustrated stand-in", () => {
  it("fits places and things, not people or the owner's own specific things", () => {
    assert.equal(illustrationFits(req), true);
    assert.equal(illustrationFits({ subject: "patio at night", named: [] }), true);
    assert.equal(illustrationFits({ subject: "blue truck", named: [] }), true);
    assert.equal(illustrationFits({ subject: "our blue truck", named: [] }), false);
    assert.equal(illustrationFits({ subject: "our team", named: [] }), false);
    assert.equal(illustrationFits({ subject: "the owner", named: [] }), false);
    assert.equal(illustrationFits({ subject: "our logo", named: [] }), false);
  });
  it("asks for a clearly-illustrated subject, never the named place", () => {
    const p = illustrationPrompt(req, place);
    assert.match(p, /ILLUSTRATION/);
    assert.match(p, /brick street in a small Oklahoma town/);
    assert.doesNotMatch(p, /Pine/);
    assert.match(p, /No text/);
  });
});
