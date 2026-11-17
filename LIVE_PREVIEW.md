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

**The refine box** sits under the cards: "Not quite right? What would you like to see different?" with a **Show me 3 new looks** button.
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

Each request is budgeted to about 85 s (`PREVIEW_STEP_BUDGET_MS`); slow AI or image calls fall back to deterministic sections, real photos or placeholders. On Vercel set the function `maxDuration` to at least 90 s (the Pro plan allows 300 s). Expected real-AI timing (not yet measured with real keys):

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
