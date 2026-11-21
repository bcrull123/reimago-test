import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { adminEnabled, adminPathValue, adminProblem, clearLoginFailures, issueToken, loginWait, noteLoginFailure, pathMatches, checkPassword, readCookie, sessionCookie, verifyToken } from "./admin-auth.server.ts";

const KEYS = ["ADMIN_PATH", "ADMIN_PASSWORD", "ADMIN_SESSION_SECRET"];
const setEnv = (v: Record<string, string | undefined>) => {
  for (const k of KEYS) delete process.env[k];
  for (const [k, val] of Object.entries(v)) if (val !== undefined) process.env[k] = val;
};
afterEach(() => setEnv({}));

test("the admin is off (every path 404s) unless ADMIN_PATH and ADMIN_PASSWORD are both set", () => {
  setEnv({});
  assert.equal(adminEnabled(), false);
  assert.equal(pathMatches("admin"), false);
  setEnv({ ADMIN_PATH: "cp-9f3a7c2e41b8d605" });
  assert.equal(adminEnabled(), false);
  assert.match(adminProblem()!, /ADMIN_PASSWORD/);
  assert.equal(pathMatches("cp-9f3a7c2e41b8d605"), false);
  setEnv({ ADMIN_PATH: "cp-9f3a7c2e41b8d605", ADMIN_PASSWORD: "pw" });
  assert.equal(adminEnabled(), true);
});

test("only the exact secret path matches; /admin and near misses do not", () => {
  setEnv({ ADMIN_PATH: "/cp-9f3a7c2e41b8d605/", ADMIN_PASSWORD: "pw" });
  assert.equal(adminPathValue(), "cp-9f3a7c2e41b8d605");
  assert.equal(pathMatches("cp-9f3a7c2e41b8d605"), true);
  assert.equal(pathMatches("admin"), false);
  assert.equal(pathMatches("cp-9f3a7c2e41b8d606"), false);
  assert.equal(pathMatches("CP-9F3A7C2E41B8D605"), false);
  assert.equal(pathMatches(""), false);
});

test("an unusable ADMIN_PATH (reserved word, too short, odd characters) disables the admin", () => {
  for (const bad of ["admin", "made", "short", "has space here", "a/b/c/d/e/f/g/h", "x".repeat(81)]) {
    setEnv({ ADMIN_PATH: bad, ADMIN_PASSWORD: "pw" });
    assert.equal(adminEnabled(), false, bad);
  }
});

test("password check is exact", () => {
  setEnv({ ADMIN_PATH: "cp-9f3a7c2e41b8d605", ADMIN_PASSWORD: "correct horse" });
  assert.equal(checkPassword("correct horse"), true);
  assert.equal(checkPassword("correct horse "), false);
  assert.equal(checkPassword(""), false);
});

test("a session token verifies, expires, and dies when tampered with or the password / secret changes", () => {
  setEnv({ ADMIN_PATH: "cp-9f3a7c2e41b8d605", ADMIN_PASSWORD: "pw1", ADMIN_SESSION_SECRET: "a-long-random-session-secret" });
  const now = Date.now();
  const token = issueToken(now);
  assert.equal(verifyToken(token, now + 1000), true);
  assert.equal(verifyToken(token, now + 13 * 3600_000), false, "expired after 12h");
  const [payload, sig] = token.split(".");
  assert.equal(verifyToken(`${payload}.${sig}x`, now), false);
  assert.equal(verifyToken(`${Buffer.from(JSON.stringify({ exp: now + 9e9, pv: "x", k: "admin" })).toString("base64url")}.${sig}`, now), false);
  assert.equal(verifyToken(undefined), false);
  setEnv({ ADMIN_PATH: "cp-9f3a7c2e41b8d605", ADMIN_PASSWORD: "pw2", ADMIN_SESSION_SECRET: "a-long-random-session-secret" });
  assert.equal(verifyToken(token, now + 1000), false, "a new password signs everyone out");
  setEnv({ ADMIN_PATH: "cp-9f3a7c2e41b8d605", ADMIN_PASSWORD: "pw1", ADMIN_SESSION_SECRET: "a-different-session-secret!" });
  assert.equal(verifyToken(token, now + 1000), false, "a new secret signs everyone out");
});

test("without ADMIN_SESSION_SECRET the key is derived from the password and path (still works, still separate)", () => {
  setEnv({ ADMIN_PATH: "cp-9f3a7c2e41b8d605", ADMIN_PASSWORD: "pw1" });
  const token = issueToken();
  assert.equal(verifyToken(token), true);
  setEnv({ ADMIN_PATH: "cp-aaaaaaaaaaaaaaaa", ADMIN_PASSWORD: "pw1" });
  assert.equal(verifyToken(token), false);
});

test("the cookie is rmg_admin, HttpOnly, SameSite=Strict, scoped to the secret path, Secure on https", () => {
  setEnv({ ADMIN_PATH: "cp-9f3a7c2e41b8d605", ADMIN_PASSWORD: "pw" });
  const c = sessionCookie("cp-9f3a7c2e41b8d605", true);
  assert.match(c, /^rmg_admin=[\w-]+\.[\w-]+; Path=\/cp-9f3a7c2e41b8d605; Max-Age=43200; HttpOnly; SameSite=Strict; Secure$/);
  assert.doesNotMatch(sessionCookie("cp-9f3a7c2e41b8d605", false), /Secure/);
  assert.equal(readCookie("a=1; rmg_admin=abc; b=2", "rmg_admin"), "abc");
  assert.equal(readCookie("rmg_customer=abc", "rmg_admin"), undefined, "a customer cookie is never an admin session");
});

test("login attempts lock out after 5 failures for 15 minutes, per client", () => {
  const key = "client-1";
  clearLoginFailures(key);
  const t = 1_000_000;
  for (let i = 0; i < 4; i++) noteLoginFailure(key, t + i);
  assert.equal(loginWait(key, t + 10), 0);
  noteLoginFailure(key, t + 5);
  assert.ok(loginWait(key, t + 10) > 800);
  assert.equal(loginWait("someone-else", t + 10), 0);
  assert.equal(loginWait(key, t + 16 * 60_000), 0);
});
