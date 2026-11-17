import { createServerFn } from "@tanstack/react-start";

/**
 * "Choose this look" → Email Bot's instant-reply webhook (see reply-webhook.server.ts). Called by the browser
 * without waiting for it (the visitor's "check your email" message never depends on it); the server holds the
 * webhook URL and key. The look must exist on this server; the dedupe id, picture URL and time are set here.
 */
const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const list = (value: unknown, count: number, max: number) => (Array.isArray(value) ? value.map((v) => str(v, max)).filter(Boolean).slice(0, count) : []);

export const notifyReplyWebhook = createServerFn({ method: "POST" })
  .validator((input: Record<string, unknown>) => {
    const id = str(input?.id, 40);
    if (!/^[a-f0-9]{16}$/.test(id)) throw new Error("That look was not found.");
    const email = str(input?.email, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter an email.");
    return {
      id,
      email,
      website: str(input?.website, 300),
      note: str(input?.note, 800),
      previewUrl: str(input?.previewUrl, 500),
      previewPages: list(input?.previewPages, 12, 500),
      chosenLook: str(input?.chosenLook, 120),
      changeRequests: list(input?.changeRequests, 5, 400),
      pictureError: str(input?.pictureError, 400),
    };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; skipped?: boolean; status?: number }> => {
    const { replyWebhookConfig, sendReplyWebhook, submissionId } = await import("./reply-webhook.server");
    if (!replyWebhookConfig()) return { ok: false, skipped: true };
    const { rateLimited, requestIp } = await import("./reimagine.server");
    if (rateLimited(`reply:${requestIp()}`, 20)) return { ok: false };
    const { readSite, readImage } = await import("./pages.server");
    const site = await readSite(data.id);
    if (!site) return { ok: false };
    const { publicBase } = await import("./publish.server");
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
      picture_url: picture ? `${publicBase()}/made/${data.id}/img/capture` : "",
      picture_error: picture ? "" : data.pictureError || "No picture was stored for this look.",
      submitted_at: new Date().toISOString(),
    });
    return { ok: result.sent, status: result.status };
  });
