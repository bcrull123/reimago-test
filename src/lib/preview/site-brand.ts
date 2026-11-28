/**
 * Round 16–16b — extract a recognizable brand from the scraped site (colors including
 * black grounds, font feel, nav, CTAs) so “Your Site, Improved” can follow it.
 */
import { BODY_FONTS, HEADING_FONTS, luminance, readablePalette } from "./design.ts";
import { isFoodSite, type GuardFacts } from "./copy-guard.ts";
import { finalizeBlurb } from "./blurb.ts";
import type { SiteFacts, SitePalette } from "./types.ts";

export const IMPROVED_NAME = "Your Site, Improved";
export const SUNLIT_NAME = "Sunlit Cut";

const NEAR_BLACK = (rgb: [number, number, number]) => (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 < 40;
const NEAR_WHITE = (rgb: [number, number, number]) => (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 230;

function hexToRgb(raw: string): [number, number, number] | undefined {
  const h = raw.replace("#", "");
  if (h.length === 3) {
    const r = Number.parseInt(h[0]! + h[0], 16);
    const g = Number.parseInt(h[1]! + h[1], 16);
    const b = Number.parseInt(h[2]! + h[2], 16);
    return Number.isFinite(r + g + b) ? [r, g, b] : undefined;
  }
  if (h.length !== 6) return undefined;
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return Number.isFinite(r + g + b) ? [r, g, b] : undefined;
}

function hexOf(rgb: [number, number, number]): string {
  return `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s > 1 ? s / 100 : s;
  const lit = l > 1 ? l / 100 : l;
  const hue = ((h % 360) + 360) % 360;
  const a = sat * Math.min(lit, 1 - lit);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    return lit - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [0, 8, 4].map((n) => Math.round(f(n) * 255)) as [number, number, number];
}

/** Parse #hex, rgb(), hsl(), or hsla() into an rgb triple. */
export function parseCssColor(raw: string, vars?: Map<string, string>): [number, number, number] | undefined {
  let t = raw.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  if (t === "black") return [0, 0, 0];
  if (t === "white") return [255, 255, 255];
  // Resolve var(--token) or hsla(var(--black-hsl), 1).
  const varRef = t.match(/^var\(--([A-Za-z0-9_-]+)\)(?:,\s*(.+))?$/i);
  if (varRef && vars?.has(varRef[1]!)) return parseCssColor(vars.get(varRef[1]!)!, vars);
  const hslaVar = t.match(/^hsla?\(\s*var\(--([A-Za-z0-9_-]+)\)\s*(?:,\s*[\d.]+%?)?\s*\)$/i);
  if (hslaVar && vars?.has(hslaVar[1]!)) {
    const inner = vars.get(hslaVar[1]!)!;
    if (/^\s*[\d.]+(?:deg)?\s*,/.test(inner) || /^\s*[\d.]+(?:deg)?\s+/.test(inner)) {
      const parts = inner.split(/[,\s]+/).filter((p) => p && p !== "/");
      const h = Number.parseFloat(parts[0] ?? "");
      const s = Number.parseFloat((parts[1] ?? "").replace("%", ""));
      const l = Number.parseFloat((parts[2] ?? "").replace("%", ""));
      if ([h, s, l].every(Number.isFinite)) return hslToRgb(h, s, l);
    }
    return parseCssColor(inner, vars);
  }
  const hex = hexToRgb(t.startsWith("#") ? t : t);
  if (hex) return hex;
  const rgb = t.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) return [0, 1, 2].map((i) => Math.round(Number.parseFloat(rgb[i + 1]!))) as [number, number, number];
  const hsl = t.match(/^hsla?\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i);
  if (hsl) return hslToRgb(Number.parseFloat(hsl[1]!), Number.parseFloat(hsl[2]!), Number.parseFloat(hsl[3]!));
  return undefined;
}

export function cssVariables(sources: string[]): Map<string, string> {
  const vars = new Map<string, string>();
  for (const source of sources) {
    for (const m of source.matchAll(/--([A-Za-z0-9_-]+)\s*:\s*([^;}{]+)/g)) {
      vars.set(m[1]!, m[2]!.trim());
    }
  }
  return vars;
}

function lastVarColor(vars: Map<string, string>, names: string[]): [number, number, number] | undefined {
  for (const name of names) {
    const raw = vars.get(name);
    if (!raw) continue;
    const rgb = parseCssColor(raw, vars);
    if (rgb) return rgb;
  }
  return undefined;
}

/** Near-black / near-white brand grounds that `brandColors` skips as too dull. */
export function brandInks(sources: string[], themeColor = "", html = ""): string[] {
  const counts = new Map<string, number>();
  const addRgb = (rgb: [number, number, number] | undefined, weight: number) => {
    if (!rgb) return;
    if (!NEAR_BLACK(rgb) && !NEAR_WHITE(rgb)) return;
    const hex = hexOf(rgb);
    counts.set(hex, (counts.get(hex) ?? 0) + weight);
  };
  const vars = cssVariables(sources);
  if (themeColor) addRgb(parseCssColor(themeColor, vars), 40);
  if (pageIsDarkBrand(sources, html || sources.join("\n"))) addRgb([0, 0, 0], 120);
  // Do not trust the last --siteBackgroundColor in a theme stylesheet: Squarespace redeclares it
  // for every section theme. Homepage section tags (pageIsDarkBrand) are the signal.
  for (const source of sources) {
    for (const match of source.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/g)) addRgb(hexToRgb(`#${match[1]}`), 1);
    for (const match of source.matchAll(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/g)) {
      addRgb([Number.parseFloat(match[1]!), Number.parseFloat(match[2]!), Number.parseFloat(match[3]!)] as [number, number, number], 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex).slice(0, 6);
}

/** Homepage section themes (Squarespace `data-section-theme="black"`) plus CSS background vars. */
export function pageIsDarkBrand(sources: string[], html = ""): boolean {
  // Squarespace: "black" / "white" / "bright" are backgrounds. "dark" / "light" are often
  // text contrast on a photo, and should not flip a civic cream site to a black brand.
  const themes = [...html.matchAll(/<[^>]*\sdata-section-theme=["']([^"']+)["']/gi)].map((m) => m[1]!.toLowerCase());
  const darkThemes = themes.filter((t) => /^(black|midnight|charcoal)$/.test(t)).length;
  const lightThemes = themes.filter((t) => /^(white|bright|cream)$/.test(t)).length;
  if (darkThemes > lightThemes) return true;
  return false;
}

function closestFont(name: string, pool: string[]): string | undefined {
  const n = name.toLowerCase().replace(/['"]/g, "");
  return pool.find((f) => n === f.toLowerCase() || n.includes(f.toLowerCase()) || f.toLowerCase().includes(n));
}

export function improvedFonts(facts: Pick<SiteFacts, "fonts" | "colors" | "inks">): { heading: string; body: string } {
  const listed = (facts.fonts ?? []).map((f) => f.trim()).filter(Boolean);
  const heading = listed.map((f) => closestFont(f, HEADING_FONTS)).find(Boolean) ?? "Inter";
  const body =
    listed
      .map((f) => closestFont(f, BODY_FONTS))
      .find((f) => f && f !== heading) ?? (heading === "Inter" ? "Source Sans 3" : "Inter");
  return { heading, body };
}

/** Squarespace / player / browser chrome — never a site's brand accent. */
export const UI_ACCENT_JUNK = new Set([
  "#f0523d",
  "#e4351e",
  "#00b2ff",
  "#ffff00",
  "#00ff00",
  "#ff00ff",
  "#00ffff",
  "#ff0000",
  "#0000ff",
]);

/** True for delete/error reds, neon primaries, and similar UI leftovers. */
export function isUiAccent(hex: string): boolean {
  const h = hex.toLowerCase();
  if (UI_ACCENT_JUNK.has(h)) return true;
  const rgb = hexToRgb(h);
  if (!rgb) return false;
  const ch = rgb.map((v) => (v >= 250 ? 1 : v <= 5 ? 0 : 2));
  if (ch.includes(2)) return false;
  const lit = ch.filter((v) => v === 1).length;
  return lit >= 1 && lit <= 2;
}

const ACCENT_VAR_NAMES = [
  "sqsp-palette-accent-color",
  "accent-hsl",
  "accent",
  "safeDarkAccent-hsl",
  "primaryButtonBackgroundColor",
  "secondaryButtonBackgroundColor",
  "lightAccent-hsl",
];

/**
 * Brand accents from CSS variables first (Squarespace --accent-hsl), then frequent hexes,
 * skipping UI junk so Cafe 501 keeps its slate navy instead of tooltip red / player blue.
 */
export function brandAccents(sources: string[], themeColor = ""): string[] {
  const counts = new Map<string, number>();
  const add = (rgb: [number, number, number] | undefined, weight: number) => {
    if (!rgb) return;
    const hex = hexOf(rgb);
    if (isUiAccent(hex) || NEAR_BLACK(rgb) || NEAR_WHITE(rgb)) return;
    counts.set(hex, (counts.get(hex) ?? 0) + weight);
  };
  const vars = cssVariables(sources);
  if (themeColor) add(parseCssColor(themeColor, vars), 40);
  for (const name of ACCENT_VAR_NAMES) {
    const raw = vars.get(name);
    if (raw) add(parseCssColor(raw, vars), 160);
  }
  add(lastVarColor(vars, ACCENT_VAR_NAMES), 80);
  for (const source of sources) {
    for (const match of source.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) add(hexToRgb(`#${match[1]}`), 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex).slice(0, 4);
}

/** A readable palette that keeps the current site's ink (e.g. Cafe 501's black) and accent colors. */
export function improvedPalette(facts: Pick<SiteFacts, "colors" | "inks" | "name" | "darkBrand">): SitePalette {
  const inks = (facts.inks ?? []).map((c) => c.toLowerCase());
  const accents = (facts.colors ?? []).map((c) => c.toLowerCase()).filter((c) => /^#[0-9a-f]{6}$/.test(c) && !isUiAccent(c));
  const inkRgb = inks.map(hexToRgb).filter((c): c is [number, number, number] => Boolean(c));
  const darkInk = inkRgb.filter((c) => NEAR_BLACK(c));
  const lightInk = inkRgb.filter((c) => NEAR_WHITE(c));
  // Unique light tokens (#fff, #f6f6f6, #ddd) must not outweigh a real black site background.
  const first = inkRgb[0];
  const isDarkBrand =
    facts.darkBrand === true ? true
    : facts.darkBrand === false ? false
    : Boolean(first && NEAR_BLACK(first)) || (darkInk.length > 0 && darkInk.length >= lightInk.length);
  const background = isDarkBrand ? hexOf(darkInk[0] ?? first ?? [0, 0, 0]) : first && NEAR_WHITE(first) ? hexOf(first) : lightInk[0] ? hexOf(lightInk[0]!) : "#f7f4ee";
  const text = isDarkBrand ? "#f4efe8" : "#16181d";
  const surface = isDarkBrand ? mixHex(background, "#ffffff", 0.08) : mixHex(background, "#000000", 0.04);
  const muted = isDarkBrand ? "#c8c0b6" : "#4f5661";
  const usable = accents.filter((c) => Math.abs(luminance(c) - luminance(background)) > 0.02);
  const accent = usable[0] ?? (isDarkBrand ? "#e8b86d" : "#0f7a6b");
  const primary = usable.find((c) => c !== accent) ?? (isDarkBrand ? "#f4efe8" : "#1b365d");
  return readablePalette({ primary, accent, background, surface, text, muted }, { primary, accent, background, surface, text, muted });
}

function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a) ?? [0, 0, 0];
  const y = hexToRgb(b) ?? [255, 255, 255];
  return hexOf([0, 1, 2].map((i) => Math.round(x[i]! + (y[i]! - x[i]!) * t)) as [number, number, number]);
}

export type ImprovedCta = { label: string; page: string };

export function improvedCtas(facts: SiteFacts): { primary: ImprovedCta; secondary?: ImprovedCta } {
  const nav = (facts.nav ?? []).map((n) => ({ label: n.label.replace(/\s+/g, " ").trim(), href: n.url, slug: slugFromNav(n.url, n.label) }));
  const find = (...re: RegExp[]) => nav.find((n) => re.some((r) => r.test(`${n.label} ${n.slug}`)));
  const food = isFoodSite(facts as GuardFacts);
  if (food) {
    const menu = find(/\bmenu\b/i, /\bfood\b/i);
    const reserve = find(/\breserv/i, /\bbook\b/i, /\btable\b/i);
    const order = find(/\border\b/i, /\bonline\b/i, /\btakeout\b/i, /\bdelivery\b/i);
    const primary = menu
      ? { label: /^view /i.test(menu.label) ? menu.label : "View Menu", page: menu.slug }
      : order
        ? { label: "Order Online", page: order.slug }
        : reserve
          ? { label: "Reserve", page: reserve.slug }
          : facts.phone
            ? { label: "Call", page: "contact" }
            : { label: "View Menu", page: "menu" };
    const secondary = facts.phone && primary.label !== "Call" ? { label: "Call", page: "contact" } : reserve && primary.page !== reserve.slug ? { label: "Reserve", page: reserve.slug } : { label: "Visit us", page: "contact" };
    return { primary, secondary };
  }
  const quote = find(/\bquote\b/i, /\bestimate\b/i);
  const contact = find(/\bcontact\b/i, /\breach\b/i);
  const services = find(/\bservice\b/i, /\bwhat we do\b/i);
  const primary = quote
    ? { label: "Get a Quote", page: quote.slug }
    : facts.phone
      ? { label: "Call", page: "contact" }
      : contact
        ? { label: contact.label.slice(0, 22) || "Get in touch", page: contact.slug }
        : { label: "Get in touch", page: "contact" };
  const secondary = services ? { label: services.label.slice(0, 22) || "Services", page: services.slug } : contact && primary.page !== contact.slug ? { label: "Contact", page: contact.slug } : undefined;
  return { primary, secondary };
}

function slugFromNav(url: string, label: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? "";
    if (path && !/\.(html?|php|aspx?)$/i.test(path)) return path.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "contact";
  } catch {
    /* ignore */
  }
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "contact";
}

export function brandColorWord(facts: Pick<SiteFacts, "colors" | "inks" | "name" | "darkBrand">): string {
  const palette = improvedPalette(facts);
  const l = luminance(palette.background);
  if (l < 0.12) return "black";
  if (l < 0.28) return "dark";
  if (l > 0.85) return "light";
  return "existing";
}

export function improvedMood(facts: SiteFacts): string {
  const who = facts.name?.trim() || "this business";
  const { primary } = improvedCtas(facts);
  const ink = brandColorWord(facts);
  const food = isFoodSite(facts as GuardFacts);
  if (facts.mode === "create" || !facts.sourceUrl) {
    return finalizeBlurb(`A clean first site in your brand: your colors, a clear ${primary.label} button, and room for your photos.`);
  }
  const photo = food ? "your food up front" : "your best photos up front";
  const color = ink === "existing" ? "your brand colors" : `same ${ink} brand`;
  return finalizeBlurb(`Your current ${who} look, refreshed: ${color}, ${photo}, a clear ${primary.label} button.`);
}

export function improvedHeadline(facts: SiteFacts): string {
  const food = isFoodSite(facts as GuardFacts);
  if (food) return "Come hungry. Eat well.";
  if (facts.tagline && facts.tagline.length <= 48 && !/welcome to/i.test(facts.tagline)) return facts.tagline.replace(/\s+/g, " ").trim();
  return facts.name ? `${facts.name}, clearer.` : "A better first impression.";
}

/** Words / labels that mean a cropped typography graphic, not a photograph. */
export const TEXT_GRAPHIC =
  /\b(lettering|typography|typographic|wordmark|word[ -]?mark|type treatment|text graphic|cropped text|letters only|monogram|lockup|logotype|logo[ -]?mark|banner type|marquee letters?|masthead|word[- ]?art)\b/i;

const PHOTO_SCENE =
  /\b(food|dish|dishes|plate|plates|meal|brunch|interior|exterior|dining|room|kitchen|patio|storefront|building|facade|people|chef|table|street|downtown|portrait|garden|park)\b/i;

export function isTextGraphicLabel(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (TEXT_GRAPHIC.test(t) && !PHOTO_SCENE.test(t)) return true;
  if (/\b(logo|wordmark|logotype|lockup)\b/i.test(t) && !/\b(storefront|building|sign in front)\b/i.test(t)) return true;
  // Short all-caps fragments like “FES ED” from a cropped poster.
  const letters = t.replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (/^([A-Z]{2,4}\s+){1,3}[A-Z]{2,4}$/.test(letters) && letters.length <= 16) return true;
  const file = t.replace(/[._\-/]+/g, " ");
  if (/\b(logo|wordmark|lockup|logotype|masthead|word ?mark|typograph)\b/i.test(file) && !PHOTO_SCENE.test(file)) return true;
  return false;
}

/** Alt / filename that is just the business name (or a fragment), i.e. a wordmark, not a photograph. */
export function isWordmarkLike(text: string, name = ""): boolean {
  if (isTextGraphicLabel(text)) return true;
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || !name || PHOTO_SCENE.test(t)) return false;
  const tokens = (s: string) =>
    s
      .toLowerCase()
      // Hostnames like cafe501.com would otherwise look like the business name.
      .replace(/https?:\/\/[^/\s]+/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 1 && !/^(the|and|of|for|at|in|to|a|an|logo|banner|header|hero|image|photo|img|graphic|brand|site|homepage|home|og|icon|mark|jpg|jpeg|png|webp|www|com|net|org|html)$/.test(w));
  const named = tokens(name);
  const words = tokens(t);
  if (!named.length || !words.length) return false;
  const same = (w: string, n: string) => w === n;
  const hit = words.filter((w) => named.some((n) => same(w, n)));
  // Filename “Cafe+501+Ed+white.png” is a wordmark: every name token is present as its own word.
  if (named.every((n) => words.some((w) => same(w, n))) && named.length >= 1) return true;
  if (words.length > 8) return false;
  return hit.length === words.length && hit.length > 0;
}


/** Font family names found in HTML or CSS (Google Fonts links + font-family declarations). */
export function extractFonts(sources: string[]): string[] {
  const fonts = new Set<string>();
  for (const source of sources) {
    for (const m of source.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/gi)) {
      const q = decodeURIComponent(m[1]!.replace(/\+/g, " "));
      for (const fam of q.matchAll(/family=([^:&]+)/g)) fonts.add(fam[1]!.replace(/\+/g, " ").trim());
    }
    for (const m of source.matchAll(/font-family\s*:\s*["']?([A-Za-z][A-Za-z0-9 -]{2,40})/gi)) {
      const name = m[1]!.trim();
      if (!/^(inherit|initial|sans-serif|serif|monospace|system-ui|-apple-system|arial|helvetica|times|georgia|verdana|tahoma|trebuchet|courier|ui-sans|ui-serif|ui-monospace|emoji|fangsong)/i.test(name)) {
        fonts.add(name);
      }
    }
  }
  return [...fonts].slice(0, 6);
}
