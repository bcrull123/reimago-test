# Live preview: creative looks

Visitor enters a URL (or finishes the Create a New Site wizard) and sees, step by step:

1. **Reading your site…**: the homepage plus up to 8 same-site pages are scraped for facts: name, phone, email, address, hours, services, real testimonials, photos, logo and brand colors. Wizard runs build the facts from the brief instead. "Sites to emulate" are lightly scanned for colors, fonts and headings.
2. **Dreaming up looks…**: two AI calls run in parallel:
   - the page plan;
   - **three design directions**. Each direction has a name, mood, archetype (editorial / dark premium / bold photo-led / playful / minimal luxury / warm craft), a hex palette (contrast-checked), a font pair from a curated Google Fonts list, imagery style, hero subject, signature motifs, and hero/header/footer styles.
3. **Painting images and homepages…**: all three looks are built in parallel. Each look:
   - stores the business's real photos first. They are downloaded and kept with the site record, never hotlinked;
   - generates only the missing hero/feature photos. Generated images never contain text, logos or the business name;
   - composes its homepage from the section library.

   The visitor gets **three picker cards** under a large "Choose your favorite look" banner. Each card has a live thumbnail, name, mood, swatches and fonts.
   - The main button on each card is a large, full-width **Choose this look**.
   - **Preview** is a smaller secondary button.
   - The full preview below the cards has a sticky **Choose this look** bar.
4. **Building pages…** and **Polishing the homepage…** (after "Choose this look"): one request builds the remaining pages (and service photos if needed). In parallel it runs a **critique-and-revise pass**:
   - it screenshots the homepage with headless Chrome when available, and an art-director AI critiques the screenshot (or the section list) and revises once;
   - the revision is validated like any other output, and the original is kept if the revision is unusable.

   The other looks stay homepage-only, and their inner pages say "built when you choose this look".

If the AI cannot write a homepage, the look falls back to the section library and its card shows the **exact reason**, for example "grok-4.5 timed out after 55s", "xai API error 400 from grok-4.5: …" or "ran out of tokens". A **Retry with AI** button re-runs only the AI step for that look, with no images or critique, so the AI gets the whole step budget. For a finished site it also retries any inner pages that fell back. The reasons are stored in the site record (`aiErrors`).

### How the AI calls are made

- **Reasoning effort.** Grok 4.5 and later always reason, and they default to `reasoning_effort: "high"`, which is slow for page writing. The app sends `reasoning_effort: "low"` (`AI_REASONING_EFFORT`).
- **Token room.** `max_tokens` is set generously (16k for pages), because thinking tokens count against it.
- **JSON output.** Every JSON call asks for `response_format: {"type": "json_object"}`. If the API rejects either optional parameter, it is dropped and the call is retried once.
- **Fallback model.** Each page call gets the main model first. If that fails or times out, one retry goes to a faster non-reasoning model (`AI_FALLBACK_MODEL`, default `grok-4.20-0309-non-reasoning`) within the same step budget.
- **Robust parsing.** JSON is extracted even from fenced code or prose and tolerates trailing commas. Cut-off answers are reported as such.

### Reading the AI's sections tolerantly

Real models drift from the documented shape, so `checkSections` in `sections.ts` reads what they actually send:

- **Section types** can sit under `type`, `section`, `kind` or `component`.
- **Type names** can be `HeroPhoto`, `hero_photo`, `"Hero photo section"` or an alias like `testimonials`.
- **Fields** can be nested under `props`, `content` or `data`.
- **Field aliases** are mapped: `headline`→heading, `body`/`subtitle`→text, `cards`/`steps`/`faqs`→items, `button`/`href`→cta.
- **Coercions:** a CTA can be a plain string, text can be an array, and sections can be keyed by type or wrapped in `{"page": {...}}`.
- **Partially valid sections are kept.** A list section without items but with copy becomes text, and a second hero becomes a feature split.

The safety rules still apply: stats must use real numbers, reviews must be real quotes, and contacts are never invented. The prompt now includes one valid JSON example per section type.

When sections are dropped, each one gets a reason, for example `#3 unknown section type kind="pricing-table"`.

- If too few remain, the first reasons appear in the look card's amber note.
- If the AI page was still used, a small grey note lists what was skipped.
- The preview record (`aiDebug`, per page) keeps the reasons plus about 2 KB of the raw AI answer, with secrets masked.

### Reloading starts fresh

Results, look cards, previews and wizard answers are kept only in memory; a page reload starts over. Old saved copies (`reimago-reimagine-v*` and `reimago-create-brief-v*` in localStorage) are deleted on load. Each preview stays reachable at its `/made/<id>` link.

### Logos

The scraped logo is downloaded and analysed in pure JS (`pngjs` / `jpeg-js`, Vercel-safe):

- **Background detection.** Its own background is found: transparent, a plain box, or busy. The padding is trimmed and a copy is stored with the site, so the logo is no longer hotlinked.
- **White or light boxes** are keyed out to transparent.
- **Dark surfaces.** For dark headers and footers, colors that would disappear are recolored white, while brand colors that already read well stay. For example, the navy "bob" turns white and the red ".me" stays red.
- **Single-color marks** are simply knocked out white (or black on light surfaces).
- **Fallbacks:**
  - logos in a colored box get a rounded plate in that color;
  - unreadable formats (SVG, WebP) get a light rounded plate on dark surfaces and `mix-blend-mode: multiply` on light ones.

Details:

- **Choosing the logo file.** The scraper picks the real logo with `logo-pick.ts`:
  - it reads lazy-load `data-src`/`srcset` instead of placeholders;
  - it skips tracking pixels, 1×1 images and partner badges;
  - it prefers a logo inside `<header>`, or one whose alt text matches the business name;
  - `http` logo links are upgraded to `https`.
- **Fetching it.** The logo is fetched asking for PNG/JPEG first. Image CDNs such as Squarespace would otherwise send WebP, which the pure-JS analyser can't read; that is what blanked Cafe 501's white logo.
- **SVG logos** are styled from their declared colors and stay at their own URL.
- **When a logo can't be used.** If it can't be loaded or read, the site shows the business name as a text wordmark, never an empty chip.
- **No blank silhouettes.** A logo is only recolored or knocked out when it stays recognizable. A two-tone mark, such as white lettering in a dark disc, gets a contrasting plate instead.

This applies to the header and footer of every look and page.

### The owner's request and "Not quite right?"

**The form's note ("What should change?") goes into every AI step.** `owner-request.ts` cleans it and caps it at 800 characters (no markup, control characters or code fences). It then reaches the AI in two ways:
- **Instruction:** every system prompt gets an "OWNER'S REQUEST — HIGH PRIORITY" block. This covers the page plan, the three design directions, the homepage sections, the inner pages and the critique pass. The block tells the AI to follow the wishes visibly unless they conflict with the safety rules (no invented facts, contact details, prices, statistics or reviews; JSON only).
- **Data:** the note is also sent as `requested_changes`, alongside the facts.

**Mock mode** reads simple wishes from the note so they can be tested without AI:
- colors (for example red, navy or gold) lead every palette;
- "dark" or "light" sets the backgrounds;
- tone words (playful, bold, warm, minimal, editorial, dark) put those styles first;
- requested sections (gallery, reviews, how-it-works steps, a promise statement) are added when real facts can fill them.

Negations such as "no red" or "too dark" are ignored.

**Each card shows** "Based on your request: “…”". In mock mode it also shows what was applied.

**One name per look** (Bob: "Just name them one thing"). Each look goes by its style only: Editorial, Dark Premium, Bold Photo, Playful, Minimal Luxury or Warm Craft (`archetype-label.ts`). The AI's concept names are not shown. The name is the same on the card, in the preview banner and in the `chosen_look` form/webhook field. An edited look keeps it, with the variant after a dot: "Dark Premium · lighter". The three looks of a round always have different styles, so the names are unique on screen.

**The refine box** sits under the cards: "Not quite right? What would you like to see different?" with a **Make this change** button. If the request names a look, only that look changes (next section). Otherwise:
- It makes three new looks, using the same browser-orchestrated steps as the first looks, so each request stays inside the step budget.
- They are built from the original note plus every feedback round so far: up to 5 rounds, each capped at 400 characters, with the newest round mattering most.
- The new looks replace the old cards, with an overlay that reads "Making 3 new looks from your feedback…" and a "3 new looks from your feedback (round N of 5)" line.
- The rounds travel as `facts.feedback` and are passed to the AI as `change_requests`.
- The preview's sticky bar has a **Change something** link that scrolls to the box.
- **Refining never sends the form.**

### Photos the owner asks for

Bob wrote "use the brick streets" and got pipes. On the Pauls Valley site he wrote "Use a photo of the downtown brick streets as background" and got the site's own photos (people reading, the airport). There were three causes:
- the image prompts never saw the note;
- a usable scraped photo always beat generation;
- the hero was the largest scraped photo, whatever it showed.

**The scene.** `requestedScene()` in `owner-request.ts` reads the photo subject. Sources, best first:
1. The AI planner's `photoSubject`. The plan prompt asks for 2–6 plain words, with the place when known (for example "red brick streets downtown"), or "" when the note names no subject. `normalizePlan` cleans it with `cleanSubject()`, and `withPlanSubject()` copies it into the facts for every look. This covers wording the rules below can't read, such as "it would be great to see those old red bricks downtown".
2. The newest feedback, then the note, sentence by sentence. Any "picture/photo/image/pic of X" counts, as does "put/use/show/add/want/make X as/in/for/behind the background/hero/header/banner/top", "make the background X", "the background should be X", "background: X" and plain "use/show X". The slot words, "please", "instead" and "a/our/my" are trimmed.

Examples: Bob's "put a picture of the red bricks as the background" gives "the red bricks", and "use the brick streets" gives "the brick streets". A subject is rejected only if it is *nothing but* design words. "use orange", "navy and gold colors", "add a gallery", "make the font bigger" and "red please" give no subject, and negated phrases ("no pictures of pipes") are skipped. Before pt95u, any color word anywhere killed the subject, so "red bricks" was read as a color request. The trace shows who read the subject (`request.subjectFrom`: "AI planner" or "note wording"). `wantsBackground()` treats "background" (or "behind the headline", "full-width") as the hero background, so those looks switch to the full-bleed `hero-photo`.

**Finding the hero photo.** When there is a subject it is the hero of all three looks. Each look gets a different matching photo when there are several (`photoRank`; the full-bleed cinematic look gets the best). `buildLook` looks in this order:
1. **The site's own photo of it.** The scrape now keeps each image's alt and title text as `facts.imageText`. `matchScraped()` needs most of the scene words (or close synonyms) in that text or the file name. "Brick and stone facade" or "reading a book" does not count.
2. **A free-license web photo.** `web-photo.server.ts` searches Openverse and Wikimedia Commons (no keys) for the scene plus the town from the address. It also searches the town name alone and the town with each scene word. Only CC0, public-domain, CC BY and CC BY-SA photos are used; NC and ND are skipped. A photo must be at least 1200 px wide and landscape (at least 1.2:1), and its title or description must name the town and a telling scene word. "Street" alone is noise, because every address has one. A title naming the town's downtown or historic district counts double for a downtown scene. The whole search is time-boxed to about 8 seconds. The photo is downloaded and stored with the preview (same origin, so the lead picture can capture it). Its credit (title, author, license link, source) is recorded on the image and shown in the footer as "Photo: “…” by …, CC BY-SA 3.0, via Wikimedia Commons". Set `PREVIEW_WEB_PHOTOS=0` to skip this step.
   **Search words** (`webQueries()`): color words only describe, so "the red bricks" searches on "brick". Bricks on a town site usually mean brick streets. For "the red bricks" in Pauls Valley the queries run in this order:
   1. "Pauls Valley red bricks"
   2. "Pauls Valley brick street"
   3. "Pauls Valley brick"
   4. "Pauls Valley Oklahoma"
   5. "red brick street" (anywhere)
   6. "brick paved street" (anywhere)

   Town results rank above results from anywhere. A Commons photo titled with the town and found by a "<town> <subject>" query counts as a match even when its short description doesn't say so, because Commons search also reads the file page. That is how "Pauls Valley Historic District" (which shows the brick streets) is found. Photos from anywhere must contain most of the subject words. Streets *named* after the subject ("Brick Street, Derby", "Street signs in Brick Lane") are rejected.
3. **An AI photo of it.** It is generated even when the site has enough photos. The hero prompt starts "The photo MUST clearly show: the downtown brick streets in Pauls Valley, Oklahoma. Make … the main subject" and adds photorealistic, golden-hour and "no text". For trades it also says "not plumbing company tools or equipment". The look's own hero idea is used only if it already shows the scene. The business name is removed, but the town is kept.

### Google Images preview photos (Serper)

