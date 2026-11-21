/**
 * Round 12 / 12b — ADMIN auth (the back-end control panel). Deliberately its OWN module:
 *   - cookie  `rmg_admin`  (customers will get `rmg_customer`, see customer-auth.server.ts — never the same cookie)
 *   - secret  ADMIN_SESSION_SECRET, or the secret stored at setup, or derived from ADMIN_PASSWORD + ADMIN_PATH
 *   - the panel lives at a secret path: env ADMIN_PATH when set, otherwise the path generated at first-run /setup
 *
 * Precedence: a complete ADMIN_PATH + ADMIN_PASSWORD in the environment always wins over the database record.
 * That is also how an owner recovers a lost in-app login. The two are never mixed (the env path and password
 * are used together; the DB path is not also accepted).
 *
 * Nothing here touches the Better Auth stack in src/lib/auth/* — that is for customers.
 * No value (password, path, secret, token, hash) is ever logged.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.server.ts";

export const ADMIN_COOKIE = "rmg_admin";
export const SESSION_HOURS = 12;
/** Paths a real route already uses (or will): never accepted as the secret path. */
export const RESERVED = new Set(["admin", "api", "made", "save", "thanks", "privacy", "terms", "operator-terms", "login", "account", "signup", "assets", "setup"]);

export type AdminConfig = {
  source: "env" | "db";
  path: string;
  sessionSecret: string;
  passwordMark: string;
  /** Present when source is "env". Compared in constant time. Never logged. */
  envPassword?: string;
  /** Present when source is "db" (scrypt string). Never logged. */
  passwordHash?: string;
  email: string;
  brandName: string;
  brandColor: string;
};

export function adminPathValue(raw: string | undefined = env("ADMIN_PATH")): string | null {
  if (!raw) return null;
  const p = raw.trim().replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(p) || RESERVED.has(p.toLowerCase())) return null;
  return p;
}

/** Why the *env* admin is off, for tests and the server log. Unset env is normal when the install uses /setup. */
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

/** Constant-time compare of a URL segment to a known path. */
export function pathEquals(candidate: string, path: string): boolean {
  if (!candidate || !path) return false;
  return same(candidate, path);
}

/** Env-only: is this URL segment the secret path? False when env admin is off. Kept for tests and callers that only care about env. */
export function pathMatches(candidate: string): boolean {
  const path = adminPathValue();
  if (!path || !env("ADMIN_PASSWORD")) return false;
  return pathEquals(candidate, path);
}

