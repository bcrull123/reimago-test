import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { licenseOk, matchScraped, pickWebPhoto, placeOf, sceneKeywords, webQuery, type WebPhotoCandidate } from "./web-photo.ts";
import { imagePrompt } from "./image-prompts.ts";
import { requestedScene, wantsBackground } from "./owner-request.ts";
import { mockDirections } from "./design.ts";
import { photoCredit } from "./render.ts";
import type { SiteFacts } from "./types.ts";

// Bob's real case: the City of Pauls Valley site, note "Use a photo of the downtown brick streets as background".
const NOTE = "Use a photo of the downtown brick streets as background";
const pv: SiteFacts = {
  mode: "reimagine",
  sourceUrl: "https://www.paulsvalley.com/",
  host: "paulsvalley.com",
  name: "City of Pauls Valley",
  tagline: "",
  description: "Welcome to the official Pauls Valley website.",
  logo: "",
  colors: [],
  phone: "(405) 238-3308",
  email: "",
  address: "100 West Paul Ave. Pauls Valley, OK 73075",
  hours: [],
  services: ["Utilities", "Water Services"],
  about: "",
  testimonials: [],
  images: ["https://www.paulsvalley.com/img/reading.jpg", "https://www.paulsvalley.com/img/airport.jpg"],
  imageText: { "https://www.paulsvalley.com/img/reading.jpg": "Woman reading a book", "https://www.paulsvalley.com/img/airport.jpg": "Pauls Valley Municipal Airport" },
  nav: [],
  pages: [],
  social: [],
  industry: "Water Services",
  notes: NOTE,
};
const place = { city: "Pauls Valley", state: "Oklahoma" };
const cand = (over: Partial<WebPhotoCandidate>): WebPhotoCandidate => ({
  title: "x",
  author: "a",
  license: "CC BY-SA 3.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:x.jpg",
  provider: "Wikimedia Commons",
  imageUrl: "https://upload.wikimedia.org/x.jpg",
  width: 1864,
  height: 1398,
  text: "",
  ...over,
});

