import { useEffect, useState } from "react";
import { ExternalLink, Monitor, Smartphone } from "lucide-react";
import type { PreviewInfo } from "@/lib/preview/types";

/**
 * The live, clickable preview site in a sandboxed iframe.
 * No allow-scripts / allow-same-origin: the preview pages ship no JavaScript and
 * cannot touch this app. Links navigate inside the frame; the contact form opens
 * Formcarry in a new tab (allow-forms + allow-popups).
 */
export function LivePreview({ preview, host }: { preview: PreviewInfo; host: string }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [src, setSrc] = useState(preview.url);

  useEffect(() => setSrc(preview.url), [preview.url]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </span>
        <p className="min-w-0 flex-1 truncate rounded-full bg-bg px-3 py-1 text-xs text-muted">
          {host} · live preview{preview.mock ? " (mock mode)" : ""}
        </p>
        <div className="flex items-center gap-1 rounded-md border border-border bg-bg p-0.5" role="group" aria-label="Preview size">
          <button
            type="button"
            onClick={() => setDevice("desktop")}
            aria-pressed={device === "desktop"}
            className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs ${device === "desktop" ? "bg-ink text-white" : "text-muted"}`}
          >
            <Monitor className="size-3.5" aria-hidden /> Desktop
          </button>
          <button
            type="button"
            onClick={() => setDevice("mobile")}
            aria-pressed={device === "mobile"}
            className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs ${device === "mobile" ? "bg-ink text-white" : "text-muted"}`}
          >
            <Smartphone className="size-3.5" aria-hidden /> Mobile
          </button>
        </div>
        <a
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-fg"
        >
          Open full site <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-border bg-bg px-4 py-2 text-xs">
        <span className="text-faint">Pages:</span>
        {preview.pages.map((page) => (
          <button
            key={page.slug}
            type="button"
            onClick={() => setSrc(`${page.url}${page.url === src ? `?r=${Date.now()}` : ""}`)}
            className="text-primary underline-offset-4 hover:underline"
          >
            {page.title}
          </button>
        ))}
      </div>
      <div className={`flex justify-center bg-[#e9e9ec] ${device === "mobile" ? "py-6" : ""}`}>
        <iframe
          key={`${preview.id}-${device}`}
          src={src}
          title={`Live preview of ${host}`}
          sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          loading="lazy"
          className={
            device === "mobile"
              ? "h-[760px] w-[390px] max-w-full rounded-[28px] border-8 border-ink bg-white"
              : "h-[78vh] min-h-[560px] w-full bg-white"
          }
        />
      </div>
    </div>
  );
}
