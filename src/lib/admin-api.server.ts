/**
 * Round 12 / 12b — the admin JSON/CSV API. Mounted by src/routes/$cp.api.$.ts, so it lives under the
 * secret path (`/<path>/api/...`), which comes from ADMIN_PATH when set, otherwise from first-run /setup.
 * Everything except `login` needs the `rmg_admin` session cookie; a wrong / unset path answers a plain 404.
 */
import { createHash } from "node:crypto";
import {
  ADMIN_HEADERS, clearedCookieFor, getAdminConfig, isSignedIn, logAdminStateOnce, loginWait,
  noteLoginFailure, clearLoginFailures, passwordMatches, pathEquals, sessionCookieFor, type AdminConfig,
} from "@/lib/admin-auth.server";
import { env, isWorkspacePreview } from "@/lib/env.server";
import { leadsToCsv } from "@/lib/leads";
import { requestIsHttps, requestOrigin } from "@/lib/admin-setup.server";

const notFound = () => new Response("Not Found", { status: 404, headers: { "x-robots-tag": "noindex" } });
const json = (body: unknown, status = 200, cookies: string[] = []) => {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", ...ADMIN_HEADERS });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
};

function clientKey(request: Request): string {
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || request.headers.get("x-real-ip") || "anonymous";
  return createHash("sha256").update(`admin-login:${ip}`).digest("hex").slice(0, 12);
}

/** Round 13: is the Email Bot reply webhook set up? (presence only, never a value) */
async function webhookState(): Promise<{ configured: boolean; problem?: string }> {
  const { replyWebhookProblem } = await import("@/lib/reply-webhook.server");
  const problem = replyWebhookProblem();
  return problem ? { configured: false, problem } : { configured: true };
}

const adminUrl = (request: Request, path: string) => `${requestOrigin(request)}/${path}`;

function settingsPayload(cfg: AdminConfig, request: Request) {
  const envOverride = cfg.source === "env";
  return {
    source: cfg.source,
    email: cfg.email,
    adminPath: cfg.path,
    adminUrl: adminUrl(request, cfg.path),
    envOverride,
    canChangePassword: !envOverride,
    canRegeneratePath: !envOverride,
    brandName: cfg.brandName,
    brandColor: cfg.brandColor,
  };
}

export async function handleAdminApi(request: Request, cp: string, splat: string): Promise<Response> {
  await logAdminStateOnce();
  const cfg = await getAdminConfig();
  if (!cfg || !pathEquals(cp, cfg.path)) return notFound();
  const method = request.method.toUpperCase();
  const route = splat.replace(/^\/+|\/+$/g, "");
  const key = clientKey(request);
  const https = requestIsHttps(request);

  if (method === "POST" && request.headers.get("x-rmg-admin") !== "1") return json({ error: "Bad request." }, 400);

  if (route === "login" && method === "POST") {
    const wait = loginWait(key);
    if (wait > 0) {
      console.warn(`[admin] login blocked: too many wrong passwords from client ${key} (retry in ${wait}s)`);
      return json({ error: `Too many tries. Wait ${Math.ceil(wait / 60)} min and try again.`, retry_after: wait }, 429);
    }
    const body = (await request.json().catch(() => ({}))) as { password?: unknown };
    if (typeof body.password === "string" && (await passwordMatches(body.password, cfg))) {
      clearLoginFailures(key);
      console.info(`[admin] login ok (client ${key})`);
      return json({ ok: true }, 200, [sessionCookieFor(cfg, https)]);
    }
    noteLoginFailure(key);
    console.warn(`[admin] login FAILED (client ${key})`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return json({ error: "That password is not right." }, 401);
  }

  if (route === "logout" && method === "POST") {
    console.info("[admin] logout");
    return json({ ok: true }, 200, [clearedCookieFor(cfg.path, https)]);
  }

  if (!isSignedIn(request.headers.get("cookie"), cfg)) return json({ error: "Sign in required." }, 401);

  if (route === "settings" && method === "GET") return json(settingsPayload(cfg, request));

  if (route === "settings/password" && method === "POST") {
    if (cfg.source !== "db") return json({ error: "Sign-in is using ADMIN_PASSWORD from the server environment, which takes priority. Remove it to use the in-app password." }, 400);
    const body = (await request.json().catch(() => ({}))) as { current?: unknown; next?: unknown; confirm?: unknown };
    const current = typeof body.current === "string" ? body.current : "";
    const next = typeof body.next === "string" ? body.next : "";
    const confirm = typeof body.confirm === "string" ? body.confirm : "";
    if (next !== confirm) return json({ error: "The two passwords do not match." }, 400);
    try {
      const { updateAdminPassword } = await import("@/lib/admin-settings.server");
      const result = await updateAdminPassword(current, next);
      if (!result.ok) {
        if (result.reason === "auth") return json({ error: "That current password is not right." }, 400);
        if (result.reason === "invalid") return json({ error: "Choose a password of at least 10 characters." }, 400);
        return json({ error: "Could not change the password." }, 400);
      }
      return json({ ok: true, ...settingsPayload(result.config, request) }, 200, [sessionCookieFor(result.config, https)]);
    } catch (error) {
      console.error(`[admin] password change failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`);
      return json({ error: "Could not change the password. Try again." }, 500);
    }
  }

  if (route === "settings/path" && method === "POST") {
    if (cfg.source !== "db") return json({ error: "The admin address is set by ADMIN_PATH in the server environment, which takes priority. Remove it to use the in-app address." }, 400);
    try {
      const { regenerateAdminPath } = await import("@/lib/admin-settings.server");
      const result = await regenerateAdminPath();
      if (!result.ok) return json({ error: "Could not create a new address." }, 400);
      console.info("[admin] owner moved to a new admin path");
      return json(
        { ok: true, ...settingsPayload(result.config, request) },
        200,
        [clearedCookieFor(result.previousPath, https), sessionCookieFor(result.config, https)],
      );
    } catch (error) {
      console.error(`[admin] path regenerate failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`);
      return json({ error: "Could not create a new address. Try again." }, 500);
    }
  }

  // Round 13: the Cursor hand-off is admin-only. It used to be a public server function behind a public button; with a
  // CURSOR_API_KEY set that let any visitor start agents on the owner's account. Needs this session and is rate limited.
  if (route === "cursor-handoff" && method === "POST") {
    const server = await import("@/lib/reimagine.server");
    if (server.rateLimited(`cursor-handoff:${key}`, 5, false)) return json({ error: "Too many hand-offs this hour. Try again later." }, 429);
    try {
      const input = server.cleanHandoff((await request.json().catch(() => ({}))) as Record<string, unknown>);
      console.info(`[admin] cursor hand-off for ${input.host || "a site"} (${server.cursorConfigured() ? "api" : "no key"})`);
      return json(await server.sendToCursor(input));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message.slice(0, 200) : "Could not hand off." }, 400);
    }
  }

  const leads = await import("@/lib/leads.server");
  const query = Object.fromEntries(new URL(request.url).searchParams);
  try {
    if (route === "leads" && method === "GET") {
      const rows = await leads.listLeads(query);
      const { previewStoreInfo } = await import("@/lib/pages.server");
      return json({ leads: rows, total: await leads.countLeads(), store: leads.hasDurableStore() ? "postgres" : "memory", published: !isWorkspacePreview(), reply_webhook: await webhookState(), formcarry_backfill: Boolean(env("FORMCARRY_API_KEY")), preview_store: previewStoreInfo() });
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
