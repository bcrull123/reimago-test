#!/usr/bin/env node
/**
 * A stand-in for Serper's Google Images API (POST /images) for tests: no real key, no credits.
 *
 *   node scripts/mock-serper.mjs            # listens on MOCK_SERPER_PORT (default 9997)
 *   SERPER_API_KEY=mock-serper-key SERPER_BASE_URL=http://localhost:9997 ...   # point the app at it
 *
 * Checks the X-API-KEY header (MOCK_SERPER_KEY, default "mock-serper-key"); 401 otherwise, like Serper.
 * Answers in Serper's shape ({searchParameters, images:[{title, imageUrl, imageWidth, imageHeight, link,
 * domain, source, position}]}). Image URLs are real, fetchable Wikimedia Commons files, so downloads, sizing
 * and the saved hero are exercised end to end; the results also carry decoys the app must skip: a watermarked
 * stock photo, a logo, a too-small image, a broken URL and a portrait photo.
 *
 * GET /log returns every query received (so a test can prove a "keep" request never searched); POST /reset clears it.
 */
import { createServer } from "node:http";

const port = Number(process.env.MOCK_SERPER_PORT ?? 9997);
const key = process.env.MOCK_SERPER_KEY ?? "mock-serper-key";
const log = [];

const W = "https://upload.wikimedia.org/wikipedia/commons";
const img = (title, imageUrl, imageWidth, imageHeight, link, domain, source) => ({ title, imageUrl, imageWidth, imageHeight, link, domain, source });

const BRICKS = [
  img("Shutterstock: red brick street stock photo", "https://www.shutterstock.com/image-photo/red-brick-street-260nw-1234567.jpg", 1600, 1067, "https://www.shutterstock.com/search/red-brick-street", "www.shutterstock.com", "Shutterstock"),
  img("Brick-paved streets, downtown historic district", `${W}/thumb/f/fb/Brick-paved_Streets_Schuyler_Downtown_Historic_District_Colfax_Co_NE.jpg/1920px-Brick-paved_Streets_Schuyler_Downtown_Historic_District_Colfax_Co_NE.jpg`, 1920, 1280, "https://commons.wikimedia.org/wiki/File:Brick-paved_Streets_Schuyler_Downtown_Historic_District_Colfax_Co_NE.jpg", "commons.wikimedia.org", "Wikimedia Commons"),
  img("Pauls Valley Chamber of Commerce logo", "https://example.org/images/pauls-valley-chamber-logo.png", 1200, 600, "https://example.org/", "example.org", "Chamber"),
  img("A brick paved street in a small town", `${W}/thumb/5/54/A_brick_paved_street_in_Owosso%2C_MI.jpg/1920px-A_brick_paved_street_in_Owosso%2C_MI.jpg`, 1920, 1281, "https://commons.wikimedia.org/wiki/File:A_brick_paved_street_in_Owosso,_MI.jpg", "commons.wikimedia.org", "Wikimedia Commons"),
  img("Red brick road (small)", `${W}/b/b8/Red_Brick_Road_-_geograph.org.uk_-_317022.jpg`, 640, 480, "https://commons.wikimedia.org/wiki/File:Red_Brick_Road_-_geograph.org.uk_-_317022.jpg", "commons.wikimedia.org", "Wikimedia Commons"),
  img("Red brick road through town", `${W}/thumb/2/22/Red_Brick_Road_in_Redmond_-_01.jpg/1920px-Red_Brick_Road_in_Redmond_-_01.jpg`, 1920, 1276, "https://commons.wikimedia.org/wiki/File:Red_Brick_Road_in_Redmond_-_01.jpg", "commons.wikimedia.org", "Wikimedia Commons"),
  img("Old red brick street downtown (gone)", `${W}/x/xx/Does_not_exist_red_brick_street.jpg`, 2000, 1333, "https://example.org/gone", "example.org", "Example"),
  img("View along a brick-paved street", `${W}/thumb/2/2d/2014-08-30_10_45_20_View_west_along_brick-paved_West_Front_Street_from_Barrack_Street_in_Trenton%2C_New_Jersey.JPG/1920px-2014-08-30_10_45_20_View_west_along_brick-paved_West_Front_Street_from_Barrack_Street_in_Trenton%2C_New_Jersey.JPG`, 1920, 1440, "https://commons.wikimedia.org/wiki/File:2014-08-30_10_45_20_View_west_along_brick-paved_West_Front_Street_from_Barrack_Street_in_Trenton,_New_Jersey.JPG", "commons.wikimedia.org", "Wikimedia Commons"),
  img("Brick street, portrait view", `${W}/thumb/8/8b/Brick_Street%2C_Mayfair%2C_December_2023.jpg/1920px-Brick_Street%2C_Mayfair%2C_December_2023.jpg`, 1440, 1920, "https://commons.wikimedia.org/wiki/File:Brick_Street,_Mayfair,_December_2023.jpg", "commons.wikimedia.org", "Wikimedia Commons"),
];

const TOWN = [
  img("Pauls Valley Santa Fe Depot", `${W}/thumb/c/ca/Pauls_Valley_Santa_Fe_Depot.jpg/1920px-Pauls_Valley_Santa_Fe_Depot.jpg`, 1920, 1440, "https://commons.wikimedia.org/wiki/File:Pauls_Valley_Santa_Fe_Depot.jpg", "commons.wikimedia.org", "Wikimedia Commons"),
  img("Pauls Valley water tower", `${W}/thumb/8/80/Pauls_Valley_water_tower%2C_August_2019.jpg/1920px-Pauls_Valley_water_tower%2C_August_2019.jpg`, 1920, 1440, "https://commons.wikimedia.org/wiki/File:Pauls_Valley_water_tower,_August_2019.jpg", "commons.wikimedia.org", "Wikimedia Commons"),
];

function results(q) {
  const s = q.toLowerCase();
  const list = /brick/.test(s) ? BRICKS : /pauls valley/.test(s) ? TOWN : [];
  return list.map((x, i) => ({ ...x, thumbnailUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:mock", googleUrl: "https://www.google.com/imgres", position: i + 1 }));
}

createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/log") return send(200, { queries: log });
  if (req.method === "POST" && req.url === "/reset") {
    log.length = 0;
    return send(200, { ok: true });
  }
  if (req.method !== "POST" || req.url !== "/images") return send(404, { message: "Not found", statusCode: 404 });
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.headers["x-api-key"] !== key) return send(401, { message: "Unauthorized.", statusCode: 401 });
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return send(400, { message: "Bad JSON", statusCode: 400 });
    }
    const images = results(String(body.q ?? ""));
    log.push({ q: body.q, num: body.num, tbs: body.tbs, at: new Date().toISOString(), results: images.length });
    console.log(`[mock-serper] q=${JSON.stringify(body.q)} tbs=${body.tbs ?? ""} -> ${images.length} images`);
    send(200, { searchParameters: { q: body.q, type: "images", engine: "google", num: body.num ?? 10, tbs: body.tbs }, images, credits: 1 });
  });
}).listen(port, () => console.log(`[mock-serper] listening on http://localhost:${port}`));
