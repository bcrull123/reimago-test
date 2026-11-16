import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/made/$id/$slug")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { readSite } = await import("@/lib/pages.server");
        const { renderSitePage, PREVIEW_CSP } = await import("@/lib/preview/render");
        const site = await readSite(params.id);
        const slug = String(params.slug ?? "").toLowerCase();
        const html = site && /^[a-z0-9-]{1,40}$/.test(slug) ? renderSitePage(site, slug) : undefined;
        if (!html) return new Response("That page is not on this server.", { status: 404 });
        return new Response(html, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            // Looks change when the visitor picks one or retries the AI, so new-style pages are never cached.
            "cache-control": site?.version === 3 ? "no-cache" : "public, max-age=300",
            "content-security-policy": PREVIEW_CSP,
            "x-robots-tag": "noindex",
          },
        });
      },
    },
  },
});
