import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DOMAIN_TLDS, parseTldList } from "./domain-config.ts";
import { cleanIdeas, cleanLabel, fallbackIdeas, nameSlug, readTypedDomain, sortItems, splitDomain } from "./domain-ideas.ts";

const tlds = ["com", "net", "org", "co"];
const brief = { business_name: "Riverside Plumbing Co.", what: "Plumbing repairs for homeowners on the east side", location: "Tulsa, Oklahoma", style: "friendly" };

describe("round 11: allowed endings (one list)", () => {
  it("defaults to the four live endings; Webhero's not-yet-live ones are off", () => {
    assert.deepEqual([...DOMAIN_TLDS], ["com", "net", "org", "co"]);
    for (const notLive of ["us", "info", "biz", "io"]) assert.ok(!DOMAIN_TLDS.includes(notLive as never), notLive);
  });
  it("DOMAIN_TLDS env override: comma list, dots/case/duplicates/garbage cleaned; empty -> default", () => {
    assert.deepEqual(parseTldList("com, .NET ,org,com, biz"), ["com", "net", "org", "biz"]);
    assert.deepEqual(parseTldList("c0m, ,;"), [...DOMAIN_TLDS]);
    assert.deepEqual(parseTldList(undefined), [...DOMAIN_TLDS]);
  });
});

describe("round 11: typed domain", () => {
  it("adds .com when there is no ending", () => {
    assert.deepEqual(readTypedDomain("Northline Plumbing", tlds), { kind: "ok", domain: "northlineplumbing.com", added: true });
    assert.deepEqual(readTypedDomain("https://www.Northline.com/about", tlds), { kind: "ok", domain: "northline.com", added: false });
  });
  it("keeps an allowed ending", () => {
    assert.deepEqual(readTypedDomain("northline.co", tlds), { kind: "ok", domain: "northline.co", added: false });
  });
  it("an ending that is not live yet is 'not offered yet' with the .com version suggested", () => {
    assert.deepEqual(readTypedDomain("northline.biz", tlds), { kind: "unsupported", domain: "northline.biz", tld: "biz", suggestion: "northline.com" });
    assert.equal(readTypedDomain("northline.io", tlds).kind, "unsupported");
  });
  it("turns on a new ending when the list grows", () => {
    assert.equal(readTypedDomain("northline.biz", [...tlds, "biz"]).kind, "ok");
  });
  it("rejects nonsense", () => {
    assert.equal(readTypedDomain("", tlds).kind, "error");
    assert.equal(readTypedDomain("-bad-.com", tlds).kind, "error");
    assert.equal(readTypedDomain("a..com", tlds).kind, "error");
  });
});

describe("round 11: ideas stay inside the allowed endings", () => {
  it("drops endings that are not live, repeats and names already shown", () => {
    const out = cleanIdeas(
      [{ name: "brightkettle", tld: "com" }, { name: "brightkettle", tld: "com" }, { name: "kettlehq", tld: "biz" }, "sunnyoak.net", "taken.com", { name: "Mint & Pine!", tld: ".co" }, { name: "x", tld: "com" }],
      tlds,
      ["taken.com"],
    );
    assert.deepEqual(out, ["brightkettle.com", "sunnyoak.net", "mintpine.co"]);
  });
  it("name-based fallback: only allowed endings, no repeats, rotates on Try again", () => {
    const a = fallbackIdeas(brief, 0, tlds);
    const b = fallbackIdeas(brief, 1, tlds, a);
    assert.ok(a.length >= 10, `${a.length}`);
    for (const d of [...a, ...b]) assert.ok(tlds.includes(splitDomain(d)!.tld), d);
    assert.equal(new Set([...a, ...b]).size, a.length + b.length);
    assert.ok(a.some((d) => d.endsWith(".com")) && a.some((d) => !d.endsWith(".com")));
    assert.ok(a.every((d) => d.startsWith(nameSlug(brief.business_name).slice(0, 3)) || /riverside|tulsa|plumb|get|try|go|my|the/.test(d)), a.join());
  });
  it("labels", () => {
    assert.equal(cleanLabel("Café Nöir"), "cafenoir");
    assert.equal(cleanLabel("a"), "");
  });
  it("shows available first, .com before the other endings", () => {
    const sorted = sortItems(
      [{ domain: "a.net", state: "available" }, { domain: "b.com", state: "taken" }, { domain: "c.com", state: "available" }, { domain: "d.co", state: "unknown" }],
      tlds,
    );
    assert.deepEqual(sorted.map((i) => i.domain), ["c.com", "a.net", "d.co", "b.com"]);
  });
});
