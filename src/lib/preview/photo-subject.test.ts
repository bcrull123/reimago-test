import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanSubject, requestedScene, wantsBackground } from "./owner-request.ts";
import { heroSuitability, pickWebPhoto, sceneKeywords, webQueries, type WebPhotoCandidate } from "./web-photo.ts";
import { imagePrompt } from "./image-prompts.ts";
import { mockDirections } from "./design.ts";
import type { SiteFacts } from "./types.ts";

// Bob's exact note on Grok Build (d697025): every card said "the note didn't name a photo subject".
const BOB = "put a picture of the red bricks as the background";

describe("reading the photo subject from the note", () => {
  const cases: [string, string | undefined][] = [
    [BOB, "the red bricks"],
    ["Put the red bricks as the background", "the red bricks"],
    ["red bricks in the background please", "red bricks"],
    ["picture of red bricks", "red bricks"],
    ["make the background red bricks", "red bricks"],
    ["I want the red brick streets behind the headline", "the red brick streets"],
    ["Can you use our storefront as the hero image?", "storefront"],
    ["I'd love a background photo of Main Street at night", "main street at night"],
    ["Please add a photo of the lake to the top", "the lake"],
    ["we want the old courthouse in the background", "the old courthouse"],
    ["Use a pic of the water tower", "the water tower"],
    ["the background should be the downtown brick streets", "downtown brick streets"],
    ["background: downtown at sunset", "downtown at sunset"],
    ["hero: our crew on a job", "crew on a job"],
    ["Change the background to a photo of the rodeo arena", "the rodeo arena"],
    ["Make it more modern. Put the depot as the background.", "the depot"],
    ["make the hero the old train depot", "old train depot"],
    ["add an image of the courthouse", "the courthouse"],
    ["no pictures of pipes, use the courthouse instead", "the courthouse"],
    ["Bigger logo and use the courthouse for the hero", "the courthouse"],
    ["use the brick streets", "the brick streets"],
    ["use a photo of downtown with brick streets for the background", "downtown with brick streets"],
    // Not photo subjects: colors, fonts, sections, negations.
    ["I don't want pipes", undefined],
    ["Too dark, use more blue", undefined],
    ["use orange", undefined],
    ["navy and gold colors", undefined],
    ["add a gallery", undefined],
    ["make the font bigger", undefined],
    ["red please", undefined],
    ["", undefined],
  ];
  for (const [note, want] of cases) {
    it(`${JSON.stringify(note)} -> ${JSON.stringify(want)}`, () => assert.equal(requestedScene({ notes: note }), want));
  }

  it("Bob's note asks for the background", () => assert.equal(wantsBackground({ notes: BOB }), true));

  it("the AI planner's photoSubject wins, and covers wording the rules can't read", () => {
    assert.equal(requestedScene({ notes: "it would be great to see those old red bricks downtown", photoSubject: "Red brick streets downtown" }), "red brick streets downtown");
    assert.equal(requestedScene({ notes: BOB, photoSubject: "" }), "the red bricks", "empty planner answer: the wording rules still work");
    assert.equal(cleanSubject("none"), "");
    assert.equal(cleanSubject("navy and gold"), "");
    assert.equal(cleanSubject("a photo of the depot"), "the depot");
    assert.equal(cleanSubject(42), "");
  });
});

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

