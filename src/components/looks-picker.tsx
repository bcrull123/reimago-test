import { useEffect, useRef, useState } from "react";
import { ArrowDown, Check, CheckCircle2, Eye, RefreshCw } from "lucide-react";
import type { LookInfo } from "@/lib/preview/types";
import { ARCHETYPE_LABEL } from "@/lib/preview/archetype-label";


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
 * a different design direction. "Choose this look" is the main call to action: it builds every page
 * in that style and sends the brief (with a picture of the chosen homepage) — nothing is sent before.
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
  sent,
}: {
  looks: LookInfo[];
  focused: string;
  chosen?: string;
  busy: boolean;
  onFocus: (id: string) => void;
  onChoose: (look: LookInfo) => void;
  onRetry?: (look: LookInfo) => void;
  retryingId?: string;
  /** The brief was emailed (after the visitor chose a look). */
  sent?: boolean;
}) {
  return (
    <div>
      {sent ? (
        <div data-choose-banner className="flex items-center gap-4 rounded-2xl border-2 border-emerald-500 bg-emerald-50 px-5 py-5 sm:px-7" aria-live="polite">
          <CheckCircle2 className="size-10 shrink-0 text-emerald-600" aria-hidden />
          <div>
            <h2 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">Sent! Check your email.</h2>
            <p className="mt-1 text-sm text-muted sm:text-base">Your chosen look is built below, and a picture of it is on its way.</p>
          </div>
        </div>
      ) : (
        <div data-choose-banner className="flex items-center gap-4 rounded-2xl border-2 border-accent bg-accent/10 px-5 py-5 sm:px-7">
          <div className="min-w-0 flex-1">
            <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-ink sm:text-4xl">
              Choose your <span className="text-accent">favorite look</span>
            </h2>
            <p className="mt-2 text-base text-fg sm:text-lg">
              Tap <strong>Choose this look</strong> on the one you like. We'll build every page in that style and email you a picture.
            </p>
            <p className="mt-1 text-xs text-muted">
              {looks.length} homepage {looks.length === 1 ? "direction" : "directions"} for your site. Nothing is sent until you choose.
            </p>
          </div>
          <span className="flex size-14 shrink-0 animate-bounce items-center justify-center rounded-full bg-accent text-white shadow-lg motion-reduce:animate-none" aria-hidden>
            <ArrowDown className="size-8" strokeWidth={2.75} />
          </span>
        </div>
      )}
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
                ) : look.aiWarning ? (
                  <p className="text-xs leading-relaxed text-muted" data-ai-warning>
                    {look.aiWarning}
                  </p>
                ) : null}
                <div className="mt-auto flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busy || (isChosen && sent)}
                    onClick={() => onChoose(look)}
                    className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-lg font-semibold text-primary-fg shadow-md transition hover:brightness-110 focus-visible:ring-4 focus-visible:ring-primary/40 disabled:opacity-60"
                  >
                    {isChosen ? <Check className="size-5" aria-hidden /> : null}
                    {isChosen ? "Chosen" : "Choose this look"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onFocus(look.id)}
                    aria-pressed={isFocused}
                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm text-muted"
                  >
                    <Eye className="size-4" aria-hidden /> {isFocused ? "Previewing below" : "Preview"}
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
