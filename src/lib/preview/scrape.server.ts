/**
 * Step 1 of the live preview: read the visitor's site.
 *
 * Fetches the start URL plus up to MAX_EXTRA same-site pages (nav links first,
 * then pages whose path looks like about/services/menu/contact/...). Every hop
 * goes through assertPublic (no private IPs), redirects are followed manually,
 * bodies are size-capped, and non-HTML responses are skipped.
 */
import { requestSignal, stopOrTimeout } from "@/lib/abort.server";
import { collectSiteArt } from "@/lib/preview/site-art";
import { isOwnStoredImageUrl } from "@/lib/preview/own-image";
import {
  REIMAGO_HOSTS,
  REIMAGO_SNAPSHOT,
  assertPublic,
  decode,
  extractLogo,
  fetchPage,
  fixtureSite,
  httpUrl,
  isWordPress,
  MENU_NOISE,
  normalizeInput,
  readCapped,
  scrubPlatform,
  stripChrome,
} from "@/lib/reimagine.server";
import type { ScrapedPage, SiteFacts, SiteNavLink, Testimonial } from "@/lib/preview/types";
import { brandAccents, brandInks, extractFonts, pageIsDarkBrand } from "./site-brand.ts";
import { isJunkCopy, scrubCopy, scrubLines } from "./site-copy.ts";

const MAX_EXTRA = 10;
/** Round 9: a second hop into photo pages (galleries, parks, events…) linked from the first pages. */
const MAX_PHOTO_PAGES = 4;
const PHOTO_PAGE = /gallery|galleries|photos?|pictures|portfolio|parks?|recreation|things-to-do|attractions|events?|festival|tour|rooms|venue|our-work|projects/i;
/** Round 9b: the whole read (homepage, linked pages, photo pages, stylesheets) is capped at 25 s, even on slow sites. */
const TOTAL_BUDGET_MS = 25_000;
const PAGE_TIMEOUT_MS = 12_000;

const BINARY_EXT =
  /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|zip|rar|7z|gz|tar|mp4|mov|avi|webm|mp3|wav|m4a|docx?|xlsx?|pptx?|csv|ics|xml|json|txt|css|js|woff2?|ttf|eot|exe|dmg|apk)$/i;
const SKIP_PATH =
  /\/(wp-admin|wp-login|wp-json|feed|cart|checkout|my-account|account|login|signin|sign-in|register|logout|tag|category|author|search|privacy[a-z-]*|terms[a-z-]*|cookies?[a-z-]*|legal|sitemap|cdn-cgi)(\/|$)|\/page\/\d+/i;
const KEYWORDS: [RegExp, number][] = [
  [/about|our-story|who-we-are|history/i, 5],
  [/service|what-we-do|solutions|treatments|practice-areas/i, 5],
  [/menu|food|drinks|catering/i, 5],
  [/contact|location|directions|find-us|visit/i, 5],
  [/product|shop|store|collections/i, 3],
  [/pricing|prices|rates|packages/i, 3],
  [/review|testimonial/i, 3],
  [/team|staff|people|doctors|attorneys/i, 2],
  [/gallery|portfolio|work|projects|photos|parks?|recreation|attractions|things-to-do|events/i, 4],
  [/faq|hours/i, 2],
];

export function cleanText(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function visible(html: string): string {
  return stripChrome(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function attr(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decode(match?.[2] ?? match?.[3] ?? match?.[4] ?? "").trim();
}

function meta(html: string, key: string): string {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const raw = tag[0];
    if (attr(raw, "property").toLowerCase() === key || attr(raw, "name").toLowerCase() === key) {
      return attr(raw, "content");
    }
  }
  return "";
}

function sameSite(a: string, b: string): boolean {
  return a.replace(/^www\./, "") === b.replace(/^www\./, "");
}

function pathKey(url: URL): string {
  return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "") || "/"}`;
}

type Doc = { url: string; html: string };

function navLinks(html: string, base: URL): SiteNavLink[] {
  const page = stripChrome(html);
  const block =
    page.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0] ??
    page.match(/<header\b[\s\S]*?<\/header>/i)?.[0] ??
    page.match(/id=["'](?:primary-)?menu["'][\s\S]{0,8000}/i)?.[0] ??
    "";
  const out: SiteNavLink[] = [];
  const seen = new Set<string>();
  for (const match of block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const label = scrubPlatform(cleanText(match[2] ?? ""));
    const href = attr(match[1] ?? "", "href");
    if (!label || label.length > 30 || MENU_NOISE.test(label)) continue;
    const url = httpUrl(href, base.toString());
    if (!url) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, url });
    if (out.length >= 10) break;
  }
  return out;
}

export function rankLinks(html: string, base: URL, nav: SiteNavLink[]): URL[] {
  const scores = new Map<string, { url: URL; score: number }>();
  const navUrls = new Set(nav.map((item) => item.url));
  const homeKey = pathKey(base);
  for (const match of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"'#][^"']*)["']/gi)) {
    let next: URL;
    try {
      next = new URL(decode(match[1] ?? ""), base);
    } catch {
      continue;
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") continue;
    if (!sameSite(next.hostname, base.hostname)) continue;
    if (BINARY_EXT.test(next.pathname) || SKIP_PATH.test(next.pathname)) continue;
    if (next.search && !/^\?(page_id|p)=\d+$/.test(next.search)) continue;
    next.hash = "";
    const key = pathKey(next);
    if (key === homeKey) continue;
    let score = navUrls.has(next.toString()) || navUrls.has(match[1] ?? "") ? 6 : 0;
    for (const [pattern, weight] of KEYWORDS) if (pattern.test(next.pathname)) score += weight;
    const depth = next.pathname.split("/").filter(Boolean).length;
    if (depth <= 1) score += 2;
    else if (depth >= 3) score -= 2;
    const prior = scores.get(key);
    if (!prior || prior.score < score) scores.set(key, { url: next, score });
  }
  return [...scores.values()]
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_EXTRA)
    .map((item) => item.url);
}

async function fetchCss(url: string, deadline: number): Promise<string> {
  try {
    let current = new URL(url);
    for (let hop = 0; hop < 3; hop += 1) {
      const remaining = deadline - Date.now();
      if (remaining < 500) return "";
      await assertPublic(current);
      const response = await fetch(current, {
        redirect: "manual",
        signal: stopOrTimeout(Math.min(remaining, 6000)),
        headers: { Accept: "text/css", "User-Agent": "ReimagoReimagine/1.0 (+https://reimago.ai)" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return "";
        current = new URL(location, current);
        continue;
      }
      if (!response.ok || !/text\/css/i.test(response.headers.get("content-type") ?? "")) return "";
      return (await readCapped(response, 400_000)).toString("utf8");
    }
  } catch {
    // Stylesheets are optional.
  }
  return "";
}

function hexToRgb(hex: string): [number, number, number] | null {
  let value = hex.replace("#", "").toLowerCase();
  if (value.length === 3) value = value.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/.test(value)) return null;
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function saturation([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

export function brandColors(sources: string[], themeColor: string): string[] {
  const fromVars = brandAccents(sources, themeColor);
  if (fromVars.length) return fromVars;
  const counts = new Map<string, number>();
  const add = (raw: string, weight: number) => {
    const rgb = hexToRgb(raw);
    if (!rgb) return;
    const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    if (saturation(rgb) < 0.25 || brightness > 235 || brightness < 25) return;
    const hex = `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    if (hex === "#f0523d" || hex === "#e4351e" || hex === "#00b2ff" || hex === "#ffff00") return;
    counts.set(hex, (counts.get(hex) ?? 0) + weight);
  };
  if (themeColor) add(themeColor, 50);
  for (const source of sources) {
    for (const match of source.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) add(`#${match[1]}`, 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([hex]) => hex)
    .slice(0, 4);
}