describe("finding a photo of the requested scene", () => {
  it("reads the scene, the place and 'background' from Bob's note", () => {
    assert.equal(requestedScene(pv), "the downtown brick streets");
    assert.equal(wantsBackground(pv), true);
    assert.deepEqual(placeOf(pv), place);
    assert.deepEqual(placeOf({ address: "", name: "City of Pauls Valley" }), { city: "Pauls Valley", state: "" });
    assert.deepEqual(sceneKeywords("the downtown brick streets", place), ["downtown", "brick", "street"]);
    assert.equal(webQuery("the downtown brick streets", place), "Pauls Valley downtown brick streets");
  });

  it("does not take the site's biggest photo when its alt text doesn't match; takes one that does", () => {
    const own = pv.images.map((url) => ({ url, label: pv.imageText![url]! }));
    assert.equal(matchScraped("the downtown brick streets", place, own), undefined);
    const withMatch = [...own, { url: "https://www.paulsvalley.com/img/main.jpg", label: "Downtown brick street on Paul Ave" }];
    assert.equal(matchScraped("the downtown brick streets", place, withMatch)?.url, "https://www.paulsvalley.com/img/main.jpg");
    // File names count too.
    assert.ok(matchScraped("the downtown brick streets", place, [{ url: "https://x.com/uploads/brick-streets-downtown.jpg", label: "" }]));
  });

  it("keeps only free licenses that allow commercial use and changes", () => {
    for (const ok of ["CC0", "Public domain", "CC BY 2.0", "CC BY-SA 4.0", "No restrictions"]) assert.equal(licenseOk(ok), true, ok);
    for (const bad of ["CC BY-NC 2.0", "CC BY-ND 4.0", "CC BY-NC-SA 3.0", "All rights reserved", "Attribution", ""]) assert.equal(licenseOk(bad), false, bad);
  });

  it("ranks the Pauls Valley Historic District photo first; rejects other towns, portraits, NC licenses", () => {
    const district = cand({ title: "Pauls Valley Historic District", text: "File:Pauls Valley Historic District.jpg Pauls Valley Historic District" });
    const amtrak = cand({ title: "Pauls Valley Amtrak Station", width: 4000, height: 3000, text: "Pauls Valley Amtrak Station. Pauls Valley, Oklahoma|Pauls Valley Historic District" });
    const elsewhere = cand({ title: "Brick street in Lawrence, Kansas", width: 4000, height: 3000, text: "Downtown brick street Lawrence Kansas" });
    const portrait = cand({ title: "First National Bank, W. Paul Avenue, Pauls Valley", width: 3633, height: 5144, text: "First National Bank, W. Paul Avenue, Pauls Valley, Oklahoma downtown" });
    const nc = cand({ title: "Pauls Valley downtown brick street", license: "CC BY-NC 2.0", text: "Pauls Valley downtown brick street" });
    const tower = cand({ title: "Pauls Valley water tower", width: 4608, height: 3456, text: "Pauls Valley water tower Oklahoma" });
    const memorial = cand({ title: "Oklahoma City National Memorial, Harvey Avenue and NW 4th Street", width: 4000, height: 3000, text: "Oklahoma City National Memorial, Harvey Avenue and NW 4th Street, Oklahoma City" });
    assert.deepEqual(pickWebPhoto([memorial], "the brick streets", { city: "Oklahoma City", state: "Oklahoma" }), [], "a street name in an address is not a brick street");
    const house = cand({ title: "Oklahoma City - Heritage Hills - 1530 Classen Dr", width: 4000, height: 3000, text: "Oklahoma City Heritage Hills brick house" });
    assert.deepEqual(pickWebPhoto([house], "the brick streets", { city: "Oklahoma City", state: "Oklahoma" }), [], "a brick house is not a brick street");
    const bricktown = cand({ title: "Brick street in Bricktown, Oklahoma City", width: 4000, height: 3000, text: "Brick street in Bricktown, Oklahoma City" });
    assert.equal(pickWebPhoto([house, bricktown], "the brick streets", { city: "Oklahoma City", state: "Oklahoma" })[0], bricktown);
    const ranked = pickWebPhoto([amtrak, elsewhere, portrait, nc, tower, district], "the downtown brick streets", place);
    assert.equal(ranked[0], district);
    assert.ok(!ranked.includes(elsewhere) && !ranked.includes(portrait) && !ranked.includes(nc) && !ranked.includes(tower));
  });

  it("the AI fallback prompt asks for the downtown brick streets of Pauls Valley, Oklahoma, photorealistic, no text", () => {
    const design = mockDirections(pv, 3)[0]!;
    const prompt = imagePrompt("hero", pv, design);
    assert.match(prompt, /^The photo MUST clearly show: the downtown brick streets in Pauls Valley, Oklahoma\./);
    assert.match(prompt, /Photorealistic/);
    assert.match(prompt, /no text/);
    assert.doesNotMatch(prompt, /City of Pauls Valley|Water Services tools/);
    // The real scrape names the site "Pauls Valley, Oklahoma": still a town site, and the place stays in the prompt.
    const scraped = { ...pv, name: "Pauls Valley, Oklahoma", address: "778 100 West Paul Ave. Pauls Valley, OK 73075" };
    const p2 = imagePrompt("hero", scraped, mockDirections(scraped, 3)[0]!);
    assert.match(p2, /^The photo MUST clearly show: the downtown brick streets in Pauls Valley, Oklahoma\. Make the downtown brick streets the main subject\. /);
    assert.doesNotMatch(p2, /Water Services/);
  });

  it("puts the photo credit (title, author, license link) in the page footer", () => {
    const html = photoCredit({
      images: {
        hero: {
          name: "hero",
          type: "image/jpeg",
          source: "web",
          alt: "Pauls Valley Historic District",
          credit: { title: "Pauls Valley Historic District", author: "Crimsonedge34", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", sourceUrl: "https://commons.wikimedia.org/wiki/File:Pauls_Valley_Historic_District.jpg", provider: "Wikimedia Commons" },
        },
        "photo-1": { name: "photo-1", type: "image/jpeg", source: "photo", alt: "x" },
      },
    });
    assert.match(html, /Photo: <a href="https:\/\/commons\.wikimedia\.org\/wiki\/File:Pauls_Valley_Historic_District\.jpg"[^>]*>“Pauls Valley Historic District”<\/a> by Crimsonedge34, <a href="https:\/\/creativecommons\.org\/licenses\/by-sa\/3\.0"[^>]*>CC BY-SA 3\.0<\/a>, via Wikimedia Commons/);
    assert.equal(photoCredit({ images: { x: { name: "x", type: "image/jpeg", source: "photo", alt: "" } } }), "");
  });
});
