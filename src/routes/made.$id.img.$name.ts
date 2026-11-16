import { createFileRoute } from "@tanstack/react-router";

/** Images stored with a preview site (generated photos, copies of the business's own photos, the lead screenshot). */
export const Route = createFileRoute("/made/$id/img/$name")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        // /made/$id/img/remote?u=<https url> — a same-origin copy of an image the homepage hotlinks (see remote-image.server.ts).
        if (String(params.name ?? "") === "remote") {
          const { remoteImageResponse } = await import("@/lib/preview/remote-image.server");
          return remoteImageResponse(String(params.id ?? ""), new URL(request.url).searchParams.get("u") ?? "");
        }
        const { readImage } = await import("@/lib/pages.server");
        const name = String(params.name ?? "").toLowerCase();
        const image = await readImage(String(params.id ?? ""), name);
        if (!image || !/^image\/(jpeg|png|webp|gif)$/.test(image.type)) return new Response("Not found.", { status: 404 });
        return new Response(new Uint8Array(image.bytes), {
          headers: {
            "content-type": image.type,
            "cache-control": "public, max-age=86400, immutable",
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'none'",
          },
        });
      },
    },
  },
});
