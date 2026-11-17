import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { googleQueries, normalizeImages, rejectReason, scoreGoogleImage, TEMP_PHOTO_LINE, type GoogleImage } from "./google-photo.ts";
import { googleImages, photoSearchMode, searchGooglePhotos, serperImages } from "./google-photo.server.ts";
import { keyMatches, overLimit, photoSearchResponse } from "./photo-search-endpoint.server.ts";
import { photosLine } from "./image-prompts.ts";
import { photoCredit } from "./render.ts";
import type { PreviewTrace, SiteFacts } from "./types.ts";

const place = { city: "Pauls Valley", state: "Oklahoma" };
const g = (over: Partial<GoogleImage>): GoogleImage => ({
  title: "Red brick street in Pauls Valley",
  imageUrl: "https://upload.wikimedia.org/a/red-brick-street.jpg",
  imageWidth: 1920,
  imageHeight: 1280,
  link: "https://example.org/pauls-valley",
  domain: "example.org",
  source: "Example",
  position: 1,
  ...over,
});

const facts: SiteFacts = {
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
  address: "100 S Walnut St, Pauls Valley, OK 73075",
  hours: [],
  services: [],
  about: "",
  testimonials: [],
  images: [],
  nav: [],
  pages: [],
  social: [],
  industry: "",
  notes: "put a picture of the red bricks as the background",
};

const ENV = ["SERPER_API_KEY", "SERPER_BASE_URL", "PHOTO_SEARCH_PROXY_URL", "PHOTO_SEARCH_PROXY_KEY", "PHOTO_SEARCH_RATE_PER_MINUTE"];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const restore = () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
};

describe("Google Images helpers", () => {
  it("normalizes Serper results (https only)", () => {
    const list = normalizeImages({
      images: [
        { title: " Red  bricks ", imageUrl: "https://x.org/a.jpg", imageWidth: 1600, imageHeight: 1000, link: "https://x.org/p", domain: "x.org", position: 1 },
        { title: "insecure", imageUrl: "http://x.org/b.jpg" },
        { title: "no url" },
      ],
    });
    assert.equal(list.length, 1);
    assert.equal(list[0]!.title, "Red bricks");
    assert.deepEqual(normalizeImages(null), []);
    assert.deepEqual(normalizeImages({ images: "nope" }), []);
  });

  it("skips stock/watermarked sites, logos, tiny, odd shapes and gifs", () => {
    assert.equal(rejectReason(g({})), "");
    for (const domain of ["www.shutterstock.com", "media.gettyimages.com", "www.istockphoto.com", "www.alamy.com", "www.dreamstime.com", "stock.adobe.com", "www.123rf.com", "depositphotos.com"]) {
      assert.equal(rejectReason(g({ domain })), "stock / watermarked", domain);
    }
    assert.equal(rejectReason(g({ domain: "x.org", imageUrl: "https://t4.ftcdn.net/jpg/1.jpg" })), "stock / watermarked");
    assert.equal(rejectReason(g({ title: "Pauls Valley logo" })), "logo / graphic");
    assert.equal(rejectReason(g({ imageUrl: "https://x.org/seal.svg" })), "logo / graphic");
    assert.equal(rejectReason(g({ imageWidth: 640, imageHeight: 480 })), "too small");
    assert.equal(rejectReason(g({ imageWidth: 1440, imageHeight: 1920 })), "not a landscape hero shape");
    assert.equal(rejectReason(g({ imageUrl: "https://x.org/a.gif" })), "not a photo");
  });

  it("builds at most two queries: the subject in its town, then its usual meaning", () => {
    const q = googleQueries("the red bricks", place, "downtown");
    assert.ok(q.length >= 1 && q.length <= 2, q.join(" | "));
    assert.match(q[0]!, /red brick.*Pauls Valley Oklahoma$/i);
    assert.deepEqual(googleQueries(undefined, { city: "Oklahoma City", state: "Oklahoma" }, "plumber"), ["plumber Oklahoma City Oklahoma"]);
    assert.deepEqual(googleQueries(undefined, undefined, "bakery"), ["bakery"]);
    assert.ok(!googleQueries("downtown Pauls Valley", place, "downtown").includes("downtown"), "no lone-word query");
  });

  it("scores by subject words, town, size and shape; -1 when unusable or off-subject", () => {
    const good = scoreGoogleImage(g({}), "the red bricks", place, "downtown");
    const plain = scoreGoogleImage(g({ title: "A brick paved street", link: "https://x.org/p", imageUrl: "https://x.org/street.jpg" }), "the red bricks", place, "downtown");
    assert.ok(good > plain && plain > 0, `${good} ${plain}`);
    assert.equal(scoreGoogleImage(g({ title: "Pauls Valley water tower", imageUrl: "https://x.org/tower.jpg", link: "https://x.org/" }), "the red bricks", place, "downtown"), -1);
    assert.equal(scoreGoogleImage(g({ domain: "shutterstock.com" }), "the red bricks", place, "downtown"), -1);
  });
});

