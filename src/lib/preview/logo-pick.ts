/**
 * Pick the site's real logo from its HTML (pure, no I/O).
 *
 * Lazy-loading themes put a placeholder (data: URI, 1x1 gif, "blank.png") in src and the real file in
 * data-src / data-lazy-src / srcset, so every candidate URL on an <img> is considered. Tracking pixels,
 * spacers, avatars and partner/brand badges are skipped, and candidates are scored: an explicit "logo"
 * signal, being inside <header>, and alt text matching the site name all count.
 */

const URL_ATTRS = ["data-src", "data-lazy-src", "data-original", "data-lazyload", "data-image", "src"];
const SRCSET_ATTRS = ["data-srcset", "data-lazy-srcset", "srcset"];
const PLACEHOLDER = /^data:|(^|\/)(blank|spacer|pixel|transparent|placeholder|lazy|loading|1x1)[^/]*\.(gif|png|svg)(\?|$)|\/(tr|pixel|collect|beacon)(\?|\/|$)|facebook\.com\/tr|google-analytics|doubleclick|\.gif(\?|$)/i;
const NOT_LOGO = /avatar|emoji|gravatar|w-logo|wordpress-logo|(partner|sponsor|client|vendor|payment|award|certif|badge|bbb|yelp|google|facebook|instagram|twitter|tripadvisor)[-_ ]?(logo|icon|img|badge)?/i;

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").replace(/&amp;/g, "&").trim();
}

/** The largest candidate in a srcset ("a.png 1x, b.png 2x" or "a.png 300w, b.png 600w"). */
export function bestFromSrcset(srcset: string): string {
  let best = "";
  let bestScore = -1;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [url, size] = part.trim().split(/\s+/);
    if (!url) continue;
    const n = size ? parseFloat(size) * (size.endsWith("x") ? 1000 : 1) : 1;
    if (n > bestScore) {
      bestScore = n;
      best = url;
    }
  }
  return best;
}

function resolve(value: string, base: string): string {
  try {
    const url = new URL(value, base);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

/** The real image URL of an <img> tag, skipping lazy-load placeholders; "" if none. */
export function imgUrl(tag: string, base: string): string {
  for (const name of SRCSET_ATTRS) {
    const set = attr(tag, name);
    const pick = set ? bestFromSrcset(set) : "";
    if (pick && !PLACEHOLDER.test(pick)) {
      // Prefer data-src over a srcset of thumbnails only when srcset is the plain attribute.
      const lazy = attr(tag, "data-src");
      if (name === "srcset" && lazy && !PLACEHOLDER.test(lazy)) return resolve(lazy, base);
      return resolve(pick, base);
    }
  }
  for (const name of URL_ATTRS) {
    const value = attr(tag, name);
    if (value && !PLACEHOLDER.test(value)) return resolve(value, base);
  }
  return "";
}

export function pickLogo(html: string, base: string, siteName = ""): string {
  const headerStart = html.search(/<header\b/i);
  const headerEnd = headerStart >= 0 ? html.indexOf("</header>", headerStart) : -1;
  const name = siteName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const candidates: { url: string; score: number; at: number }[] = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const at = match.index ?? 0;
    const width = parseInt(attr(tag, "width"), 10);
    const height = parseInt(attr(tag, "height"), 10);
    if ((width > 0 && width <= 2) || (height > 0 && height <= 2)) continue;
    const signals = `${attr(tag, "class")} ${attr(tag, "id")} ${attr(tag, "alt")} ${attr(tag, "elementtiming")} ${attr(tag, "data-testid")}`;
    const url = imgUrl(tag, base);
    if (!url) continue;
    if (NOT_LOGO.test(signals) || NOT_LOGO.test(url.replace(/^https:\/\/[^/]+/, ""))) continue;
    const inHeader = headerStart >= 0 && at > headerStart && (headerEnd < 0 || at < headerEnd);
    const altName = name.length >= 3 && attr(tag, "alt").toLowerCase().replace(/[^a-z0-9]+/g, "").includes(name);
    const logoish = /(^|[^a-z])logo([^a-z]|$)|custom-logo|site-logo|brand(ing)?([^a-z]|$)/i.test(signals) || /logo/i.test(url.replace(/^https:\/\/[^/]+/, ""));
    if (!logoish && !(inHeader && altName)) continue;
    let score = 0;
    if (logoish) score += 3;
    if (inHeader) score += 2;
    if (altName) score += 1;
    if (/\.(svg|png)(\?|$)/i.test(url)) score += 1;
    if (/footer/i.test(signals)) score -= 2;
    candidates.push({ url, score, at });
  }
  candidates.sort((a, b) => b.score - a.score || a.at - b.at);
  return candidates[0]?.url ?? "";
}
