import { createServerFn } from "@tanstack/react-start";
import { cleanLeadInput } from "@/lib/leads";

/**
 * Round 12: the browser calls this on every "Choose this look" — BEFORE it posts to Formcarry — so the lead is
 * stored on the server even if Formcarry or the Email Bot webhook fails. Same visit id => the picks merge into the
 * one lead. It never throws to the visitor: the form's "check your email" message does not depend on it.
 */
export const saveLead = createServerFn({ method: "POST" })
  .validator((input: Record<string, unknown>) => ({ raw: input as unknown, gotcha: typeof input?.gotcha === "string" ? input.gotcha : "" }))
  .handler(async ({ data }): Promise<{ ok: boolean; id?: string }> => {
    try {
      (await import("./env.server")).logKeyPresenceOnce();
      // The form's hidden honeypot: a bot filled it in. Pretend it worked, store nothing.
      if (data.gotcha.trim()) return { ok: true };
      const input = cleanLeadInput(data.raw);
      if (!input.email) return { ok: false };
      const { rateLimited, requestIp } = await import("./reimagine.server");
      if (rateLimited(`lead:${requestIp()}`, 40)) {
        console.warn(`[lead] not saved ${input.id}: rate limited`);
        return { ok: false };
      }
      const { getRequestHeader } = await import("@tanstack/react-start/server");
      const header = (name: string) => {
        try {
          return getRequestHeader(name) ?? "";
        } catch {
          return "";
        }
      };
      const country = header("x-vercel-ip-country") || header("cf-ipcountry") || "";
      const { saveLead: save } = await import("./leads.server");
      const saved = await save(input, { userAgent: header("user-agent"), country: /^[A-Za-z]{2}$/.test(country) ? country : "" });
      return { ok: true, id: saved.id };
    } catch (error) {
      console.error(`[lead] NOT saved: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`);
      return { ok: false };
    }
  });
