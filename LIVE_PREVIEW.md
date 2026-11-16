# Live preview (replaces the Grok Imagine picture)

Visitor enters a URL → **Reading your site…** (homepage + up to 8 same-site pages) →
**Planning pages…** (one AI call: pages, nav, palette, fonts) → **Building pages…**
(each page written in parallel, sanitized) → a real clickable site at
`/made/<id>` and `/made/<id>/<page>`, shown in a sandboxed iframe with a
desktop/mobile toggle and an "Open full site" link. The Formcarry lead now carries
`preview_url` and `preview_pages` instead of a picture.

The Create a New Site wizard uses the same plan/build steps, with facts taken from the brief.

## Environment variables

| Variable | Needed | What it does |
| --- | --- | --- |
| `XAI_API_KEY` | yes (for AI copy) | Grok text model for planning and writing pages, and the wizard's Let AI decide. |
| `Onesite_Domains_API` | yes | Webhero proxy token for domain search (unchanged). |
| `AI_PROVIDER` | no | `xai` (default), `openai`, or `mock`. |
| `AI_MODEL` | no | Override the model (default `grok-4.5`; `gpt-4.1-mini` for openai). |
| `OPENAI_API_KEY` | only if `AI_PROVIDER=openai` | |
| `AI_BASE_URL` | no | Any OpenAI-compatible endpoint (e.g. Together, Groq). |
| `PREVIEW_MOCK` | no | `1` = no AI calls; pages are assembled from the scraped facts and labeled MOCK PREVIEW. |
| `DATABASE_URL` | recommended in production | Stores preview sites in Postgres (`preview_sites`, created on first use) so links survive restarts and work across serverless instances. |
| `PREVIEW_STORE_DIR` | no | File storage folder when there is no `DATABASE_URL` (default: OS temp dir). |
| `CURSOR_API_KEY` | no | When set, "Send to Cursor" starts a Cursor agent with the preview links; otherwise the button downloads a brief. |

No image-generation model is called anywhere. Missing photos use CSS gradient placeholders.

## Code map

- `src/lib/ai-provider.server.ts`: every AI text call; switch providers by env.
- `src/lib/preview/scrape.server.ts`: crawler and fact extraction (SSRF-guarded, size/time capped).
- `src/lib/preview/builder.server.ts`: plan, page generation, deterministic fallback.
- `src/lib/preview/sanitize.ts`: allow-list HTML sanitizer that removes invented phone numbers and emails.
- `src/lib/preview/render.ts` and `theme.ts`: shared CSS, header/nav/footer, Formcarry contact form, CSP.
- `src/lib/preview.functions.ts`: server functions for the three steps.
- `src/components/live-preview.tsx`: iframe viewer.
- Routes: `src/routes/made.$id.ts`, `src/routes/made.$id.$slug.ts`.

## Testing

```
npm run typecheck && npm run build
node --experimental-strip-types --test src/lib/preview/preview.test.ts
PREVIEW_MOCK=1 npm run dev            # then, in another shell:
node scripts/live-preview-e2e.mjs https://www.morganplumbingokc.com/ live-preview-shots/morgan
node scripts/live-preview-wizard-e2e.mjs live-preview-shots/wizard
```
The e2e scripts intercept Formcarry, so no real lead is sent.
