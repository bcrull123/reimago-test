/**
 * Allow-list HTML sanitizer for AI-written page bodies.
 *
 * Strips scripts, styles, iframes, forms, event handlers, inline styles,
 * javascript: URLs and any tag/attribute not on the list. It also enforces the
 * "real facts only" rule: tel:/mailto: links and phone/email text must match
 * the scraped facts, images must come from the scraped site, and internal
 * links are normalized to `@page:<slug>` tokens that the renderer rewrites.
 */

const DROP_WITH_CONTENT = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "template",
  "svg",
  "math",
  "form",
  "select",
  "textarea",
  "button",
  "canvas",
  "video",
  "audio",
  "head",
  "title",
];
const VOID_DROP = ["link", "meta", "base", "input", "source", "track", "param", "frame", "frameset", "applet"];

const ALLOWED_TAGS = new Set([
  "section",
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "img",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "br",
  "hr",
  "blockquote",
  "cite",
  "figure",
  "figcaption",
  "article",
  "aside",
  "small",
  "dl",
  "dt",
  "dd",
  "details",
  "summary",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "address",
  "time",
  "mark",
  "sup",
  "sub",
]);
const VOID_TAGS = new Set(["img", "br", "hr"]);
const GLOBAL_ATTRS = new Set(["class", "id", "title", "role", "lang"]);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height", "loading"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
  time: new Set(["datetime"]),
  details: new Set(["open"]),
};

export type SanitizeContext = {
  slugs: string[];
  phone: string;
  email: string;
  images: string[];
  sourceHost: string;
};

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const digits = (value: string) => value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

export function pageSlugFor(path: string, slugs: string[]): string {
  const clean = path.toLowerCase().split(/[?#]/)[0]!.replace(/^\/+|\/+$/g, "").replace(/\.html?$/, "");
  const first = clean.split("/").pop() ?? "";
  if (!first || first === "home" || first === "index") return "home";
  if (slugs.includes(first)) return first;
  const fuzzy = slugs.find((slug) => slug !== "home" && (first.includes(slug) || slug.includes(first)));
  if (fuzzy) return fuzzy;
  if (/contact|quote|book|appointment|reserve/.test(first) && slugs.includes("contact")) return "contact";
  return "home";
}

export function normalizeHref(raw: string, ctx: SanitizeContext): { href: string; external: boolean } {
  const href = decodeAttr(raw).trim();
  if (!href) return { href: "#", external: false };
  if (href.startsWith("@page:")) {
    const slug = href.slice(6);
    return { href: `@page:${ctx.slugs.includes(slug) ? slug : "home"}`, external: false };
  }
  if (href.startsWith("#")) return { href: /^#[A-Za-z][\w-]*$/.test(href) ? href : "#", external: false };
  if (/^tel:/i.test(href)) {
    return ctx.phone && digits(href) === digits(ctx.phone)
      ? { href: `tel:${digits(ctx.phone).length === 10 ? `+1${digits(ctx.phone)}` : digits(ctx.phone)}`, external: false }
      : { href: `@page:${ctx.slugs.includes("contact") ? "contact" : "home"}`, external: false };
  }
  if (/^mailto:/i.test(href)) {
    const address = href.slice(7).split("?")[0]!.toLowerCase();
    return ctx.email && address === ctx.email.toLowerCase()
      ? { href: `mailto:${ctx.email}`, external: false }
      : { href: `@page:${ctx.slugs.includes("contact") ? "contact" : "home"}`, external: false };
  }
  if (href.startsWith("/") && !href.startsWith("//")) return { href: `@page:${pageSlugFor(href, ctx.slugs)}`, external: false };
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      const host = url.hostname.replace(/^www\./, "");
      if (ctx.sourceHost && host === ctx.sourceHost.replace(/^www\./, "")) {
        return { href: `@page:${pageSlugFor(url.pathname, ctx.slugs)}`, external: false };
      }
      return { href: url.toString(), external: true };
    } catch {
      return { href: "#", external: false };
    }
  }
  // Relative links like "about" or "services.html".
  if (/^[a-z0-9][a-z0-9\-/.]*$/i.test(href)) return { href: `@page:${pageSlugFor(href, ctx.slugs)}`, external: false };
  return { href: "#", external: false };
}

const PHONE_TEXT = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}\b/g;
const EMAIL_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Remove phone numbers / emails from text that are not in the facts. */
export function scrubInventedContacts(text: string, ctx: Pick<SanitizeContext, "phone" | "email">): string {
  return text
    .replace(PHONE_TEXT, (match) => (ctx.phone && digits(match) === digits(ctx.phone) ? match : "our contact page"))
    .replace(EMAIL_TEXT, (match) => (ctx.email && match.toLowerCase() === ctx.email.toLowerCase() ? match : "our contact page"));
}

