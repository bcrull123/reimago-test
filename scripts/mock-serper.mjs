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

// Round 1 with no note (the planner's proactive searches): like real Google, the town's name brings back its
// welcome signs (the same sign at two sizes, one titled "gateway"), mixed with downtown, depot and a dim park.
const T = "https://thumb.wikimedia.org/wikipedia/commons/thumb";
const SIGN1 = (w, h, title) => img(title, `${T}/e/e9/Grandfield%2C_Oklahoma_Welcome_sign_east_of_town_January_7%2C_2016.jpg/${w}px-Grandfield%2C_Oklahoma_Welcome_sign_east_of_town_January_7%2C_2016.jpg`, w, h, "https://commons.wikimedia.org/wiki/File:Grandfield,_Oklahoma_Welcome_sign_east_of_town_January_7,_2016.jpg", "commons.wikimedia.org", "Wikimedia Commons");
const SIGN2 = img("Pauls Valley welcome sign, Established 1857", `${T}/5/50/Welcome_Sign_Pawhuska_Oklahoma_2024.jpg/1920px-Welcome_Sign_Pawhuska_Oklahoma_2024.jpg`, 1920, 1280, "https://commons.wikimedia.org/wiki/File:Welcome_Sign_Pawhuska_Oklahoma_2024.jpg", "commons.wikimedia.org", "Wikimedia Commons");
const SIGN3 = img("Pauls Valley city limits", `${T}/2/2a/Municipal_welcome_sign%2C_Muldrow%2C_Oklahoma%2C_2023-09-11%2C_TJ_01.jpg/1920px-Municipal_welcome_sign%2C_Muldrow%2C_Oklahoma%2C_2023-09-11%2C_TJ_01.jpg`, 1920, 1099, "https://commons.wikimedia.org/wiki/File:Municipal_welcome_sign,_Muldrow,_Oklahoma,_2023-09-11,_TJ_01.jpg", "commons.wikimedia.org", "Wikimedia Commons");
const HIST = img("Pauls Valley Historic District", `${W}/3/37/Pauls_Valley_Historic_District.jpg`, 1864, 1398, "https://commons.wikimedia.org/wiki/File:Pauls_Valley_Historic_District.jpg", "commons.wikimedia.org", "Wikimedia Commons");
const NIGHT = img("Downtown Pauls Valley at night", `${T}/c/ce/Oklahoma_City%27s_downtown_at_night.jpg/1920px-Oklahoma_City%27s_downtown_at_night.jpg`, 1920, 1440, "https://commons.wikimedia.org/wiki/File:Oklahoma_City%27s_downtown_at_night.jpg", "commons.wikimedia.org", "Wikimedia Commons");
const PARK = img("Wacker Park, Pauls Valley", `${T}/0/0d/Park_Bench_at_Night_%28279616294%29.jpg/1920px-Park_Bench_at_Night_%28279616294%29.jpg`, 1920, 1280, "https://commons.wikimedia.org/wiki/File:Park_Bench_at_Night_(279616294).jpg", "commons.wikimedia.org", "Wikimedia Commons");
// More brick-street scenes further down the results: a regenerated round can show new ones.
BRICKS.push(
  img("Downtown Natchitoches showing the brick streets", `${W}/thumb/9/95/Downtown_Natchitoches_showing_the_brick_streets_IMG_1916.JPG/1920px-Downtown_Natchitoches_showing_the_brick_streets_IMG_1916.JPG`, 1920, 1440, "https://commons.wikimedia.org/wiki/File:Downtown_Natchitoches_showing_the_brick_streets_IMG_1916.JPG", "commons.wikimedia.org", "Wikimedia Commons"),
  img("Brick sidewalk on 11th Street in downtown Altoona", `${W}/thumb/1/16/Brick_sidewalk_on_11th_Street_in_downtown_Altoona%2C_Pennsylvania%2C_2019-06-28-3975.jpg/1920px-Brick_sidewalk_on_11th_Street_in_downtown_Altoona%2C_Pennsylvania%2C_2019-06-28-3975.jpg`, 1920, 1280, "https://commons.wikimedia.org/wiki/File:Brick_sidewalk_on_11th_Street_in_downtown_Altoona,_Pennsylvania,_2019-06-28-3975.jpg", "commons.wikimedia.org", "Wikimedia Commons"),
  img("Red brick alley in downtown Athens, Ohio", `${W}/thumb/7/7c/Red_brick_alley_in_downtown_Athens%2C_Ohio%2C_connecting_North_Congress_Street_and_North_Court_Street%2C_south_of_West_State_Street_%C2%B7_2021-07-03-4786.jpg/1920px-Red_brick_alley_in_downtown_Athens%2C_Ohio%2C_connecting_North_Congress_Street_and_North_Court_Street%2C_south_of_West_State_Street_%C2%B7_2021-07-03-4786.jpg`, 1920, 1280, "https://commons.wikimedia.org/wiki/File:Red_brick_alley_in_downtown_Athens,_Ohio.jpg", "commons.wikimedia.org", "Wikimedia Commons"),
);
const BRICK_MAIN = { ...BRICKS[3], title: "Brick main street, downtown Pauls Valley" };
const C = (path, w, h, title) => img(title, `${W}/thumb/${path}/1920px-${path.split("/").pop()}`, 1920, Math.round((1920 * h) / w), `https://commons.wikimedia.org/wiki/File:${decodeURIComponent(path.split("/").pop())}`, "commons.wikimedia.org", "Wikimedia Commons");
// Bob's round-1 decoy: a murky gravel lot / RV park ranked high by Google (must fail the quality gate).
const GRAVEL = C("7/7f/Chukar_Park_Recreation_Site_%2827677955933%29.jpg", 3120, 2064, "RV park gravel lot near Pauls Valley");
// A plumber (or any home-services trade): finished work is attractive; vans, diagrams and pipes are not.
const PLUMB = [
  C("8/89/Plumbing_van_parked_along_Quander_Road.jpg", 8160, 6120, "Plumbing van parked along the road"),
  C("7/76/Instructions_for_installing_modern_plumbing_systems_%281922%29_%2814597600010%29.jpg", 3856, 2856, "Pipes under the sink diagram, plumbing instructions"),
  C("7/7d/Bathroom_of_Khan_Pool_Suite_in_Amantaka_luxury_Resort_%26_Hotel_in_Luang_Prabang_Laos.jpg", 5768, 3845, "Finished modern bathroom remodel"),
  C("5/54/Sustainable_Kitchen_-_Flickr_-_Jeremy_Levine_Design.jpg", 3892, 2586, "Renovated modern kitchen with new sink and fixtures"),
];
// A restaurant: the dining room and plated dishes are attractive; menu boards are not.
const FOOD = [
  C("7/79/Drive_thru_menu_board_at_Del_Taco_in_Albany%2C_Oregon.jpg", 4592, 3448, "Restaurant menu board"),
  C("c/c4/Interior_dining_room_of_a_LongHorn_Steakhouse_restaurant_in_Blairsville%2C_Georgia_02.jpg", 4032, 3024, "Restaurant dining room interior"),
  C("0/0f/DFC_5021_A_savory_plate_of_spaghetti_topped_with_crispy_bacon_grated_cheese_and_a_sprig_of_fresh_parsley.jpg", 5568, 3712, "Plated spaghetti dish"),
  C("c/c5/DFC_1093_Two_grilled_sausages_served_with_creamy_potato_salad_and_a_side_of_coleslaw_on_a_white_plate.jpg", 5568, 3712, "Plated grilled sausages with potato salad"),
  C("5/5c/Menu_board_and_service_preparer_at_Red_White_and_Que_restaurant_in_New_Jersey.jpg", 1927, 1536, "Menu board at the counter"),
];
// A startup community (bob.me): Bob's round 1 hero was a Vecteezy preview with its watermark; it must be skipped.
const STARTUP = [
  { title: "Business people at whiteboard brainstorming", imageUrl: "https://static.vecteezy.com/system/resources/previews/000/mock/business-people-whiteboard.jpg", imageWidth: 1920, imageHeight: 1080, link: "https://www.vecteezy.com/photo/000-business-people", domain: "www.vecteezy.com", source: "Vecteezy" },
];
const ROUND1 = {
  "downtown pauls valley oklahoma": [GRAVEL, SIGN1(1920, 1440, "Welcome to Pauls Valley sign"), NIGHT, HIST, SIGN2],
  "pauls valley historic district": [HIST, SIGN1(1280, 960, "Pauls Valley, Oklahoma - gateway"), TOWN[0], PARK],
  "pauls valley oklahoma main street": [SIGN3, BRICK_MAIN, TOWN[1], PARK],
};

function results(q) {
  const s = q.toLowerCase().trim();
  const list =
    ROUND1[s] ??
    // Round 8c: nothing on the web names Pine Street in Pauls Valley (the honest "couldn't find" path).
    (/pine street/.test(s) ? [GRAVEL, ...TOWN] : /brick/.test(s) ? BRICKS : /pauls valley/.test(s) ? [GRAVEL, ...TOWN] : /plumb|bathroom|technician|drain|water heater|home/.test(s) ? PLUMB : /restaurant|dining|dish|patio|cafe|food|bistro|grill|kitchen/.test(s) ? FOOD : /startup|founder|entrepreneur|coworking/.test(s) ? STARTUP : []);
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
