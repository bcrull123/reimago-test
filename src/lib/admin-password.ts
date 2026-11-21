/**
 * Round 12b — password hashing and secret-path generation for the in-app admin (first-run setup).
 * Uses Node's built-in scrypt (no extra library). Never logs a password, hash, path or secret.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { MIN_PASSWORD, MAX_PASSWORD } from "./admin-constants.ts";

const scryptAsync = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keylen, opts, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
/** scrypt parameters: ~100ms on a typical server; rejected on verify if they look like a DoS. */
const N = 16_384;
const R = 8;
const P = 1;
const DK = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, DK, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!password || !stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (n < 16_384 || n > 1 << 20 || r < 8 || r > 16 || p < 1 || p > 4) return false;
  try {
    const salt = Buffer.from(parts[4]!, "base64url");
    const expected = Buffer.from(parts[5]!, "base64url");
    if (!salt.length || expected.length < 16) return false;
    const actual = await scryptAsync(password, salt, expected.length, { N: n, r, p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** A secret admin path: `cp-` plus 32 hex characters (16 random bytes). */
export function randomAdminPath(): string {
  return `cp-${randomBytes(16).toString("hex")}`;
}

export function randomSessionSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function passwordOk(password: string): boolean {
  return password.length >= MIN_PASSWORD && password.length <= MAX_PASSWORD;
}
