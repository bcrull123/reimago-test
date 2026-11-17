import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, Check, CheckCircle2, Eye, MessageSquareText, RefreshCw, Wand2 } from "lucide-react";
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
  feedback = [],
  maxFeedback = 5,
  refining = false,
  onRefine,
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
  /** "Not quite right?" rounds so far (oldest first). */
  feedback?: string[];
  maxFeedback?: number;
  refining?: boolean;
  /** Make three new looks from the original note + this feedback. Never sends the form. */
  onRefine?: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const roundsLeft = maxFeedback - feedback.length;
  function submitRefine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !onRefine || refining || busy || roundsLeft <= 0) return;
    onRefine(text);
    setDraft("");
  }
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
      {feedback.length ? (
        <p className="mt-4 text-sm text-fg" data-refine-round>
          <strong>3 new looks</strong> from your feedback (round {feedback.length} of {maxFeedback}): “{feedback.at(-1)}”
        </p>
      ) : null}
      <div className={`mt-6 grid gap-5 transition-opacity md:grid-cols-3 ${refining ? "pointer-events-none opacity-40" : ""}`} aria-busy={refining}>
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
                {look.request ? (
                  <p className="rounded-md bg-accent/10 px-2.5 py-1.5 text-xs leading-relaxed text-fg" data-look-request>
                    <MessageSquareText className="mr-1 inline size-3.5 align-[-2px] text-accent" aria-hidden />
                    Based on your request: “{look.request.length > 140 ? `${look.request.slice(0, 137)}…` : look.request}”
                    {look.applied?.length ? <span className="mt-0.5 block text-muted">Applied: {look.applied.join(" · ")}</span> : null}
                  </p>
                ) : null}
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
      {onRefine ? (
        <form id="refine-looks" onSubmit={submitRefine} className="mt-6 scroll-mt-6 rounded-2xl border-2 border-dashed border-primary/50 bg-surface p-4 sm:p-5">
          <label htmlFor="refine-text" className="block text-lg font-semibold text-ink">
            Not quite right? What would you like to see different?
          </label>
          <p className="mt-1 text-sm text-muted">
            Tell us in your own words (colors, mood, photos, sections, wording). We'll make 3 new looks using your original note plus this. Nothing is sent until you choose a look.
          </p>
          <textarea
            id="refine-text"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 400))}
            maxLength={400}
            rows={3}
            disabled={roundsLeft <= 0}
            placeholder="e.g. Darker and more premium, use navy and gold, and show more photos of our work."
            className="mt-3 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-50"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!draft.trim() || refining || busy || roundsLeft <= 0}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-ink px-5 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Wand2 className={`size-4 ${refining ? "animate-pulse" : ""}`} aria-hidden />
              {refining ? "Making 3 new looks…" : "Show me 3 new looks"}
            </button>
            <span className="text-xs text-muted">
              {roundsLeft > 0 ? `${roundsLeft} of ${maxFeedback} rounds left.` : "That's all the rounds for this preview. Choose the closest look; sales will follow up on the rest."}
            </span>
          </div>
          {feedback.length ? (
            <div className="mt-3 text-xs text-muted">
              <p className="font-medium text-fg">Your requests so far</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                {feedback.map((item, i) => (
                  <li key={`${i}-${item}`}>{item}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
