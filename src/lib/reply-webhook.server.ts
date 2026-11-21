/**
 * Email Bot's instant reply: when a visitor presses "Choose this look", the app SERVER posts the submission as
 * JSON to Email Bot's webhook (the routine "Instant reply to reimago.ai submissions"), next to the browser's
 * Formcarry submission, which is unchanged.
 *
 *   REPLY_WEBHOOK_URL  the routine's webhook URL
 *   REPLY_WEBHOOK_KEY  its key; sent as "Authorization: Bearer <key>" (or as-is if it already starts with a
 *                      scheme word and a space, e.g. "Bearer …" / "Basic …")
 *
 * Either unset: skipped silently. The key is never logged or sent to the browser. 10 s timeout, one retry on a
 * network error or a 5xx. Success and failure are logged with the status code only.
 */
import { env } from "./env.server.ts";

export type ReplyPayload = {
  /** Stable per chosen look ("reimago-<made id>-<look>"): the same on every retry, so Email Bot can dedupe. */
  submission_id: string;
  email: string;
  website: string;
  note: string;
  preview_url: string;
  /** Same text as the Formcarry field: one "Title: URL" per line. */
  preview_pages: string;
  chosen_look: string;
  /** Same text as the Formcarry field: "1. …" per "Not quite right?" round, oldest first. */
  change_requests: string;
  picture_url: string;
  picture_error: string;
  /** The Custom Design look's Grok Imagine design mockup ("" for template looks). */
  design_mockup_url?: string;
  /** Round 10: "reimagine" (the owner's site) or "new_site" (Build a New Site, no source site). */
  mode?: "reimagine" | "new_site";
  /** New site only: the business name, and the domain choice ("have" + the domain, or "get" = domain, email & hosting). */
  business_name?: string;
  domain_choice?: string;
  domain?: string;
  /** Round 11: "Pick your domain" result for domain_choice "get": the picked name ("" = none) and `selected_not_registered` / `not_selected`. Never registered here. */
  chosen_domain?: string;
  domain_status?: string;
  /** Round 10d: optional extra details from "Add more details" (only the ones the owner filled). */
  industry?: string;
  customers?: string;
  services?: string;
  pages?: string;
  goal?: string;
  features?: string;
  brand_color?: string;
  phone?: string;
  contact_email?: string;
  address?: string;
  hours?: string;
  social?: string;
  existing_site?: string;
  emulate_url_1?: string;
  emulate_url_2?: string;
  emulate_url_3?: string;
  emulate_note?: string;
  copy_text?: string;
  anything_else?: string;
  files_link?: string;
  video_link?: string;
  photo_urls?: string;
  submitted_at: string;
};


export type ReplyResult = { sent: boolean; skipped?: boolean; status?: number; attempts: number; error?: string };

/** The dedupe id for a chosen look: the look's made id plus the look (its archetype), never random. */
export function submissionId(madeId: string, look: string): string {
  const slug = look.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "look";
  return `reimago-${madeId}-${slug}`;
}

/** "Bearer <key>", unless the key already names its scheme ("Bearer abc", "Basic dXNlcjpw"). */
export function authorizationFor(key: string): string {
  const k = key.trim();
  return /^[A-Za-z][A-Za-z0-9!#$%&'*+.^_`|~-]*\s+\S/.test(k) ? k : `Bearer ${k}`;
}

/** Round 10: why the webhook is off, for one log line (presence only, never a value). */
export function replyWebhookProblem(): string | undefined {
  const url = env("REPLY_WEBHOOK_URL");
  const key = env("REPLY_WEBHOOK_KEY");
  if (!url || !key) return `not configured (REPLY_WEBHOOK_URL=${Boolean(url)} REPLY_WEBHOOK_KEY=${Boolean(key)})`;
  if (!replyWebhookConfig()) return "REPLY_WEBHOOK_URL is not a valid https URL";
  return undefined;
}

export function replyWebhookConfig(): { url: string; key: string } | undefined {
  const url = env("REPLY_WEBHOOK_URL");
  const key = env("REPLY_WEBHOOK_KEY");
  if (!url || !key) return undefined;
  try {
    const parsed = new URL(url);
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(parsed.hostname);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) return undefined;
  } catch {
    return undefined;
  }
  return { url, key };
}

/** Where it went, for logs: host only (the URL may carry a token in its path or query). */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "webhook";
  }
}

export async function sendReplyWebhook(payload: ReplyPayload, options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<ReplyResult> {
  const config = replyWebhookConfig();
  if (!config) return { sent: false, skipped: true, attempts: 0 };
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const body = JSON.stringify(payload);
  const where = hostOf(config.url);
  let last: ReplyResult = { sent: false, attempts: 0 };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await doFetch(config.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: authorizationFor(config.key),
          "idempotency-key": payload.submission_id,
          "user-agent": "Reimago/1.0 (+https://reimago.ai)",
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.arrayBuffer().catch(() => undefined);
      last = { sent: response.ok, status: response.status, attempts: attempt };
      if (response.ok) {
        console.info(`[reply-webhook] sent ${payload.submission_id} to ${where}: ${response.status}`);
        return last;
      }
      console.warn(`[reply-webhook] ${payload.submission_id} to ${where} failed: ${response.status} (attempt ${attempt})`);
      if (response.status < 500) return last;
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const reason = name === "TimeoutError" || name === "AbortError" ? `timed out after ${Math.round(timeoutMs / 1000)}s` : "network error";
      last = { sent: false, attempts: attempt, error: reason };
      console.warn(`[reply-webhook] ${payload.submission_id} to ${where} failed: ${reason} (attempt ${attempt})`);
    }
  }
  return last;
}
