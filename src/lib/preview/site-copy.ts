/**
 * Round 16b — drop scraped junk (form country lists, validation strings, cookie
 * banners) so it never lands in a hero, lead, or about blurb.
 */
const COUNTRY_MARKERS = [
  "british indian ocean territory",
  "united states minor outlying islands",
  "heard island and mcdonald islands",
  "south georgia and the south sandwich islands",
  "svalbard and jan mayen",
  "cocos (keeling) islands",
  "åland islands",
  "aland islands",
  "saint pierre and miquelon",
  "virgin islands, british",
  "virgin islands, u.s.",
  "korea, democratic people's",
  "korea, republic of",
  "moldova, republic of",
  "tanzania, united republic",
  "macedonia, the former yugoslav",
  "lao people's democratic",
  "palestine, state of",
  "brunei darussalam",
  "congo, the democratic republic",
  "falkland islands (malvinas)",
  "saint kitts and nevis",
  "saint vincent and the grenadines",
  "bosnia and herzegovina",
  "antigua and barbuda",
  "trinidad and tobago",
  "papua new guinea",
  "central african republic",
  "dominican republic",
  "equatorial guinea",
  "marshall islands",
  "solomon islands",
  "cayman islands",
  "faroe islands",
  "cook islands",
];

const FORM_JUNK =
  /\b(?:this field is required|is required\.?$|a valid selection must be made|must be a valid|please (?:enter|fill|select|provide|choose|answer)|invalid (?:email|phone|url|date|selection|number|entry)|passwords? should not|country code should|please complete this field|select (?:a )?country|choose (?:a )?country|this form is protected by recaptcha|protected by recaptcha|recaptcha requires|error:?\s*please|there (?:was|were) (?:an error|errors?|a problem)|form validation|required field|required question|missing a required question|email addresses should follow|should follow the format|user@domain\.com|invalid question|contained an invalid|captcha validation|validation failed)\b/i;

const COOKIE_JUNK =
  /\b(?:we use cookies|this (?:site|website) uses cookies|accept (?:all )?cookies|cookie (?:policy|preferences|settings|banner|consent)|manage cookies|reject (?:all )?cookies|by (?:using|continuing to use) this (?:site|website) you (?:agree|consent))\b/i;

const VALIDATION_RULE =
  /\b(?:must (?:contain|be|have|include)|should (?:contain|be|have|follow)|may only contain|only (?:digits|letters|numbers|alphanumeric)|no other characters|valid (?:names?|emails?|numbers?|phones?|selections?|inputs?|fields?) (?:contain|must)|contain only (?:letters|digits|numbers)|alphanumeric characters|unable to submit|please try again later|submit form)\b/i;

const PLATFORM_JUNK =
  /\b(?:powered by squarespace|website coming soon|you need to enable javascript|please enable javascript|skip to (?:main )?content)\b/i;

function countryHits(lower: string): number {
  let n = 0;
  for (const name of COUNTRY_MARKERS) if (lower.includes(name)) n += 1;
  return n;
}

/** True when a scraped line is a country list, form error, cookie banner, or similar chrome. */
export function isJunkCopy(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  if (countryHits(lower) >= 1 && (countryHits(lower) >= 2 || /british indian ocean territory|united states minor outlying/.test(lower))) return true;
  if (FORM_JUNK.test(t) || VALIDATION_RULE.test(t) || COOKIE_JUNK.test(t) || PLATFORM_JUNK.test(t)) return true;
  const parts = t.split(/[,;|]|\n/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 8) {
    const names = parts.filter((p) => /^[A-ZÀ-ÖØ-Þ][\p{L} .''()-]{2,40}$/u.test(p)).length;
    if (names >= 6) return true;
  }
  return false;
}

/** Drop junk sentences / lines from a longer scraped string. */
export function scrubCopy(text: string): string {
  if (!text) return "";
  const parts = text.split(/(?<=[.!?])\s+|\n+/).map((p) => p.trim()).filter((p) => p && !isJunkCopy(p));
  const out = parts.join(" ").replace(/\s+/g, " ").trim();
  return !out || isJunkCopy(out) ? "" : out;
}

export function scrubLines(lines: string[]): string[] {
  return lines.map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l && !isJunkCopy(l));
}
