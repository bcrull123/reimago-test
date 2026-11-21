import { createServerFn } from "@tanstack/react-start";
import type { DomainCheck } from "@/lib/logicboxes-types";
import { normalizeDomain } from "@/lib/domain-name";
import type { CreateBrief } from "@/components/create-site-wizard";

export const checkDomainName = createServerFn({ method: "POST" })
  .validator((input: { name?: string; degrade?: boolean }) => {
    const name = typeof input?.name === "string" ? input.name.trim().slice(0, 80) : "";
    if (!name) throw new Error("Enter a domain name, like northline.com.");
    return { name, degrade: input?.degrade === true };
  })
  .handler(async ({ data }): Promise<DomainCheck> => {
    const { checkDomainAvailability } = await import("./logicboxes.server");
    return checkDomainAvailability(data.name, { degrade: data.degrade });
  });

/**
 * The wizard's "Select" on an available domain. Records the choice only: nothing is registered or charged.
 * See domain-checkout.server.ts for the future Webhero cart hook (DOMAIN_CHECKOUT_URL, unused by default).
 */
export const selectDomain = createServerFn({ method: "POST" })
  .validator((input: { domain?: string }) => {
    const result = normalizeDomain(typeof input?.domain === "string" ? input.domain.slice(0, 253) : "");
    if (!result.domain) throw new Error(result.error);
    return { domain: result.domain };
  })
  .handler(async ({ data }) => {
    const { startDomainCheckout } = await import("./domain-checkout.server");
    return startDomainCheckout(data.domain);
  });

export const suggestCreateStep = createServerFn({ method: "POST" })
  .validator((input: { step?: number; brief?: CreateBrief; attempt?: number }) => {
    const step = typeof input?.step === "number" ? Math.floor(input.step) : -1;
    if (step < 0 || step > 13) throw new Error("That step cannot be suggested.");
    return { step, brief: input.brief, attempt: typeof input?.attempt === "number" ? input.attempt : 1 };
  })
  .handler(async ({ data }) => {
    const { suggestCreateStep: suggest } = await import("./create-suggest.server");
    return suggest(data.step, data.brief as CreateBrief, data.attempt);
  });