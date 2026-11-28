/**
 * Round 16 — card blurbs must start with a capital letter and never be cut off mid-sentence.
 */

export function finalizeBlurb(text: string, max = 240): string {
  let t = text.replace(/\s+/g, " ").trim();
  if (!t) return t;
  t = t.replace(/^[^A-Za-z0-9“"']+/, "").trim();
  if (!t) return t;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (t.length <= max) return t;
  const sliced = t.slice(0, max);
  const lastStop = Math.max(sliced.lastIndexOf(". "), sliced.lastIndexOf("? "), sliced.lastIndexOf("! "));
  if (lastStop >= 80) return sliced.slice(0, lastStop + 1).trim();
  const lastComma = sliced.lastIndexOf(", ");
  if (lastComma >= 80) return `${sliced.slice(0, lastComma).trim()}.`;
  const lastSpace = sliced.lastIndexOf(" ");
  return lastSpace >= 80 ? `${sliced.slice(0, lastSpace).trim()}.` : `${sliced.trim().replace(/[,:;–-]+$/, "")}.`;
}

export function startsLowercase(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  return /^[a-z]/.test(t);
}
