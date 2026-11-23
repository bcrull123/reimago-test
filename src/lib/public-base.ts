/**
 * The public origin (plus any preview path prefix) used in links we hand back
 * (Preview, email, thank-you, admin, the reply webhook).
 *
 * Never use VERCEL_URL or a *.vercel.app / *.vercel.com host: on Grok Build / Vercel
 * the request Host is rewritten to a deployment URL that is often behind Vercel SSO,
 * so a customer who opens /made/<id> would land on a login page. Card iframes already
 * use a same-origin path; these helpers are for absolute links we put in email and
 * in the lead record.
 *
 * Order: the request's own host when it is a real public host; otherwise PUBLIC_BASE_URL
 * or VITE_PUBLIC_HOSTNAME (the published app's canonical host). A foreign Referer is
 * ignored (round 10f). https is never downgraded to http.
 *
 * Absolute links that go in email (preview_url, picture_url, preview_pages) must never be
 * root-relative: mail clients have no app origin, and some will prefix a stored or inferred
 * host (including a *.vercel.app deployment URL). If no public host is found, we default to
 * https://reimago.ai.
 */
import { previewPathPrefix } from "./preview-path-prefix.ts";

export type PublicRequest = {
  protocol: string;
  hostname: string;
  host: string;
  pathname: string;
};

/** Fallback origin for absolute customer links (email, webhook, Formcarry) when no public host is known. */
export const DEFAULT_PUBLIC_ORIGIN = "https://reimago.ai";

export type PublicBaseEnv = {
  /** Absolute origin, or a hostname. e.g. https://reimago.ai */
  publicBaseUrl?: string;
  /** Hostname only, e.g. reimago.ai or a grok.me publish host (VITE_PUBLIC_HOSTNAME). */
  publicHostname?: string;
};

/** True for Vercel system domains (SSO-protected deployment URLs, including VERCEL_URL). */
export function isVercelSystemHost(host: string): boolean {
  const h = String(host ?? "")
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase();
  return h === "vercel.app" || h.endsWith(".vercel.app") || h === "vercel.com" || h.endsWith(".vercel.com");
}

function hostnameOf(host: string): string {
  return String(host ?? "")
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase();
}

/** A host we may put in a customer-facing link (not Vercel, not empty, not a bare word). */
export function isPublicAppHost(host: string): boolean {
  const h = hostnameOf(host);
  if (!h) return false;
  if (isVercelSystemHost(h)) return false;
  if (h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "[::1]") return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) return true;
  return /^[a-z0-9.-]+$/.test(h) && h.includes(".");
}

function sameHost(request: PublicRequest, referer: URL): boolean {
  return referer.host.toLowerCase() === request.host.toLowerCase() || referer.hostname.toLowerCase() === request.hostname.toLowerCase();
}

function parseOrigin(raw: string, fallbackProtocol = "https:"): { protocol: string; host: string; pathname: string } | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    const url = new URL(text.includes("://") ? text : `${fallbackProtocol}//${text}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (!isPublicAppHost(url.host)) return undefined;
    const pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/$/, "") || "/";
    return { protocol: url.protocol, host: url.host, pathname };
  } catch {
    return undefined;
  }
}

/** Canonical origin from env, if it is a real public host (never a Vercel system domain). */
export function envPublicOrigin(env: PublicBaseEnv = {}): { protocol: string; host: string; pathname: string } | undefined {
  const fromUrl = env.publicBaseUrl ? parseOrigin(env.publicBaseUrl) : undefined;
  if (fromUrl) return fromUrl;
  const name = (env.publicHostname ?? "").trim();
  if (name) return parseOrigin(name, "https:");
  return undefined;
}

export function readPublicBaseEnv(): PublicBaseEnv {
  return {
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    // VITE_PUBLIC_HOSTNAME is injected by Grok Build as the public/grok.me host.
    // VERCEL_URL is intentionally ignored: it is the SSO-protected deployment host.
    publicHostname: process.env.VITE_PUBLIC_HOSTNAME || process.env.PUBLIC_HOSTNAME,
  };
}

function withPrefix(protocol: string, host: string, pathname: string): string {
  const prefix = previewPathPrefix(new URL(`${protocol}//${host}`).hostname, pathname) ?? "";
  return `${protocol}//${host}${prefix}`;
}

