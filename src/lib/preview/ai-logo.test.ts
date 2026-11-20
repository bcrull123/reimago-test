import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { logoFileStem, logoProblem, logoSpecs, logoWord, type LogoBrief } from "./ai-logo.ts";
import { standInLogoPng } from "./ai-logo-standin.ts";

const glow: LogoBrief = {
  business_name: "Glow Studio",
  what: "Hair color and cuts for busy professionals",
  location: "Austin, Texas",
  style: "warm, modern",
  domain: "glowstudio.com",
};

describe("round 10b: AI logo brief and prompts", () => {
  it("needs a business name or a domain first", () => {
    assert.match(logoProblem({ business_name: "", domain: "" }), /business name/);
    assert.match(logoProblem({ business_name: "   ", domain: "" }), /business name/);
    assert.equal(logoProblem({ business_name: "Glow Studio", domain: "" }), "");
    assert.equal(logoProblem({ business_name: "", domain: "https://www.glowstudio.com/" }), "");
    assert.equal(logoWord({ business_name: "Glow Studio", domain: "other.com" }), "Glow Studio");
    assert.equal(logoWord({ business_name: "", domain: "https://www.glowstudio.com/about" }), "glowstudio.com");
  });

  it("makes three generic prompts, wordmark first, using the answers on the form", () => {
    const specs = logoSpecs(glow);
    assert.equal(specs.length, 3);
    assert.deepEqual(specs.map((s) => s.kind), ["wordmark", "icon_name", "emblem"]);
    assert.equal(specs[0]!.label, "Wordmark");
    for (const s of specs) {
      assert.match(s.prompt, /Glow Studio/);
      assert.match(s.prompt, /Hair color and cuts/);
      assert.match(s.prompt, /Austin, Texas/);
      assert.match(s.prompt, /warm, modern/);
      assert.match(s.prompt, /plain solid off-white/i);
      assert.doesNotMatch(s.prompt, /Photograph only|no text, letters, numbers/i);
    }
    assert.match(specs[0]!.prompt, /wordmark/i);
    assert.match(specs[1]!.prompt, /icon or monogram/i);
    assert.match(specs[2]!.prompt, /emblem or badge/i);
  });

  it("letters the domain when there is no business name, and is not hard-coded to one trade", () => {
    const domainOnly = logoSpecs({ business_name: "", what: "", location: "", style: "", domain: "riverside-plumbing.com" });
    assert.match(domainOnly[0]!.prompt, /riverside-plumbing\.com/);
    assert.doesNotMatch(domainOnly[0]!.prompt, /Glow Studio|Hair color/);
    const plumber = logoSpecs({ ...glow, business_name: "Riverside Plumbing", what: "Emergency plumbing repairs", location: "Oklahoma City", style: "trustworthy navy", domain: "" });
    assert.match(plumber[0]!.prompt, /Riverside Plumbing/);
    assert.match(plumber[0]!.prompt, /Emergency plumbing/);
    assert.doesNotMatch(plumber[0]!.prompt, /Glow Studio|Hair color|Austin/);
  });

  it("changes the prompt on Make more, and names the file from the word and kind", () => {
    const first = logoSpecs(glow, 0)[0]!.prompt;
    const again = logoSpecs(glow, 1)[0]!.prompt;
    assert.match(again, /take 2/i);
    assert.notEqual(first, again);
    assert.equal(logoFileStem("Glow Studio", "wordmark"), "glow-studio-wordmark");
    assert.equal(logoFileStem("Glow Studio", "icon_name"), "glow-studio-icon-name");
  });
});

describe("round 10b: stand-in logos for tests", () => {
  it("paints a readable square PNG of the name, different per kind and variation", () => {
    const a = standInLogoPng("Glow Studio", "wordmark");
    const b = standInLogoPng("Glow Studio", "icon_name");
    const c = standInLogoPng("Glow Studio", "emblem");
    const d = standInLogoPng("Glow Studio", "wordmark", 1);
    const e = standInLogoPng("Riverside Plumbing", "wordmark");
    const hashes = [a, b, c, d, e].map((buf) => {
      assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      const img = PNG.sync.read(buf);
      assert.equal(img.width, 512);
      assert.equal(img.height, 512);
      assert.ok(buf.length > 800, `tiny png (${buf.length})`);
      return createHash("sha1").update(buf).digest("hex");
    });
    assert.equal(new Set(hashes).size, 5, "each kind, variation and name should look different");
  });
});
