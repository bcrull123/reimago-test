import { getRequestHeader, getRequestUrl } from "@tanstack/react-start/server";
import { publicBaseFrom, requestPathPrefixFrom, type PublicRequest } from "@/lib/public-base";
import { savePage } from "@/lib/pages.server";

function thisRequest(): PublicRequest {
  const url = getRequestUrl({ xForwardedHost: true, xForwardedProto: true });
  return { protocol: url.protocol, hostname: url.hostname, host: url.host, pathname: url.pathname };
}

/** Public origin (plus any preview path prefix) for links handed back to the browser. */
export function publicBase(): string {
  return publicBaseFrom(thisRequest(), getRequestHeader("referer"));
}

/** Path prefix the current request should use in /made links (same-host Referer, else the request URL). */
export function requestPathPrefix(): string {
  return requestPathPrefixFrom(thisRequest(), getRequestHeader("referer"));
}

export async function hostPage(html: string): Promise<string> {
  const id = await savePage(html);
  return `${publicBase()}/made/${id}`;
}