describe("photo search configuration", () => {
  beforeEach(restore);
  after(restore);

  it("is off unless a Serper key or a full proxy config is set", () => {
    for (const k of ENV) delete process.env[k];
    assert.equal(photoSearchMode(), undefined);
    process.env.PHOTO_SEARCH_PROXY_URL = "https://master.example/api/photo-search";
    assert.equal(photoSearchMode(), undefined, "proxy URL without its key");
    process.env.PHOTO_SEARCH_PROXY_KEY = "shared";
    assert.equal(photoSearchMode()?.mode, "proxy");
    process.env.SERPER_API_KEY = "k";
    assert.equal(photoSearchMode()?.mode, "serper", "a server with its own key never proxies");
    process.env.SERPER_BASE_URL = "http://evil.example";
    assert.equal(photoSearchMode(), undefined, "plain http only for localhost (tests)");
  });
});

describe("Serper calls (mock server)", () => {
  let server: Server;
  let base = "";
  const seen: { path: string; headers: Record<string, unknown>; body: Record<string, unknown> }[] = [];
  before(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        seen.push({ path: req.url ?? "", headers: req.headers, body });
        res.writeHead(req.headers["x-api-key"] === "test-key" || req.headers.authorization === "Bearer shared" ? 200 : 401, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            images: [
              { title: "Red brick street, Pauls Valley", imageUrl: "https://img.example/red-brick-street-1.jpg", imageWidth: 1920, imageHeight: 1280, link: "https://page.example/1", domain: "page.example", position: 1 },
              { title: "Red brick road stock photo", imageUrl: "https://www.shutterstock.com/a.jpg", imageWidth: 1920, imageHeight: 1280, link: "https://www.shutterstock.com/p", domain: "www.shutterstock.com", position: 2 },
              { title: "Brick paved street downtown", imageUrl: "https://img.example/brick-paved-2.jpg", imageWidth: 2000, imageHeight: 1300, link: "https://page.example/2", domain: "page.example", position: 3 },
              { title: "Old red brick street (gone)", imageUrl: "https://img.example/broken-brick-3.jpg", imageWidth: 2000, imageHeight: 1300, link: "https://page.example/3", domain: "page.example", position: 4 },
              { title: "Red brick street small", imageUrl: "https://img.example/brick-small.jpg", imageWidth: 2000, imageHeight: 1300, link: "https://page.example/4", domain: "page.example", position: 5 },
            ],
          }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  after(() => {
    server.close();
    restore();
  });

  it("posts the query with X-API-KEY, large-image filter, and reads the results", async () => {
    const list = await serperImages("red brick street", "test-key", base);
    assert.equal(list.length, 5);
    const last = seen.at(-1)!;
    assert.equal(last.path, "/images");
    assert.equal(last.headers["x-api-key"], "test-key");
    assert.equal(last.body.q, "red brick street");
    assert.equal(last.body.tbs, "isz:l");
    await assert.rejects(serperImages("x", "wrong-key", base), /Serper 401/);
  });

  it("caches per query and never throws (bad key -> [])", async () => {
    for (const k of ENV) delete process.env[k];
    process.env.SERPER_API_KEY = "wrong-key";
    process.env.SERPER_BASE_URL = base;
    assert.deepEqual(await googleImages("cache test bad key"), []);
    process.env.SERPER_API_KEY = "test-key";
    const before = seen.length;
    const a = await googleImages("cache test good key");
    const b = await googleImages("Cache Test Good Key");
    assert.equal(a.length, 5);
    assert.equal(b, a);
    assert.equal(seen.length, before + 1, "second identical query served from cache");
  });

  it("proxy mode sends the shared key as Bearer, never a Serper key", async () => {
    for (const k of ENV) delete process.env[k];
    process.env.PHOTO_SEARCH_PROXY_URL = `${base}/api/photo-search`;
    process.env.PHOTO_SEARCH_PROXY_KEY = "shared";
    const list = await googleImages("proxy query red bricks");
    assert.equal(list.length, 5);
    const last = seen.at(-1)!;
    assert.equal(last.path, "/api/photo-search");
    assert.equal(last.headers.authorization, "Bearer shared");
    assert.equal(last.headers["x-api-key"], undefined);
  });

  it("downloads, skips stock/broken/small, ranks by score and marks each pick temporary", async () => {
    for (const k of ENV) delete process.env[k];
    process.env.SERPER_API_KEY = "test-key";
    process.env.SERPER_BASE_URL = base;
    const fetched: string[] = [];
    const fetcher = async (url: string) => {
      fetched.push(url);
      if (url.includes("broken")) return null;
      const small = url.includes("small");
      return { url, bytes: Buffer.from("x"), type: "image/jpeg", width: small ? 800 : 1920, height: small ? 600 : 1280 };
    };
    const r = await searchGooglePhotos("the red bricks", facts, false, Date.now() + 20_000, 3, fetcher);
    assert.ok(!fetched.some((u) => u.includes("shutterstock")), "stock photos are never downloaded");
    assert.deepEqual(
      r.photos.map((p) => p.temp.imageUrl),
      ["https://img.example/red-brick-street-1.jpg", "https://img.example/brick-paved-2.jpg"],
    );
    const t = r.photos[0]!.temp;
    assert.equal(t.provider, "Google Images");
    assert.equal(t.via, "Serper");
    assert.equal(t.sourcePage, "https://page.example/1");
    assert.equal(t.domain, "page.example");
    assert.equal(t.pickedBy, "score");
    assert.match(t.query, /Pauls Valley Oklahoma/);
    assert.ok(r.rejected["stock / watermarked"] && r.rejected["broken or blocked download"] && r.rejected["too small after download"], JSON.stringify(r.rejected));
  });
});

describe("POST /api/photo-search (master endpoint)", () => {
  beforeEach(restore);
  after(restore);
  const req = (body: unknown, auth?: string, ip = "203.0.113.9") =>
    new Request("https://master.example/api/photo-search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify(body),
    });
  const search = async (q: string) => [{ title: q, imageUrl: "https://x.org/a.jpg" }];

  it("is 404 unless the server has both the Serper key and the proxy key", async () => {
    for (const k of ENV) delete process.env[k];
    assert.equal((await photoSearchResponse(req({ q: "x" }, "Bearer shared"), search)).status, 404);
    process.env.SERPER_API_KEY = "secret-serper";
    assert.equal((await photoSearchResponse(req({ q: "x" }, "Bearer shared"), search)).status, 404);
  });

  it("requires the proxy key, validates q, returns images only, and never the Serper key", async () => {
    process.env.SERPER_API_KEY = "secret-serper";
    process.env.PHOTO_SEARCH_PROXY_KEY = "shared";
    assert.equal((await photoSearchResponse(req({ q: "x" }), search)).status, 401);
    assert.equal((await photoSearchResponse(req({ q: "x" }, "Bearer nope"), search)).status, 401);
    assert.equal((await photoSearchResponse(req({ q: "" }, "Bearer shared", "203.0.113.10"), search)).status, 400);
    assert.equal((await photoSearchResponse(req({ q: "x".repeat(201) }, "Bearer shared", "203.0.113.10"), search)).status, 400);
    const ok = await photoSearchResponse(req({ q: "red bricks" }, "Bearer shared", "203.0.113.11"), search);
    assert.equal(ok.status, 200);
    const text = await ok.text();
    assert.deepEqual(JSON.parse(text), { images: [{ title: "red bricks", imageUrl: "https://x.org/a.jpg" }] });
    assert.ok(!text.includes("secret-serper"));
  });

  it("rate-limits per caller", async () => {
    process.env.SERPER_API_KEY = "secret-serper";
    process.env.PHOTO_SEARCH_PROXY_KEY = "shared";
    process.env.PHOTO_SEARCH_RATE_PER_MINUTE = "2";
    const ip = "198.51.100.77";
    assert.equal((await photoSearchResponse(req({ q: "a" }, "Bearer shared", ip), search)).status, 200);
    assert.equal((await photoSearchResponse(req({ q: "b" }, "Bearer shared", ip), search)).status, 200);
    assert.equal((await photoSearchResponse(req({ q: "c" }, "Bearer shared", ip), search)).status, 429);
    assert.equal((await photoSearchResponse(req({ q: "c" }, "Bearer shared", "198.51.100.78"), search)).status, 200);
    assert.equal(overLimit("t", 1, 5, 0), false);
    assert.equal(overLimit("t", 1, 5, 1000), true);
    assert.equal(overLimit("t", 1, 5, 61_000), false);
  });

  it("compares keys exactly", () => {
    assert.equal(keyMatches("Bearer shared", "shared"), true);
    assert.equal(keyMatches("bearer  shared ", "shared"), true);
    assert.equal(keyMatches("Bearer shared2", "shared"), false);
    assert.equal(keyMatches("shared", "shared"), false);
    assert.equal(keyMatches(null, "shared"), false);
  });
});

