import { createFileRoute } from "@tanstack/react-router";

/** Round 12b: POST /setup/api — first-run claim. A claimed install answers 404. */
export const Route = createFileRoute("/setup/api")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleSetupApi } = await import("@/lib/admin-setup.server");
        return handleSetupApi(request);
      },
    },
  },
});