export function checkPassword(input: string): boolean {
  const password = env("ADMIN_PASSWORD");
  if (!password || !input) return false;
  return same(input, password);
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
function envSessionSecret(): string {
  const explicit = env("ADMIN_SESSION_SECRET");
  if (explicit && explicit.length >= 16) return explicit;
  return createHmac("sha256", `rmg-admin-session-v1:${adminPathValue() ?? ""}`).update(env("ADMIN_PASSWORD") ?? "").digest("hex");
}
const envPasswordMark = () => createHash("sha256").update(`pw:${env("ADMIN_PASSWORD") ?? ""}`).digest("hex").slice(0, 10);

/** Complete env config, or null. Env wins over the database only when both path and password are usable. */
export function configFromEnv(): AdminConfig | null {
  const path = adminPathValue();
  const password = env("ADMIN_PASSWORD");
  if (!path || !password) return null;
  return {
    source: "env",
    path,
    sessionSecret: envSessionSecret(),
    passwordMark: envPasswordMark(),
    envPassword: password,
    email: "",
    brandName: "",
    brandColor: "",
  };
}

/** Effective admin config: env (if complete) else the /setup database record. */
export async function getAdminConfig(): Promise<AdminConfig | null> {
  const fromEnv = configFromEnv();
  if (fromEnv) return fromEnv;
  try {
    const { readAdminSettings } = await import("./admin-settings.server.ts");
    return await readAdminSettings();
  } catch {
    return null;
  }
}

export async function passwordMatches(input: string, cfg: AdminConfig): Promise<boolean> {
  if (!input) return false;
  if (cfg.source === "env") return Boolean(cfg.envPassword && same(input, cfg.envPassword));
  if (!cfg.passwordHash) return false;
  const { verifyPassword } = await import("./admin-password.ts");
  return verifyPassword(input, cfg.passwordHash);
}

function signWith(cfg: AdminConfig, payload: string) {
  return createHmac("sha256", cfg.sessionSecret).update(payload).digest("base64url");
}

export function issueTokenFor(cfg: AdminConfig, now = Date.now()): string {
  const payload = b64(JSON.stringify({ exp: now + SESSION_HOURS * 3600_000, pv: cfg.passwordMark, k: "admin" }));
  return `${payload}.${signWith(cfg, payload)}`;
}

export function verifyTokenFor(token: string | undefined, cfg: AdminConfig, now = Date.now()): boolean {
  if (!token) return false;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return false;
  if (!same(sig, signWith(cfg, payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number; pv?: string; k?: string };
    return data.k === "admin" && typeof data.exp === "number" && data.exp > now && data.pv === cfg.passwordMark;
  } catch {
    return false;
  }
}

/** Env-only helpers, kept so existing tests and the env-only path stay unchanged. */
const envCfgOrNull = () => configFromEnv();
export function issueToken(now = Date.now()): string {
  const cfg = envCfgOrNull();
  if (!cfg) return issueTokenFor({ source: "env", path: "", sessionSecret: envSessionSecret(), passwordMark: envPasswordMark(), email: "", brandName: "", brandColor: "" }, now);
  return issueTokenFor(cfg, now);
}
export function verifyToken(token: string | undefined, now = Date.now()): boolean {
  const cfg = envCfgOrNull();
  if (!token || !cfg) return false;
  return verifyTokenFor(token, cfg, now);
}

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export const isAdminRequest = (cookieHeader: string | null | undefined): boolean => verifyToken(readCookie(cookieHeader, ADMIN_COOKIE));
export const isSignedIn = (cookieHeader: string | null | undefined, cfg: AdminConfig): boolean => verifyTokenFor(readCookie(cookieHeader, ADMIN_COOKIE), cfg);

export function sessionCookieFor(cfg: AdminConfig, secure: boolean): string {
  return `${ADMIN_COOKIE}=${issueTokenFor(cfg)}; Path=/${cfg.path}; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}
export function clearedCookieFor(path: string, secure: boolean): string {
  return `${ADMIN_COOKIE}=; Path=/${path}; Max-Age=0; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}
export function sessionCookie(path: string, secure: boolean): string {
  const cfg = envCfgOrNull();
  if (cfg) return sessionCookieFor({ ...cfg, path }, secure);
  return `${ADMIN_COOKIE}=${issueToken()}; Path=/${path}; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}
export function clearedCookie(path: string, secure: boolean): string {
  return clearedCookieFor(path, secure);
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

/** Headers on every admin (and setup) response: never cached, never indexed. */
export const ADMIN_HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" } as const;

let logged = false;
/** One `[admin]` line per server instance: how it is configured, never any value. */
export async function logAdminStateOnce() {
  if (logged) return;
  logged = true;
  const fromEnv = configFromEnv();
  if (fromEnv) {
    console.info("[admin] enabled at the secret path (ADMIN_PATH env, takes precedence over any in-app setup)");
    return;
  }
  if (adminProblem() === "ADMIN_PASSWORD is not set" || adminProblem()?.startsWith("ADMIN_PATH is not usable")) {
    console.info(`[admin] env admin ignored: ${adminProblem()}`);
  }
  try {
    const { hasDurableStore, readAdminSettings } = await import("./admin-settings.server.ts");
    const rec = await readAdminSettings();
    if (rec) {
      console.info("[admin] enabled at the secret path (saved at /setup)");
      return;
    }
    if (!hasDurableStore()) {
      console.info("[admin] unclaimed: /setup cannot run (no DATABASE_URL); set ADMIN_PATH and ADMIN_PASSWORD, or add a database");
      return;
    }
    console.info(`[admin] unclaimed: first-run setup is available at /setup${env("SETUP_CODE") ? " (SETUP_CODE required)" : ""}`);
  } catch {
    console.info("[admin] unclaimed: could not read the admin store");
  }
}

export function resetAdminLogFlag() {
  logged = false;
}
