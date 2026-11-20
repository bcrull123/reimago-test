/**
 * Round 10f: record why a look-card thumbnail failed so the published server log
 * shows a "[thumb] …" line (reason only — no secrets).
 */
import { createServerFn } from "@tanstack/react-start";

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export const logThumb = createServerFn({ method: "POST" })
  .validator((input: Record<string, unknown>) => ({
    id: /^[a-f0-9]{16}$/.test(str(input?.id, 40)) ? str(input?.id, 40) : "unknown",
    look: str(input?.look, 80).replace(/[^\w ·&'()-]/g, ""),
    reason: str(input?.reason, 200).replace(/[^\w .,:;'()/=?-]/g, ""),
    src: str(input?.src, 180).replace(/[^\w .,:;'()/=?&:-]/g, ""),
  }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    console.info(`[thumb] look ${data.id} “${data.look}”: ${data.reason}${data.src ? ` · ${data.src}` : ""}`);
    return { ok: true };
  });
