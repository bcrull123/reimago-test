/**
 * Round 12 — ADMIN auth (the back-end control panel). Deliberately its OWN module:
 *   - cookie  `rmg_admin`  (customers will get `rmg_customer`, see customer-auth.server.ts — never the same cookie)
 *   - secret  ADMIN_SESSION_SECRET (or derived from ADMIN_PASSWORD + ADMIN_PATH) — never shared with customer sessions
 *   - the panel lives at the secret path ADMIN_PATH; unset / invalid => the admin does not exist (normal 404 everywhere)
 * Nothing here touches the Better Auth stack in src/lib/auth/* — that is for customers.
 * No value (password, path, secret, token) is ever logged.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.server.ts";

export const ADMIN_COOKIE = "rmg_admin";
export const SESSION_HOURS = 12;
/** Paths a real route already uses (or will): never accepted as the secret path. */
const RESERVED = new Set(["admin", "api", "made", "save", "thanks", "privacy", "terms", "operator-terms", "login", "account", "signup", "assets"]);

export function adminPathValue(raw: string | undefined = env("ADMIN_PATH")): string | null {
  if (!raw) return null;
  const p = raw.trim().replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(p) || RESERVED.has(p.toLowerCase())) return null;
  return p;
}

/** Why the admin is off, for the server log only (never shown to a visitor). */
export function adminProblem(): string | null {
  if (!env("ADMIN_PATH")) return "ADMIN_PATH is not set";
  if (!adminPathValue()) return "ADMIN_PATH is not usable (8-80 letters, digits, - or _; not a reserved word)";
  if (!env("ADMIN_PASSWORD")) return "ADMIN_PASSWORD is not set";
  return null;
}
export const adminEnabled = () => adminProblem() === null;

const same = (a: string, b: string): boolean => {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
};

/** Is this URL segment the secret path? Constant-time; false whenever the admin is off. */
export function pathMatches(candidate: string): boolean {
  const path = adminPathValue();
  if (!path || !env("ADMIN_PASSWORD")) return false;
  return same(candidate, path);
}

export function checkPassword(input: string): boolean {
  const password = env("ADMIN_PASSWORD");
  if (!password || !input) return false;
  return same(input, password);
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
function sessionSecret(): string {
  const explicit = env("ADMIN_SESSION_SECRET");
  if (explicit && explicit.length >= 16) return explicit;
  // No separate secret set: derive one from the password + path (changing either signs everyone out).
  return createHmac("sha256", `rmg-admin-session-v1:${adminPathValue() ?? ""}`).update(env("ADMIN_PASSWORD") ?? "").digest("hex");
}
const passwordMark = () => createHash("sha256").update(`pw:${env("ADMIN_PASSWORD") ?? ""}`).digest("hex").slice(0, 10);
const sign = (payload: string) => createHmac("sha256", sessionSecret()).update(payload).digest("base64url");

export function issueToken(now = Date.now()): string {
  const payload = b64(JSON.stringify({ exp: now + SESSION_HOURS * 3600_000, pv: passwordMark(), k: "admin" }));
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined, now = Date.now()): boolean {
  if (!token || !adminEnabled()) return false;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return false;
  if (!same(sig, sign(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number; pv?: string; k?: string };
    return data.k === "admin" && typeof data.exp === "number" && data.exp > now && data.pv === passwordMark();
  } catch {
    return false;
  }
}

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export const isAdminRequest = (cookieHeader: string | null | undefined): boolean => verifyToken(readCookie(cookieHeader, ADMIN_COOKIE));

/** Set-Cookie for a new session. HttpOnly, SameSite=Strict, scoped to the secret path, Secure on https. */
export function sessionCookie(path: string, secure: boolean): string {
  return `${ADMIN_COOKIE}=${issueToken()}; Path=/${path}; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}
export function clearedCookie(path: string, secure: boolean): string {
  return `${ADMIN_COOKIE}=; Path=/${path}; Max-Age=0; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

// ------------------------------------------------------------------------------------ login rate limit
const failures = new Map<string, number[]>();
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 5;
/** Seconds until this client may try again (0 = may try). */
export function loginWait(key: string, now = Date.now()): number {
  const recent = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(key, recent);
  if (recent.length < MAX_FAILS) return 0;
  return Math.ceil((recent[0]! + WINDOW_MS - now) / 1000);
}
export function noteLoginFailure(key: string, now = Date.now()) {
  failures.set(key, [...(failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS), now]);
  if (failures.size > 5000) failures.clear();
}
export const clearLoginFailures = (key: string) => failures.delete(key);

/** Headers on every admin response: never cached, never indexed. */
export const ADMIN_HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" } as const;

let logged = false;
/** One `[admin]` line per server instance: whether it is on, never any value. */
export function logAdminStateOnce() {
  if (logged) return;
  logged = true;
  const problem = adminProblem();
  console.info(problem ? `[admin] disabled: ${problem}` : "[admin] enabled at the secret path (ADMIN_PATH)");
}
