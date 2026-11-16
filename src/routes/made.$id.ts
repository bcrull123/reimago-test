import { createFileRoute } from "@tanstack/react-router";

const LEGACY_CSP =
  "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data:; base-uri 'none'; form-action 'none'";

export const Route = createFileRoute("/made/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { readSite, readPage } = await import("@/lib/pages.server");
        const { renderSitePage, PREVIEW_CSP } = await import("@/lib/preview/render");
        const site = await readSite(params.id);
        if (site) {
          const html = renderSitePage(site, "home");
          if (html) {
            return new Response(html, {
              headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "public, max-age=300",
                "content-security-policy": PREVIEW_CSP,
                "x-robots-tag": "noindex",
              },
            });
          }
        }
        const legacy = await readPage(params.id);
        if (!legacy) return new Response("That page is not on this server.", { status: 404 });
        return new Response(legacy, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=300",
            "content-security-policy": LEGACY_CSP,
          },
        });
      },
    },
  },
});