When `SERPER_API_KEY` is set (or a white-label clone has `PHOTO_SEARCH_PROXY_URL` + `PHOTO_SEARCH_PROXY_KEY`), Google Images via [Serper](https://serper.dev) becomes the **first web source**. The full order for a *find* subject is: the site's own matching photo → **Google Images** → Openverse / Wikimedia Commons (only to fill up to three) → an AI photo. A *keep* request ("Keep the rocket") never searches anything; the e2e checks that the mock Serper gets zero queries for it. With neither setting the app behaves exactly as before.

It is also used for the hero when there is no subject and the site has no good photo of its own (or, with `PHOTO_SEARCH_WEAK_HEROES=1`, only a small or weak one). The search is then the business type in its town ("plumber Oklahoma City Oklahoma"), or "downtown <town>" for a town site.

- **Queries** (`googleQueries()` in `google-photo.ts`): at most two, and the second only when the first gives fewer than five usable results. For Bob's note the queries are "red bricks Pauls Valley Oklahoma", then "red brick street". Requests ask for large images (`tbs: isz:l`, `num: 20`).
- **Filtering** (`rejectReason()`): skips watermarked-stock domains (Shutterstock, Getty, iStock, Alamy, Dreamstime, Adobe Stock/ftcdn, 123RF, Depositphotos and a few more), logos and graphics (logo, icon, vector, clipart, map, poster, seal, .svg…), anything under 1000 px wide, non-landscape shapes (outside 1.2–2.8:1) and gifs.
- **Download**: candidates are downloaded server-side by the same SSRF-guarded fetcher as the site's photos (public hosts only, 3.5 MB cap, jpeg/png/webp). The real size is checked, so broken and too-small images drop out. Picks are saved with the preview and served same-origin. The originals are also allowlisted in that preview's image proxy (`/made/<id>/img/remote`), and for no other preview.
- **Picking**: with real AI on, Grok vision looks at up to 8 candidates and keeps only those that clearly show the subject and work as a hero (no watermark, text or logo), best first. Without AI (or if vision fails) the title/size/aspect score is used, and the title or page must name the subject. Each look takes a different photo (`photoRank`).
- **Temporary**: these photos belong to someone else, so they are preview-only. The stored image has `source: "web"` and `temporary: { provider: "Google Images", via, title, imageUrl, sourcePage, domain, query, pickedBy }`, so the build step can find and replace them. The card says "Photo: from Google Images (preview only, replaced when your site is built)". The footer carries a tiny note: "Preview photo from <domain, linked to the page> via Google Images, temporary: replaced when your site is built" (`span.photo-temporary[data-temporary-photo]`). The trace status is "preview photo (Google Images)", and its search line lists the queries and what was skipped.
- **Limits**: each Serper call has a 6 s timeout. The whole photo search stays inside the step budget (it runs alongside the page writer). Results are cached per query for 30 minutes, and picks per site + subject, so the three looks share one search. Failures are logged by status only; the key is never logged, returned or sent to the browser.
- **White-label clones**: the Serper key lives only on the master server. A clone without `SERPER_API_KEY` sets `PHOTO_SEARCH_PROXY_URL=https://<master>/api/photo-search` and `PHOTO_SEARCH_PROXY_KEY=<shared key>`. The master's `POST /api/photo-search` (`photo-search-endpoint.server.ts`) works as follows:
  - it exists only when the master has both `SERPER_API_KEY` and `PHOTO_SEARCH_PROXY_KEY` (404 otherwise);
  - it needs `Authorization: Bearer <PHOTO_SEARCH_PROXY_KEY>` (timing-safe compare, 401 otherwise);
  - it takes `{"q": "…"}` (1–200 characters, 400 otherwise);
  - it is rate-limited per caller IP (`PHOTO_SEARCH_RATE_PER_MINUTE`, default 30; `PHOTO_SEARCH_RATE_PER_HOUR`, default 300; 429 otherwise);
  - it returns only `{"images": [...]}`, never the key.
  A server that has its own key never proxies.
4. **Nothing found** (for example, mock mode with no web match). The hero gets a plain background, never an unrelated scraped photo.

**"Keep the rocket": the owner's own picture.** On bob.me, Bob wrote "Keep the rocket" and every look got a different Wikimedia "rocket" (the Success Rockets logo, the Tesla Roadster in orbit, a NASA lab photo). His rocket is a 440×360 transparent PNG illustration: a pink rocket with people and clouds, in an Elementor image box on the homepage. Its alt text is "Blast off" and its title and file name are `rocket_transparent-bg…png`. It was missed for two reasons: the old scrape dropped images under 640 px, and "keep" was read as "find a photo of".

How a keep request is read:
- `requestedPhoto()` (`owner-request.ts`) returns `{ subject, intent }`.
- `keep` is detected from words like keep, retain, preserve, reuse, "don't lose", "don't remove", leave, "still use", "stick with", "the same X", "our existing X", "X from my site", "our X" / "my X" (but not "our town"/"our city"), and "I like my X, keep it".
- The planner also returns `photoIntent: "keep" | "find" | "none"`. A keep reading from either side wins, because keep never fetches anything from outside the site.
- "keep it simple", "keep the same colors" and "keep the logo" are not photo subjects.
- `sceneToFind()` gives image prompts and look directions only the *find* subjects. For a keep subject, the prompts also leave out the owner's words, so no AI rocket gets painted.

Where kept art can come from: only the scraped site. The scrape now keeps `facts.siteArt` (`site-art.ts`): every picture on the homepage first, then the other scraped pages. Each entry carries the words that describe it:
- `<img>`: alt, title, aria-label, class, id, the file name (with CDN hashes and size suffixes removed) and the srcset file names;
- `<picture><source>`;
- inline SVG: title, desc, ids, classes, data-name (drawings 64 px or larger);
- CSS backgrounds: inline styles, data-bg, `<style>` blocks and the site's stylesheets;
- og:image and the logo.

`matchSiteArt()` needs the subject's words in those words. If nothing matches and AI is on, `keep-art.server.ts` shows up to 8 of the site's pictures to the vision model (same model as the rest, or `PREVIEW_VISION_MODEL`), as data URLs, and asks which one shows the subject. The result is cached per site and subject, so all three looks keep the same picture.

How it is shown: the same picture is the hero of every look, in that look's treatment. Transparent PNGs (`analyzeLogo` reports a transparent background), drawings on a flat color and SVGs are marked `cutout`. They are never cropped full-bleed or duotoned; `arrangeSections(…, cutout)` shows them whole on a color panel (`x-cutout`):
- caption: a light panel;
- collage: a tilted white card on the brand color block;
- cinematic: a dark stage with an accent glow.

The card's layout line says "your art shown whole". Inline and remote SVGs are sanitized (`sanitizeSvg`: no scripts, handlers, foreignObject or outside links). `/made/<id>/img/<name>` now also serves `image/svg+xml`, with a CSP that blocks scripts.

On the card:
- found: "Photo: kept your rocket from your site, as you asked";
- not found: "Couldn't find a rocket on your site to keep, and no web or AI rocket was swapped in · …". The hero then falls back to the normal choice (your site's best photo, else the look's own AI photo, which never shows the kept subject).

The trace says how the picture was matched (the words, or AI vision) and where it was on the site.

**No subject named: hero suitability.** Bob asked why pipes showed up on a town website. With no subject, the hero used to be the *largest* scraped photo. Now `heroSuitability()` (`web-photo.ts`) scores each scraped photo from its alt text, file name and URL. There is no extra AI call.
- **Preferred:** places and landmarks (downtown, streets, parks, lakes, courthouse, historic, storefront, exterior, welcome sign, depot, museum …), then people and events.
- **Demoted everywhere:** logos, icons, documents/PDFs, forms, flyers, maps, agendas, bids, headshots/staff portraits and placeholders.
- **Also demoted on civic sites** (`isCivic`): pipes, valves, meters, pumps, utility, sewer, treatment plants, tanks, equipment, machinery, infrastructure, and photos from utility, water, public-works, department, staff, bids or forms pages. A plumber's site may still show its pipes.

How the scores are used:
- Photos scoring below −3 are dropped from the preview.
- The rest are stored best-first (`photo-1` is the best).
- Each look leads with a different suitable photo (score > 0).
- If a civic site has no suitable hero-sized photo, the hero shows the town instead: the subject becomes "downtown <town>" (`trace.request.autoScene`), and the same search runs, finding a free-license photo of the town or else an AI photo of it.

On paulsvalley.com the pipes photo scores −9, "Open Bids" −4, the welcome sign 4, people reading 2 and the airport 0.

Every image prompt also carries the owner's words as "The business owner's request (top priority …)". The look-directions prompt asks the AI to make each look's `heroSubject` the requested scene and adds a `featureScene`. Refine rounds that mention photos, images, scenes or backgrounds regenerate the images.

**On the card.** A small line says what happened:
- "Photo: “Pauls Valley Historic District” by Crimsonedge34 (CC BY-SA 3.0) from Wikimedia Commons";
- "Photo: your site's photo of …";
- "AI photo of “the brick streets”";
- "Photos: no photo of … found; would generate one (mock mode / AI images off)".

"How your request was used" (`look.trace`, saved with the preview as `trace`) lists:
- each AI step and whether it got the OWNER'S REQUEST block;
- each image's status and source;
- the web search words and result;
- the credit;
- the AI image prompt.

It contains no secrets.

### Proactive Google Images on the first round (no note needed)

When photo search is on (`SERPER_API_KEY` on the master, or the photo-search proxy), round 1 gets Google photos even with no note:
- The AI planner returns 2-3 `imageQueries` from the scrape, aimed at what makes the place or business look its best, never its name alone: a town -> downtown, main street, historic district, landmark, courthouse, skyline or aerial ("downtown Pauls Valley Oklahoma", "Pauls Valley historic district", "Pauls Valley Oklahoma main street"); a business -> its work, product, storefront or team in its setting. `cleanImageQueries` (`photo-queries.ts`) drops queries that return signs, logos, seals or maps ("welcome to …", "city limits sign"). Without AI, `defaultImageQueries` builds them by site type (town: downtown / historic district / main street; business: "<worker> at work", "<kind> storefront <city>", "<worker> team <city>").
- `previewDirections` starts the searches as soon as the plan is ready, in parallel with the directions (`prefetchForPlan`). The queries run in parallel; candidates are downloaded and ranked (Grok vision when AI is on, which also labels each photo's subject and whether it is mainly a sign; otherwise title/size/aspect). The site's own hero-sized photos are added as candidates too.
- **Hero score** (`hero-pick.ts`, measured from the downloaded pixels and the photo's words): wide scenes with streets, buildings, landmarks or people, in good light and with contrast, score high; signs, plaques and text (`welcome sign`, `city limits`, `entrance sign`, logos) get -5; dim (brightness < 0.22), flat (contrast < 0.12), mostly-sky or mostly-grass photos are demoted. A night street is dark by design and is not treated as dim. Site photos are scored the same way and win only when they beat the Google photos.
- **Three different subjects**: the three looks are assigned together (`assignHeroes`, best total of hero score + mood fit), with no two photos of the same subject (same subject bucket such as "sign", "depot", "night street", "building", or a near-duplicate picture by perceptual hash, ≤ 10 bits apart). A near-duplicate of a sign is a sign whatever its title says, so a welcome sign is used at most once. Mood fit: dark premium prefers a dusk/night scene, editorial a daytime historic building, playful/bold a lively street or festival, warm craft warm light, minimal luxury a calm landmark. The assignment is made once, when the directions' archetypes are known, and stored with the search (server-side, 6 h) so every look reads the same picks; if a look is built before it is stored, it recomputes the same assignment without moods.
- A look whose assigned photo can't be downloaded falls back to the next photo in the pool.
- Not used when the owner asked to keep something ("Keep the rocket"): keep requests stay site-only and never search. Not used either when the note names a subject (that search runs instead).
- Logs: `[photo-search] proactive [queries]: N results, M usable (ranking); skipped {...}; K site photos competing` once per round, then one `[photo-search]   candidate google|site score S [SIGN] subject "…" “title” brightness B contrast C` line per candidate and one `[photo-search] pick look N (archetype): google|site “title” · score … · mood … · beat “runner-up” … · subject: …` line per look, and one line per look: `[photo] look N "Name": hero = Google Images (domain) · query "..." | your site (photo-n) | AI photo | none · status · search ...`. The same text is in the card's "How your request was used". When search is off, the trace says "Google Images: off on this server (no SERPER_API_KEY or photo-search proxy)".

### Hero quality gate (any kind of business)

Bob's round 1 on paulsvalley.com showed the airport, a library interior and a murky gravel lot / RV park as heroes ("Not very appealing"). Every hero candidate now has to pass a designer bar before it can be used. Nothing in the gate is specific to towns:
- **Business type** (`hero-brief.ts`, pure): `heroBrief(facts)` reads the site (name, industry, tagline, services, description) and picks a brief: town/city, restaurant/cafe/bakery, trades (plumber, HVAC, roofer, contractor…), law/finance, medical/dental, salon/spa, real estate, retail, fitness, auto, hotel/venue, nonprofit/church, tech/SaaS, or general. Each brief says what a beautiful hero looks like for that kind of business (`good`), what to avoid (`avoid`), off-topic words (`offTopic`, e.g. a town: airport, runway, meetings, library interior, people sitting; a restaurant: menu boards, parking; a plumber: vans, diagrams, clogged drains) and search scenes. `briefQueries(facts, brief)` fills the scenes with the city, state and main service ("Pauls Valley Oklahoma landmark", "Drain cleaning technician at work in a home", "restaurant dining room Edmond"). These 2 queries are added to the planner's queries on round 1. `LOW_QUALITY` is the generic bad list for every type: clutter, debris, screenshots, diagrams, clipart, watermarks, blur, power lines, gravel or parking lots, RV parks, empty lots, chain-link fences, storage rooms, documents, maps.
- **Vision rating** (`rateHeroes`, `google-photo.server.ts`): one extra Grok vision call per round rates EVERY candidate (Google and site photos, up to 16) from 1 to 10: "would a designer use this as the hero of a beautiful homepage for THIS kind of business" (the brief's good/avoid text is in the prompt). Bar: **7/10** (`HERO_BAR`). The rating moves the hero score by (rating - 6) x 1.5; an off-topic title is -6; a `LOW_QUALITY` title is -4. Without AI (or if the call fails) the title words and pixel stats decide.
- **Only passing photos are used** (`assignHeroes`): when at least one photo passes, failing photos are never picked. If fewer than three pass, a passing photo is reused rather than show a bad one (reason "reused: only N photos passed the quality bar"). If fewer than 3 pass, free-license photos (Openverse/Wikimedia, `findWebPhotos`) for the first brief query are rated too. If nothing passes and AI images are on, the look gets an AI photo instead.
- Photos narrower than **1200 px** are rejected ("too small"; was 1000). Dark Premium still prefers a dusk/night scene (mood fit), but only among photos that passed.
- Logs: `[photo-search] quality gate (category: kind): vision-rated, bar 7/10 · N passed, M failed`, then each candidate line has `PASS|FAIL rating X/10 “note”` and `OFF-TOPIC` when it matches the brief's off-topic words; `[photo-search] quality gate: only N candidates passed; free-license search “…”: K found` when the fallback runs. The `[photo] look N` line includes the quality gate in its search text.

**Hero layouts fixed**: the big-type (panorama) headline had an invisible word ("ADVENTURE, FUN, AND … PRIDE"): the outlined accent word used a transparent fill with a `currentColor` stroke, so it drew nothing. It now has a 30% accent fill and a stroke in the text color (white on photo heroes). The panorama's photo strip had a reveal-on-scroll class and too much height above it, so it didn't show in the first screen or in thumbnails. It has no reveal class now, a smaller headline (max 5rem, 20ch) and a 21:7 strip. Checked at 1280x800 and 1024x640 for panorama, poster and framed with Editorial, Dark Premium and Playful.

### Custom Design: one look designed from scratch (round 5)

Bob on bob.me (round 5): "These are basically the same as the other sites. We need to add something more creative." So, as the owner asked, there is **one** look per round that Grok designs from scratch. The other two stay template looks so you can compare. It is always the **third card**, named **"Custom Design"**.

- **Creative brief** (`creativeBrief`, `custom-design.server.ts`): it runs in parallel inside `previewDirections` (30s cap). Grok writes the concept, a visual metaphor, mood, composition, typography (two Google Fonts), motion (CSS only) and a palette. If the call fails or times out, `fallbackBrief` picks a concept by business type: town "Front Porch", restaurant "The Long Table", trades "Blueprint", startup community "The Launchpad", other "Signature". Fonts outside the curated list are swapped for curated ones. The third direction becomes the custom direction (`asCustomDirection`). Its sub-pages, and the fallback homepage, use the template archetype with the brief's colors and fonts.
- **The page** (`designCustom`): a separate server call `previewCustom`, chained after that look's template build in `home-page.tsx`. It has its own step budget. Grok writes the full homepage as freeform HTML + CSS (draft cap 75s, 16k tokens). It gets the real content (name, tagline, services, phone, pages, CTA, the look's quality-gated photos as `@img:` tokens, and the keep flag). Inline SVG and CSS art are encouraged when the photos are weak.
- **Guardrails** (`custom-design.ts`, pure):
  - `sanitizeCustomHtml` / `sanitizeCss` remove scripts, `on*` handlers, forms and iframes, external images, links and fonts, `@import`, `@font-face`, `expression()` and `javascript:`. Off-site links become the CTA page. Only the business's own tel/mailto and https social links survive.
  - The preview CSP (`script-src 'none'`) still applies.
  - `validateCustom` checks:
    - the name/logo is there;
    - the header nav links every page;
    - a CTA sits in the hero;
    - there is a tel link, exactly one h1, ≥3 sections, a footer, and enough text;
    - keep → the kept picture is shown whole;
    - an `@media` rule, and no fixed width over 600px outside media queries;
    - WCAG AA contrast per CSS rule (same-rule color/background 4.5:1; colors on an ancestor rule's background 3:1; the palette's text on background/surface 4.5:1).
  - `render.ts` adds the preview ribbon and the legal/photo-credit line ("Preview by Reimago · designed from scratch (“concept”)"), and it places the logo with the same per-surface treatment as the templates (`@brand:light|dark`).
- **One repair pass, then fallback**: when a check fails, Grok gets the problem list once (`REPAIR`). If the page still fails, or the draft times out or errors, the card shows the template homepage under its style name (e.g. "Playful"), with an amber note on the card. The page is never blank and never broken.
- **Render check**: there is no browser render check on the server (Vercel has no Chrome); the server runs the static checks above. `scripts/custom-look-check.mjs <base> <id> <outDir>` is the real browser check for tests. At 1280 and 390 it checks: non-blank, no horizontal overflow, no unresolved tokens or broken images, ribbon and legal line, no scripts, one h1, CTA in the hero, and per-element contrast. It writes `custom-{1280,390}-top.png` and `custom-check.json`.
- **Refine**: "make the custom one darker" (also "custom design", "from-scratch", "bespoke") targets only that card. The palette is retuned deterministically first, then Grok edits the page's HTML/CSS (`editCustom`, `EDIT`). The edit is checked like the draft; if it fails, the retuned colors alone are kept. The card keeps its name ("Custom Design · darker"). A refine with no look named makes a new round, again with one Custom Design.
- **Keep**: "keep the rocket" stays site-only (no web search and no AI image), and the custom page must show `@img:hero` whole.
- **Card line**: `Designed from scratch by Grok: “concept”` and `(fixed after our checks)` after a repair. Layout line: `Layout: designed from scratch · concept “X” · metaphor`.
- **Logs**:
  - `[design] brief (category: kind) by Grok|fallback in Ns: “concept” · metaphor · fonts A / B · #primary on #background`
  - `[design] look 3 is the from-scratch “Custom Design”: …`
  - `[design] “X” draft: N chars html + M chars css in Ns`
  - `[design] checks “X”: pass | N problem(s): … · sanitized: …`
  - `[design] repair pass: …`, `[design] checks after repair: …`
  - `[design] “X” ready (ok|repaired) in Ns · … · images …`, or `[design] fallback: look 3 shows its template homepage as “Playful” (reason)`
  - `[design] edit “…” by Grok in Ns: html+css · background A -> B`
- **Off switch**: `PREVIEW_CUSTOM_LOOK=0` (then three template looks as before). Mock mode has no custom look.

### Wolf River Bob fix (relevance is business fit, not a shared word)

On bob.me, both Dark Premium and Bold Photo showed Wikimedia's "Wolf River Bob 10-1974" (an old cowboy). Root cause:
1. The scraped "services" were merch and page furniture ("Bob.me Golf Hat", "Specs", "Report"), so the business kind became "Bob.me Golf Hat" and the category was "general".
2. The free-license fallback query became "bob golf hat" (a brand word plus merch). Wikimedia and Openverse answer that with people named Bob in hats.
3. The vision rating judged photos against "Bob.me Golf Hat", so a man in a hat looked on-topic. When unrated, the general brief's keyword fallback only rejected logos and signs.
4. With few passing photos, the "reuse a passing photo" rule put it on two looks.

Fixes:
- `realServices` drops merch, page furniture and "brand + product" items.
- A **startup-community** category (founders, entrepreneurs, coworking) has its own scenes.
- `briefQueries` strips brand and name words, and the brief text no longer contains the business name.
- `brandOnlyMatch` flags a candidate whose title only shares a word with the name as OFF-TOPIC.
- Every non-town brief rejects vintage, archival, 19xx and portrait-of-an-unrelated-person titles.
- The rating prompt says "judge BUSINESS FIT first; a photo that only shares a word with the business NAME, a vintage/archival photo, or a portrait of an unrelated person rates 1-3".
- `passesBar` now needs appeal ≥7 **and** not off-topic, and an unrated free-license (web) photo never passes.

### Imagine first, then Grok builds (Custom Design, round 6)

Bob tested the from-scratch look on bob.me. Editorial got a Vecteezy stock photo with its watermark, Dark Premium got a stock office photo, and the custom "Founder Launchpad" page looked generic. With "include a rocket", the custom page failed one contrast check after repair (`.cta-nav #ffffff on #e85d04 = 3.50:1`) and fell back, and all three looks ended up as a rocket on a panel ("These are pretty weak"). The owner chose: Imagine designs it first, then Grok builds it.

- **Flow for the third card** (`home-page.tsx` chains `previewLook` → `previewImagine` → `previewCustom`):
  1. Grok writes the creative brief (unchanged, `creativeBrief`).
  2. `previewLook` builds the template version, which picks the photos (site photos first, see below).
  3. `previewImagine` (`imagineMockup`, `custom-design.server.ts`): Grok Imagine paints a full desktop homepage mockup. The prompt (`mockupPrompt`, `custom-design.ts`, at most 3600 chars) holds the real name, the nav labels, the exact headline, the button and the services. It also has the brief's concept, metaphor, mood, composition, fonts and palette hexes, the owner's request ("include a rocket"), and a description of the photos the page will really use, marked as the business's own photos. "Keep" asks for the owner's own picture shown whole. The mockup is stored with the look as image `mockup`, served at `/made/<id>/img/mockup`.
  4. `previewCustom` (`designCustom` with the mockup): Grok vision gets the mockup image (`image_url`, detail high), the site content, the photos that passed the gate (`@img:` names, own photos first) and the rules (`mockupBuildPrompt`, marker "Build this homepage to MATCH THE DESIGN MOCKUP"). It writes HTML/CSS that matches the mockup's layout, colors and type, using the real photo files and never the mockup's pixels. It may ask for up to 2 extra Grok Imagine artworks for decorative areas (`"assets"` → `art-1`, `art-2`, made in parallel, at most 45s, stored like the other AI images). Cropping parts of the mockup itself is not done.
- **Model / endpoint**: `grok-imagine-image-2.0` (`IMAGE_MODEL`). It uses `POST https://api.x.ai/v1/images/edits` with the site's logo as the reference image when there is a logo (`PREVIEW_IMAGINE_LOGO=0` turns that off), otherwise `POST /v1/images/generations`; an edits error retries as generations. Settings: `aspect_ratio 16:9`, `resolution 1k` (`PREVIEW_IMAGINE_RESOLUTION` = 1k|1.5k|2k), `quality low`, `n 1`. The key is the same server-only `XAI_API_KEY`. The vision build uses `PREVIEW_VISION_MODEL` or `AI_MODEL`.
- **Cost per round** (xAI pricing page, docs.x.ai/developers/pricing, read Nov 2026): the mockup is $0.04 at 1K low (+$0.01 for the logo as input image on the edits path; 1.5K low $0.05, 2K low $0.06). Up to 2 art assets are $0.04 each. The vision build is about 6–10k input tokens plus the image and about 5–8k output tokens (≈ $0.05–0.07 at grok-4.7's ≈ $2 / $6 per 1M tokens). So about **$0.10–0.25 extra per round**, on top of the existing brief, template looks and photos.
- **Timeouts and fallback**: mockup 60s (`PREVIEW_IMAGINE_TIMEOUT_MS`), vision build 90s (`PREVIEW_CUSTOM_BUILD_TIMEOUT_MS`), custom step budget 150s (`PREVIEW_CUSTOM_BUDGET_MS`). The two template cards don't wait for it. Chain: Imagine fails → the text-brief design (round 5 flow; the card says "no Imagine mockup this time; designed from the text brief") → structural failure → the template homepage. The vision build also falls back to the text-brief design when it fails and over 60s are left. `PREVIEW_IMAGINE_DESIGN=0` skips the mockup.
- **Automatic contrast fix** (`autoFixContrast`, `custom-design.ts`, deterministic): before any check, each rule below WCAG AA has its own background shifted toward black/white (same hue) until it passes, or its text color is shifted when the background is inherited. Examples: `.top .btn.small: background #e85d04 -> #c34e03 (4.76:1)` (the stand-in run of Bob's case), and an `@media` copy of the rule is fixed too. The card says "N colors adjusted for readability". Contrast alone never causes a repair or a fallback (`isStructuralProblem`); only structural breakage does (nav, h1, CTA, keep, widths, unsafe markup).
- **Card**: the Custom Design card shows the mockup and the built page side by side (`DesignVsBuilt` in `looks-picker.tsx`; the mockup links to full size), with "Designed by Grok Imagine, built by Grok: “concept”". After a refine it reads "Design · Grok Imagine (before your edit)". The Formcarry/email `picture` stays the built page screenshot; Formcarry and the reply webhook get `design_mockup_url` too.
- **Refine**: "make the custom one darker" still edits the built HTML/CSS in place (`editCustom`); the mockup is not regenerated (marked stale).
- **Logs**:
  - `[imagine] mockup for “X” by grok-imagine-image-2.0 (edits (from the logo)|generations, 16:9, 1k, quality low) in Ns · 1 image · KB · WxH · designed around N of the site's own photos · request|keep · prompt N chars`
  - `[imagine] mockup … failed after Ns (…); falling back to the text-brief design`
  - `[design] “X” build from mockup: N chars html + M chars css in Ns · built from the Imagine mockup by <model> (vision)`
  - `[imagine] art for the custom page: k/n made in Ns (model) · art-1 1:1 “…”`
  - `[design] checks “X”: pass | auto-fixed contrast: …`, and `[design] “X” ready (ok, from the Imagine mockup) in Ns · … images … (N of the site's own) · Imagine art …`

### Custom Design art: the site's own assets first, then Imagine; Google only as a last resort (round 7)

Bob ran 52fb142 on bob.me. The Imagine mockup was bold, but the built Custom Design page was plain, with a Google Images photo of two people at a laptop ("Photo: from Google Images"). Bob asked: "why did we use google images and not imagine". Bob also said: "Imagine used to make some cool sites out of the rocket" and "let imagine be creative with what they have on their site first".

**Why Google won**: the order of the steps. The custom card runs `previewLook` (the template build) first, then `previewImagine`, then `previewCustom`. The template step ran the normal hero pipeline for look 3 too: no site photo passed, so it took a Google Images photo and stored it as `hero`. The custom page then had to use `@img:hero` (the validator requires the hero photo when there is one), and the card kept the template step's "Photo: from Google Images" line. Imagine was never asked for art.

**Now**:
- **Template step for the Custom Design look** (`buildLook`, `imagineFirst` when Imagine design is on): only the site's own photos (or the kept picture) are taken. There is no Google pick, no free-license photo, no plain AI photo and no AI feature photo for this look. The trace says "Custom Design: Grok Imagine makes this look's imagery from your site's own assets (no Google Images)". The round's shared Google search still runs once for the two template looks.
- **The site's assets** (`prepareCustomPhotos` / `customContext`):
  - The template's own-photo hero is copied to `@img:hero`.
  - Photos that passed the gate are used as before. Photos that failed only the hero bar (not signs, lettering, logos, documents, maps, watermarks or the brief's off-topic words) come along as **secondary** material (collage tiles, textures).
  - The **signature graphic** (`signatureArt`, `site-art.ts` `signatureCandidates` / `isSignatureArt`) is stored as `@img:brand-art`. It is a mascot or illustration placed in the page: a transparent PNG/WebP or SVG of at least 200 px, not the logo, not an icon, not a banner strip or wide wordmark (wider than 2:1), and not a decorative shape (circle, blob, divider, dots). Example: bob.me's 440x360 "Blast off" rocket. This needs no note.
- **Imagine gets the real assets**: `/v1/images/edits` with up to 5 reference images as data URIs (`images: [...]`; one image uses `image: {...}`). Order: logo, signature graphic, hero photo, other own photos, then secondary photos. The prompt names each one (`<IMAGE_0>` …) and asks Imagine to design around them and recompose them creatively (collage, duotone, cutouts, framing, color treatments) instead of replacing them. With a signature graphic and no own hero photo, the graphic is the hero centerpiece. Log: `[imagine] site assets sent to Imagine (N reference images, /images/edits): logo “…” · brand-art “…” · …`. `PREVIEW_IMAGINE_REFS=0` sends none; `PREVIEW_IMAGINE_LOGO=0` leaves out the logo.
- **Gap art** (`planArt` / `makeArt`): Imagine art from the mockup (plus the signature graphic) as reference images, made in parallel with the vision build (≤45 s). The build is told the names up front (`kind: "imagine art"`). At most 4 pieces:
  - no own hero and no signature graphic: `hero` (16:9) + 3 supporting pieces;
  - a signature graphic: 2 pieces in its style (its world: trails, scenery; a pattern from its shapes);
  - own photos: 1 decorative piece.
  - Art that fails is removed from the page.
- **Google is the last resort**: only when the hero artwork failed, or when Imagine failed (no mockup) and the site has no picture at all (`googleHero`, logged as `[photo] Custom Design: … Google Images photo (last resort)`).
- **The built page uses the real files** (`@img:brand-art`, `@img:hero`, `@img:photo-N`) with CSS treatments, never the mockup's pixels.
- **Card line** (`photoLineFor`, from what the built page really uses), for example:
  - "Art: your site's own Blast off rocket, with 2 pieces of art created by Grok Imagine for this design"
  - "Art: created by Grok Imagine for this design"
  - "Photos: your site's own (N)"
  - "Photo: your site's own (1) · Art: 2 pieces created by Grok Imagine for this design" (own hero photo plus Imagine gap art)
  - "Photo: from Google Images (Grok Imagine was unavailable; preview only)"
- **Fidelity**:
  - The server samples the mockup's pixels (PNG/JPEG; `mockupColors`): the dominant color and tone of the header (top 10%), hero (10–70%) and below (70–100%) bands, plus the main colors with their shares. These go into the vision prompt ("Colors sampled from the mockup's pixels (match them): …").
  - The prompt asks Grok to describe the mockup region by region first (`"regions": [...]`), then build each region to match: layout (grids, collages), dark/light blocking, headline scale and decorative elements.
  - `fidelityScore` is render-free (0–100): 60% from the header, hero and next section's declared backgrounds vs the bands, 40% from main-color coverage in the CSS.
  - Under 60 (`PREVIEW_FIDELITY_MIN`), there is one repair pass with the differences ("The mockup's hero area is dark (#0b1026) but your section.hero background is light (#ffffff)…"). The repair is kept only if it doesn't break the page or lower the score. Low fidelity alone never falls back to a template.
  - Log: `[design] fidelity N/100 vs the Imagine mockup (header ✓ dark … · hero … · below … · 3/4 main colors)`.
- **Cost per round (Custom Design images)**, from docs.x.ai/developers/pricing (grok-imagine-image-2.0: $0.04 per 1K-low output, $0.01 per input image; edits bill input + output):
  - mockup: $0.04 + $0.01 × reference images (≤5), so $0.04–0.09;
  - each art piece: $0.04 + $0.01 for the mockup reference (+ $0.01 with the signature graphic), so $0.05–0.06 each;
  - totals: bob.me-like (logo + rocket, 2 art pieces) ≈ $0.06 + $0.12 = **$0.18**; no site assets (hero + 3 art) ≈ $0.04 + 4 × $0.05 = **$0.24**; worst case (5 refs, 4 art with 2 refs each) ≈ $0.09 + $0.24 = **$0.33**.
  - The vision build's tokens come on top (not measured; the default `AI_MODEL` rate was not checked).

### The site's own photos first (all looks) and watermarked stock rejected

- **Priority** (Bob: "Make sure you use the actual photos on the site if available"): the business's own photos → Google Images / free-license → AI / Imagine art. A site photo passes at **6/10** (`SITE_BAR`, others 7/10) when it is on-topic, sharp and not a sign or utility shot. It also gets +4 in the hero score and a +15 weight when heroes are assigned, so a site photo rated 7 beats a Google photo rated 9. The card says "Photo: your site's own photo of …". The Custom Design gets only the site photos that passed the round's gate (`StoredImage.gate`, with the vision caption in `shows`). Signs, the airport and utility shots that failed are never offered. The template's hero (e.g. `photo-3`) is copied to `@img:hero` (`prepareCustomPhotos`), so the mockup is drawn around that real photo and the built page uses the real file. Utility words (industrial, pipes, valves, machinery, pump station, storage tanks) are off-topic for a town hero.
- **Watermarked stock** (`WATERMARK_SOURCE` / `watermarkedSource`, `google-photo.ts`): Google and free-license results from vecteezy, shutterstock, istock, gettyimages, alamy, dreamstime, depositphotos, 123rf, adobe stock (ftcdn), bigstock, canstock, agefotostock, pond5, vectorstock, freepik, stocksy, megapixl and photodune are dropped by domain, URL, link or title ("stock / watermarked"). The vision rating also returns `watermark: true` for a visible watermark, and such a photo never passes.
- **Template variety with a note**: kept or cutout art ("include a rocket") is composed differently per look. Panorama is a giant headline over a wide color band with the art whole in it. Poster/cinematic is a dark stage (art right/left). Framed/caption is a light panel (art left/right). Collage uses the brand color. So the two template looks are no longer both a rocket on a panel.

### "Change this look": a box on each card (round 8)

Bob: "I tried to change the middle one and it changed the picture. What I would like to see is a box in each sample site at the bottom so it is more clear to the system which one is being modified."

- **Why the middle card changed style and photo:** "Use Bold Photo and make the image in daylight…" went into the shared box. No card on screen was called "Bold Photo" (the middle one was Dark Premium), so the request named no look and became a whole new round, and the word "bold" steered the new middle look to the Bold Photo style. The planner also read "make the image in daylight" as a request for a different photo ("daylight scene"), so a new Google photo replaced the current one instead of brightening it.
- **The box:** every card has "Change this look" (round 8b: "What would you change?", moved up under the colors) (`CardEditBox` in `looks-picker.tsx`, `data-card-edit`), with the placeholder "e.g. make the photo daylight, more contrast" and a Change button. It is full width on phones.
- **Explicit target:** the box sends `card: {id, index, style}` to `previewRefine`; `planEdit(…, cardId)` uses that card as the target (no name matching), even when the words name another look. A per-card request never turns into three new looks. The global box still works as before, as a fallback.
- **Only that card changes:** the edited copies replace that card only; the other two keep their ids and their homepage HTML byte for byte (the e2e checks this with a hash of each page).
- **Same style, same photo:**
  - the style name stays unless the box text explicitly asks for another style by its full name ("use Bold Photo", "make it Editorial", "switch to Warm Craft style", `requestedStyle`). Then only that card switches: same photo, words, colors and sections, in the new style's fonts, motifs, corners and buttons, and it goes by the new name. Custom Design is never restyled;
  - a new photo is searched only when the owner asks for a different one (`wantsNewPhoto`: "a different photo", "a photo of the depot"). A planner photo that only names lighting ("daylight scene", `lightingOnly`) is ignored and logged: `[refine] planner photo “daylight scene” ignored: …`.
- **New tweak `daylight`** ("make the image daylight", "sunny", "daytime"): the same photo is made brighter and warmer (CSS `brightness`, `saturate`, `sepia`), with a lighter dark overlay that never goes below the WCAG AA floor for the hero text. The palette is not touched. "adjust the text to show contrast" and "raise text contrast" now read as `more-contrast`. When the Grok planner misses a tweak that the wording rules caught, the rules' tweak is added.
- **Custom Design:** its box edits only Custom Design (one version, no chips). Grok edits the page when AI is on. The photo tweaks are applied as CSS filters on the business's own photos (`img[src$="/img/hero"]`, `/img/photo-N`; `customTuneCss`), never on the logo, the signature graphic or Imagine art. The card keeps its round 7 picture line.
- **Variations:** 3 chips for template looks and 1 version for Custom Design, as before.
- **Log:** `[refine] card box: card 2 “Dark Premium” (<id>) asked “…” · style kept | explicit style switch to bold-photo`, then `[refine] "…" -> edit Dark Premium only (its own “Change this look” box (card 2)); unchanged (byte-identical): Editorial, Custom Design · adjustments [...]`.
- **Test:** `scripts/card-edit-e2e.mjs <url> <outdir>` runs round 1 with no note and checks that every card has its box, including on a phone. It then makes three edits:
  - the middle box: "make the image daylight and raise text contrast" gives the same name, the same hero bytes, 3 chips and "daylight" in the Changed line, with no new photo;
  - Custom Design's box: it stays Custom Design, with the same hero;
  - Bob's exact words in the middle box: it switches to Bold Photo with the same photo.

  After every edit, it checks that the other two cards are byte-identical. Unit tests are in `card-edit.test.ts`.

### Round 8b: the box where Bob looks, and a build stamp

Bob on aceee96: "It still doesn't have the what would you change box in the renderings. You can remove the images in the Custom design and place a box there as well."

- **Why he likely missed it:** in aceee96 the box was only on the small cards, at the very bottom of each card, under the long details (photo credits, layout, "How your request was used"). On a tall card it sat below the fold, and the Custom Design card was the tallest because of its two thumbnails. The full-size rendering under the cards (the "Choose this look" bar and the live page) had no box at all, only a "Change something" link to the shared box at the bottom. The box needed no refine, flag or special state: it rendered on every card in round 1, as long as the looks came from a live run (`facts`) and no look had been chosen and sent yet.
- **Placement:** the box is now labelled **"What would you change?"** (with "(<style> only)"). It keeps the placeholder "e.g. make the photo daylight, more contrast", has a 2 px primary border and a light tint, and sits right under each card's description and colors, so it is visible without scrolling. The e2e checks that the box ends within the first 1000 px of each card.
- **Custom Design card:** the two thumbnails ("Design · Grok Imagine" and "Built page · Grok") and their captions are gone. The box takes their place, as on the other cards. `design_mockup_url` still goes to Formcarry and the webhook (`look.custom.mockupUrl`), and the `[imagine]` / `[design]` logs are unchanged.
- **Full-size rendering:** the look being previewed gets the same box (`data-preview-edit`) between its "Choose this look" bar and the live page. It edits only that look, like the card's own box. The preview pages themselves (`/made/<id>`, "Open full site") ship no JavaScript, so they have no box.
- **Phone:** under 420 px wide, the field and the Change button stack. The button is primary-colored, at least 6.5rem wide and 44 px tall, with `whitespace-nowrap`, so its label always shows (the e2e checks the label text and size at 390 px).
- **Build stamp:** the site footer shows `Build <short commit> · <build time> UTC` (`data-build-stamp`). It comes from `BUILD_COMMIT`, `VERCEL_GIT_COMMIT_SHA` or `GITHUB_SHA`, else `git rev-parse --short HEAD`, read at build time (`vite.config.ts` `define: __BUILD_STAMP__`). With `npm run dev`, it is read when the server starts.

### Round 9b: photo changes never "change" to the same photo; keys, timings, Google optional

Bob's real run (paulsvalley, no SERPER key) typed "change the photo to one of the brick streets, maybe Pine Street"
in Editorial's box and got "new photo: closest to brick street" with the SAME welcome-sign photo. Causes, in plain
words, and the fixes:

- **The current hero wasn't recognised.** It was a site photo stored without its address, its alt text was just the
  town name, and it was a WebP (no image hash: only JPEG/PNG are hashed). So none of the old checks matched it.
  Now (`sameAsCurrent`, photo-request.server.ts) the current hero is removed **before ranking** by: its exact URL,
  its normalized URL (sizes / query stripped: `?format=750w` = `?format=1500w`), its exact bytes (sha1), its image
  hash, or its specific caption. Site photos now store their `sourceUrl`. A last guard drops a pick whose bytes equal
  the current hero. Unit test "Bob's exact case" reproduces it.
- **"Closest match" swaps are gone.** A photo that doesn't show the request is never used as the "new" photo. With no
  real match the card says "Couldn't find a brick street / Pine Street photo, so I kept your current photo"
  (label "same photo (no brick street found)"), or:
- **An Imagine illustration** of the request when one makes sense (places, scenes, things; not people, logos, signs,
  menus or "our …" things): "Art: brick street, illustrated by Grok Imagine (not a real photo of Pine Street)",
  label "art: brick street (illustrated)". The prompt asks for a clearly illustrated subject and never names the
  street. Off with `PREVIEW_REQUEST_ILLUSTRATION=0`.
- **Weak matches.** A caption whose main subject names the request while vision says "no" is logged as a weak match
  and used only after real matches ("new photo: its caption says brick street …, but it may not show it clearly").
  A passing mention ("a water park with … a brick wall") is not a match.
- **The deep crawl is used for photo changes too**: all usable site photos ≥800px wide (up to 30), not the old 7;
  up to 16 are shown to vision.
- **Round 1 without Google**: a look with no passing site photo now gets the signature graphic / Imagine art even
  when SERPER_API_KEY is unset (before, bob.me's failed blog cover was used on every look in that case).
- **Google is optional for round 1 too.** Before, the round-9 site-photo vision gate and assignment only ran when
  SERPER_API_KEY was set, so Bob's preview never used them. Now they run without Google. When the key is missing
  the server logs once `[photo-search] Google Images disabled: SERPER_API_KEY not set`; nothing in the UI.
- **Keys at a glance**: once per server instance, `[env] keys present (true/false only): XAI_API_KEY=… SERPER_API_KEY=…
  REPLY_WEBHOOK_URL=… REPLY_WEBHOOK_KEY=… PHOTO_SEARCH_PROXY=… · running as: workspace preview | published app`.
  Values are never printed.
- **Time caps and timings**: the site read is hard-capped at 25 s (homepage 15 s max; photo pages only with ≥5 s
  left); the site-photo scan is hard-capped at 12 s (downloads still running are dropped, not waited for). New
  `[timing]` lines: `read <host>` (homepage, linked pages, photo pages, stylesheets), `photos` (site photos, vision
  gate), `directions` (plan, looks, photos), `look N` (photos stored, built in), `photo request`, `refine`.
  Bob's f6c6f14 run never finished: the crawl was budgeted at 35 s (homepage 20 s) with no leftover-time gate on
  the photo pages, and the photo scan (15 s) waited for in-flight downloads. On a slow site those stacked with
  the Custom Design request (up to 150 s) and could hit the host's 180 s limit. The caps above keep the read
  well under that; the `[timing]` lines show which phase used the time.

### Round 9: the first round uses the site's own pictures (any business)

Bob's Pauls Valley run showed Editorial and Dark Premium with Google Images photos even though the site has
plenty of its own; only Custom Design used one. Round 1 now looks through the site first for every look. Nothing
is tied to a particular site, business or keyword: the crawl is generic, and the vision model judges what is
appealing and on-topic for the business type it detected.

- **Crawling deeper** (scrape.server.ts, site-art.ts):
  - Up to 10 key pages (about, gallery, services, menu, events…), then a second hop to up to 4 photo pages
    linked from them (gallery / photos / portfolio / parks / attractions / events / rooms / projects…).
  - Every picture form counts: `img` src and the largest `srcset` entry, `picture/source`, CSS
    `background-image`, `og:image` / `twitter:image`, lazy attributes (`data-src`, `data-lazy-src`,
    `data-original`, `data-bg`, `data-bg-src`…), and links straight to full-size `.jpg/.png/.webp` files.
  - Logos, icons, social badges, sprites, tracking pixels, SVG/GIF/ICO and declared sizes under 200px are skipped.
- **Measuring** (site-photos.ts, site-photos.server.ts `scanSitePhotos`): up to 40 candidates, 6 at a time,
  15 s budget, cached 15 minutes per site. Squarespace / Shopify / WordPress full-size variants are tried first.
  Usable = at least 640x360; hero-sized = at least 800px wide landscape, or 1000px square / portrait.
  Transparent PNGs are cutouts, not photos. Duplicates (same picture at another size) collapse to the biggest.
  Log: `[photo-search] site photos: read N pages, X pictures seen, Y candidates, Z usable photos (≥640px),
  H hero-sized …` plus one `site photo HERO|section WxH “label” url` line each.
- **A lower bar for the site's own photos**: the vision gate passes them at 5/10 (Google needs more) and rejects
  only truly bad ones (blurry, screenshots of text, watermarked stock, blog cover graphics, off-topic).
  A photo under 1400px wide gets the "small" treatment: a light duotone, a gradient overlay and a framed width.
- **A different photo per look**: the site photos are ranked by the vision verdict and shared out between
  Editorial and Dark Premium, one each (the photo the assignment gave the look, else the best free one). When there
  are fewer good site photos than looks, a look is not given a repeat: it gets the signature graphic below or
  Grok Imagine art. The Custom Design builds with Imagine from all the site's own assets, so it may use a photo a
  template look also leads with (a one-photo site). Supporting sections use the remaining site photos.
- **Google Images is the last resort** for template looks: Imagine first, Google only if Imagine fails. Each
  fallback logs why, e.g. `[photo] look 2: no hero-sized photo on your site → Grok Imagine art (Google Images
  only if Imagine fails)`.
- **Signature graphic reimagined** (signature-hero.server.ts): when a site has no hero photo but one strong
  graphic (a mascot, an illustration, a rocket…), Imagine gets it as a reference image and makes a cinematic
  hero version with the same identity and colours. The original is the fallback. Only PNG/JPEG/WebP are used
  (an SVG icon sprite is not a signature). The logo is used this way only when the site has no usable photo at
  all. Card: "Art: your rocket, reimagined by Grok Imagine". Turn it off with `PREVIEW_SIGNATURE_HERO=0`.
- **Card line**: "Photo: your site's own (“label”) · 30 photos found on your site, 4 used here".
- Tests: `site-photos.test.ts` (srcset, page art kinds, filtering, full-size URLs, size classes, cutouts,
  assignment before Google, card lines, signature subject and prompt). e2e with the stand-in AI on a town site,
  a restaurant, bob.me, a plumber and a text-only blog.

### Round 8c: "change the photo to one of the brick streets, maybe Pine Street"

Bob typed that in Editorial's box and got "Editorial · new photo: downtown Pauls Valley", a generic town photo.
The cause had three parts:

- The wording rules didn't see "change the photo to …" as a request for a new photo.
- So the AI planner's one-line summary was used, and it had turned his words into the town's generic subject,
  "downtown Pauls Valley". That is the same query round 1 used.
- The edit's photo search had no subject check and no way to skip the current photo.

Now a new-photo request keeps the owner's own subject. The same logic covers other wordings, e.g. "a photo of
our blue truck", "the patio at night", or "swap the hero image for the courthouse":

- **Reading the request** (`readPhotoRequest`, look-edit.ts): the subject is "brick streets" and the named
  place is "Pine Street". The text after "maybe / like / or" is read as a named place.
  - `mergePhotoRequest` puts the owner's words first. The planner's subject is used only when it shares a
    content word with what the owner typed. Its "downtown Pauls Valley" is logged and dropped.
  - Lighting and contrast tweaks ("a photo with more contrast", "make the image daylight") are still
    adjustments, not new photos.
- **Searching specific first, then looser** (`photoRequestQueries`):
  - `"Pine Street" Pauls Valley brick`
  - `"Pine Street" Pauls Valley Oklahoma`
  - `"brick street" Pauls Valley Oklahoma`
  - `brick street Pauls Valley`
  - `brick street Oklahoma`
  - `brick street`

  It never falls back to the town's generic query. It stops early once a few photos match by their titles.
  Each query writes a `[photo-search] q=…` line.
- **Own photos first** (`findRequestedPhoto`, photo-request.server.ts): the site's own photos and the photos
  the other looks already show are checked too. A matching one beats Google.
- **Vision judges the subject** (`judgeSubject`): for each photo it answers whether the photo shows the named
  place, the subject, or neither, plus a 1-10 hero rating (minimum 5) and a few words on what it shows.
  - A photo that shows the request beats a prettier one that doesn't.
  - Without vision, the caption decides.
- **Never the same photo**: the current hero is excluded by URL and by perceptual hash (≤10 bits). Near-duplicates
  of each other are collapsed.
- **Honest wording**: the change line comes from `photoOutcomeNote` and the card label from `photoVariantLabel`.

  | Result | Card label | Change line |
  |---|---|---|
  | Named place found | `new photo: brick street (Pine St)` | — |
  | Subject found, named place not | `new photo: brick street (no Pine St found)` | "couldn't find Pine Street; used a brick street photo (…)" |
  | Nothing shows the subject | `new photo: closest to brick street` | "no brick street photo found; used the closest match: …" (taken from the subject searches, not a random site photo) |
  | Nothing found at all | — | the current photo is kept, and the line says so |

- **Logs**:
  - `[refine] photo request: subject “brick streets”, named “Pine Street” · planner said “downtown Pauls Valley” (kept the owner's words)`
  - `[photo-search] requested photo …`, then one `q=` line per query
  - `[photo] candidate …` for each photo checked, with its vision verdict
  - `[photo] requested “brick street (Pine St)” -> …` with the pick and the card line
- **Tests**:
  - `src/lib/preview/photo-request.test.ts` covers parsing, the merge, query order, the label, caption
    matching, honest notes, specific-first search, named over prettier, the quality minimum, skipping the
    current photo or a near-duplicate, own photos first, the closest match, and keeping the photo when nothing
    is found.
  - `scripts/card-edit-e2e.mjs` step 5 types Bob's sentence in Editorial's box. The mock search has nothing for
    Pine Street, so the expected result is a different brick-street hero labelled "brick street (no Pine St
    found)", the "couldn't find Pine Street" line, and the other cards byte-identical.

### Editing one look from feedback ("Make Dark Premium lighter", "Use editorials picture on dark premium")

When the refine feedback names a look, that look is EDITED in place instead of making three new ones (`previewRefine`, `look-edit.ts`, `look-edit.server.ts`). **Only that card changes**: same place, same name. The other two cards stay exactly as they were (same ids, same renders). The banner reads "Edited Dark Premium only, as you asked (round n of 5) … The other looks are unchanged."
- A look can be named by:
  - its name or style label, case-insensitive and fuzzy: "DARK PREMIUM", "dark-premium", "premium", "editorials", "editoral", "Playfull", "the bold one". Older sessions with creative names ("Night Courthouse") still resolve by those names AND by the style label;
  - a possessive ("editorial's picture");
  - its position ("the first one", "the middle one", "the last look");
  - a description ("the dark one", "the blue one");
  - "this one" / "the one I'm previewing" (the look open in the preview).
- A style word used as a wish is not a look: "make it more playful" names no look, so it makes 3 new looks.
- `findLookRefs` lists every look mentioned, with its position in the text. `findTargetLook` picks the target. The Grok planner (`planEdit`) can only confirm a look the owner's words refer to (name, label or position); it no longer needs the creative name.
- **Cross-look edits** (`findBorrow`): "Use editorials picture on dark premium", "use the first one's photo on the middle one", "give dark premium the editorial colors", "Dark Premium with the photo from Editorial", "put Playful's fonts on Editorial". The look after on/onto/to/for/into (or after give/make) is edited; the possessive one or the one after "from" lends its asset:
  - **photo:** the lender's hero image bytes and credit are copied; no new search and no AI image;
  - **colors:** the lender's palette becomes the new base, so later tweaks are computed from it;
  - **fonts:** the lender's fonts.

  The edited look keeps its layout, copy and name. Its card says "Changed: photo from “Editorial”". A borrow alone gives one look. A borrow plus a tweak ("…and make it lighter") gives three.
- Supported tweaks (`{type, amount: slight|medium|strong}`): lighten, darken, more/less contrast, saturate/desaturate, warmer/cooler, bigger/smaller text, more/less spacing, more color, less busy, daylight (round 8). The planner returns `{targetLook, adjustments, copy, photo}`; a regex reading handles common phrases ("a little too dark" = lighten slight) and is used when AI is off or fails.
- Everything else is kept: name, layout, fonts, photo, copy, sections. The palette is recomputed from the ORIGINAL palette plus cumulative levels (no drift over rounds): background/surface lightness moves in OKLCH, then text, muted and primary colors are re-picked to keep WCAG AA (text ≥ 7:1 where it was, never < 4.5:1). Over the hero photo, the dark overlay is reduced and the photo filter gets `brightness()`; the overlay never goes below what keeps white text at 4.5:1 over the measured photo (80th-percentile luma of the text area).
- A tweak gives three variations: as asked ("Dark Premium · lighter"), a half step more ("a bit lighter still") and a full step more ("noticeably lighter"). They replace ONLY the target card. The card shows the first one, with three chips to switch between them in place (`data-look-variants`). The name does not change. A green line says what changed ("Changed: lightened backgrounds and photo overlay (slight)").
- When a look is named but nothing applicable is asked ("Night Brick is great"), the box says so and the round is not used. Feedback that names no look keeps the old behavior (3 new looks with the feedback).
- Log lines:
  - `[refine] "<feedback>" -> edit Dark Premium only (style “dark-premium” | named “…” | photo from “Editorial” onto “Dark Premium”); unchanged: Editorial, Playful · adjustments [...] · borrow photo from Editorial · read by AI planner|wording`;
  - one line per edited look: `[refine] edited “Dark Premium” (old -> new id) lighter · borrowed photo from “Editorial” (id): {"lighten":1} · bg #0e1013->#1e2023 · scrim 0.774 (AA floor …) · photo brightness 1.11`.
- Copy/photo changes in an edit ("same but use the depot photo") use Google/web photos only; no AI image is generated in an edit.

### Every round is new (creativity)

Bob: "The first look is the same still. no creativity … all it did was change the order." Each round now draws from a wider pool and avoids what the owner has already seen:
- **Random seed per round** (`previewDirections`):
  - archetypes are picked at random from the business's five best fits (`archetypesFor(facts, variation, {seed, archetypes})`);
  - hero treatments are shuffled; the AI art director's pick is only one candidate, because a real model gives each archetype the same hero every time.
- **Six hero treatments** (`look-variety.ts`, CSS in `theme.ts`):
  - caption: split hero, captioned photo;
  - cinematic: full-bleed photo, side overlay;
  - collage: tilted frame, stamp;
  - **poster:** full-bleed photo, giant centered headline at the bottom;
  - **panorama:** big type first, a 21:8 photo strip under it;
  - **framed:** large photo on the left, copy card overlapping it.

  Header, buttons, footer and the below-the-fold recipe are kept distinct within a round.
- **The previous rounds** (`round-memory.server.ts`): the browser sends the ids of every look shown this session; the server reads them itself and passes them on:
  - the last round's archetypes, hero treatments, names and palettes go to `directionsFor`. A regenerated round prefers at least 2 new styles and new treatments. The AI prompt lists what was already shown ("must look VISIBLY different"). A palette too close to an earlier one gets its hue turned;
  - every earlier hero photo (image URL / source page plus a perceptual hash) goes in `plan.avoidPhotos`. Requested-scene photos ("brick streets") look 6 results deep and put already-shown photos last. A log line reads `[photo] look N: K photos shown in an earlier round moved behind M new ones`. Proactive searches give shown photos −8 ("shown in an earlier round") and add two more town queries (courthouse, landmark, aerial view, park, depot, festival).
- The owner's note is still honored in every round (the requested scene stays the subject).
- Log line per round: `[looks] round (regenerated): “Playful” playful/poster · … · previous round: “Editorial” editorial/caption · …`.

### Three looks that really differ

Bob's Pauls Valley run (on a2b92fb) gave three looks that were the same except for the wording. Each one had the same Wikimedia photo as a full-bleed hero, in the same layout. `look-variety.ts` now keeps the looks apart. `directionsFor` runs `diversifyDirections`, so each look gets its own:
- **hero treatment** (`heroStyle`), chosen by archetype in priority order:
  - **caption** (editorial / minimal): split hero with the text on a light panel and the photo in a frame with a caption (title and credit);
  - **cinematic** (dark premium): full-bleed photo with a strong side overlay, a low focal point and a tighter crop;
  - **collage** (playful / bold / warm): a color-block hero with the photo in a tilted, rounded, duotone frame, a second photo tile and a big stamp.
- **header:** solid bar, transparent overlay, or centered logo with the menu below. An overlay header with no photo behind it becomes a dark bar.
- **button shape:** square, outline or pill.
- **footer:** columns, minimal or statement.
- **below-the-fold recipe** (`layout`), applied by `arrangeSections` (it adds no new copy or facts):
  - *editorial*: statement, then a list of services, then the feature section;
  - *showcase*: feature, then a photo mosaic (gallery) when there are 3 or more photos, then image cards or a bento grid of up to 5 services;
  - *bold*: a services ticker (marquee), icon tiles, then process.

The AI art director is asked for a different `heroStyle`, header, buttons and footer for each look. If two looks still clash, `diversifyDirections` re-rolls. `lookSignature` and `similarities` compare the hero variant, header, buttons, section sequence and photo treatment. The tests require that the three Pauls Valley looks share none of these. The signature is saved in the preview record as `trace.layout`, and the card shows a "Layout: …" line.

**Several photos of the requested scene.** `findWebPhotos` returns up to 3 matching free-license photos (the site's own match counts first). The best match goes to the cinematic look, the next to the caption look, then the collage look (`photoRank`). With fewer photos than looks:
- when AI images are on, the extra look gets an AI photo of the scene;
- otherwise it shows the same photo in its own treatment.

Each look's "Photo:" line and footer credit name its own photo. A photo filed under the town's historic district (title or category) counts as downtown.

### When the form is sent

**Nothing is sent when the looks appear.** The email, website and note are collected up front and held in memory.

**When the visitor presses Choose this look**, the app does three things in order:
1. Builds every page of the chosen look.
2. Takes a picture of that look's homepage.
3. Sends Formcarry **once**.

The overlay reads "Building your site and preparing your picture…". It then switches to a green **"Sent! Check your email."** banner.

**One submission per preview.**
- The send is claimed before the first await, so double clicks are ignored.
- Choosing a different look later builds it, but does not send again.
- If Formcarry fails, the visitor can press Choose this look again to resend.
- If the visitor leaves without choosing, nothing is sent. Bob accepted this.

**What Formcarry receives:**
- `preview_url`: the chosen look's full site.
- `preview_pages`: that site's pages.
- `chosen_look`: the name and style, for example `Front Page (Bold photo-led)`.
- `change_requests`: the numbered feedback rounds, if any. The `note` field still carries the original note.
- `picture`, `picture_url` or `picture_error`: see below.

**The Create New Site wizard** follows the same rule when it shows looks. If no looks could be built, it sends the brief right away, as before, without a picture.

### Email Bot's instant reply (server webhook)

When the visitor presses Choose this look, the **app server** also posts the submission as JSON to Email Bot's instant-reply webhook (Email Bot routine "Instant reply to reimago.ai submissions"). This is in addition to the Formcarry submission, which is unchanged: same fields, still sent from the browser with the picture attached.

How it is sent:
- The browser calls `notifyReplyWebhook` (`src/lib/reply-webhook.functions.ts`) right after the picture is stored. It does not wait for the answer, so "Check your email" never depends on it.
- The server checks that the look exists on it and is rate-limited per IP (20 per hour). It then posts with `sendReplyWebhook()` (`src/lib/reply-webhook.server.ts`).
- The webhook URL and key stay on the server and never reach the browser bundle.

The payload is one JSON object; every value is a string:

| Field | Value |
|---|---|
| `submission_id` | `reimago-<made id>-<look archetype>`, e.g. `reimago-9fbd8da257ef404c-editorial`. Set by the server from the chosen look and the same on every retry, including when the visitor presses Choose again after a Formcarry failure, so Email Bot can dedupe. Also sent as the `Idempotency-Key` header. |
| `email`, `website`, `note` | The form's values; `website` is the bare domain, as in Formcarry. Create mode sends the brief's domain and its "anything else" text. |
| `preview_url`, `preview_pages` | Same text as the Formcarry fields: one `Title: URL` per line. |
| `chosen_look`, `change_requests` | Same text as the Formcarry fields: change requests are numbered rounds, `""` when none. |
| `picture_url` | `<app>/made/<id>/img/capture`, only when the server has the stored picture. |
| `picture_error` | Set when no picture was stored. |
| `submitted_at` | ISO time, set by the server. |

Request rules:
- Headers: `Content-Type: application/json` and `Authorization: Bearer <REPLY_WEBHOOK_KEY>`. If the key already starts with a scheme word and a space (`Bearer …`, `Basic …`), it is sent as-is.
- Timeout: 10 s.
- Retry: once, on a network error, timeout or 5xx. A 4xx is not retried.
- Logs: one line per attempt, with the submission id, the webhook host and the status code (`[reply-webhook] sent … : 200` or `… failed: 503 (attempt 1)`). The key and the URL path are never logged.
- If `REPLY_WEBHOOK_URL` or `REPLY_WEBHOOK_KEY` is unset (or the URL is not https), nothing is sent and nothing is logged. Plain http is accepted only for localhost tests.

Tests:
- `src/lib/reply-webhook.test.ts` runs against a local endpoint and covers the header, the as-is scheme, the payload, skipping, retry rules, the timeout, no key in the logs, and dedupe-id stability.
- `scripts/reply-webhook-e2e.mjs` (with `scripts/mock-reply-webhook.mjs`) runs the real flow: Formcarry is intercepted and fails once, and the visitor presses Choose again. Both webhook posts carry the same `submission_id`, and the mock checks the Authorization header and every field.

### The lead picture (Formcarry `picture`)

The lead email also gets a PNG of the **chosen** look's homepage, as the old flow did. It is taken after the look is built, so it shows the polished homepage.

- **How it's made.** The browser does the capture; no server-side Chrome is used, so it works on Vercel.
  - The page is loaded in a hidden, same-origin, unsandboxed iframe at 1280px wide (`src/lib/preview-picture.ts`). The visible preview iframes are sandboxed, so their DOM can't be read.
  - It waits for images and fonts, and freezes animations so the finished state shows.
  - `modern-screenshot` then draws the top of the page to PNG at 1280×(page height, at most 2400). If that comes out at 9.5 MB or more, it draws 1280×720 instead.
  - The overlay shows "Preparing your picture…" while this runs, usually 1–3 seconds. It gives up after 30 seconds.
- **No tainted canvas.** Preview photos are already same-origin (`/made/$id/img/…`). Anything the page still hotlinks, mainly SVG logos, is fetched through `/made/$id/img/remote?u=…` (`remote-image.server.ts`). Google Fonts are CORS-enabled and embedded by the library.
  - The proxy only fetches URLs that the stored homepage itself shows as `<img src>`. It is not an open proxy.
  - Fetches go through `fetchLogoFile`, which refuses private hosts and caps files at 2 MB.
- **Fields sent.**
  - `picture`: the PNG, named `<domain>.png`.
  - `picture_url`: a stored copy at `/made/$id/img/capture`, when it was 4.2 MB or less as base64. Above that, the file is only attached.
  - `picture_error`: the reason, if the capture failed. The lead is still sent, with the links, and capture never blocks it.
- **Formcarry plan.** The plan must allow file uploads. The old flow already relied on this.

### The section library

The AI never writes HTML. It returns JSON sections, and trusted templates render them:

- hero variants: split, full-bleed photo, oversized type, and the inner-page hero;
- stat bar and marquee;
- icon / image / bento / list service grids;
- feature split and process steps;
- a CSS-only scroll-snap review carousel and before/after;
- gallery, statement quote, `<details>` FAQ, gradient CTA band, and a contact block with a map link and the Formcarry form;
- three footer styles.

Design tokens become body classes: archetype, radius, button style, header, footer and motifs (grain, thin rules, oversized numbers, diagonal cuts, blobs, underline marks, grid lines, glow, outlined type, stamp badges). Scroll-reveal animations are pure CSS (`animation-timeline: view()` inside `@supports`) and are off for `prefers-reduced-motion`. Preview pages still have no JavaScript (`script-src 'none'`).

### Safety (unchanged rules, enforced in `sections.ts`)

- Text is escaped; `*word*` becomes emphasis and is the only markup the AI can use.
- Phone numbers and emails not found on the real site are removed.
- Stat numbers must appear in the scraped facts or the stat is dropped.
- Reviews must match a real testimonial or they are replaced by the real ones (or the section is dropped).
- Images must be stored images for that site. Links must be pages of the preview.
- The contact form posts to Formcarry with `mode=preview_contact`, `preview_site`, `preview_id` and the `_gotcha` honeypot.

### Host time limits

Serverless functions cannot keep working after they respond, so there is no background job. Instead the browser drives four short requests:

1. read;
2. directions;
3. three looks in parallel;
4. finish.

Each request is budgeted to about 85 s (`PREVIEW_STEP_BUDGET_MS`); slow AI or image calls fall back to deterministic sections, real photos or placeholders. On Vercel set the function `maxDuration` to at least 90 s (the Pro plan allows 300 s). The Custom Design steps (`previewImagine`, then `previewCustom`, mockup 60 s + vision build 90 s + art) need **at least 160 s**, so set `maxDuration` to 160–300 s for the server functions when the Custom Design is on. Expected real-AI timing (not yet measured with real keys):

- 20–40 s for looks (dominated by image generation);
- 20–40 s for the finish step.

## Create a New Site: domain first

Step 1 of the wizard asks **"Do you already have a domain?"**

- **Yes.** The visitor types a domain. It is validated and normalized: lowercase, no `https://`, `www.`, path or port. It is stored with `domain_status: "owned"`.
- **No.** The visitor searches a name. The existing LogicBoxes availability check (`checkDomainName` → `logicboxes.server.ts`, read-only) lists .com/.net/… results.
  - **Select** on an available result stores it with `domain_status: "selected-pending-checkout"`. The rest of the flow treats it as theirs.
  - **Nothing is registered or charged.** Real registration will go through the Webhero cart; see `DOMAIN_CHECKOUT_URL` and `TODO(webhero-cart)`.
  - **If LogicBoxes is unreachable,** or when `PREVIEW_MOCK=1` is set or the token is missing, the wizard gets a clearly labelled sample after one quick attempt instead of an error.
- **Let AI decide** suggests three domain ideas, and tapping one checks it.
- **Skip** records "Decide later".

The chosen domain:

- shows as a badge on every later step;
- offers the business name (and, if owned, the existing site);
- appears first on the review screen;
- becomes the preview's site address (`facts.host`);
- is sent with the lead as `domain`, `domain_status` and the `website` field.

The old domain step (step 12) is gone. Wizard answers are kept in memory only (see "Reloading starts fresh").

## Environment variables

| Variable | Needed | What it does |
| --- | --- | --- |
| `XAI_API_KEY` | yes (for AI) | Grok text model (plans, directions, sections, critique) and Grok Imagine images. |
| `Onesite_Domains_API` | yes | Webhero proxy token for domain search (unchanged). |
| **`DOMAIN_CHECKOUT_URL`** | no | Unused by default. A future hook for the Webhero cart (alpha.webhero.com) that will register a domain the visitor selected in the wizard. See `src/lib/domain-checkout.server.ts`. Nothing is ever registered today. |
| `AI_PROVIDER` | no | `xai` (default), `openai`, or `mock`. |
| `AI_MODEL` | no | Override the text model (default `grok-4.5`; `gpt-4.1-mini` for openai). |
| `OPENAI_API_KEY` | only for openai text or images | |
| **`AI_REASONING_EFFORT`** | no | `low` (default), `medium`, `high`, or `none` (don't send). Sent to reasoning models (Grok 4.5+). |
| **`AI_FALLBACK_MODEL`** | no | Faster model for one retry when the main model fails or times out (default `grok-4.20-0309-non-reasoning` for xAI; `none` disables). |
| `AI_BASE_URL` | no | Any OpenAI-compatible text endpoint. |
| **`IMAGE_PROVIDER`** | no | `xai` (default, `grok-imagine-image-2.0`), `openai` (`gpt-image-1`, needs `OPENAI_API_KEY`), or `none` (real photos + placeholders only). Turns into `none` automatically when the key is missing or `PREVIEW_MOCK=1`. |
| **`IMAGE_MODEL`** | no | Override the image model. |
| **`IMAGE_BASE_URL`** | no | OpenAI-compatible image endpoint base (e.g. a proxy). |
| **`PREVIEW_CRITIQUE`** | no | `auto` (default: screenshot + vision when Chrome exists, else HTML/section critique), `vision`, `html`, or `off` to skip the polish pass. |
| **`CRITIQUE_MODEL`** | no | Model for the critique call (must accept images for `vision`; default = `AI_MODEL`). |
| **`CHROME_PATH`** | no | Headless Chrome/Chromium for the screenshot. Standard Linux paths are checked automatically; Vercel has none, so the critique there is text-only. |
| **`PREVIEW_STEP_BUDGET_MS`** | no | Time budget per step (default `85000`). |
| `PREVIEW_MOCK` | no | `1` = no AI calls; looks are composed from the facts with three preset directions, labeled MOCK PREVIEW. |
| `DATABASE_URL` | recommended in production | Stores preview sites (`preview_sites`) and their images (`preview_images`) in Postgres, created on first use. Without it, files go to `PREVIEW_STORE_DIR` and disappear on serverless restarts. |
| **`REPLY_WEBHOOK_URL`** | no | Email Bot's instant-reply webhook URL (routine "Instant reply to reimago.ai submissions"). The server posts each "Choose this look" submission there as JSON. Unset: not sent. |
| **`REPLY_WEBHOOK_KEY`** | no | That webhook's key; sent as `Authorization: Bearer <key>` (as-is if it already starts with `Bearer `/`Basic `). Server-only secret: set it in the host's environment settings, never in code or chat. Unset: not sent. |
| **`PREVIEW_VISION_MODEL`** | no | Model for the "keep" vision fallback (which of the site's pictures shows the subject). Defaults to the main AI model. |
| **`SERPER_API_KEY`** | no | Serper key ([serper.dev](https://serper.dev)) for Google Images preview photos (first web source for photo requests and for heroes when the site has no good photo). Server-only secret on the **master** server: set it in the host's environment settings, never in code or chat. Unset: no Google Images. |
| **`PHOTO_SEARCH_PROXY_URL`** | no | White-label clones without a Serper key: the master's endpoint, e.g. `https://<master>/api/photo-search`. Used only together with `PHOTO_SEARCH_PROXY_KEY` and only when `SERPER_API_KEY` is not set. |
| **`PHOTO_SEARCH_PROXY_KEY`** | no | Shared key for that endpoint. On the master it switches `/api/photo-search` on (with `SERPER_API_KEY`) and is what callers must send as `Authorization: Bearer <key>`; on a clone it is the key it sends. Server-only secret. |
| **`PHOTO_SEARCH_WEAK_HEROES`** | no | `1` also replaces a small/weak own hero photo with a Google Images one when search is configured. Off by default. |
| **`PHOTO_SEARCH_RATE_PER_MINUTE`** / **`PHOTO_SEARCH_RATE_PER_HOUR`** | no | Master endpoint limits per caller IP (defaults 30 / 300). |
| **`SERPER_BASE_URL`** | no | Tests only: point Serper calls at a mock (`http://localhost:9997`; plain http is allowed for localhost only). Default `https://google.serper.dev`. |
| **`PREVIEW_WEB_PHOTOS`** | no | `0` turns off the free-license web photo search (Openverse, Wikimedia Commons) used when the owner's note asks for a photo of something. On by default, also in mock mode. |
| **`PREVIEW_CUSTOM_LOOK`** | no | `0` turns off the from-scratch "Custom Design" look (third card); on by default when AI is available. |
| `PREVIEW_IMAGINE_DESIGN` | no | `0` skips the Grok Imagine mockup (the custom page is designed from the text brief only). On by default when an image provider is set. |
| `PREVIEW_IMAGINE_TIMEOUT_MS` | no | Mockup time limit (default 60000). |
| `PREVIEW_IMAGINE_RESOLUTION` | no | Mockup resolution: `1k` (default, $0.04), `1.5k` or `2k`. |
| `PREVIEW_IMAGINE_LOGO` | no | `0` draws the mockup without the logo as reference (`/images/generations` instead of `/images/edits`). |
| `PREVIEW_CUSTOM_BUILD_TIMEOUT_MS` | no | Vision build time limit (default 90000). |
| `PREVIEW_CUSTOM_BUDGET_MS` | no | Budget of each Custom Design request (default 150000); keep the host's `maxDuration` above it. |
| `PREVIEW_VISION_MODEL` | no | Model for the vision build (default `AI_MODEL`). |
| `PREVIEW_IMAGINE_REFS` | no | `0` sends no site assets to Imagine as reference images (default: logo, signature graphic and own photos, ≤5). |
| `PREVIEW_FIDELITY_MIN` | no | Custom Design fidelity score (0-100) under which the build gets one repair pass with the differences (default 60). |
| `PREVIEW_STORE_DIR` | no | File storage folder when there is no `DATABASE_URL` (default: OS temp dir). |
| `CURSOR_API_KEY` | no | When set, "Send to Cursor" starts a Cursor agent with the preview links; otherwise the button downloads a brief. |

## Code map

- `src/lib/ai-provider.server.ts`: every AI call: text (`chatJson`, with image parts for vision) and `generateImage`. `src/lib/ai-json.ts`: JSON extraction and error types.
- `src/lib/preview/logo.ts` / `logo.server.ts`: logo background detection, trimming, reversed copies, and per-surface treatment.
- `src/lib/preview/scrape.server.ts`: crawler, fact extraction, inspiration scan (SSRF-guarded, capped).
- `src/lib/preview/design.ts`: curated fonts, archetype presets, palette contrast fixes, `normalizeDirection`.
- `src/lib/preview/sections.ts`: section types, validation (`normalizeSections`), mock composer, HTML templates.
- `src/lib/preview/theme.ts`: the design-system CSS. `legacy-theme.ts` keeps old (v2) previews rendering.
- `src/lib/preview/images.server.ts`: real-photo selection/storage and generated images.
- `src/lib/preview/look-variety.ts`: makes the three looks different (hero treatment, header, buttons, footer, section recipe), plus the distinctness check.
- `src/lib/preview/image-prompts.ts`: image prompts (the owner's scene first) and the card's photo line. `web-photo.ts` handles place, scene words, search words, matching, licenses, ranking and hero suitability of scraped photos (pure). `web-photo.server.ts` runs the Openverse and Commons search and the download. `google-photo.ts` (pure: queries, filters, scoring, the temporary-photo metadata) and `google-photo.server.ts` (Serper or proxy search, cache, download, vision pick) handle Google Images; `photo-search-endpoint.server.ts` + `src/routes/api.photo-search.ts` are the master's endpoint for clones. `site-art.ts` collects and matches all of a site's imagery and sanitizes inline SVG (pure). `keep-art.server.ts` finds the owner's own picture to keep (words, then AI vision) and checks whether it is a cutout.
- `src/lib/preview/critique.server.ts`: screenshot + critique-and-revise.
- `src/lib/preview/builder.server.ts`: plan, directions, `buildLook`, `finishSite`.
- `src/lib/preview.functions.ts`: server functions `previewRead`, `previewFromBrief`, `previewDirections`, `previewLook`, `previewFinish`.
- `src/lib/preview/photo-queries.ts`: the planner's proactive Google Images queries (clean + no-AI defaults). `hero-brief.ts` (pure: business type -> what a good hero is, off-topic words, search scenes, the generic low-quality list). `hero-pick.ts` (pure: quality bar, pixel stats, perceptual hash, sign/subject words, hero score, mood fit, the three-look assignment) and `hero-pick.server.ts` (decoding photos, the site's photos as candidates).
- `src/lib/preview/look-edit.ts` (pure: which look, which tweaks, OKLCH palette tuning with AA, CSS, labels) and `look-edit.server.ts` (Grok edit planner, photo luma, building the edited looks).
- `src/lib/preview/custom-design.ts` (pure: brief fallback, prompts, HTML/CSS sanitizer, `validateCustom` checks, palette vars) and `custom-design.server.ts` (`creativeBrief`, `designCustom` draft → checks → one repair → fallback, `editCustom`). `render.ts` `customDocument` serves the custom homepage.
- Imagine designer: `mockupPrompt` / `mockupBuildPrompt` / `autoFixContrast` in `custom-design.ts`; `imagineMockup`, `designCustom(site, deadline, mockup)` and the art assets in `custom-design.server.ts`; `previewImagine` / `previewCustom` in `preview.functions.ts`; `generateImage` (`sourceImageUrl`, `guard`, `resolution`) and `imageModelInfo` in `ai-provider.server.ts`. Photo priority: `SITE_BAR` / `barFor` / `assignHeroes` in `hero-pick.ts`; watermark rejection in `google-photo.ts`.
- `src/components/looks-picker.tsx`, `live-preview.tsx`, `home-page.tsx`: UI.
- Routes:
  - `made.$id.ts` and `made.$id.$slug.ts` serve the pages; unfinished looks are sent `no-cache`;
  - `made.$id.img.$name.ts` serves stored images.

## Testing

```
npm run typecheck && npm run build && npm test
# mock mode (no AI):
PREVIEW_MOCK=1 npm run dev
node scripts/live-preview-e2e.mjs https://www.morganplumbingokc.com/ live-preview-shots/morgan 1
# fake creative AI (text + images) on :9999, no keys needed:
node scripts/fake-ai-server.mjs &
XAI_API_KEY=fake AI_BASE_URL=http://localhost:9999/v1 IMAGE_BASE_URL=http://localhost:9999/v1 npm run dev
CHROME_PATH=/usr/bin/google-chrome node scripts/live-preview-e2e.mjs https://www.morganplumbingokc.com/ live-preview-shots/morgan-ai 1
```

`FAKE_PHOTO_INTENT=keep|find|none` sets the fake planner's `photoIntent`, and `FAKE_VISION_INDEX=<n>` sets its answer to the keep vision question (1-based; 0 = none). `FAKE_PHOTO_SUBJECT="red brick streets downtown"` makes the fake planner return that `photoSubject`, to test the planner path. For example, `NOTE="it would be great to see those old red bricks downtown" node scripts/note-photo-e2e.mjs https://www.paulsvalley.com/ <outDir>`. To simulate real-API failures with the fake server, set `FAKE_FAIL=slow|length|badjson|reject-reasoning` (add `FAKE_FAIL_ALL=1` to make the fallback model fail too). `scripts/live-preview-retry-e2e.mjs` records each card's error and can click "Retry with AI". `FAKE_SHAPE=alt` answers in drifted shapes (type under `section`/`component`, CamelCase names, nested `props`). `scripts/create-wizard-domain-e2e.mjs` screenshots the domain-first wizard steps. `scripts/preview-picture-e2e.mjs reimagine|wizard <url|-> <outDir> [lookIndex]` does the following:
- submits the form and checks that nothing reaches Formcarry before a look is chosen;
- double-clicks **Choose this look** on the given look (default 1, the second);
- checks that exactly one request is sent;
- saves the `picture` from the intercepted body.

Set `BREAK_CANVAS=1` to check the `picture_error` path.

`scripts/refine-looks-e2e.mjs <url> <outDir>` tests the note and the refine box. It checks that:
- the cards show the note;
- "Change something" scrolls to the box;
- "Show me 3 new looks" produces three new looks that reflect the feedback;
- nothing is sent until **Choose this look**, which then sends one request with `note` and `change_requests`.

Set `NOTE` and `FEEDBACK` to change the text it uses.

The last argument picks which look to choose (0–2); `APP_URL` points the script at another port. The e2e scripts intercept Formcarry, so no real lead is sent. The fake AI server deliberately returns an invented phone, email, stats and review so you can see the validators remove them.

**Google Images without a real key**: `node scripts/mock-serper.mjs` (port 9997) answers like Serper's `/images`, checks `X-API-KEY` (`mock-serper-key`), logs queries (`GET /log`, `POST /reset`), and returns real Wikimedia image URLs plus decoys (a Shutterstock result, a logo, a 640 px image, a broken URL, a portrait). Run the app with `SERPER_API_KEY=mock-serper-key SERPER_BASE_URL=http://localhost:9997`, then `NOTE="put a picture of the red bricks as the background" node scripts/note-photo-e2e.mjs https://www.paulsvalley.com/ live-preview-shots/serper-mock/paulsvalley-red-bricks`. For proxy mode, run a second "master" dev server with `SERPER_API_KEY`, `SERPER_BASE_URL` and `PHOTO_SEARCH_PROXY_KEY`, and point the clone at it with `PHOTO_SEARCH_PROXY_URL`/`PHOTO_SEARCH_PROXY_KEY`. With the fake AI server the vision step answers too (`FAKE_GOOGLE_VISION=reverse|none`). Unit tests: `src/lib/preview/google-photo.test.ts`.

`scripts/note-photo-e2e.mjs <url> <outDir>` (`NOTE`, default "use the brick streets") submits the form with a note. It screenshots the cards (photo line and "How your request was used") and each look's top. It also takes a footer shot when there is a photo credit, plus full-page shots and side-by-side boards of the three look tops (`05-tops-side-by-side.png`) and full pages (`06-full-pages-side-by-side.png`). Each look's hero image, hero type and credit go in `summary.json`. Formcarry is intercepted and nothing is chosen. Example: `NOTE="Use a photo of the downtown brick streets as background" node scripts/note-photo-e2e.mjs https://www.paulsvalley.com/ live-preview-shots/note-photo-paulsvalley-mock`.

`scripts/refine-edit-e2e.mjs <url> <outDir>` repeats Bob's steps:
1. Round 1 with his note ("use a photo of downtown pauls valley with the brick streets for the background").
2. "Use editorials picture on dark premium". Checks: only the Dark Premium card changes, it keeps its name and layout, its hero bytes equal Editorial's, and it has a "photo from" line.
3. "Make Dark Premium lighter so you can see the image better." Checks: only Dark Premium changes, there are 3 variation chips, a Changed: line, a brighter hero and the same photo; a chip swaps only that card.
4. "Show me something different" (no look named). Checks: at least 2 new styles, at least 2 new hero treatments and at least 2 hero photos not shown in round 1.

It exits 1 on any failed check, writes before/after boards (`03-borrow-before-after.png`, `04-lighten-before-after.png`, `06-round1-vs-regenerated.png`) and writes `summary.json`. Run it with the fake AI server (`FAKE_BOB_ROUND1=1` makes round 1 Editorial / Dark Premium / Playful like Bob's) and the mock Serper. Unit tests: `src/lib/preview/look-edit.test.ts` and `src/lib/preview/refine-target.test.ts` (Bob's two phrases, labels, positions, borrows, round variety).

Round 1 photos: run the app with the mock Serper and the fake AI server, then `SERVER_LOG=<dev log> EXPECT_DISTINCT_HEROES=1 NOTE="" node scripts/note-photo-e2e.mjs https://www.paulsvalley.com/ live-preview-shots/round1-photos`. The mock's round-1 fixtures for the three town queries mix three welcome signs (one of them the same picture at another size, titled "gateway"), a dim park, the historic district, a downtown night street, a brick main street, the depot and the water tower. The check passes when the three heroes are different pictures with three different subjects and none is a sign. Unit tests: `src/lib/preview/hero-pick.test.ts`.

Quality gate (business types): the mock's Pauls Valley pool also has a gravel lot / RV park ranked first by Google, and the live paulsvalley.com site photos include the airport and a library interior. Plumber queries (plumb/bathroom/technician/home) get a van, a pipe diagram, a finished bathroom and a renovated kitchen. Restaurant queries (restaurant/dining/dish/cafe/food) get two menu boards, a dining room and two plated dishes. The fake AI answers the "Rate EVERY photo as a homepage hero" call from the titles (bad words 3, good 8-9, otherwise 5; `FAKE_RATING=none` gives no answer). Run with `FAKE_BOB_ROUND1=1` on the fake AI, then `SERVER_LOG=<dev log> NOTE="" node scripts/note-photo-e2e.mjs <url> <outDir>` for https://www.paulsvalley.com/ (add `EXPECT_DISTINCT_HEROES=1`), https://www.morganplumbingokc.com/ and https://www.cafe501.com/. Unit tests: `src/lib/preview/hero-brief.test.ts`.

Custom Design (from scratch): the fake AI answers the brief, design, repair and edit calls (`scripts/fake-custom-design.mjs`: a realistic page with SVG art per concept). `FAKE_CUSTOM=broken` returns a broken first draft (header nav missing pages, a script, external image/link, onclick, low contrast, a 1400px width) that the repair pass fixes. `FAKE_CUSTOM=broken-always` keeps it broken, so the card falls back to the template. `FAKE_CUSTOM=slow` sleeps 180s, so the draft times out and falls back. After a round, run `CHROME_PATH=… node scripts/custom-look-check.mjs http://localhost:8080 <third card id> <outDir>`. `scripts/refine-edit-e2e.mjs` adds a "Make the custom one darker" step (`CUSTOM_EDIT`) when a Custom Design card exists. Unit tests: `src/lib/preview/custom-design.test.ts` (also the Wolf River Bob regression).

Imagine designer (stand-ins): the fake AI answers image prompts containing "website homepage design" with a sample mockup PNG (`fakeMockupPng`: the brief's colors, header, headline bars, photo area, a rocket when asked, cards). It answers the "MATCH THE DESIGN MOCKUP" vision build with the realistic page plus one `@img:art-1` asset, and the "Illustration / artwork" prompts with art. `FAKE_IMAGINE=fail` makes the mockup fail (text-brief fallback). `FAKE_CUSTOM=lowcontrast` adds `.btn.small{background:#e85d04;color:#fff}` (3.5:1), which the automatic contrast fix must correct without a fallback. The mock Serper returns a Vecteezy decoy for startup/founder queries, which must be skipped as "stock / watermarked". Unit tests: `custom-design.test.ts` (mockup prompts, contrast auto-fix), `photo-priority.test.ts` (site photos win over Google, watermarks), `keep-art.test.ts` (cutout variety).

Custom Design art (round 7, stand-ins): Imagine edits with an `images` array are logged as "edits (N reference images)". Art prompts ("Illustration / artwork for a website section") on `/images/edits` get art (`FAKE_IMAGINE=artfail` fails only the art, on edits and on the generations retry, which tests dropping planned art and the Google last resort). The vision build (`fakeMockupBuild`) uses the planned `imagine art` and the signature graphic (`@img:brand-art`) and returns `regions`. `FAKE_CUSTOM=plain` makes the first build ignore the mockup's dark blocking, so the fidelity check sends it back once. Unit tests: `custom-design.test.ts` (mockup color sampling, fidelity high/low), `photo-priority.test.ts` (signature graphic detection).
