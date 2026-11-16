import { useEffect, useRef, useState } from "react";
import { Check, Eye, RefreshCw, Sparkles } from "lucide-react";
import type { LookInfo } from "@/lib/preview/types";

const ARCHETYPE_LABEL: Record<LookInfo["archetype"], string> = {
  editorial: "Editorial",
  "dark-premium": "Dark premium",
  "bold-photo": "Bold photo-led",
  playful: "Playful",
  "minimal-luxury": "Minimal luxury",
  "warm-craft": "Warm craft",
};

/** A live, scaled-down homepage thumbnail (sandboxed, not interactive). */
function Thumb({ look }: { look: LookInfo }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.27);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setScale((entry?.contentRect.width ?? 345) / 1280));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="relative aspect-[16/11] overflow-hidden rounded-t-2xl bg-[#e9e9ec]">
      <iframe
        key={look.rev ?? 0}
        src={look.rev ? `${look.url}?v=${look.rev}` : look.url}
        title={`${look.name} homepage`}
        sandbox=""
        loading="lazy"
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 h-[880px] w-[1280px] origin-top-left border-0 bg-white"
        style={{ transform: `scale(${scale})` }}
      />
    </div>
  );
}

/**
 * The visitor's choice of homepage looks. Each card is a real, live homepage in
 * a different design direction; "Use this look" builds every page in that style.
 */
export function LooksPicker({
  looks,
  focused,
  chosen,
  busy,
  onFocus,
  onChoose,
  onRetry,
  retryingId,
}: {
  looks: LookInfo[];
  focused: string;
  chosen?: string;
  busy: boolean;
  onFocus: (id: string) => void;
  onChoose: (look: LookInfo) => void;
  onRetry?: (look: LookInfo) => void;
  retryingId?: string;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-eyebrow text-faint">Pick a look</p>
          <h2 className="mt-1 font-display text-3xl leading-tight text-ink">
            {looks.length} homepage {looks.length === 1 ? "direction" : "directions"} for your site
          </h2>
        </div>
        <p className="max-w-md text-sm text-muted">
          Preview each look, then choose your favorite. We build every page in that style and give it a designer polish.
        </p>
      </div>
      <div className="mt-6 grid gap-5 md:grid-cols-3">
        {looks.map((look) => {
          const isChosen = chosen === look.id;
          const isFocused = focused === look.id;
          return (
            <article
              key={look.id}
              data-look={look.id}
              className={`flex flex-col overflow-hidden rounded-2xl border-2 bg-bg transition-shadow ${
                isChosen ? "border-primary shadow-[0_18px_40px_-24px_rgba(0,104,232,0.85)]" : isFocused ? "border-ink/60" : "border-border"
              }`}
            >
              <button type="button" onClick={() => onFocus(look.id)} className="block text-left" aria-label={`Preview the ${look.name} look`}>
                <Thumb look={look} />
              </button>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-xl leading-tight text-ink">{look.name}</h3>
                    <p className="text-xs uppercase tracking-eyebrow text-faint">{ARCHETYPE_LABEL[look.archetype]}</p>
                  </div>
                  {isChosen ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-fg">
                      <Check className="size-3" aria-hidden /> Chosen
                    </span>
                  ) : null}
                </div>
                {look.mood ? <p className="text-sm leading-relaxed text-muted">{look.mood}</p> : null}
                <div className="flex items-center gap-1.5" aria-label="Palette">
                  {[look.palette.primary, look.palette.accent, look.palette.background, look.palette.surface, look.palette.text].map((color, i) => (
                    <span key={`${color}-${i}`} title={color} className="size-5 rounded-full border border-border" style={{ background: color }} />
                  ))}
                </div>
                <p className="text-xs text-muted">
                  {look.fonts.heading} / {look.fonts.body}
                  {look.images.generated || look.images.photos
                    ? ` · ${[look.images.photos ? `${look.images.photos} of your photos` : "", look.images.generated ? `${look.images.generated} AI photo${look.images.generated === 1 ? "" : "s"}` : ""]
                        .filter(Boolean)
                        .join(" · ")}`
                    : ""}
                </p>
                {look.aiError ? (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900">
                    <p>
                      <strong>Section-library version.</strong> The AI homepage failed: {look.aiError}
                    </p>
                    {onRetry ? (
                      <button
                        type="button"
                        disabled={busy || retryingId === look.id}
                        onClick={() => onRetry(look)}
                        className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-900 px-3 text-xs font-medium text-white disabled:opacity-50"
                      >
                        <RefreshCw className={`size-3.5 ${retryingId === look.id ? "animate-spin" : ""}`} aria-hidden />
                        {retryingId === look.id ? "Retrying with AI…" : "Retry with AI"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-auto flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onFocus(look.id)}
                    className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm"
                  >
                    <Eye className="size-4" aria-hidden /> Preview
                  </button>
                  <button
                    type="button"
                    disabled={busy || isChosen}
                    onClick={() => onChoose(look)}
                    className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md bg-ink px-3 text-sm font-medium text-white disabled:opacity-40"
                  >
                    <Sparkles className="size-4" aria-hidden /> {isChosen ? "In use" : "Use this look"}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
