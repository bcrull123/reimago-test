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
  type LookRef,
} from "./look-edit.ts";
import { planEdit } from "./look-edit.server.ts";
import { findRequestedPhoto, type RequestCandidate, type RequestDeps } from "./photo-request.server.ts";
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
    assert.match(photoOutcomeNote(r, "none", "downtown"), /^no brick street photo found; used the closest match/);
    assert.match(photoOutcomeNote(r, "nothing"), /kept the current one/);
    assert.equal(photoVariantLabel(r, "named"), "new photo: brick street (Pine St)");
    assert.equal(photoVariantLabel(r, "subject"), "new photo: brick street (no Pine St found)");
    assert.equal(photoVariantLabel(r, "none"), "new photo: closest to brick street");
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
  it("keeps the closest match and says so when nothing shows the subject", async () => {
    const r = await findRequestedPhoto(req, place, { own: [], current: { urls: [] } }, deps({ "brick street": [g("Downtown Pauls Valley at dusk", 15)] }), { deadline: deadline(), googleEnabled: true });
    assert.equal(r.match, "none");
    assert.match(r.note, /^no brick street photo found; used the closest match/);
  });
  it("the closest match is what the subject search found, not an unrelated site photo", async () => {
    const pipes: RequestCandidate = { id: "https://site.example/pipes.jpg", from: "your site", caption: "A network of white industrial pipes", photo: { url: "p", bytes: Buffer.from("own 16.jpg"), type: "image/jpeg", width: 1600, height: 1000 }, level: 0, caption_match: "none" };
    const judge: RequestDeps["judge"] = async (_r, _c, items) => items.map(() => ({ shows: "none" as const, rating: 8 }));
    const r = await findRequestedPhoto(req, place, { own: [pipes], current: { urls: [] } }, deps({ '"brick street" Pauls Valley Oklahoma': [g("Downtown Pauls Valley main street", 17)] }, judge), { deadline: deadline(), googleEnabled: true });
    assert.equal(r.match, "none");
    assert.equal(r.pick?.from, "Google Images");
  });
  it("keeps the current photo when nothing at all turns up", async () => {
    const r = await findRequestedPhoto(req, place, { own: [], current: { urls: [] } }, deps({}), { deadline: deadline(), googleEnabled: true });
    assert.equal(r.match, "nothing");
    assert.equal(r.pick, undefined);
    assert.match(r.note, /kept the current one/);
  });
});

describe("round 8c: card wording", () => {
  it("never cuts a word in half", async () => {
    const { shortWhat } = await import("./photo-request.server.ts");
    assert.equal(shortWhat("brick-paved streets, downtown historic district"), "brick-paved streets, downtown historic");
    assert.equal(shortWhat("red brick road"), "red brick road");
  });
});
