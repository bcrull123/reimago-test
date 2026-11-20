/**
 * Round 10b — "Have AI make one": a few logo options from the Build a New Site answers (no hard-coded business).
 * The first is a styled wordmark of the business name, or the domain if that's all they entered; the others are a
 * simple icon + name, and a small emblem. Prompts ask for clean, legible marks on a plain background.
 */
import { bareHost } from "../new-site.ts";

export type LogoKind = "wordmark" | "icon_name" | "emblem";

export type LogoBrief = {
  business_name: string;
  what: string;
  location: string;
  style: string;
  domain: string;
};

export type LogoSpec = { kind: LogoKind; label: string; prompt: string };

/** One generated option the visitor can pick (same shape whether Imagine or a stand-in made it). */
export type LogoOption = { id: string; url: string; kind: LogoKind; label: string };

/** The name (or domain) lettered on the mark. */
export function logoWord(brief: Pick<LogoBrief, "business_name" | "domain">): string {
  const name = brief.business_name.trim();
  if (name) return name.slice(0, 60);
  return bareHost(brief.domain).slice(0, 60);
}

/** What's missing before we can design a logo (empty = ready). */
export function logoProblem(brief: Pick<LogoBrief, "business_name" | "domain">): string {
  if (logoWord(brief)) return "";
  return "Enter your business name first (or your domain under “I have a domain”), then I can design a logo.";
}

const KINDS: { kind: LogoKind; label: string }[] = [
  { kind: "wordmark", label: "Wordmark" },
  { kind: "icon_name", label: "Icon and name" },
  { kind: "emblem", label: "Emblem" },
];

const SHARED =
  "Clean vector-like logo, generous padding, centered, high contrast, sharp edges, no photography, no scenery, no people, no stock-photo objects, no desk or paper mockup, no drop shadow of a card, no watermark, no app icon grid, no extra words, no tagline, no website URL, no address, no slogan. Plain solid off-white or very light neutral background (or a transparent-looking field). The mark must be immediately legible at small sizes.";

function kindBrief(kind: LogoKind, word: string, variation: number): string {
  const again = variation > 0 ? ` This is take ${variation + 1}: use a clearly different typographic style and layout than a previous take.` : "";
  if (kind === "wordmark") {
    return `A professional logo wordmark. The only text in the image is exactly "${word}", set in distinctive, highly legible custom typography, as a single line or a tidy two-line stack if the name is long. No icon, no symbol, no monogram, no decorative badge behind the letters — just the name, beautifully styled.${again}`;
  }
  if (kind === "icon_name") {
    return `A professional logo: one simple original icon or monogram (geometric, not clip-art, not a photograph) beside or above the name. The only text in the image is exactly "${word}". The icon may hint at the kind of work without being literal or cliché.${again}`;
  }
  return `A professional emblem or badge logo: a simple monogram or symbol inside a clean circle, rounded square, or shield, with the name lettered around or just below it. The only text in the image is exactly "${word}" (initials may appear in the monogram).${again}`;
}

function contextLines(brief: LogoBrief): string {
  const bits = [
    brief.what.trim() && `The business: ${brief.what.trim().slice(0, 300)}.`,
    brief.location.trim() && `Area: ${brief.location.trim().slice(0, 80)}.`,
    brief.style.trim() && `Style notes from the owner: ${brief.style.trim().slice(0, 300)}.`,
    bareHost(brief.domain) && `Their domain is ${bareHost(brief.domain)}.`,
  ].filter(Boolean);
  return bits.join(" ");
}

/** Three Imagine prompts (wordmark first) from the answers already on the form. Generic for any business. */
export function logoSpecs(brief: LogoBrief, variation = 0): LogoSpec[] {
  const word = logoWord(brief);
  const context = contextLines(brief);
  return KINDS.map(({ kind, label }) => ({
    kind,
    label,
    prompt: `A professional logo for a business named "${word}". ${kindBrief(kind, word, Math.max(0, Math.floor(variation)))} ${context} ${SHARED}`.replace(/\s+/g, " ").trim(),
  }));
}

export const LOGO_STATUS = [
  "Sketching a wordmark with your name…",
  "Drawing a simple mark…",
  "Laying the letters just so…",
  "Trying a couple of takes…",
];

/** A short file stem for the chosen logo (no path, no extension). */
export function logoFileStem(word: string, kind: LogoKind): string {
  const slug = word
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "logo";
  return `${slug}-${kind.replace("_", "-")}`;
}
