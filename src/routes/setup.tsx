import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { lazy, Suspense } from "react";

/**
 * Round 12b: first-run setup, only while the install is unclaimed (no ADMIN_PATH+ADMIN_PASSWORD and no
 * admin_settings row). Afterwards this is the site's normal 404. Not linked from the public site, noindex.
 */
const setupGate = createServerFn({ method: "GET" }).handler(async () => {
  const { setupPageState } = await import("@/lib/admin-setup.server");
  const { ADMIN_HEADERS } = await import("@/lib/admin-auth.server");
  try {
    const { setResponseHeader } = await import("@tanstack/react-start/server");
    for (const [k, v] of Object.entries(ADMIN_HEADERS)) setResponseHeader(k, v);
  } catch {
    /* headers are best effort; the page also carries a noindex meta when shown */
  }
  return setupPageState();
});

const SetupApp = lazy(() => import("@/components/admin/setup-app").then((m) => ({ default: m.SetupApp })));

export const Route = createFileRoute("/setup")({
  loader: async () => {
    const state = await setupGate();
    if (state.status === "claimed") throw notFound();
    return state;
  },
  head: ({ loaderData }) =>
    loaderData
      ? { meta: [{ title: "Set up your control panel" }, { name: "robots", content: "noindex, nofollow, noarchive" }] }
      : {},
  component: SetupPage,
});

function SetupPage() {
  const state = Route.useLoaderData();
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg" />}>
      <SetupApp state={state} />
    </Suspense>
  );
}
