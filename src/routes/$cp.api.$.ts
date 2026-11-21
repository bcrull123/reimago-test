import { createFileRoute } from "@tanstack/react-router";

/**
 * Round 12: the admin API under the secret path (`/<ADMIN_PATH>/api/...`). Not linked from anywhere. A wrong or
 * unset ADMIN_PATH is a plain 404. Logic: src/lib/admin-api.server.ts.
 */
const run = async ({ request, params }: { request: Request; params: { cp: string; _splat?: string } }) => {
  const { handleAdminApi } = await import("@/lib/admin-api.server");
  return handleAdminApi(request, params.cp, params._splat ?? "");
};

export const Route = createFileRoute("/$cp/api/$")({
  server: { handlers: { GET: run, POST: run } },
});
