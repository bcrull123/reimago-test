/**
 * Every picture on the owner's site, with the words that describe it, so "Keep the rocket" can find *their*
 * rocket wherever it lives: an <img> (alt, title, file name, srcset), a <picture> source, an inline SVG
 * (title, desc, ids, classes, data-name), a CSS background-image (selector + file name), og:image or the logo.
 *
 * Pure (no fetching): scrape.server.ts collects, builder.server.ts matches and stores. Homepage art comes first.
 */
import { sceneKeywords } from "./web-photo.ts";

export type SiteArtKind = "img" | "picture" | "svg" | "css" | "og" | "logo";

export type SiteArt = {
  /** https URL of the image; "inline-svg:<n>" for an inline SVG (its markup is in `svg`). */
  url: string;
  /** Words describing it: alt / title / aria-label / class / id / file name / CSS selector / SVG title. */
  label: string;
  kind: SiteArtKind;
  /** The page it was found on, and whether that is the homepage. */
  page: string;
  home: boolean;
  width?: number;
  height?: number;
  /** Inline SVG markup (capped; sanitized again before it is stored). */
  svg?: string;
};

export const SITE_ART_MAX = 90;
const SVG_MAX = 40_000;

function decode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decode(match?.[2] ?? match?.[3] ?? match?.[4] ?? "").trim();
}

