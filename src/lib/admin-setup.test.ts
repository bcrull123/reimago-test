import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, passwordOk, randomAdminPath, randomSessionSecret, verifyPassword } from "./admin-password.ts";
import { MIN_PASSWORD } from "./admin-constants.ts";
import { cleanSetupInput, setupCodeState } from "./admin-setup.ts";
import { adminEnabled, adminPathValue, configFromEnv, pathEquals, RESERVED } from "./admin-auth.server.ts";
import { isUniqueViolation } from "./admin-settings.server.ts";

test("scrypt hash verifies the same password and rejects a wrong one", async () => {
  const hash = await hashPassword("correct-horse-12");
  assert.match(hash, /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(await verifyPassword("correct-horse-12", hash), true);
  assert.equal(await verifyPassword("correct-horse-13", hash), false);
  assert.equal(await verifyPassword("correct-horse-12", "not-a-hash"), false);
  assert.equal(await verifyPassword("", hash), false);
  const a = await hashPassword("same-password-ok");
  const b = await hashPassword("same-password-ok");
  assert.notEqual(a, b, "each hash has its own salt");
});

test("random admin path is cp- plus 32 hex characters and is a usable secret path", () => {
  const path = randomAdminPath();
  assert.match(path, /^cp-[a-f0-9]{32}$/);
  assert.equal(adminPathValue(path), path);
  assert.ok(!RESERVED.has(path));
  assert.notEqual(randomAdminPath(), randomAdminPath());
  assert.ok(randomSessionSecret().length >= 32);
});

test("setup is a reserved path (cannot be chosen as ADMIN_PATH)", () => {
  assert.equal(adminPathValue("setup"), null);
  assert.ok(RESERVED.has("setup"));
});

test("passwordOk enforces the 10-character minimum", () => {
  assert.equal(passwordOk("123456789"), false);
  assert.equal(passwordOk("1234567890"), true);
  assert.equal(MIN_PASSWORD, 10);
});

test("cleanSetupInput accepts a good form and rejects bad email, short or mismatched passwords, and a bad color", () => {
  const good = cleanSetupInput({ email: " Owner@Example.com ", password: "a-good-password", confirm: "a-good-password", brandName: "acme.ai", brandColor: "#AABBCC" });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.value.email, "owner@example.com");
    assert.equal(good.value.brandName, "acme.ai");
    assert.equal(good.value.brandColor, "#aabbcc");
  }
  assert.equal(cleanSetupInput({ email: "nope", password: "a-good-password", confirm: "a-good-password" }).ok, false);
  const short = cleanSetupInput({ email: "a@b.com", password: "short", confirm: "short" });
  assert.equal(short.ok, false);
  if (!short.ok) assert.match(short.error, /at least 10/);
  const mismatch = cleanSetupInput({ email: "a@b.com", password: "a-good-password", confirm: "a-good-passworx" });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.match(mismatch.error, /do not match/);
  const color = cleanSetupInput({ email: "a@b.com", password: "a-good-password", confirm: "a-good-password", brandColor: "red" });
  assert.equal(color.ok, false);
  const emptyColor = cleanSetupInput({ email: "a@b.com", password: "a-good-password", confirm: "a-good-password", brandColor: "" });
  assert.equal(emptyColor.ok, true);
});

test("SETUP_CODE is optional; when set it must match exactly (never by prefix)", () => {
  assert.deepEqual(setupCodeState(undefined, ""), { required: false, ok: true });
  assert.deepEqual(setupCodeState("", "anything"), { required: false, ok: true });
  assert.deepEqual(setupCodeState("secret-code", "secret-code"), { required: true, ok: true });
  assert.deepEqual(setupCodeState("secret-code", "secret-cod"), { required: true, ok: false });
  assert.deepEqual(setupCodeState("secret-code", ""), { required: true, ok: false });
});

test("a complete env config takes precedence: configFromEnv is set and pathEquals only that path", () => {
  const prev = { PATH: process.env.ADMIN_PATH, PW: process.env.ADMIN_PASSWORD, SEC: process.env.ADMIN_SESSION_SECRET };
  delete process.env.ADMIN_PATH;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_SESSION_SECRET;
  try {
    assert.equal(configFromEnv(), null);
    assert.equal(adminEnabled(), false);
    process.env.ADMIN_PATH = "cp-env-override-path1";
    process.env.ADMIN_PASSWORD = "env-password-is-set";
    const cfg = configFromEnv();
    assert.ok(cfg);
    assert.equal(cfg?.source, "env");
    assert.equal(cfg?.path, "cp-env-override-path1");
    assert.equal(pathEquals("cp-env-override-path1", cfg!.path), true);
    assert.equal(pathEquals("cp-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", cfg!.path), false);
  } finally {
    const restore: [string, string | undefined][] = [["ADMIN_PATH", prev.PATH], ["ADMIN_PASSWORD", prev.PW], ["ADMIN_SESSION_SECRET", prev.SEC]];
    for (const [k, v] of restore) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("isUniqueViolation recognizes Postgres 23505 and typical wording", () => {
  assert.equal(isUniqueViolation({ code: "23505" }), true);
  assert.equal(isUniqueViolation(new Error("duplicate key value violates unique constraint")), true);
  assert.equal(isUniqueViolation(new Error("something else")), false);
});
