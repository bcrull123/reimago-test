/**
 * Round 10: the one-time startup line of which keys are present (true/false only, never a value), logged on the
 * deployed app's first request — before any form is used — so a published build can be told from the preview.
 */
import { logKeyPresenceOnce } from "../../src/lib/env.server";

export default function envLogMiddleware(_event: unknown, next: () => unknown | Promise<unknown>): unknown | Promise<unknown> {
  logKeyPresenceOnce();
  return next();
}
