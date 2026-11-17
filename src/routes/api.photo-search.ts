import { createFileRoute } from "@tanstack/react-router";

/** Google Images search for white-label clones (see src/lib/preview/photo-search-endpoint.server.ts). */
export const Route = createFileRoute("/api/photo-search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { photoSearchResponse } = await import("@/lib/preview/photo-search-endpoint.server");
        return photoSearchResponse(request);
      },
      GET: async ({ request }) => {
        const { photoSearchResponse } = await import("@/lib/preview/photo-search-endpoint.server");
        return photoSearchResponse(request);
      },
    },
  },
});