/**
 * Public origin for links handed back to the customer.
 * Never returns a *.vercel.app origin. If no public host can be found, returns ""
 * so callers can emit a root-relative /made/… path rather than a login-walled URL.
 */
export function publicBaseFrom(request: PublicRequest, refererHeader?: string, env: PublicBaseEnv = {}): string {
  const fallback = envPublicOrigin(env);

  let protocol = request.protocol.endsWith(":") ? request.protocol : `${request.protocol}:`;
  let host = request.host;
  let pathname = request.pathname;
  if (refererHeader) {
    try {
      const referer = new URL(refererHeader);
      if (sameHost(request, referer) && isPublicAppHost(referer.host)) {
        // Never downgrade https to http — card iframes on an https app would be mixed-content blocked.
        if (!(protocol.startsWith("https") && referer.protocol === "http:")) protocol = referer.protocol;
        host = referer.host;
        pathname = referer.pathname;
      }
    } catch {
      // Ignore a malformed Referer and keep the request URL.
    }
  }

  if (isPublicAppHost(host)) return withPrefix(protocol, host, pathname);
  if (fallback) return withPrefix(fallback.protocol, fallback.host, fallback.pathname);
  return "";
}

/** Like publicBaseFrom, but never empty: email and other absolute links fall back to reimago.ai. */
export function publicAbsoluteBaseFrom(request: PublicRequest, refererHeader?: string, env: PublicBaseEnv = {}): string {
  return publicBaseFrom(request, refererHeader, env) || DEFAULT_PUBLIC_ORIGIN;
}

/** Path prefix for this request (Referer first, then the request URL) so rendered /made links stay correct on path-based preview hosts. */
export function requestPathPrefixFrom(request: PublicRequest, refererHeader?: string): string {
  if (refererHeader) {
    try {
      const referer = new URL(refererHeader);
      if (isPublicAppHost(referer.host)) {
        const prefix = previewPathPrefix(referer.hostname, referer.pathname);
        if (prefix) return prefix;
      }
    } catch {
      // fall through
    }
  }
  if (!isPublicAppHost(request.host) && !isPublicAppHost(request.hostname)) return "";
  return previewPathPrefix(request.hostname, request.pathname) ?? "";
}

/** Join a public base and a /made/… path. Empty base → a root-relative path (never a vercel.app URL). */
export function publicLookUrlFrom(base: string, id: string, rest = ""): string {
  const suffix = `/made/${id}${rest}`;
  const origin = base.replace(/\/$/, "");
  return origin ? `${origin}${suffix}` : suffix;
}

const MADE_PATH = /^\/made\/([a-f0-9]{16})(\/.*)?$/i;

/**
 * Turn a maybe-bad /made link (*.vercel.app, root-relative, missing) into an absolute public URL.
 * Other URLs are left alone. Used so Email Bot and Formcarry never receive a login-walled or relative link.
 */
export function rewriteCustomerLookUrl(url: string, id: string, base: string, rest = ""): string {
  const origin = (base || DEFAULT_PUBLIC_ORIGIN).replace(/\/$/, "");
  const canonical = publicLookUrlFrom(origin, id, rest);
  const raw = url.trim();
  if (!raw) return canonical;
  try {
    const absolute = raw.startsWith("/") ? new URL(raw, DEFAULT_PUBLIC_ORIGIN) : new URL(raw);
    const match = absolute.pathname.match(MADE_PATH);
    if (!match) return raw;
    const lookId = match[1]!.toLowerCase();
    const tail = match[2] ?? rest;
    // Relative /made links and Vercel system hosts must be rewritten; a real public host is kept.
    if (raw.startsWith("/") || isVercelSystemHost(absolute.host) || !isPublicAppHost(absolute.host)) {
      return publicLookUrlFrom(origin, lookId, tail);
    }
    return `${absolute.protocol}//${absolute.host}/made/${lookId}${tail}`;
  } catch {
    return canonical;
  }
}

/** Rewrite each "Title: URL" (or bare URL) line in preview_pages the same way. */
export function rewritePreviewPages(text: string, id: string, base: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      const named = /^(.*?):\s*(\S+)\s*$/.exec(trimmed);
      if (named) return `${named[1]}: ${rewriteCustomerLookUrl(named[2]!, id, base)}`;
      if (/\/made\/[a-f0-9]{16}/i.test(trimmed)) return rewriteCustomerLookUrl(trimmed, id, base);
      return line;
    })
    .join("\n");
}
