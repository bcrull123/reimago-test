import { createFileRoute } from "@tanstack/react-router";

/** Images stored with a preview site (generated photos and copies of the business's own photos). */
export const Route = createFileRoute("/made/$id/img/$name")({
  server: {
    handlers: {
      GET: async ({ params }) => {
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
