/**
 * Round 12b — the in-app admin record (first-run /setup). One row, id = 'default'.
 * Used only when ADMIN_PATH + ADMIN_PASSWORD are not set in the environment; those env values
 * always take precedence (and are how an owner recovers a lost login).
 *
 * Refuses to read or write when DATABASE_URL is unset: a memory store cannot keep the password.
 */
import { createHash } from "node:crypto";
import { env } from "./env.server.ts";
import { hashPassword, passwordOk, randomAdminPath, randomSessionSecret, verifyPassword } from "./admin-password.ts";
import type { AdminConfig } from "./admin-auth.server.ts";

export const hasDurableStore = () => Boolean(env("DATABASE_URL"));
const ROW = "default";

export type AdminRecord = {
  email: string;
  passwordHash: string;
  path: string;
  sessionSecret: string;
  brandName: string;
  brandColor: string;
};

let ready: Promise<void> | null = null;
async function table() {
  if (!hasDurableStore()) throw new Error("no durable store");
  const { getSql } = await import("./db.ts");
  const sql = await getSql();
  ready ??= (async () => {
    await sql.query(`create table if not exists admin_settings (
      id text primary key,
      owner_email text not null default '',
      password_hash text not null,
      admin_path text not null unique,
      session_secret text not null,
      brand_name text not null default '',
      brand_color text not null default '',
      claimed_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`);
  })().catch((error) => {
    ready = null;
    throw error;
  });
  await ready;
  return sql;
}

const str = (v: unknown) => String(v ?? "");
function toRecord(row: Record<string, unknown>): AdminRecord {
  return {
    email: str(row.owner_email),
    passwordHash: str(row.password_hash),
    path: str(row.admin_path),
    sessionSecret: str(row.session_secret),
    brandName: str(row.brand_name),
    brandColor: str(row.brand_color),
  };
}

export function recordToConfig(row: AdminRecord): AdminConfig {
  return {
    source: "db",
    path: row.path,
    sessionSecret: row.sessionSecret,
    passwordMark: createHash("sha256").update(`pw:${row.passwordHash}`).digest("hex").slice(0, 10),
    passwordHash: row.passwordHash,
    email: row.email,
    brandName: row.brandName,
    brandColor: row.brandColor,
  };
}

let cached: { at: number; value: AdminConfig | null } | null = null;
export const clearAdminCache = () => {
  cached = null;
};

export async function readAdminSettings(): Promise<AdminConfig | null> {
  if (!hasDurableStore()) return null;
  if (cached && Date.now() - cached.at < 2000) return cached.value;
  try {
    const sql = await table();
    const rows = await sql.query<Record<string, unknown>>("select * from admin_settings where id = $1", [ROW]);
    const value = rows[0] ? recordToConfig(toRecord(rows[0])) : null;
    cached = { at: Date.now(), value };
    return value;
  } catch (error) {
    console.error(`[admin] could not read settings: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`);
    return null;
  }
}

export const isUniqueViolation = (error: unknown): boolean => {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return code === "23505" || /unique|duplicate key/i.test(msg);
};

export type ClaimInput = {
  email: string;
  password: string;
  brandName: string;
  brandColor: string;
};

export type ClaimResult =
  | { ok: true; config: AdminConfig }
  | { ok: false; reason: "claimed" | "no-store" | "invalid" };

/** First successful insert wins. A second claim is "claimed" (the caller 404s). */
export async function claimAdmin(input: ClaimInput): Promise<ClaimResult> {
  if (!hasDurableStore()) return { ok: false, reason: "no-store" };
  if (!passwordOk(input.password) || !input.email) return { ok: false, reason: "invalid" };
  const existing = await readAdminSettings();
  if (existing) return { ok: false, reason: "claimed" };
  const passwordHash = await hashPassword(input.password);
  const path = randomAdminPath();
  const sessionSecret = randomSessionSecret();
  try {
    const sql = await table();
    await sql.query(
      `insert into admin_settings (id, owner_email, password_hash, admin_path, session_secret, brand_name, brand_color)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [ROW, input.email, passwordHash, path, sessionSecret, input.brandName, input.brandColor],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      clearAdminCache();
      return { ok: false, reason: "claimed" };
    }
    throw error;
  }
  clearAdminCache();
  const config = recordToConfig({ email: input.email, passwordHash, path, sessionSecret, brandName: input.brandName, brandColor: input.brandColor });
  console.info("[admin] setup completed");
  return { ok: true, config };
}

export async function updateAdminPassword(current: string, next: string): Promise<{ ok: true; config: AdminConfig } | { ok: false; reason: "auth" | "invalid" | "missing" }> {
  if (!passwordOk(next)) return { ok: false, reason: "invalid" };
  const sql = await table();
  const rows = await sql.query<Record<string, unknown>>("select * from admin_settings where id = $1", [ROW]);
  if (!rows[0]) return { ok: false, reason: "missing" };
  const rec = toRecord(rows[0]);
  if (!(await verifyPassword(current, rec.passwordHash))) return { ok: false, reason: "auth" };
  const passwordHash = await hashPassword(next);
  await sql.query("update admin_settings set password_hash = $2, updated_at = now() where id = $1", [ROW, passwordHash]);
  clearAdminCache();
  console.info("[admin] password changed");
  return { ok: true, config: recordToConfig({ ...rec, passwordHash }) };
}

export async function regenerateAdminPath(): Promise<{ ok: true; config: AdminConfig; previousPath: string } | { ok: false; reason: "missing" }> {
  const sql = await table();
  const rows = await sql.query<Record<string, unknown>>("select * from admin_settings where id = $1", [ROW]);
  if (!rows[0]) return { ok: false, reason: "missing" };
  const rec = toRecord(rows[0]);
  const path = randomAdminPath();
  await sql.query("update admin_settings set admin_path = $2, updated_at = now() where id = $1", [ROW, path]);
  clearAdminCache();
  console.info("[admin] admin path regenerated");
  return { ok: true, config: recordToConfig({ ...rec, path }), previousPath: rec.path };
}
