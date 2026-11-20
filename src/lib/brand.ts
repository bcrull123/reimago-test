/**
 * White-label clone config. A clone edits only these three values. Everything in the
 * app chrome that used to be "Reimago orange" or the header name reads from here:
 * the top header, marketing bubble accents, mode buttons, selected state, progress
 * ring, and accent links. The marketing bubble itself is generic — no product name
 * or logo — so it does not need a per-clone edit.
 */
export const BRAND = {
  /** Domain-name text shown in the top header as styled text. */
  name: "reimago.ai",
  /**
   * Optional small header logo (fixed max height ~36px, object-fit contain).
   * Leave empty for the default text-only header. When set, it appears beside the name.
   */
  logoUrl: "",
  /** Brand color. Drives the `--brand` CSS variable and its derived dark/light/glow shades. */
  color: "#f89800",
} as const;

/** Split "reimago.ai" into head + mark ("reimago" / ".ai") so the last part can take the brand color. */
export function brandNameParts(name: string = BRAND.name): { head: string; mark: string } {
  const at = name.lastIndexOf(".");
  if (at <= 0) return { head: name, mark: "" };
  return { head: name.slice(0, at), mark: name.slice(at) };
}