type LdFacts = {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  hours: string[];
  logo?: string;
  images: string[];
  description?: string;
  reviews: Testimonial[];
  offers: string[];
  sameAs: string[];
  type?: string;
};

function jsonLd(html: string): LdFacts {
  const facts: LdFacts = { hours: [], images: [], reviews: [], offers: [], sameAs: [] };
  const visit = (node: unknown, depth: number): void => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof node !== "object") return;
    const item = node as Record<string, unknown>;
    const type = String(Array.isArray(item["@type"]) ? item["@type"][0] : item["@type"] ?? "");
    const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    const isBusiness = /Organization|Business|Restaurant|Store|Service|Dentist|Physician|Attorney|LegalService|Contractor|Plumber|Electrician|Salon|Spa|Clinic|Hotel|Bakery|Cafe|Bar|Agency|Shop|Place/i.test(type);
    if (isBusiness) {
      facts.type ??= type;
      if (!facts.name && str(item.name)) facts.name = str(item.name);
      if (!facts.phone && str(item.telephone)) facts.phone = str(item.telephone);
      if (!facts.email && str(item.email)) facts.email = str(item.email).replace(/^mailto:/i, "");
      if (!facts.description && str(item.description)) facts.description = str(item.description);
      const logo = item.logo;
      if (!facts.logo) facts.logo = str(logo) || str((logo as Record<string, unknown> | undefined)?.url);
      const address = item.address as Record<string, unknown> | string | undefined;
      if (!facts.address && address) {
        if (typeof address === "string") facts.address = address;
        else {
          const parts = [
            str(address.streetAddress),
            [str(address.addressLocality), [str(address.addressRegion), str(address.postalCode)].filter(Boolean).join(" ")]
              .filter(Boolean)
              .join(", "),
          ].filter(Boolean);
          if (parts.length) facts.address = parts.join(", ");
        }
      }
      const hours = item.openingHours;
      if (typeof hours === "string") facts.hours.push(hours);
      if (Array.isArray(hours)) hours.forEach((h) => typeof h === "string" && facts.hours.push(h));
      const spec = item.openingHoursSpecification;
      if (Array.isArray(spec)) {
        for (const s of spec) {
          if (!s || typeof s !== "object") continue;
          const rec = s as Record<string, unknown>;
          const days = Array.isArray(rec.dayOfWeek) ? rec.dayOfWeek : [rec.dayOfWeek];
          const dayText = days.map((d) => String(d ?? "").replace(/^https?:\/\/schema\.org\//, "").slice(0, 3)).filter(Boolean).join(", ");
          if (dayText && str(rec.opens)) facts.hours.push(`${dayText}: ${str(rec.opens)}–${str(rec.closes)}`);
        }
      }
      if (Array.isArray(item.sameAs)) item.sameAs.forEach((s) => typeof s === "string" && facts.sameAs.push(s));
    }
    const image = item.image;
    if (typeof image === "string") facts.images.push(image);
    else if (Array.isArray(image)) image.forEach((i) => typeof i === "string" && facts.images.push(i));
    if (/Review/i.test(type) && str(item.reviewBody)) {
      const author = item.author as Record<string, unknown> | string | undefined;
      facts.reviews.push({
        quote: str(item.reviewBody).slice(0, 400),
        author: typeof author === "string" ? author : str(author?.name),
      });
    }
    if (/^(Offer|Service|Product|MenuItem)$/i.test(type) && str(item.name)) facts.offers.push(str(item.name));
    for (const value of Object.values(item)) if (value && typeof value === "object") visit(value, depth + 1);
  };
  for (const match of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(match[1] ?? ""), 0);
    } catch {
      // Ignore broken JSON-LD.
    }
  }
  return facts;
}

const PHONE = /(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})\b/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const ADDRESS =
  /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9.' ]{2,40}?\s(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pkwy|Parkway|Hwy|Highway|Pl|Place|Ter|Terrace|Cir|Circle|Trl|Trail|Sq|Square)\b\.?(?:,?\s*(?:Suite|Ste\.?|Unit|#)\s*[\w-]+)?,?\s+[A-Za-z .'-]{2,30},?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?/;
const HOURS_LINE =
  /\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)[a-z]*\.?(?:\s*(?:-|–|—|to|through|thru|&|,)\s*(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)[a-z]*\.?)*\s*:?\s*(?:closed|open 24 hours|\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/gi;

export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length !== 10) return raw.trim();
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function goodEmail(value: string): boolean {
  return (
    EMAIL.test(value) &&
    !/\.(png|jpe?g|gif|webp|svg)$/i.test(value) &&
    !/sentry|wixpress|example\.|domain\.com|email\.com|yourdomain|@2x|godaddy|squarespace/i.test(value)
  );
}

