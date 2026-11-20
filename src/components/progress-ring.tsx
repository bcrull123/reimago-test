/**
 * Round 10 — the progress ring that replaced the spinner. It fills segment by segment around the circle by
 * elapsed / the server's rolling average for this kind of render (round 1, card edit, new site), capped at 95%
 * until the work is really done. Under it, lively status lines tied to the real stage, rotating every few seconds,
 * and a Stop button.
 */
import { useEffect, useState } from "react";
import { ringFraction } from "@/lib/status-copy";

const SEGMENTS = 24;


export function ProgressRing({ start, averageMs, done = false, compact = false }: { start: number; averageMs: number; done?: boolean; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  const fraction = done ? 1 : ringFraction(now - start, averageMs);
  const lit = Math.floor(fraction * SEGMENTS);
  const secs = Math.max(0, Math.round((now - start) / 1000));
  const r = 80;
  const gap = 3.2; // degrees between segments
  const arc = (i: number) => {
    const a0 = ((i * 360) / SEGMENTS + gap / 2 - 90) * (Math.PI / 180);
    const a1 = (((i + 1) * 360) / SEGMENTS - gap / 2 - 90) * (Math.PI / 180);
    return `M ${100 + r * Math.cos(a0)} ${100 + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${100 + r * Math.cos(a1)} ${100 + r * Math.sin(a1)}`;
  };
  return (
    <div className={compact ? "relative size-28" : "relative size-48"} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} aria-label="Progress" data-progress-ring data-fraction={fraction.toFixed(3)}>
      <svg viewBox="0 0 200 200" className="size-full">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <path
            key={i}
            d={arc(i)}
            fill="none"
            strokeWidth={14}
            strokeLinecap="butt"
            className={`transition-colors duration-300 ${i < lit ? "stroke-accent" : i === lit ? "stroke-accent/45" : "stroke-fg/12"}`}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-display leading-none text-fg tabular-nums ${compact ? "text-2xl" : "text-4xl"}`}>{Math.round(fraction * 100)}%</span>
        <span className="mt-1 text-xs text-muted tabular-nums">
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}

/** The status line for the current stage, rotating through its lines every few seconds. */
export function RotatingStatus({ lines }: { lines: string[] }) {
  const [i, setI] = useState(0);
  const key = lines.join("|");
  useEffect(() => {
    setI(0);
    if (lines.length < 2) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % lines.length), 3500);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <p className="mt-6 min-h-5 text-sm font-medium text-fg" data-status-line>
      {lines[i % Math.max(1, lines.length)]}
    </p>
  );
}
