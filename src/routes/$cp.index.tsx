import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { lazy, Suspense } from "react";

/**
 * Round 12: the control panel page, at the secret ADMIN_PATH only. Any other first segment (including plain
 * /admin) — or an unset/invalid ADMIN_PATH — is the site's normal 404: the gate below throws notFound() before
 * anything admin-shaped is rendered. Not linked from anywhere, not in the sitemap, noindex.
 */
const adminGate = createServerFn({ method: "GET" })
  .validator((input: { cp: string }) => ({ cp: typeof input?.cp === "string" ? input.cp.slice(0, 120) : "" }))
  .handler(async ({ data }): Promise<{ ok: boolean; authed: boolean }> => {
    const { pathMatches, isAdminRequest, logAdminStateOnce, ADMIN_HEADERS } = await import("@/lib/admin-auth.server");
    logAdminStateOnce();
    if (!pathMatches(data.cp)) return { ok: false, authed: false };
    const { getRequestHeader, setResponseHeader } = await import("@tanstack/react-start/server");
    try {
      for (const [k, v] of Object.entries(ADMIN_HEADERS)) setResponseHeader(k, v);
    } catch {
      /* headers are best effort here; the page also carries a noindex meta tag */
    }
    return { ok: true, authed: isAdminRequest(getRequestHeader("cookie")) };
  });

const AdminApp = lazy(() => import("@/components/admin/admin-app").then((m) => ({ default: m.AdminApp })));

export const Route = createFileRoute("/$cp/")({
  loader: async ({ params }) => {
    const gate = await adminGate({ data: { cp: params.cp } });
    if (!gate.ok) throw notFound();
    return { cp: params.cp, authed: gate.authed };
  },
  // Only once the gate passed: a 404 (plain /admin, a wrong path) must carry no admin-looking title or meta.
  head: ({ loaderData }) => (loaderData ? { meta: [{ title: "Control panel" }, { name: "robots", content: "noindex, nofollow, noarchive" }] } : {}),
  component: AdminPage,
});

function AdminPage() {
  const { cp, authed } = Route.useLoaderData();
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg" />}>
      <AdminApp cp={cp} authed={authed} />
    </Suspense>
  );
}
