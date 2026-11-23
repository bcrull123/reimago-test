import { getRequestHeader, getRequestUrl } from "@tanstack/react-start/server";
import { DEFAULT_PUBLIC_ORIGIN, publicAbsoluteBaseFrom, publicBaseFrom, publicLookUrlFrom, readPublicBaseEnv, requestPathPrefixFrom, type PublicRequest } from "@/lib/public-base";
import { savePage } from "@/lib/pages.server";

function thisRequest(): PublicRequest {
  const url = getRequestUrl({ xForwardedHost: true, xForwardedProto: true });
  return { protocol: url.protocol, hostname: url.hostname, host: url.host, pathname: url.pathname };
}

/** Public origin (plus any preview path prefix) for links handed back to the browser, email and admin. Never a *.vercel.app host. */
export function publicBase(): string {
  const base = publicBaseFrom(thisRequest(), getRequestHeader("referer"), readPublicBaseEnv());
  if (!base) console.warn(`[public-base] no public host: refused to use a Vercel system domain. Set PUBLIC_BASE_URL or VITE_PUBLIC_HOSTNAME. Absolute email links will use ${DEFAULT_PUBLIC_ORIGIN}.`);
  return base;
}

/** Always-absolute public origin: PUBLIC_BASE_URL / request host / VITE_PUBLIC_HOSTNAME, else DEFAULT_PUBLIC_ORIGIN. */
export function publicAbsoluteBase(): string {
  return publicAbsoluteBaseFrom(thisRequest(), getRequestHeader("referer"), readPublicBaseEnv());
}

/** Absolute /made/<id>… link for customers (email, webhook, Formcarry, look.url). Never relative, never *.vercel.app. */
export function publicLookUrl(id: string, rest = ""): string {
  return publicLookUrlFrom(publicAbsoluteBase(), id, rest);
}

/** Path prefix the current request should use in /made links (same-host Referer, else the request URL). */
export function requestPathPrefix(): string {
  return requestPathPrefixFrom(thisRequest(), getRequestHeader("referer"));
}

export async function hostPage(html: string): Promise<string> {
  const id = await savePage(html);
  return publicLookUrl(id);
}
