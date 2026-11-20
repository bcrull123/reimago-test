import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { publicBaseFrom, requestPathPrefixFrom } from "./public-base.ts";

const app = { protocol: "https:", hostname: "app.example", host: "app.example", pathname: "/" };
const port = "/hds-up68yqz8egcm-6014-7b575";

describe("round 10f: publicBase ignores a foreign Referer", () => {
  it("uses the request URL when there is no Referer", () => {
    assert.equal(publicBaseFrom(app), "https://app.example");
  });
  it("keeps a same-host Referer, including a path-based preview prefix", () => {
    assert.equal(publicBaseFrom({ ...app, hostname: "preview.grokgsac.com", host: "preview.grokgsac.com" }, `https://preview.grokgsac.com${port}/`), `https://preview.grokgsac.com${port}`);
  });
  it("ignores a Referer from another site (Grok, email, etc.) so look URLs stay on this app", () => {
    assert.equal(publicBaseFrom(app, "https://grok.com/chat"), "https://app.example");
    assert.equal(publicBaseFrom(app, "https://x.com/i/status/1"), "https://app.example");
    assert.equal(publicBaseFrom({ ...app, protocol: "https:" }, "http://app.example/"), "https://app.example");
  });
  it("still reads the preview prefix from a same-host Referer when the request path was already stripped", () => {
    const req = { protocol: "https:", hostname: "preview.grokgsac.com", host: "preview.grokgsac.com", pathname: "/made/abc" };
    assert.equal(requestPathPrefixFrom(req, `https://preview.grokgsac.com${port}/`), port);
    assert.equal(requestPathPrefixFrom(req), "");
  });
});
