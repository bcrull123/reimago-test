import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isJunkCopy, scrubCopy, scrubLines } from "./site-copy.ts";

describe("scraped junk copy", () => {
  it("drops Squarespace country lists, form errors, and cookie banners", () => {
    const countries =
      "Afghanistan, Åland Islands, Albania, Algeria, American Samoa, Andorra, Angola, Anguilla, Antarctica, Antigua and Barbuda, Argentina, Armenia, Aruba, Australia, Austria, Azerbaijan, Bahamas, Bahrain, Bangladesh, Barbados, Belarus, Belgium, Belize, Benin, Bermuda, Bhutan, Bolivia, Bosnia and Herzegovina, Botswana, Brazil, British Indian Ocean Territory, Brunei Darussalam, Bulgaria, Burkina Faso, Burundi, United States Minor Outlying Islands";
    assert.equal(isJunkCopy(countries), true);
    assert.equal(isJunkCopy("British Indian Ocean Territory, United States Minor Outlying Islands, Heard Island and McDonald Islands"), true);
    assert.equal(isJunkCopy("A valid selection must be made"), true);
    assert.equal(isJunkCopy("This field is required"), true);
    assert.equal(isJunkCopy("We use cookies to improve your experience. Accept all cookies."), true);
    assert.equal(isJunkCopy("Email addresses should follow the format user@domain.com."), true);
    assert.equal(isJunkCopy("Missing a required question."), true);
    assert.equal(isJunkCopy("Contained an invalid question."), true);
    assert.equal(isJunkCopy("Captcha validation failed."), true);
    assert.equal(isJunkCopy("Numbers must contain only digits and no other characters."), true);
    assert.equal(isJunkCopy("Valid names contain only letters, numbers, spaces, ', or - characters."), true);
    assert.equal(isJunkCopy("Lunch, dinner, and brunch on the boulevard."), false);
    assert.equal(scrubCopy(`Lunch, dinner, and brunch on the boulevard. ${countries} Please fill out this field.`), "Lunch, dinner, and brunch on the boulevard.");
    assert.deepEqual(scrubLines(["Come hungry.", countries, "This field is required", "Open daily."]), ["Come hungry.", "Open daily."]);
  });
});
