/**
 * Round 12b — pure validation for first-run /setup. Shared by the server and the tests.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { MIN_PASSWORD, MAX_PASSWORD } from "./admin-constants.ts";

export type SetupFields = {
  email: string;
  password: string;
  confirm: string;
  setupCode: string;
  brandName: string;
  brandColor: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

export function cleanSetupInput(raw: unknown): { ok: true; value: { email: string; password: string; setupCode: string; brandName: string; brandColor: string } } | { ok: false; error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: string, max: number) => (typeof r[k] === "string" ? r[k].trim().slice(0, max) : "");
  const email = str("email", 200).toLowerCase();
  const password = typeof r.password === "string" ? r.password.slice(0, MAX_PASSWORD + 1) : "";
  const confirm = typeof r.confirm === "string" ? r.confirm : "";
  const setupCode = typeof r.setupCode === "string" ? r.setupCode : str("setup_code", 200);
  const brandName = str("brandName", 80).replace(/[\u0000-\u001f]+/g, " ").trim();
  const colorRaw = str("brandColor", 16);
  const brandColor = COLOR_RE.test(colorRaw) ? colorRaw.toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter the owner email." };
  if (password.length < MIN_PASSWORD) return { ok: false, error: `Choose a password of at least ${MIN_PASSWORD} characters.` };
  if (password.length > MAX_PASSWORD) return { ok: false, error: "That password is too long." };
  if (password !== confirm) return { ok: false, error: "The two passwords do not match." };
  if (colorRaw && !brandColor) return { ok: false, error: "Brand color must be a # plus six hex digits, for example #f89800." };
  return { ok: true, value: { email, password, setupCode, brandName, brandColor } };
}


/** Whether this install requires SETUP_CODE, and whether a given attempt matches. Never leaks the code. */
export function setupCodeState(expected: string | undefined, given: string): { required: boolean; ok: boolean } {
  const code = (expected ?? "").trim();
  if (!code) return { required: false, ok: true };
  const ha = createHash("sha256").update(code).digest();
  const hb = createHash("sha256").update(given).digest();
  return { required: true, ok: timingSafeEqual(ha, hb) };
}
