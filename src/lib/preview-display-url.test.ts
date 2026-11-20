import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { currentPreviewPrefix, displayImagePath, displayLookPath, thumbFallbackNames } from "./preview-display-url.ts";

const PORT = "/hds-up68yqz8egcm-6014-7b575";

describe("round 10f: card thumbs load on this origin", () => {
  it("uses a same-origin /made path, never a foreign host or http: URL", () => {
    const local = { hostname: "reimago.ai", pathname: "/" };
    assert.equal(displayLookPath("0123456789abcdef", local), "/made/0123456789abcdef");
    assert.equal(displayImagePath("0123456789abcdef", "hero", local), "/made/0123456789abcdef/img/hero");
    const preview = { hostname: "preview.grokgsac.com", pathname: `${PORT}/` };
    assert.equal(currentPreviewPrefix(preview), PORT);
    assert.equal(displayLookPath("0123456789abcdef", preview), `${PORT}/made/0123456789abcdef`);
  });
  it("orders fallback images: hero, Imagine art, then the owner's photos", () => {
    assert.deepEqual(thumbFallbackNames(["photo-2", "capture", "hero", "upload-logo", "art-1", "photo-1"]), ["hero", "art-1", "photo-1", "photo-2"]);
    assert.deepEqual(thumbFallbackNames([]), []);
  });
});
