import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getXaiKey, xaiKeyName, xaiKeyPresence } from "./env.server.ts";

const KEYS = ["XAI_API_KEY", "REIMAGO_GROK_API_KEY"] as const;
const saved: Record<string, string | undefined> = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

const setEnv = (v: Record<string, string | undefined>) => {
  for (const k of KEYS) delete process.env[k];
  for (const [k, val] of Object.entries(v)) if (val !== undefined) process.env[k] = val;
};

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getXaiKey falls back to REIMAGO_GROK_API_KEY", () => {
  it("returns undefined when neither name is set", () => {
    setEnv({});
    assert.equal(getXaiKey(), undefined);
    assert.equal(xaiKeyName(), undefined);
    assert.equal(xaiKeyPresence(), "XAI_API_KEY=false REIMAGO_GROK_API_KEY=false");
  });

  it("prefers XAI_API_KEY when it is set", () => {
    setEnv({ XAI_API_KEY: "sk-secret-primary-value", REIMAGO_GROK_API_KEY: "sk-secret-alias-value" });
    assert.equal(getXaiKey(), "sk-secret-primary-value");
    assert.equal(xaiKeyName(), "XAI_API_KEY");
    const log = xaiKeyPresence();
    assert.equal(log, "XAI_API_KEY=true REIMAGO_GROK_API_KEY=true (using XAI_API_KEY)");
    assert.equal(log.includes("sk-secret-primary-value"), false);
    assert.equal(log.includes("sk-secret-alias-value"), false);
  });

  it("uses REIMAGO_GROK_API_KEY when XAI_API_KEY is unset", () => {
    setEnv({ REIMAGO_GROK_API_KEY: "sk-secret-alias-value" });
    assert.equal(getXaiKey(), "sk-secret-alias-value");
    assert.equal(xaiKeyName(), "REIMAGO_GROK_API_KEY");
    const log = xaiKeyPresence();
    assert.equal(log, "XAI_API_KEY=false REIMAGO_GROK_API_KEY=true (using REIMAGO_GROK_API_KEY)");
    assert.equal(log.includes("sk-secret-alias-value"), false);
  });

  it("treats a blank XAI_API_KEY as unset and falls back to the alias", () => {
    setEnv({ XAI_API_KEY: "   ", REIMAGO_GROK_API_KEY: "sk-secret-alias-value" });
    assert.equal(getXaiKey(), "sk-secret-alias-value");
    assert.equal(xaiKeyName(), "REIMAGO_GROK_API_KEY");
  });
});