describe("temporary photo display", () => {
  const temp = { provider: "Google Images" as const, via: "Serper" as const, title: "Red brick street", imageUrl: "https://img.example/a.jpg", sourcePage: "https://page.example/1", domain: "page.example", query: "red bricks Pauls Valley Oklahoma", pickedBy: "score" as const };

  it("card line says preview only", () => {
    const trace: PreviewTrace = {
      request: { note: facts.notes, feedback: [], scene: "the red bricks", intent: "find" },
      steps: [],
      images: [{ name: "hero", slot: "hero", scene: "the red bricks", prompt: "", status: "preview photo (Google Images)", source: "web search" }],
    };
    assert.equal(photosLine(trace, 3), TEMP_PHOTO_LINE);
    assert.equal(TEMP_PHOTO_LINE, "Photo: from Google Images (preview only, replaced when your site is built)");
  });

  it("footer note links the source page and says temporary", () => {
    const html = photoCredit({
      images: { hero: { name: "hero", type: "image/jpeg", source: "web", alt: "x", temporary: temp, credit: { title: "Red brick street", author: "page.example", license: "preview only", licenseUrl: "", sourceUrl: temp.sourcePage, provider: "Google Images" } } },
    });
    assert.match(html, /class="photo-credit photo-temporary"/);
    assert.match(html, /href="https:\/\/page\.example\/1"[^>]*>page\.example<\/a>/);
    assert.match(html, /via Google Images, temporary: replaced when your site is built/);
    assert.doesNotMatch(html, /preview only, via/);
  });
});
