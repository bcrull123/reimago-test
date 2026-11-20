import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isOwnStoredImageUrl, parseOwnStoredImage } from "./own-image.ts";

describe("round 10d: own stored image URLs", () => {
  it("accepts logos and photos this app stored, on http or https", () => {
    const logo = parseOwnStoredImage("https://reimago.ai/made/0123456789abcdef/img/upload-logo");
    assert.deepEqual(logo, { host: "reimago.ai", id: "0123456789abcdef", name: "upload-logo" });
    const photo = parseOwnStoredImage("http://localhost:8080/made/aaaaaaaaaaaaaaaa/img/upload-photo-2");
    assert.equal(photo?.name, "upload-photo-2");
    assert.equal(isOwnStoredImageUrl("https://x.example/made/0123456789abcdef/img/ai-logo-1"), true);
    assert.equal(isOwnStoredImageUrl("https://evil.example/made/../img/x"), false);
    assert.equal(isOwnStoredImageUrl("https://reimago.ai/made/0123456789abcdef/img/not_valid"), false);
  });
});
