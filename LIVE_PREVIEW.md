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

   The visitor gets **three picker cards**, each with a live thumbnail, name, mood, swatches and fonts, plus "Preview" and "Use this look" buttons.
4. **Building pages…** and **Polishing the homepage…** (after "Use this look"): one request builds the remaining pages (and service photos if needed). In parallel it runs a **critique-and-revise pass**:
   - it screenshots the homepage with headless Chrome when available, and an art-director AI critiques the screenshot (or the section list) and revises once;
   - the revision is validated like any other output, and the original is kept if the revision is unusable.

   The other looks stay homepage-only, and their inner pages say "built when you choose this look".

The Formcarry lead still carries `preview_url` (the first look) and `preview_pages`, which lists all three look links.

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

## Environment variables

| Variable | Needed | What it does |
| --- | --- | --- |
| `XAI_API_KEY` | yes (for AI) | Grok text model (plans, directions, sections, critique) and Grok Imagine images. |
| `Onesite_Domains_API` | yes | Webhero proxy token for domain search (unchanged). |
| `AI_PROVIDER` | no | `xai` (default), `openai`, or `mock`. |
| `AI_MODEL` | no | Override the text model (default `grok-4.5`; `gpt-4.1-mini` for openai). |
| `OPENAI_API_KEY` | only for openai text or images | |
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

- `src/lib/ai-provider.server.ts`: every AI call: text (`chatJson`, with image parts for vision) and `generateImage`.
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

The last argument picks which look to choose (0–2); `APP_URL` points the script at another port. The e2e scripts intercept Formcarry, so no real lead is sent. The fake AI server deliberately returns an invented phone, email, stats and review so you can see the validators remove them.
