/**
 * Round 12 — the admin JSON/CSV API. Mounted by src/routes/$cp.api.$.ts, so it lives under the secret path
 * (`/<ADMIN_PATH>/api/...`). Everything except `login` needs the `rmg_admin` session cookie; a wrong / unset
 * path answers a plain 404 before anything else happens.
 */
import { createHash } from "node:crypto";
import {
  ADMIN_HEADERS, checkPassword, clearLoginFailures, clearedCookie, isAdminRequest, loginWait, logAdminStateOnce,
  noteLoginFailure, pathMatches, sessionCookie,
} from "@/lib/admin-auth.server";
import { env, isWorkspacePreview } from "@/lib/env.server";
import { leadsToCsv } from "@/lib/leads";

const notFound = () => new Response("Not Found", { status: 404, headers: { "x-robots-tag": "noindex" } });
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...ADMIN_HEADERS, ...extra } });

function clientKey(request: Request): string {
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || request.headers.get("x-real-ip") || "anonymous";
  return createHash("sha256").update(`admin-login:${ip}`).digest("hex").slice(0, 12);
}
const isHttps = (request: Request) => request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";

export async function handleAdminApi(request: Request, cp: string, splat: string): Promise<Response> {
  logAdminStateOnce();
  if (!pathMatches(cp)) return notFound();
  const method = request.method.toUpperCase();
  const route = splat.replace(/^\/+|\/+$/g, "");
  const key = clientKey(request);

  // A POST must carry the custom header (a cross-site form cannot set it) — on top of SameSite=Strict.
  if (method === "POST" && request.headers.get("x-rmg-admin") !== "1") return json({ error: "Bad request." }, 400);

  if (route === "login" && method === "POST") {
    const wait = loginWait(key);
    if (wait > 0) {
      console.warn(`[admin] login blocked: too many wrong passwords from client ${key} (retry in ${wait}s)`);
      return json({ error: `Too many tries. Wait ${Math.ceil(wait / 60)} min and try again.`, retry_after: wait }, 429, { "retry-after": String(wait) });
    }
    const body = (await request.json().catch(() => ({}))) as { password?: unknown };
    if (typeof body.password === "string" && checkPassword(body.password)) {
      clearLoginFailures(key);
      console.info(`[admin] login ok (client ${key})`);
      return json({ ok: true }, 200, { "set-cookie": sessionCookie(cp, isHttps(request)) });
    }
    noteLoginFailure(key);
    console.warn(`[admin] login FAILED (client ${key})`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return json({ error: "That password is not right." }, 401);
  }

  if (route === "logout" && method === "POST") {
    console.info("[admin] logout");
    return json({ ok: true }, 200, { "set-cookie": clearedCookie(cp, isHttps(request)) });
  }

  if (!isAdminRequest(request.headers.get("cookie"))) return json({ error: "Sign in required." }, 401);

  const leads = await import("@/lib/leads.server");
  const query = Object.fromEntries(new URL(request.url).searchParams);
  try {
    if (route === "leads" && method === "GET") {
      const rows = await leads.listLeads(query);
      return json({ leads: rows, total: await leads.countLeads(), store: leads.hasDurableStore() ? "postgres" : "memory", published: !isWorkspacePreview(), formcarry_backfill: Boolean(env("FORMCARRY_API_KEY")) });
    }
    if (route === "leads.csv" && method === "GET") {
      const rows = await leads.listLeads({ ...query, limit: 2000 });
      console.info(`[admin] csv export: ${rows.length} leads`);
      const stamp = new Date().toISOString().slice(0, 10);
      return new Response(leadsToCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="reimago-leads-${stamp}.csv"`, ...ADMIN_HEADERS } });
    }
    const one = /^lead\/([a-f0-9]{24})$/.exec(route);
    if (one) {
      const id = one[1]!;
      if (method === "GET") {
        const lead = await leads.getLead(id);
        return lead ? json({ lead }) : json({ error: "No such lead." }, 404);
      }
      if (method === "POST") {
        const body = (await request.json().catch(() => ({}))) as { status?: unknown; note?: unknown };
        const lead = await leads.updateLead(id, { status: typeof body.status === "string" ? body.status : undefined, note: typeof body.note === "string" ? body.note : undefined });
        return lead ? json({ lead }) : json({ error: "No such lead." }, 404);
      }
    }
  } catch (error) {
    console.error(`[admin] ${route} failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`);
    return json({ error: "The lead store did not answer. Try again." }, 500);
  }
  return notFound();
}