function absolute(src: string, base: string): string {
  try {
    const url = new URL(decode(src.trim()), base);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

/** Words in a file name: "rocket_transparent-bg-p65h8jtiue3…-300x200.png" -> "rocket transparent bg". */
export function fileWords(url: string): string {
  let name = "";
  try {
    name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    name = url.split("/").pop() ?? "";
  }
  return name
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/-\d{2,4}x\d{2,4}$/i, "")
    .split(/[-_.\s+]+/)
    .flatMap((w) => w.split(/(?<=[a-z])(?=[A-Z])/))
    // CDN hashes and ids ("p65h8jtiue3itp4ksz7aa4634a26hhg47mz85aa32o", "IMG_2041") are not words.
    .filter((w) => w && w.length > 1 && !/\d/.test(w.slice(0, 1)) && !(w.length > 12 && /\d/.test(w)) && !/^(img|dsc|image|scaled|copy|final|v\d+)$/i.test(w))
    .join(" ")
    .toLowerCase()
    .slice(0, 120);
}

function words(...parts: string[]): string {
  return parts
    .join(" ")
    .replace(/[-_]+/g, " ")
    .replace(/(?<=[a-z])(?=[A-Z])/g, " ")
    .replace(/\b(elementor|wp|image|img|attachment|size|full|large|medium|thumbnail|lazy|loaded|class|wrapper|widget|container|element|col|row|section|inner|column|e-con)\b/gi, " ")
    .replace(/\b[a-z0-9]{0,3}\d[a-z0-9]*\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * The largest file in a srcset ("a.jpg 400w, a-big.jpg 1600w" -> a-big.jpg; "a.jpg 1x, a@2x.jpg 2x" -> a@2x.jpg).
 * Entries without a descriptor count as 1x. Empty when there is no srcset.
 */
export function largestSrcset(srcset: string): string {
  let best = "";
  let top = -1;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [u, d] = part.trim().split(/\s+/);
    if (!u || u.startsWith("data:")) continue;
    const m = d?.match(/^(\d+(?:\.\d+)?)([wx])$/i);
    const v = m ? Number(m[1]) * (m[2]!.toLowerCase() === "x" ? 1000 : 1) : 1000;
    if (v > top) {
      top = v;
      best = u;
    }
  }
  return best;
}

/** Template / tracking images that are never the owner's art. */
const JUNK = /^\{|\{\{|pixel|spacer|gravatar|emoji|data:|\/avatars?\/|blank\.gif|transparent\.gif/i;

/** Inline SVGs worth keeping: not tiny UI icons (a 24px arrow named "icon-rocket" is not the rocket). */
function svgSize(tag: string): { width?: number; height?: number } {
  const w = parseFloat(attr(tag, "width"));
  const h = parseFloat(attr(tag, "height"));
  const box = attr(tag, "viewBox").split(/[\s,]+/).map(Number);
  return { width: Number.isFinite(w) ? w : box[2], height: Number.isFinite(h) ? h : box[3] };
}

/** All imagery on one page. */
export function artOfPage(html: string, page: string, home: boolean, css: { href: string; text: string }[] = []): SiteArt[] {
  const out: SiteArt[] = [];
  const add = (art: SiteArt) => {
    if (!art.url || art.url === page || JUNK.test(art.url) || /\/loader\.|spinner|ajax-loader/i.test(art.url)) return;
    // url(#gradient) / url(#divider) style references are not pictures.
    if (/#/.test(art.url) && art.url.split("#")[0] === page.split("#")[0]) return;
    out.push(art);
  };
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<template[\s\S]*?<\/template>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");

  for (const key of ["og:image", "twitter:image"]) {
    for (const tag of body.matchAll(/<meta\b[^>]*>/gi)) {
      if ([attr(tag[0], "property"), attr(tag[0], "name")].some((v) => v.toLowerCase() === key)) {
        const url = absolute(attr(tag[0], "content"), page);
        add({ url, label: words("share image", fileWords(url)), kind: "og", page, home });
      }
    }
  }

  // <img> (and lazy-loading variants), with srcset file names as extra words.
  for (const tag of body.matchAll(/<img\b[^>]*>/gi)) {
    const raw = tag[0];
    const srcset = attr(raw, "srcset") || attr(raw, "data-srcset");
    const setUrls = srcset.split(",").map((s) => s.trim().split(/\s+/)[0] ?? "").filter(Boolean);
    // The biggest file the page offers: the largest srcset entry, then lazy-load attributes, then src.
    let src = largestSrcset(srcset) || attr(raw, "data-src") || attr(raw, "data-lazy-src") || attr(raw, "data-lazy") || attr(raw, "data-original") || attr(raw, "data-image") || attr(raw, "src");
    if (!src || src.startsWith("data:")) src = setUrls.at(-1) ?? "";
    const url = absolute(src, page);
    const logo = /logo/i.test(`${attr(raw, "class")} ${attr(raw, "id")} ${src}`);
    add({
      url,
      label: words(attr(raw, "alt"), attr(raw, "title"), attr(raw, "aria-label"), attr(raw, "class"), attr(raw, "id"), fileWords(url), ...setUrls.slice(0, 2).map((u) => fileWords(absolute(u, page)))),
      kind: logo ? "logo" : "img",
      page,
      home,
      width: Number(attr(raw, "width")) || undefined,
      height: Number(attr(raw, "height")) || undefined,
    });
  }

  // <picture><source srcset> (the <img> inside is handled above; sources can name a different file).
  for (const pic of body.matchAll(/<picture\b[\s\S]*?<\/picture>/gi)) {
    const alt = attr(pic[0].match(/<img\b[^>]*>/i)?.[0] ?? "", "alt");
    for (const source of pic[0].matchAll(/<source\b[^>]*>/gi)) {
      const first = largestSrcset(attr(source[0], "srcset") || attr(source[0], "data-srcset"));
      const url = absolute(first, page);
      add({ url, label: words(alt, fileWords(url)), kind: "picture", page, home });
    }
  }

  // Linked full-size images (galleries / lightboxes: <a href="photo-full.jpg"><img src="thumb.jpg"></a>).
  for (const link of body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["'][^>]*>([\s\S]{0,600}?)<\/a>/gi)) {
    const url = absolute(link[1]!, page);
    const inner = link[2] ?? "";
    const alt = attr(inner.match(/<img\b[^>]*>/i)?.[0] ?? "", "alt");
    add({ url, label: words(alt, attr(link[0].match(/^<a\b[^>]*>/i)?.[0] ?? "", "title"), cleanInner(inner), fileWords(url)), kind: "img", page, home });
  }

  // Inline SVG drawings.
  let n = 0;
  for (const svg of body.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi)) {
    const markup = svg[0];
    const open = markup.match(/^<svg\b[^>]*>/i)?.[0] ?? "";
    const size = svgSize(open);
    if ((size.width && size.width < 64) || (size.height && size.height < 64) || markup.length < 400) continue;
    const inner = [...markup.matchAll(/\s(?:id|class|data-name|aria-label|inkscape:label)\s*=\s*["']([^"']{1,60})["']/gi)].map((m) => m[1]!).slice(0, 30);
    const title = markup.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const desc = markup.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i)?.[1] ?? "";
    n += 1;
    if (markup.length > SVG_MAX) continue;
    add({ url: `inline-svg:${home ? "home" : "page"}-${n}`, label: words(decode(title), decode(desc), ...inner), kind: "svg", page, home, ...size, svg: markup });
  }

  // CSS backgrounds: style="background-image:url(…)", data-bg attributes, <style> blocks and the site's stylesheets.
  for (const tag of body.matchAll(/<[a-z][a-z0-9-]*\b[^>]*\b(?:style|data-bg|data-bg-src|data-background|data-background-image)\s*=[^>]*>/gi)) {
    const raw = tag[0];
    const style = attr(raw, "style");
    const urls = [...style.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)].map((m) => m[1]!);
    for (const v of [attr(raw, "data-bg"), attr(raw, "data-background"), attr(raw, "data-background-image"), attr(raw, "data-bg-src")]) if (v) urls.push(v.replace(/^url\(['"]?|['"]?\)$/g, ""));
    for (const u of urls) {
      const url = absolute(u, page);
      add({ url, label: words(attr(raw, "class"), attr(raw, "id"), attr(raw, "aria-label"), attr(raw, "title"), fileWords(url)), kind: "css", page, home });
    }
  }
  const sheets = [...[...body.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => ({ href: page, text: m[1] ?? "" })), ...css];
  for (const sheet of sheets) {
    for (const rule of sheet.text.matchAll(/([^{}]{1,300})\{[^{}]*?background(?:-image)?\s*:[^;{}]*?url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
      const url = absolute(rule[2]!, sheet.href);
      if (!/\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/i.test(url)) continue;
      add({ url, label: words(rule[1]!.replace(/[.#>:+~,[\]()*="']/g, " "), fileWords(url)), kind: "css", page, home });
    }
  }
  return out;
}

/** All pages' imagery, homepage first, de-duplicated by URL, capped. */
export function collectSiteArt(docs: { url: string; html: string }[], css: { href: string; text: string }[], logo: string): SiteArt[] {
  const all: SiteArt[] = [];
  docs.forEach((doc, i) => all.push(...artOfPage(doc.html, doc.url, i === 0, i === 0 ? css : [])));
  if (logo) all.push({ url: logo, label: words("logo", fileWords(logo)), kind: "logo", page: docs[0]?.url ?? "", home: true });
  const seen = new Map<string, SiteArt>();
  for (const art of all) {
    const prev = seen.get(art.url);
    if (!prev) seen.set(art.url, art);
    else if (art.label && !prev.label.includes(art.label)) prev.label = `${prev.label} ${art.label}`.slice(0, 200);
  }
  return [...seen.values()].slice(0, SITE_ART_MAX);
}

/** Text inside a link (a caption), without tags. */
function cleanInner(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 80);
}

function hasWord(text: string, keyword: string): boolean {
  const t = ` ${text.toLowerCase()} `;
  const stem = keyword.replace(/s$/, "");
  return new RegExp(`\\b${stem.replace(/[^a-z0-9]/g, "")}(?:s|es)?\\b`).test(t);
}

/**
 * The site's own pictures of the subject, best first. Needs the subject's words in the picture's own words
 * (alt, title, file name, SVG labels, CSS selector). Homepage art, real images over the logo, bigger first.
 */
export function matchSiteArt(subject: string, art: SiteArt[]): SiteArt[] {
  const keywords = sceneKeywords(subject, undefined).filter((k) => !/^(image|graphic|illustration|picture|photo|art|icon)$/.test(k));
  if (!keywords.length) return [];
  const need = Math.min(2, keywords.length);
  const KIND: Record<SiteArtKind, number> = { img: 3, picture: 3, svg: 3, css: 2, og: 1, logo: 0 };
  return art
    .map((a, i) => ({ a, i, hits: keywords.filter((k) => hasWord(a.label, k)).length }))
    .filter((x) => x.hits >= need)
    .sort((x, y) => y.hits - x.hits || Number(y.a.home) - Number(x.a.home) || KIND[y.a.kind] - KIND[x.a.kind] || (y.a.width ?? 0) * (y.a.height ?? 0) - (x.a.width ?? 0) * (x.a.height ?? 0) || x.i - y.i)
    .map((x) => x.a);
}

/** Candidates to show the vision model when no picture's words name the subject: real pictures, homepage first. */
export function visionCandidates(art: SiteArt[], max = 8): SiteArt[] {
  return art
    .filter((a) => a.kind !== "svg" && a.kind !== "og" && !/avatar|profile photo|gravatar/i.test(a.label + a.url) && !/\.svg(\?|$)/i.test(a.url))
    .filter((a) => !(a.width && a.width < 120) && !(a.height && a.height < 120))
    .sort((x, y) => Number(y.home) - Number(x.home))
    .slice(0, max);
}

/** Inline SVG made safe to serve as an image: no scripts, event handlers, foreign content or outside links. */
export function sanitizeSvg(markup: string): string | undefined {
  let svg = markup.slice(0, SVG_MAX);
  if (!/^<svg\b/i.test(svg.trim())) return undefined;
  svg = svg
    .replace(/<(script|foreignObject|iframe|object|embed|audio|video)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|foreignObject|iframe|object|embed)\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, "")
    .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, "none")
    .replace(/@import[^;]*;/gi, "");
  if (!/\sxmlns=/.test(svg.slice(0, 300))) svg = svg.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}

/** Words that mark small UI pictures, not a brand's signature graphic. */
const NOT_SIGNATURE = /\b(?:icons?|favicon|logos?|badges?|buttons?|arrows?|chevron|avatar|gravatar|headshot|portrait|profile|sponsors?|partners?|payment|visa|mastercard|paypal|social|facebook|instagram|twitter|linkedin|youtube|tiktok|spinner|loader|placeholder|pixel|tracking|qr|circles?|shapes?|blobs?|dividers?|separators?|dots?|lines?)\b/i;

/**
 * Candidates for the site's signature brand graphic (a mascot, an illustration like bob.me's rocket): pictures in
 * the page (not the logo, the share image or small UI icons), homepage first, then the largest declared size.
 * Whether one really is a cutout illustration is decided after loading it (transparent PNG/WebP or SVG, ≥200px).
 */
export function signatureCandidates(art: SiteArt[], logo?: string, max = 6): SiteArt[] {
  const area = (a: SiteArt) => (a.width ?? 0) * (a.height ?? 0);
  return art
    .filter((a) => a.kind === "img" || a.kind === "picture" || a.kind === "svg" || a.kind === "css")
    .filter((a) => a.url !== logo && !NOT_SIGNATURE.test(`${a.label} ${a.url.split(/[?#]/)[0]}`))
    .filter((a) => !(a.width && a.width < 200) && !(a.height && a.height < 200))
    .sort((x, y) => Number(y.home) - Number(x.home) || area(y) - area(x))
    .slice(0, max);
}

/** A loaded picture is a signature graphic: a cutout (transparent / drawn) at least 200px each way, not a banner strip. */
export function isSignatureArt(file: { cutout: boolean; width?: number; height?: number; type: string }): boolean {
  if (!file.cutout) return false;
  if (!/^image\/(png|webp|svg\+xml|gif)$/.test(file.type)) return false;
  const w = file.width ?? 0;
  const h = file.height ?? 0;
  if (file.type !== "image/svg+xml" && (w < 200 || h < 200)) return false;
  // wider than 2:1 reads as a wordmark or banner (a logo in text), not a mascot / centerpiece graphic
  if (w && h && (w / h > 2 || h / w > 3)) return false;
  return true;
}
