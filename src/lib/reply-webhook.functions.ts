import { createServerFn } from "@tanstack/react-start";
import { EXTRA_LEAD_KEYS } from "@/lib/new-site";

/**
 * "Choose this look" → Email Bot's instant-reply webhook (see reply-webhook.server.ts). Called by the browser
 * without waiting for it (the visitor's "check your email" message never depends on it); the server holds the
 * webhook URL and key. The look must exist on this server; the dedupe id, picture URL and time are set here.
 */
const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const list = (value: unknown, count: number, max: number) => (Array.isArray(value) ? value.map((v) => str(v, max)).filter(Boolean).slice(0, count) : []);
const clampDetails = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of EXTRA_LEAD_KEYS) {
    const v = str(raw[key], 2000);
    if (v) out[key] = v;
  }
  return out;
};

/** Round 12: remember on the stored lead how the Email Bot webhook answered. Never throws. */
async function noteWebhook(leadId: string, lookId: string, status: string) {
  if (!leadId) return;
  try {
    await (await import("./leads.server")).recordDelivery(leadId, lookId, "webhook", status);
  } catch {
    /* the lead list is a convenience; the webhook result is already logged */
  }
}

export const notifyReplyWebhook = createServerFn({ method: "POST" })
  .validator((input: Record<string, unknown>) => {
    const id = str(input?.id, 40);
    if (!/^[a-f0-9]{16}$/.test(id)) throw new Error("That look was not found.");
    const email = str(input?.email, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter an email.");
    return {
      id,
      leadId: /^[a-f0-9]{24}$/.test(str(input?.leadId, 40)) ? str(input?.leadId, 40) : "",
      email,
      website: str(input?.website, 300),
      note: str(input?.note, 800),
      previewUrl: str(input?.previewUrl, 500),
      previewPages: list(input?.previewPages, 12, 500),
      chosenLook: str(input?.chosenLook, 120),
      changeRequests: list(input?.changeRequests, 5, 400),
      pictureError: str(input?.pictureError, 400),
      mode: input?.mode === "new_site" ? ("new_site" as const) : ("reimagine" as const),
      businessName: str(input?.businessName, 120),
      domainChoice: str(input?.domainChoice, 20),
      domain: str(input?.domain, 200),
      // Round 11: the name picked in "Pick your domain". Never registered; reserved at checkout.
      chosenDomain: /^[a-z0-9-]+\.[a-z]{2,24}$/.test(str(input?.chosenDomain, 80).toLowerCase()) ? str(input?.chosenDomain, 80).toLowerCase() : "",
      domainStatus: ["selected_not_registered", "not_selected"].includes(str(input?.domainStatus, 30)) ? str(input?.domainStatus, 30) : "",
      details: clampDetails(input?.details),
    };

  })
  .handler(async ({ data }): Promise<{ ok: boolean; skipped?: boolean; status?: number }> => {
    (await import("./env.server")).logKeyPresenceOnce();
    const { replyWebhookConfig, replyWebhookProblem, sendReplyWebhook, submissionId } = await import("./reply-webhook.server");
    // Round 10: every way this can stop is one log line (status / reason only, never a value).
    const problem = replyWebhookProblem();
    if (problem || !replyWebhookConfig()) {
      console.warn(`[reply-webhook] skipped look ${data.id} (${data.mode}): ${problem ?? "not configured"}`);
      await noteWebhook(data.leadId, data.id, "skipped (not configured)");
      return { ok: false, skipped: true };
    }
    const { rateLimited, requestIp } = await import("./reimagine.server");
    if (rateLimited(`reply:${requestIp()}`, 20)) {
      console.warn(`[reply-webhook] skipped look ${data.id} (${data.mode}): rate limited`);
      await noteWebhook(data.leadId, data.id, "skipped (rate limited)");
      return { ok: false };
    }
    const { readSite, readImage } = await import("./pages.server");
    const site = await readSite(data.id);
    if (!site) {
      console.warn(`[reply-webhook] skipped look ${data.id} (${data.mode}): that look is not stored on this server`);
      await noteWebhook(data.leadId, data.id, "skipped (look not stored)");
      return { ok: false };
    }
    const { publicLookUrl } = await import("./publish.server");
    const picture = await readImage(data.id, "capture").catch(() => undefined);
    const result = await sendReplyWebhook({
      submission_id: submissionId(data.id, site.design?.archetype ?? "look"),
      email: data.email,
      website: data.website,
      note: data.note,
      preview_url: data.previewUrl,
      preview_pages: data.previewPages.join("\n"),
      chosen_look: data.chosenLook,
      change_requests: data.changeRequests.map((text, i) => `${i + 1}. ${text}`).join("\n"),
      picture_url: picture ? publicLookUrl(data.id, "/img/capture") : "",
      picture_error: picture ? "" : data.pictureError || "No picture was stored for this look.",
      // The Custom Design look: the Grok Imagine mockup it was built from (empty for template looks).
      design_mockup_url: site.custom?.mockup && !site.design?.custom?.failed ? publicLookUrl(data.id, "/img/mockup") : "",
      mode: data.mode,
      ...(data.mode === "new_site" ? { business_name: data.businessName, domain_choice: data.domainChoice, domain: data.domain, ...(data.domainStatus ? { chosen_domain: data.chosenDomain, domain_status: data.domainStatus } : {}), ...data.details } : {}),
      submitted_at: new Date().toISOString(),
    });
    if (!result.sent) console.warn(`[reply-webhook] look ${data.id} (${data.mode}): not delivered (${result.status ?? result.error ?? "no answer"}, ${result.attempts} attempt${result.attempts === 1 ? "" : "s"})`);
    await noteWebhook(data.leadId, data.id, result.sent ? `sent${result.status ? ` ${result.status}` : ""}` : `failed ${result.status ?? result.error ?? "no answer"}`.slice(0, 60));
    return { ok: result.sent, status: result.status };
  });

/**
 * Round 10: the browser posts the lead to Formcarry itself; this records how that went in the server log
 * ("[submit] …", status code / outcome only — never the email, note or any value), so a missing submission can be
 * traced on the published app.
 */
export const logSubmit = createServerFn({ method: "POST" })
  .validator((input: Record<string, unknown>) => ({
    id: /^[a-f0-9]{16}$/.test(str(input?.id, 40)) ? str(input?.id, 40) : "unknown",
    leadId: /^[a-f0-9]{24}$/.test(str(input?.leadId, 40)) ? str(input?.leadId, 40) : "",
    mode: input?.mode === "new_site" ? "new_site" : "reimagine",
    look: str(input?.look, 80).replace(/[^\w ·&'()-]/g, ""),
    event: ["choose", "sent", "failed", "not-resent"].includes(str(input?.event, 20)) ? str(input?.event, 20) : "choose",
    status: Number.isFinite(Number(input?.status)) ? Math.round(Number(input?.status)) : 0,
    reason: str(input?.reason, 160).replace(/[^\w .,:;'()/-]/g, ""),
  }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    (await import("./env.server")).logKeyPresenceOnce();
    const what = `look ${data.id} “${data.look}” (mode=${data.mode})`;
    if (data.event === "choose") console.info(`[submit] Choose this look: ${what} → posting to Formcarry`);
    else if (data.event === "sent") console.info(`[submit] Formcarry ${what}: ${data.status || 200} sent`);
    else if (data.event === "not-resent") console.info(`[submit] Choose this look: ${what} → already sent for this look; not resent`);
    else console.warn(`[submit] Formcarry ${what}: FAILED ${data.status || "no status"}${data.reason ? ` (${data.reason})` : ""}`);
    if (data.leadId && (data.event === "sent" || data.event === "failed")) {
      try {
        await (await import("./leads.server")).recordDelivery(data.leadId, data.id, "formcarry", data.event === "sent" ? `sent ${data.status || 200}` : `failed ${data.status || "no answer"}`);
      } catch {
        /* never blocks the visitor */
      }
    }
    return { ok: true };
  });
