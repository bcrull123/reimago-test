/**
 * Same-origin paths for preview pages and their stored images, as the *browser* should load them.
 * Card thumbs and the live preview must not use the server-built absolute look URL: publicBase() can
 * be the wrong host or http:, and the iframe then shows a blank broken-image box.
 */
import { previewPathPrefix } from "./preview-path-prefix.ts";

export function currentPreviewPrefix(location: { hostname: string; pathname: string }): string {
  return previewPathPrefix(location.hostname, location.pathname) ?? "";
}

export function displayLookPath(lookId: string, location: { hostname: string; pathname: string }): string {
  return `${currentPreviewPrefix(location)}/made/${lookId}`;
}

export function displayImagePath(lookId: string, name: string, location: { hostname: string; pathname: string }): string {
  return `${currentPreviewPrefix(location)}/made/${lookId}/img/${name}`;
}

/**
 * Stored image names to try as a card-thumbnail fallback, preferred first
 * (hero, Imagine mockup/art, then the owner's photos).
 */
export function thumbFallbackNames(names: Iterable<string>): string[] {
  const have = [...new Set(names)].filter((n) => /^[a-z0-9-]{1,40}$/.test(n));
  const prefer = ["hero", "mockup", "art-1", "art-2", "photo-1", "photo-2", "photo-3", "photo-4"];
  const out: string[] = [];
  for (const name of prefer) if (have.includes(name)) out.push(name);
  for (const name of have) if (!out.includes(name) && name !== "capture" && !name.startsWith("upload-")) out.push(name);
  return out.slice(0, 8);
}
