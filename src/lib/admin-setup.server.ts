/**
 * Round 12b — first-run /setup API. Public only while the install is unclaimed (no env admin and no
 * admin_settings row). Afterwards every /setup URL is a normal 404.
 */
import { createHash } from "node:crypto";
import { ADMIN_HEADERS, clearedCookieFor, configFromEnv, getAdminConfig, logAdminStateOnce, loginWait, noteLoginFailure, sessionCookieFor } from "@/lib/admin-auth.server";
import { cleanSetupInput, setupCodeState } from "@/lib/admin-setup";
import { env } from "@/lib/env.server";
import { BRAND } from "@/lib/brand";

const notFound = () => new Response("Not Found", { status: 404, headers: { "x-robots-tag": "noindex" } });
const json = (body: unknown, status = 200, cookies: string[] = []) => {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", ...ADMIN_HEADERS });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
};

function clientKey(request: Request): string {
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || request.headers.get("x-real-ip") || "anonymous";
  return createHash("sha256").update(`admin-setup:${ip}`).digest("hex").slice(0, 12);
}
const isHttps = (request: Request) => request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";
const originOf = (request: Request) => {
  const proto = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host;
  return `${proto}://${host}`;
};

export type SetupPageState =
  | { status: "claimed" }
  | { status: "no-store" }
  | { status: "unclaimed"; needsCode: boolean; brandName: string; brandColor: string };

export async function setupPageState(): Promise<SetupPageState> {
  await logAdminStateOnce();
  if (configFromEnv()) return { status: "claimed" };
  const { hasDurableStore, readAdminSettings } = await import("@/lib/admin-settings.server");
  if (await readAdminSettings()) return { status: "claimed" };
  if (!hasDurableStore()) return { status: "no-store" };
  return { status: "unclaimed", needsCode: Boolean(env("SETUP_CODE")), brandName: BRAND.name, brandColor: BRAND.color };
}

export async function handleSetupApi(request: Request): Promise<Response> {
  await logAdminStateOnce();
  if (request.method.toUpperCase() !== "POST") return notFound();
  if (request.headers.get("x-rmg-admin") !== "1") return json({ error: "Bad request." }, 400);

  // Already claimed (env or DB) → the same 404 a visitor would get on /setup.
  if (configFromEnv() || (await getAdminConfig())) return notFound();
  const { hasDurableStore, claimAdmin } = await import("@/lib/admin-settings.server");
  if (!hasDurableStore()) {
    return json({ error: "This app has no database (DATABASE_URL is not set), so a control-panel password cannot be saved. Add a database, or set ADMIN_PATH and ADMIN_PASSWORD in the server environment." }, 400);
  }

  const key = clientKey(request);
  const wait = loginWait(key);
  if (wait > 0) {
    console.warn(`[admin] setup blocked: too many tries from client ${key} (retry in ${wait}s)`);
    return json({ error: `Too many tries. Wait ${Math.ceil(wait / 60)} min and try again.`, retry_after: wait }, 429, []);
  }

  const body = await request.json().catch(() => ({}));
  const cleaned = cleanSetupInput(body);
  if (!cleaned.ok) return json({ error: cleaned.error }, 400);
  const code = setupCodeState(env("SETUP_CODE"), cleaned.value.setupCode);
  if (!code.ok) {
    noteLoginFailure(key);
    await new Promise((r) => setTimeout(r, 500));
    return json({ error: "That setup code is not right." }, 400);
  }

  try {
    const claimed = await claimAdmin({
      email: cleaned.value.email,
      password: cleaned.value.password,
      brandName: cleaned.value.brandName,
      brandColor: cleaned.value.brandColor,
    });
    if (!claimed.ok) {
      if (claimed.reason === "claimed") return notFound();
      if (claimed.reason === "no-store") return json({ error: "This app has no database, so a control-panel password cannot be saved." }, 400);
      return json({ error: "That setup could not be saved. Check the form and try again." }, 400);
    }
    const origin = originOf(request);
    const url = `${origin}/${claimed.config.path}`;
    return json(
      { ok: true, email: claimed.config.email, adminPath: claimed.config.path, adminUrl: url },
      200,
      [sessionCookieFor(claimed.config, isHttps(request))],
    );
  } catch (error) {
    console.error(`[admin] setup failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`);
    return json({ error: "Setup could not be saved. Try again." }, 500);
  }
}

/** Shared origin helper for the settings API (admin address shown to the signed-in owner). */
export const requestOrigin = originOf;
export const requestIsHttps = isHttps;
export { json as adminJson, notFound as adminNotFound, clearedCookieFor };