function paragraphs(html: string, min = 40): string[] {
  const out: string[] = [];
  for (const match of visible(html).matchAll(/<(p|li|dd|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = scrubPlatform(cleanText(match[2] ?? ""));
    if (text.length >= min && text.length <= 900 && !/cookie|javascript|copyright|©|all rights reserved/i.test(text)) {
      out.push(text);
    }
  }
  const seen = new Set<string>();
  return scrubLines(out).filter((text) => {
    const key = text.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 160);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function headingsOf(html: string): string[] {
  return [
    ...new Set(
      [...visible(html).matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi)]
        .map((m) => scrubPlatform(cleanText(m[2] ?? "")))
        .filter((h) => h.length > 1 && h.length < 120 && !MENU_NOISE.test(h)),
    ),
  ].slice(0, 20);
}

/** Alt/title text of scraped images by URL, so a photo the owner asks for ("the brick streets") can be found. */
function imagesOf(html: string, base: string, labels?: Map<string, string>): string[] {
  const out: string[] = [];
  const og = meta(html, "og:image");
  if (og) out.push(httpUrl(og, base));
  for (const tag of visible(html).matchAll(/<img\b[^>]*>/gi)) {
    const raw = tag[0];
    let src = attr(raw, "src");
    const lazy = attr(raw, "data-src") || attr(raw, "data-lazy-src") || attr(raw, "data-original");
    if (lazy) src = lazy;
    if (!src || src.startsWith("data:")) {
      const srcset = attr(raw, "srcset") || attr(raw, "data-srcset");
      src = srcset.split(",").pop()?.trim().split(/\s+/)[0] ?? "";
    }
    if (!src || src.startsWith("data:")) continue;
    if (/(brand|partner|sponsor|client|vendor|manufacturer|certif|award)s?[-_ ]?(logo|img|image|item)?/i.test(attr(raw, "class") + " " + attr(raw, "alt"))) continue;
    if (/logo|icon|sprite|pixel|spacer|gravatar|emoji|badge|avatar|placeholder|loader|facebook|twitter|google|yelp|bbb|\.svg(\?|$)|\.gif(\?|$)/i.test(src + attr(raw, "class") + attr(raw, "alt")))
      continue;
    const width = Number(attr(raw, "width")) || 0;
    const height = Number(attr(raw, "height")) || 0;
    if ((width && width < 160) || (height && height < 120)) continue;
    const url = httpUrl(src, base);
    if (url) out.push(url);
    const label = cleanText(`${attr(raw, "alt")} ${attr(raw, "title")}`).slice(0, 160);
    if (url && label && labels && !labels.has(url)) labels.set(url, label);
  }
  // Photos (jpg/webp) first; PNGs are often partner/brand logos.
  return out
    .filter((url) => url.startsWith("https://"))
    .sort((a, b) => Number(/\.png(\?|$)/i.test(a)) - Number(/\.png(\?|$)/i.test(b)));
}

function testimonialsOf(html: string): Testimonial[] {
  const out: Testimonial[] = [];
  const page = visible(html);
  for (const match of page.matchAll(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi)) {
    const text = cleanText(match[1] ?? "");
    if (text.length >= 30 && text.length <= 500) out.push({ quote: text, author: "" });
  }
  for (const match of page.matchAll(/<(div|li|article|section)\b[^>]*class=["'][^"']*(testimonial|review)[^"']*["'][^>]*>([\s\S]{0,2000}?)<\/\1>/gi)) {
    const quote = paragraphs(match[3] ?? "", 30)[0];
    if (quote && quote.length <= 500) {
      const author = cleanText(match[3]?.match(/<(cite|strong|h4|h5|span)[^>]*class=["'][^"']*(name|author|cite)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i)?.[3] ?? "");
      out.push({ quote, author: author.slice(0, 60) });
    }
  }
  return out;
}

function servicesOf(doc: Doc): string[] {
  const out: string[] = [];
  const page = visible(doc.html);
  out.push(...headingsOf(doc.html).filter((h) => h.length <= 60 && !/^(home|contact|about|menu|services?|our services|what we do)$/i.test(h)));
  for (const match of page.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    if (/<a\b/i.test(match[1] ?? "") && /<\/a>\s*$/i.test((match[1] ?? "").trim())) continue; // nav links
    const text = cleanText(match[1] ?? "");
    if (text.length >= 3 && text.length <= 70 && !PHONE.test(text) && !EMAIL.test(text)) out.push(text);
  }
  return out;
}

/** Service names are usually Title Case; sentence-case list items are often symptoms or steps. */
function isTitleCase(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => /^[A-Za-z]{4,}$/.test(w) && !/^(with|from|into|over|your|that|this)$/i.test(w));
  return words.length > 0 && words.every((w) => /^[A-Z]/.test(w));
}

function preferTitleCase(list: string[]): string[] {
  const titled = list.filter(isTitleCase);
  return titled.length >= 3 ? titled : list;
}

function clipList(list: string[], max: number, each = 200): string[] {
  return [...new Set(list.map((item) => item.replace(/\s+/g, " ").trim().slice(0, each)).filter(Boolean))].slice(0, max);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function nameFrom(title: string, siteName: string, ldName: string, host: string): string {
  if (siteName) return scrubPlatform(siteName).slice(0, 60);
  if (ldName) return scrubPlatform(ldName).slice(0, 60);
  const parts = scrubPlatform(title).split(/\s+[|\-–—:·•]\s+/).map((p) => p.trim()).filter(Boolean);
  // Titles are often "Page | Brand" or "Brand | Tagline"; prefer the shortest non-generic part.
  const generic = /^(home|homepage|welcome|index|since\s+\d{4}|est\.?\s*\d{4}|established\s+\d{4})$/i;
  const candidates = parts.filter((p) => !generic.test(p));
  const pick = candidates.length > 1 ? candidates.reduce((a, b) => (b.length < a.length ? b : a)) : candidates[0];
  return (pick || host.replace(/^www\./, "")).slice(0, 60);
}


// ---------------------------------------------------------------- Round 13: thin sites never dead-end

/** Thrown when a site has nothing readable AND the visitor gave no note: the UI asks "Tell us a bit about the business". */
export class ThinSiteError extends Error {
  readonly needsDetails = true;
  constructor() {
    super("That site has very little text we can read, so we need a little help. Tell us a bit about the business and we'll build from that and the site's photos and colors.");
  }
}

const BOILERPLATE = /cookie|javascript|copyright|©|all rights reserved|enable js|loading\.\.\.|privacy policy|skip to (?:main )?content/i;

/** Breaks between blocks, so text in div/td/section (not just p/li) can be read line by line. */
function blockLines(html: string): string[] {
  const text = decode(
    visible(html)
      .replace(/<\/?(?:br|hr|p|div|li|ul|ol|td|th|tr|table|h[1-6]|section|article|header|footer|main|blockquote|dd|dt|dl|figcaption|address)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
  return scrubLines(
    text
      .split(/\n+/)
      .map((line) => scrubPlatform(line.replace(/\s+/g, " ").trim()))
      .filter((line) => line.length >= 25 && line.length <= 500 && line.split(" ").length >= 4 && !BOILERPLATE.test(line)),
  );
}

/** Text inside <noscript> (many JS sites keep a plain fallback there). */
function noscriptLines(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<noscript[^>]*>([\s\S]*?)<\/noscript>/gi)) {
    for (const line of decode((m[1] ?? "").replace(/<(?:br|p|div|li)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")).split(/\n+/)) {
      const t = scrubPlatform(line.replace(/\s+/g, " ").trim());
      if (t.length >= 25 && t.split(" ").length >= 4 && !/enable javascript|javascript (?:is|must|has)|turn on javascript|requires javascript|please enable/i.test(t)) out.push(t);
    }
  }
  return scrubLines(out);
}

const SKIP_KEYS = /^(?:css|style|styles|class|classname|classes|url|src|srcset|href|id|ids|uri|path|type|font|fonts|color|colors|key|hash|token|nonce|sha|integrity|script|html|svg|icon|image|images|thumbnail|slug|locale|lang|env|config|theme|selector|animation|transform|template|tag|rel|format|mimetype|alt)$/i;

/** Pull a JSON object starting at `start` (a "{" or "["), string-aware, up to a size cap. */
function balancedJson(text: string, start: number, cap = 600_000): unknown {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = start; i < Math.min(text.length, start + cap); i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function humanString(value: string): string {
  const t = decode(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  if (t.length < 25 || t.length > 500 || t.split(" ").length < 4) return "";
  if (/^https?:|[{};]|\bfunction\b|=>|^[#.]?[\w-]+:\s*[\w#.%(),\s-]+;?$/.test(t)) return "";
  const letters = (t.match(/[A-Za-z]/g) ?? []).length;
  if (letters / t.length < 0.7 || BOILERPLATE.test(t)) return "";
  const cleaned = scrubPlatform(t);
  return cleaned && !isJunkCopy(cleaned) ? cleaned : "";
}

/**
 * Words a JavaScript site ships inside its page: __NEXT_DATA__, other application/json blocks (Wix's warmup data,
 * Squarespace's context), JSON-LD, and window.__NUXT__ / __INITIAL_STATE__ / SQUARESPACE_CONTEXT assignments.
 * Only sentence-like strings are kept (no urls, css, ids), so a React/Wix/Squarespace shell still yields real copy.
 */
export function embeddedStrings(html: string, limit = 60): string[] {
  const roots: unknown[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? "";
    const body = (m[2] ?? "").trim();
    if (!body) continue;
    if (/type=["']application\/(?:ld\+)?json["']|id=["']__NEXT_DATA__["']|type=["']text\/json["']/i.test(attrs) && /^[{[]/.test(body)) {
      try {
        roots.push(JSON.parse(body));
      } catch {
        // not JSON after all
      }
      continue;
    }
    for (const a of body.matchAll(/(?:window\.__[A-Z_]+__|window\.__[A-Za-z_]+|__INITIAL_STATE__|__PRELOADED_STATE__|__NUXT__|SQUARESPACE_CONTEXT|wixEmbedsAPI|window\.[a-zA-Z]+Data)\s*=\s*(?=[{[])/g)) {
      const parsed = balancedJson(body, (a.index ?? 0) + a[0].length);
      if (parsed) roots.push(parsed);
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  const walk = (node: unknown, depth: number) => {
    if (out.length >= limit || depth > 14) return;
    if (typeof node === "string") {
      const text = humanString(node);
      const key = text.toLowerCase().slice(0, 120);
      if (text && !seen.has(key)) {
        seen.add(key);
        out.push(text);
      }
    } else if (Array.isArray(node)) {
      for (const item of node.slice(0, 400)) walk(item, depth + 1);
    } else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>).slice(0, 400)) {
        if (!SKIP_KEYS.test(key)) walk(value, depth + 1);
      }
    }
  };
  for (const root of roots) walk(root, 0);
  return out;
}

/** Readable lines of a page, best source first: real paragraphs, then any block text, then <noscript>, then embedded JSON. */
export function readableLines(html: string): { lines: string[]; source: "paragraphs" | "blocks" | "noscript" | "embedded" | "none" } {
  const paras = paragraphs(html);
  if (paras.join(" ").length >= 40) return { lines: paras, source: "paragraphs" };
  const blocks = blockLines(html);
  if (blocks.join(" ").length >= 40) return { lines: blocks, source: "blocks" };
  const ns = noscriptLines(html);
  if (ns.join(" ").length >= 40) return { lines: ns, source: "noscript" };
  const emb = embeddedStrings(html);
  if (emb.join(" ").length >= 40) return { lines: emb, source: "embedded" };
  return { lines: [], source: "none" };
}

/** Same-site pages a thin homepage may be hiding behind: sitemap entries first, then the usual suspects. */
const COMMON_PATHS = ["/about", "/about-us", "/menu", "/services", "/contact", "/contact-us", "/our-story", "/products", "/gallery"];

async function fetchPlain(url: URL, timeoutMs: number): Promise<string> {
  const fixture = fixtureSite(url);
  if (fixture) {
    if (fixture.status >= 400) throw new Error(`status ${fixture.status}`);
    return fixture.body;
  }
  let current = url;
  for (let hop = 0; hop < 3; hop += 1) {
    await assertPublic(current);
    const response = await fetch(current, {
      redirect: "manual",
      signal: stopOrTimeout(timeoutMs),
      headers: { Accept: "application/xml,text/xml,text/plain,*/*;q=0.5", "User-Agent": "ReimagoReimagine/1.0 (+https://reimago.ai)" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("redirect");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`status ${response.status}`);
    return (await readCapped(response, 400_000)).toString("utf8");
  }
  throw new Error("too many redirects");
}

export function sitemapUrls(xml: string, base: URL): URL[] {
  const found: URL[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    try {
      const u = new URL(decode(m[1] ?? ""), base);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (!sameSite(u.hostname, base.hostname) || BINARY_EXT.test(u.pathname) || SKIP_PATH.test(u.pathname) || /\.xml$/i.test(u.pathname)) continue;
      u.hash = "";
      found.push(u);
    } catch {
      // skip
    }
  }
  const scored = found.map((u) => {
    let score = 0;
    for (const [pattern, weight] of KEYWORDS) if (pattern.test(u.pathname)) score += weight;
    const depth = u.pathname.split("/").filter(Boolean).length;
    return { u, score: score + (depth <= 1 ? 2 : depth >= 3 ? -2 : 0) };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.u);
}

async function deeperCrawl(base: URL, seen: Set<string>, deadline: number): Promise<URL[]> {
  const urls: URL[] = [];
  const add = (u: URL) => {
    const key = pathKey(u);
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(u);
  };
  try {
    let xml = await fetchPlain(new URL("/sitemap.xml", base), Math.min(4000, Math.max(800, deadline - Date.now())));
    // A sitemap index points at child sitemaps: read the first one.
    const child = xml.match(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>/i)?.[1];
    if (child && /<sitemapindex/i.test(xml)) {
      try {
        const childUrl = new URL(decode(child), base);
        if (sameSite(childUrl.hostname, base.hostname)) xml = await fetchPlain(childUrl, Math.min(4000, Math.max(800, deadline - Date.now())));
      } catch {
        // keep the index
      }
    }
    for (const u of sitemapUrls(xml, base).slice(0, 6)) add(u);
  } catch {
    // no sitemap
  }
  for (const path of COMMON_PATHS) add(new URL(path, base));
  return urls.slice(0, 9);
}

export type ScrapeOptions = { /** What the visitor typed under "Tell us a bit about the business". */ details?: string; /** Build from the photos/colors even when there is no text and no note. */ allowThin?: boolean };

export async function scrapeSite(rawUrl: string, notes: string, options: ScrapeOptions = {}): Promise<SiteFacts> {
  const start = normalizeInput(rawUrl);
  await assertPublic(start);
  let deadline = Date.now() + TOTAL_BUDGET_MS;
  let home: Doc;
  try {
    home = await fetchPage(start, 15_000);
  } catch (error) {
    if (!REIMAGO_HOSTS.has(start.hostname)) throw error;
    return snapshotFacts(start, notes);
  }
  const t0 = deadline - TOTAL_BUDGET_MS;
  const tHome = Date.now() - t0;
  const base = new URL(home.url);
  const nav = navLinks(home.html, base);
  const extra = rankLinks(home.html, base, nav);
  const docs: Doc[] = [home];
  const queue = [...extra];
  const worker = async () => {
    while (queue.length && !requestSignal()?.aborted) {
      const next = queue.shift();
      if (!next) return;
      const remaining = deadline - Date.now();
      if (remaining < 1500) return;
      try {
        docs.push(await fetchPage(next, Math.min(PAGE_TIMEOUT_MS, remaining)));
      } catch {
        // A linked page is optional.
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const tPages = Date.now() - t0;
  const firstWave = docs.length - 1;
  // Second hop: photo-rich pages (gallery, parks, events…) linked from the pages read so far.
  const seenPaths = new Set(docs.map((d) => pathKey(new URL(d.url))));
  for (const u of extra) seenPaths.add(pathKey(u));
  const photoPages: URL[] = [];
  for (const doc of docs.slice(1)) {
    for (const u of rankLinks(doc.html, new URL(doc.url), [])) {
      const key = pathKey(u);
      if (seenPaths.has(key) || !PHOTO_PAGE.test(u.pathname)) continue;
      seenPaths.add(key);
      photoPages.push(u);
    }
  }
  // Only with time left (≥5 s): the photo pages are a bonus, never a reason to run long.
  if (deadline - Date.now() >= 5000) queue.push(...photoPages.slice(0, MAX_PHOTO_PAGES));
  if (queue.length) await Promise.all([worker(), worker(), worker(), worker()]);
  const tPhotoPages = Date.now() - t0;

  // Round 13: a thin homepage (JS shell, text in images, table layouts) gets a deeper crawl: sitemap.xml, then /about,
  // /menu, /services, /contact… Only when the pages read so far hold almost no text; always time-boxed (≤ 8 s extra).
  const textTotal = () => docs.reduce((sum, doc) => sum + readableLines(doc.html).lines.join(" ").length, 0);
  let deeper = 0;
  if (textTotal() < 200 && !requestSignal()?.aborted) {
    deadline = Math.max(deadline, Date.now() + 8000);
    const seen = new Set(docs.map((d) => pathKey(new URL(d.url))));
    seen.add(pathKey(base));
    const more = await deeperCrawl(base, seen, deadline).catch(() => [] as URL[]);
    const before = docs.length;
    queue.push(...more);
    if (queue.length) await Promise.all([worker(), worker(), worker(), worker()]);
    deeper = docs.length - before;
    console.info(`[thin] ${base.hostname}: homepage text is thin, deeper crawl tried ${more.length} page${more.length === 1 ? "" : "s"}, read ${deeper}, text now ${textTotal()} chars`);
  }

  // Stylesheets help find brand colors. Same-site first, plus a site-builder theme sheet
  // (Squarespace hosts cafe501.com's palette on static1.squarespace.com / versioned-site-css).
  const cssRank = (href: string): number => {
    if (/versioned-site-css|\/site\.css(\?|$)|custom\.css|theme\.css|global\.css/i.test(href)) return 0;
    if (sameSite(hostOf(href), base.hostname)) return 1;
    if (/squarespace\.com|sqspcdn\.com|shopify|webflow|wixstatic/i.test(href)) return 3;
    return 9;
  };
  const cssLinks = [...home.html.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /stylesheet/i.test(attr(tag, "rel")))
    .map((tag) => httpUrl(attr(tag, "href"), home.url))
    .filter((href) => href && !/wp-includes|plugins|font|icon|google/i.test(href) && cssRank(href) < 9)
    .filter((href, i, list) => list.indexOf(href) === i)
    .sort((a, b) => cssRank(a) - cssRank(b))
    .slice(0, 3);
  const css = await Promise.all(cssLinks.map((href) => fetchCss(href, deadline)));
  console.info(
    `[timing] read ${base.hostname}: homepage ${tHome}ms, ${firstWave} linked page${firstWave === 1 ? "" : "s"} by ${tPages}ms, ${docs.length - 1 - firstWave} photo page${docs.length - 1 - firstWave === 1 ? "" : "s"} by ${tPhotoPages}ms (${photoPages.length} found), stylesheets by ${Date.now() - t0}ms · cap ${TOTAL_BUDGET_MS / 1000}s`,
  );
  const inlineStyles = docs.map((doc) =>
    [...doc.html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|style=["']([^"']*)["']/gi)].map((m) => m[1] ?? m[2] ?? "").join("\n"),
  );

  const ld = docs.map((doc) => jsonLd(doc.html));
  const ldFirst = <K extends keyof LdFacts>(key: K) => ld.map((f) => f[key]).find((v) => (Array.isArray(v) ? v.length : v));

  const allText = docs.map((doc) => cleanText(visible(doc.html))).join("\n");
  const telLinks = docs.flatMap((doc) => [...doc.html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => decode(m[1] ?? "")));
  const mailLinks = docs.flatMap((doc) =>
    [...doc.html.matchAll(/href=["']mailto:([^"'?]+)/gi)].map((m) => decodeURIComponent(decode(m[1] ?? "")).trim()),
  );
  const phoneRaw = (ldFirst("phone") as string | undefined) || telLinks.find((t) => t.replace(/\D/g, "").length >= 10) || allText.match(PHONE)?.[0] || "";
  const emailRaw =
    [(ldFirst("email") as string | undefined) ?? "", ...mailLinks, ...(allText.match(new RegExp(EMAIL.source, "g")) ?? [])].find(goodEmail) ?? "";
  const address = ((ldFirst("address") as string | undefined) || allText.match(ADDRESS)?.[0] || "").replace(/\s+/g, " ").trim();
  const hourKey = (h: string) =>
    h
      .toLowerCase()
      .replace(/(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?/g, "$1")
      .replace(/[^a-z0-9]/g, "");
  const hours = clipList(
    [...((ldFirst("hours") as string[] | undefined) ?? []), ...(allText.match(HOURS_LINE) ?? [])].map((h) => h.replace(/\s+/g, " ")),
    14,
    60,
  )
    .filter((h, i, list) => list.findIndex((x) => hourKey(x) === hourKey(h)) === i)
    .slice(0, 7);

  const title = cleanText(home.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const description = scrubPlatform(meta(home.html, "description") || meta(home.html, "og:description") || (ldFirst("description") as string) || "");
  const name = nameFrom(title, meta(home.html, "og:site_name"), (ldFirst("name") as string) || "", base.hostname);
  const titleParts = scrubPlatform(title).split(/\s+[|\-–—:·•]\s+/).map((p) => p.trim());
  const tagline = titleParts.find((p) => p && p !== name && !/^(home|welcome)$/i.test(p) && p.length < 90) ?? "";

  let logo = extractLogo(home.html, home.url, name) || httpUrl((ldFirst("logo") as string) || "", home.url);
  if (isWordPress(home.html) && /wp-includes|wordpress\.org|w-logo|wordpress-logo/i.test(logo)) logo = "";
  if (logo.startsWith("http://")) logo = `https://${logo.slice(7)}`;
  if (!logo.startsWith("https://")) logo = "";

  const pageOf = (pattern: RegExp) => docs.find((doc) => pattern.test(new URL(doc.url).pathname));
  const aboutDoc = pageOf(/about|our-story|who-we-are|history/i);
  const aboutParas = aboutDoc ? paragraphs(aboutDoc.html, 60) : paragraphs(home.html, 80);
  const aboutText = (aboutParas.length ? aboutParas : readableLines((aboutDoc ?? home).html).lines).slice(0, 4).join("\n\n").slice(0, 1400);

  const serviceDocs = docs.filter((doc) => {
    const path = new URL(doc.url).pathname;
    // "terms-of-service" and friends are legal pages, not service lists.
    return /service|what-we-do|menu|product|treatment|practice|solutions/i.test(path) && !/terms|privacy|policy|legal|cookie|accessibility|disclaimer/i.test(path);
  });
  const serviceCandidates = [
    ...ld.flatMap((f) => f.offers),
    ...serviceDocs.flatMap(servicesOf),
    ...(serviceDocs.length ? [] : headingsOf(home.html).filter((h) => h.length <= 50)),
  ];
  const navLabels = new Set(nav.map((n) => n.label.toLowerCase()));
  const services = preferTitleCase(clipList(
    serviceCandidates.filter(
      (s) =>
        !navLabels.has(s.toLowerCase()) &&
        !MENU_NOISE.test(s) &&
        !/^(read more|learn more|call|contact|view|book|menu|get|give|need|signs?|why|how|what|our|we|faq|other|more|all|a|an|the|if|when|your|you|shut|turn)\b/i.test(s) &&
        s.split(/\s+/).length <= 7 &&
        !/^(home|welcome\b.*|.*\bchapter \d+.*)$/i.test(s) &&
        !/\b(if you|you can|for no reason|is off|jumps)\b/i.test(s) &&
        !/[?!]|license|#\d|copyright|©|reserved|hours|estimate|reviews?|testimonial|follow us|areas? (we )?serve/i.test(s) &&
        !ADDRESS.test(s) &&
        !PHONE.test(s) &&
        !EMAIL.test(s) &&
        !/\b\d{1,2}(:\d{2})?\s*(am|pm)\b|days a week|24\/7/i.test(s) &&
        s.toLowerCase() !== name.toLowerCase(),
    ),
    16,
    80,
  )).slice(0, 12);

  const testimonials = [...ld.flatMap((f) => f.reviews), ...docs.flatMap((doc) => testimonialsOf(doc.html))]
    .filter((t, i, list) => list.findIndex((x) => x.quote === t.quote) === i)
    .slice(0, 4);

  const imageLabels = new Map<string, string>();
  const images = clipList(
    [...ld.flatMap((f) => f.images.map((i) => httpUrl(i, home.url))), ...docs.flatMap((doc) => imagesOf(doc.html, doc.url, imageLabels))].filter(
      (url) => url.startsWith("https://") && url !== logo,
    ),
    12,
    500,
  );

  const social = clipList(
    [
      ...ld.flatMap((f) => f.sameAs),
      ...[...home.html.matchAll(/href=["'](https?:\/\/(?:www\.)?(?:facebook|instagram|x|twitter|linkedin|youtube|yelp|tiktok)\.com\/[^"']+)["']/gi)].map(
        (m) => m[1] ?? "",
      ),
    ].filter((s) => /^https:\/\//.test(s)),
    6,
    200,
  );

  const pages: ScrapedPage[] = docs.map((doc) => ({
    url: doc.url,
    title: cleanText(doc.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 120),
    headings: headingsOf(doc.html).slice(0, 12),
    // Paragraphs first (unchanged for normal sites); thin pages fall back to block text, <noscript> and embedded JSON.
    text: readableLines(doc.html).lines.join("\n").slice(0, 1800),
  }));

  const colorSources = [...css, ...inlineStyles, home.html];
  const colors = brandColors([...css, ...inlineStyles], meta(home.html, "theme-color"));
  const inks = brandInks(colorSources, meta(home.html, "theme-color"), home.html);
  const darkBrand = pageIsDarkBrand(colorSources, home.html);
  const fonts = extractFonts(colorSources);
  const industry =
    ld.map((f) => f.type ?? "").find((type) => type && !/^(Organization|LocalBusiness|WebSite|WebPage|Corporation|Place|ProfessionalService)$/i.test(type)) ?? "";

  // Round 13: never a dead end. "Thin" = no readable text on any page and no description. With a note (or typed details,
  // or "use its photos and colors") the looks are built from the note + the site's photos, colors and logo and the visitor
  // gets a soft notice; with nothing at all, the UI asks "Tell us a bit about the business".
  const details = (options.details ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  const thin = pages.every((p) => p.text.length < 40) && !description && !REIMAGO_HOSTS.has(start.hostname);
  if (thin && !notes.trim() && !details && !options.allowThin) throw new ThinSiteError();
  let thinNote: string | undefined;
  if (thin) {
    thinNote = details || notes.trim()
      ? `${base.hostname.replace(/^www\./, "")} has very little text we can read, so these looks are built from ${details ? "what you told us" : "your request"} plus the site's photos, colors and logo.`
      : `${base.hostname.replace(/^www\./, "")} has very little text we can read, so these looks use only its photos, colors and logo. Use “Not quite right?” to tell us what the business does.`;
    console.info(`[thin] ${base.hostname}: no readable text (${docs.length} page${docs.length === 1 ? "" : "s"}, deeper ${deeper}); building from ${details ? "details" : notes.trim() ? "the note" : "photos/colors only"}`);
  }
  const thinDescription = thin && details ? details.slice(0, 400) : "";

  return {
    mode: "reimagine",
    sourceUrl: home.url,
    host: base.hostname,
    name,
    tagline: scrubCopy(tagline).slice(0, 120),
    description: scrubCopy(description || thinDescription).slice(0, 400),
    logo,
    colors,
    inks,
    fonts,
    darkBrand,
    phone: phoneRaw ? formatPhone(phoneRaw) : "",
    email: emailRaw.toLowerCase(),
    address: address.slice(0, 160),
    hours,
    services,
    about: scrubCopy(aboutText || thinDescription),
    testimonials,
    images,
    imageText: Object.fromEntries(images.filter((u) => imageLabels.has(u)).map((u) => [u, imageLabels.get(u)!])),
    // All imagery with its words (img, picture, inline SVG, CSS backgrounds, og:image, logo), for "keep the rocket".
    siteArt: collectSiteArt(docs, cssLinks.map((href, i) => ({ href, text: css[i] ?? "" })), logo),
    nav: nav.filter((n) => sameSite(hostOf(n.url), base.hostname)).slice(0, 8),
    pages,
    social,
    industry,
    notes: notes.slice(0, 800),
    ...(thin ? { thin: true, note: thinNote } : {}),
  };
}

/**
 * Round 13: "Build from your note instead". The site can't be read at all (blocked, empty, timed out, not found), so the
 * facts come from the address, the visitor's note and what they told us about the business. Nothing is fetched.
 */
export function noteOnlyFacts(rawUrl: string, notes: string, details: string): SiteFacts {
  let host = rawUrl.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0] ?? "";
  host = host.toLowerCase().slice(0, 120);
  const label = host.split(".")[0] ?? host;
  const name = label.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60) || "Your business";
  const about = details.replace(/\s+/g, " ").trim().slice(0, 600);
  return {
    mode: "reimagine",
    sourceUrl: host ? `https://${host}/` : "",
    host: host || "your-site",
    name,
    tagline: "",
    description: about.slice(0, 400),
    logo: "",
    colors: [],
    phone: "",
    email: "",
    address: "",
    hours: [],
    services: [],
    about,
    testimonials: [],
    images: [],
    nav: [],
    pages: [{ url: host ? `https://${host}/` : "", title: name, headings: [], text: about }],
    social: [],
    industry: "",
    notes: notes.trim().slice(0, 800),
    thin: true,
    note: `We couldn't read ${host || "that site"}, so these looks are built from your note${about ? " and what you told us about the business" : ""}. Nothing on the live site was changed.`,
  };
}

function snapshotFacts(start: URL, notes: string): SiteFacts {
  return {
    mode: "reimagine",
    sourceUrl: start.toString(),
    host: start.hostname,
    name: "Reimago",
    tagline: "Social network software, community software, and single sign-on",
    description: REIMAGO_SNAPSHOT.description,
    logo: "",
    colors: [],
    phone: "(405) 753-5300",
    email: "sales@reimago.ai",
    address: "",
    hours: [],
    services: REIMAGO_SNAPSHOT.headings.slice(1),
    about: REIMAGO_SNAPSHOT.text,
    testimonials: [],
    images: [],
    nav: [],
    pages: [{ url: start.toString(), title: REIMAGO_SNAPSHOT.title, headings: REIMAGO_SNAPSHOT.headings, text: REIMAGO_SNAPSHOT.text }],
    social: [],
    industry: "Software",
    notes: notes.slice(0, 800),
    note: "reimago.ai did not answer in time, so this preview uses the public homepage copy already on file. Nothing on the live domain was changed.",
  };
}

function sentence(value: string): string {
  const text = value.trim();
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Facts for the Create a New Site wizard: everything comes from what the visitor typed. */
export function factsFromBrief(brief: Record<string, unknown>): SiteFacts {
  const s = (key: string, max = 400) => (typeof brief[key] === "string" ? (brief[key] as string).trim().slice(0, max) : "");
  const list = (key: string) => (Array.isArray(brief[key]) ? (brief[key] as unknown[]).map(String).filter(Boolean) : []);
  const name = s("business_name", 60) || "New site";
  const services = s("services", 1000)
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
  const pages = list("pages");
  const color = s("brand_color", 7);
  const email = s("contact_email", 200);
  // The domain chosen in step 1 (owned, or selected pending checkout) is the new site's address.
  const host = (s("domain") || s("existing_site") || name).replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || name;
  const brief_text = [
    s("domain") && `Domain: ${s("domain")}${s("domain_status") === "selected-pending-checkout" ? " (chosen; registration pending checkout)" : ""}`,
    s("what") && `What the business does: ${s("what")}`,
    s("industry") && `Industry: ${s("industry")}`,
    s("location") && `Location: ${s("location")}`,
    s("customers") && `Customers: ${s("customers")}`,
    s("goal") && `Main goal for visitors: ${s("goal")}`,
    pages.length && `Pages wanted: ${pages.join(", ")}`,
    s("style") && `Style: ${s("style")}`,
    list("features").length && `Features: ${list("features").join(", ")}`,
    s("emulate_note") && `Inspiration note: ${s("emulate_note")}`,
    s("copy_text", 2000) && `Copy provided by the owner: ${s("copy_text", 2000)}`,
    s("hours", 300) && `Hours: ${s("hours", 300)}`,
    s("phone", 40) && `Phone: ${s("phone", 40)}`,
    list("social").length && `Social: ${list("social").join(", ")}`,
    (list("photo_urls").length || list("images").length) && "The owner uploaded photos of their business — prefer these over generated art.",
    s("anything_else") && `Anything else: ${s("anything_else")}`,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    mode: "create",
    sourceUrl: s("existing_site"),
    host,
    name,
    tagline: s("what", 120),
    description: [s("what"), s("customers")].filter(Boolean).map(sentence).join(" ").slice(0, 400),
    // A logo the owner uploaded or had AI make (stored with the previews; nothing else is fetched).
    logo: isOwnStoredImageUrl(s("logo_url", 300)) ? s("logo_url", 300) : "",
    colors: /^#[0-9a-fA-F]{6}$/.test(color) ? [color.toLowerCase()] : [],
    phone: s("phone", 40) ? formatPhone(s("phone", 40)) : "",
    email: goodEmail(email) || EMAIL.test(email) ? email : "",
    address: s("address", 160),
    hours: s("hours", 300) ? s("hours", 300).split(/\n|;/).map((h) => h.trim()).filter(Boolean).slice(0, 7) : [],
    services,
    about: [s("what"), s("customers"), s("location") && `Based in ${s("location")}.`].filter(Boolean).map(sentence).join(" ").slice(0, 1400),
    testimonials: [],
    images: (list("photo_urls").length ? list("photo_urls") : list("images")).filter((u) => /^https?:\/\//.test(u)).slice(0, 12),
    imageText: Object.fromEntries(
      (list("photo_urls").length ? list("photo_urls") : list("images"))
        .filter((u) => /^https?:\/\//.test(u))
        .slice(0, 12)
        .map((u) => [u, "Photo you uploaded"]),
    ),
    nav: [],
    pages: pages.map((p) => ({ url: "", title: p, headings: [], text: "" })),
    social: (list("social").length ? list("social") : s("social", 1000).split(/\n|,/))
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//.test(u))
      .slice(0, 8),
    industry: /^other$/i.test(s("industry", 60)) ? "" : s("industry", 60),
    notes: [s("style") && `Style: ${s("style")}`, s("anything_else")].filter(Boolean).join(". ").slice(0, 800),
    brief: brief_text.slice(0, 4000),
  };
}

/**
 * Lightly scan "sites to emulate" from the wizard: title, description, colors,
 * fonts and a few headings — just enough for the art director to borrow a vibe.
 * Homepage only, short timeouts, failures are skipped.
 */
export async function scanInspiration(urls: string[], likes: string): Promise<SiteFacts["inspiration"]> {
  const scans = await Promise.all(
    urls.slice(0, 3).map(async (raw) => {
      try {
        const start = normalizeInput(raw);
        const page = await fetchPage(start, 9000);
        const html = page.html;
        const fonts = new Set<string>();
        for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/gi)) {
          for (const fam of decode(m[1]!).matchAll(/family=([^:&]+)/g)) fonts.add(decodeURIComponent(fam[1]!.replace(/\+/g, " ")).trim());
        }
        for (const m of html.matchAll(/font-family\s*:\s*["']?([A-Za-z][A-Za-z0-9 -]{2,40})/gi)) {
          const name = m[1]!.trim();
          if (!/^(inherit|initial|sans-serif|serif|monospace|system-ui|-apple-system|arial|helvetica|times)/i.test(name)) fonts.add(name);
        }
        const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? "").join("\n").slice(0, 200_000);
        return {
          url: page.url,
          title: cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 120),
          description: cleanText(meta(html, "description") || meta(html, "og:description")).slice(0, 240),
          colors: brandColors([inline], meta(html, "theme-color")),
          fonts: [...fonts].slice(0, 4),
          headings: headingsOf(html).slice(0, 6),
          likes: likes.slice(0, 300),
        };
      } catch {
        return { url: raw.slice(0, 200), title: "", description: "", colors: [], fonts: [], headings: [], likes: likes.slice(0, 300) };
      }
    }),
  );
  return scans;
}
