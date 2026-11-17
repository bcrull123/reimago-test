import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requestedScene, wantsNewPhotos } from "./owner-request.ts";
import { imagePrompt, photosLine, sceneFor } from "./image-prompts.ts";
import { mockDirections } from "./design.ts";
import type { PreviewTrace, SiteFacts } from "./types.ts";

const facts: SiteFacts = {
  mode: "reimagine",
  sourceUrl: "https://www.morganplumbingokc.com/",
  host: "morganplumbingokc.com",
  name: "Morgan Plumbing",
  tagline: "",
  description: "Family-owned Oklahoma City plumber.",
  logo: "",
  colors: [],
  phone: "",
  email: "",
  address: "",
  hours: [],
  services: ["Water Heaters", "Drain Cleaning", "Leak Repair"],
  about: "",
  testimonials: [],
  images: [],
  nav: [],
  pages: [],
  social: [],
  industry: "",
  notes: "",
};

describe("requested photo scene", () => {
  it("finds the scene the owner named, newest feedback first", () => {
    assert.equal(requestedScene({ notes: "use the brick streets" }), "the brick streets");
    assert.equal(requestedScene({ notes: "Please use the brick streets of Bricktown for the hero image." }), "the brick streets of bricktown");
    assert.equal(requestedScene({ notes: "I want photos of our trucks on the job" }), "trucks on the job");
    assert.equal(requestedScene({ notes: "use the brick streets", feedback: ["show the downtown skyline at dusk instead"] }), "the downtown skyline at dusk");
  });

  it("ignores design words that are not a photo subject", () => {
    assert.equal(requestedScene({ notes: "use navy and gold" }), undefined);
    assert.equal(requestedScene({ notes: "Make it dark and premium, add a photo gallery." }), undefined);
    assert.equal(requestedScene({ notes: "Too dark. Make it lighter, use orange, and add how it works steps." }), undefined);
    assert.equal(requestedScene({ notes: "" }), undefined);
  });

  it("feedback about photos asks for fresh images", () => {
    assert.equal(wantsNewPhotos({ notes: "", feedback: ["no pipes, different photos please"] }), true);
    assert.equal(wantsNewPhotos({ notes: "", feedback: ["make it bolder"] }), false);
  });
});

describe("image prompts carry the owner's request", () => {
  const note = { ...facts, notes: "use the brick streets" };
  const design = mockDirections(note, 0)[0]!;

  it("the hero prompt must show the requested scene, first", () => {
    const prompt = imagePrompt("hero", note, design);
    assert.match(prompt, /^The photo MUST clearly show: the brick streets/);
    assert.match(prompt, /not plumb\w* .*tools or equipment/i);
    assert.match(prompt, /owner's request .*"use the brick streets"/);
    assert.doesNotMatch(prompt, /Morgan Plumbing/);
    assert.equal(sceneFor("hero", note, design), "the brick streets");
  });

  it("every slot gets the owner's words; feedback scenes win", () => {
    for (const slot of ["feature", "service"] as const) assert.match(imagePrompt(slot, note, design, "Water Heaters"), /brick streets/);
    const later = { ...note, feedback: ["show the downtown skyline at dusk"] };
    assert.match(imagePrompt("hero", later, mockDirections(later, 1)[0]!), /MUST clearly show: the downtown skyline at dusk/);
  });

  it("mock looks use the scene as their hero subject", () => {
    for (const look of mockDirections(note, 0)) assert.equal(look.heroSubject, "the brick streets");
  });

  it("without a request the prompt is unchanged in spirit", () => {
    const prompt = imagePrompt("hero", facts, mockDirections(facts, 0)[0]!);
    assert.doesNotMatch(prompt, /MUST clearly show|owner's request/);
  });

  it("the card's Photos line says what happened", () => {
    const trace: PreviewTrace = { request: { note: "use the brick streets", feedback: [], scene: "the brick streets" }, steps: [], images: [{ name: "hero", slot: "hero", scene: "the brick streets", prompt: "x", status: "generated" }] };
    assert.match(photosLine(trace, 0), /^AI photo of “the brick streets”/);
    trace.images[0]!.status = "not generated (mock mode / images off)";
    assert.match(photosLine(trace, 2), /would generate one/);
    trace.images[0]!.status = "web photo";
    trace.images[0]!.credit = { title: "Pauls Valley Historic District", author: "Crimsonedge34", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", sourceUrl: "https://commons.wikimedia.org/wiki/File:x.jpg", provider: "Wikimedia Commons" };
    assert.equal(photosLine(trace, 5), "Photo: “Pauls Valley Historic District” by Crimsonedge34 (CC BY-SA 3.0) from Wikimedia Commons");
  });
});
