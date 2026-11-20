/**
 * Browser-side screenshot of a look's homepage for the lead email (Formcarry `picture`).
 *
 * The page is loaded in a hidden, same-origin, unsandboxed iframe at desktop width (the visible preview
 * iframes are sandboxed, so their DOM can't be read), then drawn to PNG with modern-screenshot — no server
 * browser, so it works on Vercel. Preview images are already same-origin (/made/$id/img/…); anything the page
 * still hotlinks (SVG logos) is fetched through /made/$id/img/remote so the canvas is never tainted.
 * Google Fonts are CORS-enabled and embedded by the library.
 */
import { domToPng } from "modern-screenshot";
import { displayLookPath } from "@/lib/preview-display-url";

export const PICTURE_WIDTH = 1280;
/** Above-the-fold viewport used for layout (100vh sections), and the cap for the full-page picture. */
const VIEWPORT_HEIGHT = 720;
const MAX_HEIGHT = 2400;
const MAX_BYTES = 9_500_000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** The look's URL on this origin (the iframe must be same-origin to be read). */
export function sameOriginLookUrl(_lookUrl: string, lookId: string): string {
  return displayLookPath(lookId, window.location);
}

function loadFrame(src: string): Promise<HTMLIFrameElement> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.title = "Preview picture";
    // Laid out at desktop size but invisible and out of the way. Kept in the viewport (not far off-screen)
    // so the browser renders it normally.
    Object.assign(frame.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: `${PICTURE_WIDTH}px`,
      height: `${VIEWPORT_HEIGHT}px`,
      border: "0",
      opacity: "0",
      pointerEvents: "none",
      zIndex: "-1",
    });
    frame.onload = () => resolve(frame);
    frame.onerror = () => reject(new Error("the preview page did not load"));
    frame.src = src;
    document.body.appendChild(frame);
  });
}

async function settle(doc: Document): Promise<void> {
  // Freeze motion so the picture shows the finished state (hero fade-ins, Ken Burns, marquees, reveals).
  const freeze = doc.createElement("style");
  freeze.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}";
  doc.head.appendChild(freeze);
  const images = Array.from(doc.images);
  for (const img of images) {
    img.loading = "eager";
    img.decoding = "sync";
  }
  await Promise.all(
    images.map((img) =>
      withTimeout(
        img.complete && img.naturalWidth > 0 ? Promise.resolve() : img.decode().catch(() => undefined),
        10_000,
        "image",
      ).catch(() => undefined),
    ),
  );
  await withTimeout(doc.fonts.ready.then(() => undefined), 8_000, "fonts").catch(() => undefined);
  await new Promise((resolve) => window.setTimeout(resolve, 150));
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body = ""] = dataUrl.split(",", 2);
  const type = /data:([^;]+)/.exec(head ?? "")?.[1] ?? "image/png";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export type PreviewPicture = { blob: Blob; dataUrl: string; width: number; height: number };

/**
 * Screenshot the homepage of a look (top of the page, up to 1280×2400; 1280×720 if the long one is too big).
 * Throws with a short reason on failure — callers send the form without the picture in that case.
 */
export async function capturePreviewPicture(look: { id: string; url: string }, timeoutMs = 30_000): Promise<PreviewPicture> {
  let frame: HTMLIFrameElement | undefined;
  const work = async (): Promise<PreviewPicture> => {
    const src = sameOriginLookUrl(look.url, look.id);
    frame = await loadFrame(src);
    const doc = frame.contentDocument;
    if (!doc?.body) throw new Error("the preview page could not be read");
    await settle(doc);
    const base = new URL(src, window.location.href);
    const remote = (url: string) => `${base.pathname.replace(/\/$/, "")}/img/remote?u=${encodeURIComponent(url)}`;
    const fetchFn = async (url: string): Promise<string | false> => {
      let target: URL;
      try {
        target = new URL(url, base);
      } catch {
        return false;
      }
      if (target.protocol === "data:" || target.origin === window.location.origin) return false;
      // Google Fonts send CORS headers; let the library fetch and embed them directly.
      if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(target.hostname)) return false;
      const response = await fetch(remote(target.href), { credentials: "omit" }).catch(() => null);
      if (!response?.ok) return false;
      return blobToDataUrl(await response.blob());
    };
    const background = frame.contentWindow?.getComputedStyle(doc.body).backgroundColor || "#ffffff";
    const shoot = async (height: number) => {
      const dataUrl = await domToPng(doc.documentElement, {
        width: PICTURE_WIDTH,
        height,
        scale: 1,
        backgroundColor: background === "rgba(0, 0, 0, 0)" ? "#ffffff" : background,
        timeout: 12_000,
        fetchFn,
        // The ownerDocument of the node is the iframe; styles and fonts are read from there.
        font: { preferredFormat: "woff2" },
      });
      if (!dataUrl.startsWith("data:image/png")) throw new Error("the picture came out empty");
      return { dataUrl, blob: dataUrlToBlob(dataUrl), width: PICTURE_WIDTH, height };
    };
    const full = Math.min(Math.max(doc.documentElement.scrollHeight, VIEWPORT_HEIGHT), MAX_HEIGHT);
    let picture = await shoot(full);
    if (picture.blob.size >= MAX_BYTES && full > VIEWPORT_HEIGHT) picture = await shoot(VIEWPORT_HEIGHT);
    if (picture.blob.size >= MAX_BYTES) throw new Error("the picture is over 10 MB");
    if (picture.blob.size < 2_000) throw new Error("the picture came out blank");
    return picture;
  };
  try {
    return await withTimeout(work(), timeoutMs, "the preview picture");
  } finally {
    frame?.remove();
  }
}

/** File name the email bot expects: `<domain>.png`. */
export function pictureFileName(domain: string): string {
  const safe = domain.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "preview";
  return `${safe}.png`;
}