describe("searching for the red bricks of Pauls Valley", () => {
  it("colors only describe; the search adds the town and the usual meaning (brick streets)", () => {
    assert.deepEqual(sceneKeywords("the red bricks", place), ["brick"]);
    assert.deepEqual(webQueries("the red bricks", place), [
      { q: "Pauls Valley red bricks", scope: "town" },
      { q: "Pauls Valley brick street", scope: "town" },
      { q: "Pauls Valley brick", scope: "town" },
      { q: "Pauls Valley Oklahoma", scope: "town" },
      { q: "red brick street", scope: "generic" },
      { q: "brick paved street", scope: "generic" },
    ]);
    assert.deepEqual(
      webQueries("the brick streets", { city: "Oklahoma City", state: "Oklahoma" }).filter((x) => x.scope === "generic"),
      [{ q: "brick paved street", scope: "generic" }],
      "not \"brick street\": that finds streets named Brick Street",
    );
  });

  it("a street named Brick Street / Brick Lane is not a brick street", () => {
    const g = (title: string) => cand({ title, text: title, scope: "generic", width: 3000, height: 2000 });
    const okc = { city: "Oklahoma City", state: "Oklahoma" };
    const named = [g("Brick Street, Derby - geograph.org.uk - 1815009"), g("Street signs in Brick Lane - geograph.org.uk - 3321582"), g("Brick Street 1763")];
    const paved = [g("A brick paved street in Owosso, MI"), g("Redmond, WA - Red Brick Road 01"), g("Brick-paved Streets Schuyler Downtown Historic District Colfax Co NE")];
    assert.deepEqual(pickWebPhoto([...named, ...paved], "the brick streets", okc).map((c) => c.title).sort(), paved.map((c) => c.title).sort());
  });

  it("ranks the town's own photo first, then brick streets elsewhere; rejects brick walls and unrelated town photos", () => {
    // Commons found it for "Pauls Valley brick" (its file page mentions the brick streets; its short text doesn't).
    const district = cand({ title: "Pauls Valley Historic District", text: "Pauls Valley Historic District", scope: "town", queryWords: ["brick"] });
    const tower = cand({ title: "Pauls Valley water tower", text: "Pauls Valley water tower Oklahoma", scope: "town", queryWords: ["oklahoma"] });
    const street = cand({ title: "Red brick street in Hillsboro", text: "Red brick street in Hillsboro, Texas", scope: "generic", width: 4000, height: 3000 });
    const wall = cand({ title: "Red brick wall texture", text: "Red brick wall texture", scope: "generic" });
    const ranked = pickWebPhoto([wall, street, tower, district], "the red bricks", place);
    assert.deepEqual(ranked, [district, street]);
  });
});

describe("hero photo without a subject: not just the biggest scraped photo", () => {
  // Alt texts from the real paulsvalley.com scrape.
  const pv = {
    pipes: "A network of white industrial pipes with flanged joints, mounted on a wall in a technical or mechanical room.",
    reading: "People sitting in a row, reading books and taking notes at an event or lecture.",
    sign: "A large white sign with black lettering welcoming visitors to Pauls Valley, established in 1857, with red brick pillars on either side",
    rec: "Exterior view of Donald W. Reynolds Recreation Center with entrance illuminated, brick and stone facade, and clear evening sky.",
    bids: "Open Bids",
  };
  it("a town site demotes pipes, documents and utility pages; prefers places and landmarks", () => {
    const s = (alt: string, url = "https://www.paulsvalley.com/img/x.jpg") => heroSuitability(url, alt, true);
    assert.ok(s(pv.pipes) < -3, "pipes stay off a town homepage");
    assert.ok(s(pv.bids) < 0);
    assert.ok(s(pv.sign) > s(pv.reading) && s(pv.rec) > s(pv.reading));
    assert.ok(s("", "https://www.paulsvalley.com/utilities/water-plant.jpg") < 0, "photos from utility pages");
  });
  it("a plumber's site may show pipes", () => {
    assert.ok(heroSuitability("https://x.com/a.jpg", pv.pipes, false) >= 0);
  });
});

describe("the AI fallback prompt for Bob's note", () => {
  it("names the red bricks in Pauls Valley", () => {
    const facts = {
      mode: "reimagine",
      sourceUrl: "https://www.paulsvalley.com/",
      host: "paulsvalley.com",
      name: "Pauls Valley, Oklahoma",
      tagline: "",
      description: "",
      logo: "",
      colors: [],
      phone: "",
      email: "",
      address: "778 100 West Paul Ave. Pauls Valley, OK 73075",
      hours: [],
      services: [],
      about: "",
      testimonials: [],
      images: [],
      nav: [],
      pages: [],
      social: [],
      industry: "Water Services",
      notes: BOB,
    } as SiteFacts;
    const prompt = imagePrompt("hero", facts, mockDirections(facts, 0)[0]!);
    assert.match(prompt, /^The photo MUST clearly show: the red bricks in Pauls Valley, Oklahoma\. Make the red bricks the main subject\./);
  });
});
