/**
 * The public origin (plus any preview path prefix) used in links we hand back.
 * A foreign Referer (Grok, email, another site) must not become that origin — otherwise
 * card iframes point at a host that is not this app (or at http: on an https page) and
 * the thumbs render as a blank broken-image box.
 */
import { previewPathPrefix } from "./preview-path-prefix.ts";

export type PublicRequest = {
  protocol: string;
  hostname: string;
  host: string;
  pathname: string;
};

function sameHost(request: PublicRequest, referer: URL): boolean {
  return referer.host.toLowerCase() === request.host.toLowerCase() || referer.hostname.toLowerCase() === request.hostname.toLowerCase();
}

export function publicBaseFrom(request: PublicRequest, refererHeader?: string): string {
  let protocol = request.protocol.endsWith(":") ? request.protocol : `${request.protocol}:`;
  let host = request.host;
  let pathname = request.pathname;
  if (refererHeader) {
    try {
      const referer = new URL(refererHeader);
      if (sameHost(request, referer)) {
        // Never downgrade https to http — card iframes on an https app would be mixed-content blocked.
        if (!(protocol.startsWith("https") && referer.protocol === "http:")) protocol = referer.protocol;
        host = referer.host;
        pathname = referer.pathname;
      }
    } catch {
      // Ignore a malformed Referer and keep the request URL.
    }
  }
  const prefix = previewPathPrefix(new URL(`${protocol}//${host}`).hostname, pathname) ?? "";
  return `${protocol}//${host}${prefix}`;
}

/** Path prefix for this request (Referer first, then the request URL) so rendered /made links stay correct on path-based preview hosts. */
export function requestPathPrefixFrom(request: PublicRequest, refererHeader?: string): string {
  if (refererHeader) {
    try {
      const referer = new URL(refererHeader);
      const prefix = previewPathPrefix(referer.hostname, referer.pathname);
      if (prefix) return prefix;
    } catch {
      // fall through
    }
  }
  return previewPathPrefix(request.hostname, request.pathname) ?? "";
}
