import { getRequestHeader, getRequestUrl } from "@tanstack/react-start/server";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { savePage } from "@/lib/pages.server";

/** Public origin (plus any preview path prefix) for links handed back to the browser. */
export function publicBase(): string {
  try {
    const referer = getRequestHeader("referer");
    if (referer) {
      const ref = new URL(referer);
      const prefix = previewPathPrefix(ref.hostname, ref.pathname) ?? "";
      return `${ref.protocol}//${ref.host}${prefix}`;
    }
  } catch {
    // Fall through to the request URL.
  }
  const url = getRequestUrl({ xForwardedHost: true, xForwardedProto: true });
  const prefix = previewPathPrefix(url.hostname, url.pathname) ?? "";
  return `${url.protocol}//${url.host}${prefix}`;
}

export async function hostPage(html: string): Promise<string> {
  const id = await savePage(html);
  return `${publicBase()}/made/${id}`;
}
