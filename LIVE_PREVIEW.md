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

To simulate real-API failures with the fake server, set `FAKE_FAIL=slow|length|badjson|reject-reasoning` (add `FAKE_FAIL_ALL=1` to make the fallback model fail too). `scripts/live-preview-retry-e2e.mjs` records each card's error and can click "Retry with AI". `FAKE_SHAPE=alt` answers in drifted shapes (type under `section`/`component`, CamelCase names, nested `props`). `scripts/create-wizard-domain-e2e.mjs` screenshots the domain-first wizard steps. `scripts/preview-picture-e2e.mjs reimagine|wizard <url|-> <outDir> [lookIndex]` does the following:
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