let phCounter = 0;

export function sanitizeHtml(input: string, ctx: SanitizeContext): string {
  let html = input;
  const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) html = fence[1];
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[1]) html = bodyMatch[1];
  html = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<!doctype[^>]*>/gi, "").replace(/<\/?(html|body)[^>]*>/gi, "");
  for (const tag of DROP_WITH_CONTENT) {
    html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
    html = html.replace(new RegExp(`<${tag}\\b[^>]*>`, "gi"), "");
  }
  for (const tag of VOID_DROP) html = html.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
  // Site chrome is rendered by us; drop any AI-written header/nav/footer/main wrappers but keep their inner content
  // only for main (header/nav/footer content would duplicate navigation).
  html = html.replace(/<(header|nav|footer)\b[\s\S]*?<\/\1\s*>/gi, "");

  const allowedImages = new Set(ctx.images);
  const out: string[] = [];
  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  const textChunk = (chunk: string) => scrubInventedContacts(chunk.replace(/</g, "&lt;").replace(/>/g, "&gt;"), ctx);
  while ((match = tagPattern.exec(html))) {
    out.push(textChunk(html.slice(last, match.index)));
    last = tagPattern.lastIndex;
    const closing = match[1] === "/";
    let tag = (match[2] ?? "").toLowerCase();
    if (tag === "main") tag = "div";
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (closing) {
      if (!VOID_TAGS.has(tag)) out.push(`</${tag}>`);
      continue;
    }
    const attrs = new Map<string, string>();
    for (const a of (match[3] ?? "").matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      const name = (a[1] ?? "").toLowerCase();
      const value = a[3] ?? a[4] ?? a[5] ?? "";
      if (name.startsWith("on") || name === "style" || name === "srcset") continue;
      if (GLOBAL_ATTRS.has(name) || name.startsWith("aria-") || TAG_ATTRS[tag]?.has(name)) attrs.set(name, value);
    }
    if (tag === "img") {
      const src = decodeAttr(attrs.get("src") ?? "");
      if (!allowedImages.has(src)) {
        phCounter = (phCounter % 3) + 1;
        const alt = decodeAttr(attrs.get("alt") ?? "");
        out.push(`<div class="ph ph-${phCounter}" role="img" aria-label="${escapeAttr(alt || "Photo placeholder")}"></div>`);
        continue;
      }
      attrs.set("loading", "lazy");
      if (!attrs.has("alt")) attrs.set("alt", "");
    }
    if (tag === "a") {
      const { href, external } = normalizeHref(attrs.get("href") ?? "", ctx);
      attrs.set("href", href);
      attrs.delete("target");
      attrs.delete("rel");
      if (external) {
        attrs.set("target", "_blank");
        attrs.set("rel", "noopener noreferrer");
      }
    }
    if (attrs.has("class")) {
      const cls = decodeAttr(attrs.get("class") ?? "").replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      if (cls) attrs.set("class", cls);
      else attrs.delete("class");
    }
    const rendered = [...attrs.entries()]
      .map(([name, value]) => (value === "" && name === "open" ? name : `${name}="${escapeAttr(decodeAttr(value))}"`))
      .join(" ");
    out.push(`<${tag}${rendered ? ` ${rendered}` : ""}>`);
  }
  out.push(textChunk(html.slice(last)));
  return out.join("").replace(/javascript:/gi, "").trim();
}
