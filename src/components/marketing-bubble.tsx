/**
 * Round 10e — marketing bubble to the left of the landing form (above it on phones).
 * Generic on purpose: no product name or logo, so a white-label clone can leave this alone.
 */
const POINTS: { lead: string; rest: string }[] = [
  { lead: "Save cost", rest: " — lower your website bill" },
  { lead: "Update your site automatically", rest: ", any time you want" },
  { lead: "AI-designed", rest: " in minutes" },
  { lead: "Domain, email & hosting", rest: " available" },
];

function Check() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.18" />
      <path d="M6 10.5 8.6 13 14 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MarketingBubble() {
  return (
    <aside data-marketing-bubble className="relative mx-auto w-full max-w-md md:mx-0 md:mt-1 md:max-w-none md:pr-2">
      <div className="relative rounded-[1.75rem] border-2 border-brand bg-brand-wash px-5 py-5 text-ink shadow-[0_16px_36px_-18px_var(--brand-shadow)] sm:px-6 sm:py-6">
        <h1 className="font-display text-[1.85rem] font-semibold leading-[1.15] tracking-tight text-ink sm:text-[2.15rem]">
          <span className="text-brand-dark">FREE</span> to start
        </h1>
        <ul className="mt-4 space-y-2.5">
          {POINTS.map((point) => (
            <li key={point.lead} className="flex gap-2.5 text-sm leading-snug text-ink sm:text-[0.95rem]">
              <Check />
              <span>
                <strong className="font-semibold">{point.lead}</strong>
                {point.rest}
              </span>
            </li>
          ))}
        </ul>
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-full h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b-2 border-r-2 border-brand bg-brand-wash md:left-full md:top-12 md:translate-x-0 md:-translate-y-1/2 md:border-b-0 md:border-t-2"
        />
      </div>
    </aside>
  );
}
