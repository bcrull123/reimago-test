/**
 * Round 10 — Stop / Cancel. When the visitor presses Stop, the browser aborts its server-function request; the
 * request's AbortSignal then fires here (TanStack Start keeps the current request in async context), so the AI calls,
 * image generations and page fetches of THAT request stop instead of running on to the time limit, and the browser
 * never starts the next step. Outside a request (tests, scripts) there is no signal and nothing changes.
 */
import { getRequest } from "@tanstack/react-start/server";

export function requestSignal(): AbortSignal | undefined {
  try {
    return getRequest()?.signal;
  } catch {
    return undefined;
  }
}

/** A timeout signal that also fires when the visitor pressed Stop. */
export function stopOrTimeout(ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  const stop = requestSignal();
  return stop ? AbortSignal.any([timeout, stop]) : timeout;
}

export class StoppedError extends Error {
  constructor(step: string) {
    super(`Stopped: ${step}`);
    this.name = "StoppedError";
  }
}

/** Throw between phases when the visitor already pressed Stop. */
export function throwIfStopped(step: string): void {
  if (requestSignal()?.aborted) {
    console.info(`[cancel] ${step}: stopped (the visitor pressed Stop)`);
    throw new StoppedError(step);
  }
}

/** One "[cancel]" log line if the visitor presses Stop while this request (step) is running. */
export function watchStop(step: string): void {
  const signal = requestSignal();
  if (!signal) return;
  const t0 = Date.now();
  const log = () => console.info(`[cancel] ${step}: the visitor pressed Stop after ${Math.round((Date.now() - t0) / 100) / 10}s; this request's AI calls and page fetches are aborted`);
  if (signal.aborted) log();
  else signal.addEventListener("abort", log, { once: true });
}
