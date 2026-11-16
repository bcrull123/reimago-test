import { createServerFn } from "@tanstack/react-start";
import type { DomainCheck } from "@/lib/logicboxes-types";
import type { CreateBrief } from "@/components/create-site-wizard";

export const handOffToCursor = createServerFn({ method: "POST" })
  .validator((input: {
    host?: string;
    submitted?: string;
    url?: string;
    title?: string;
    description?: string;
    nav?: string[];
    headings?: string[];
    text?: string;
    notes?: string;
    previewUrl?: string;
    pages?: string[];
  }) => {
    const clip = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
    const list = (value: unknown, max: number, each = 80) =>
      Array.isArray(value) ? value.map((item) => String(item).trim().slice(0, each)).filter(Boolean).slice(0, max) : [];
    const previewUrl = clip(input?.previewUrl, 400);
    if (!/^https?:\/\//.test(previewUrl)) throw new Error("The live preview is not ready.");
    return {
      host: clip(input?.host, 200),
      submitted: clip(input?.submitted, 300),
      url: clip(input?.url, 300),
      title: clip(input?.title, 200),
      description: clip(input?.description, 400),
      nav: list(input?.nav, 8),
      headings: list(input?.headings, 16),
      text: clip(input?.text, 2500),
      notes: clip(input?.notes, 800),
      previewUrl,
      pages: list(input?.pages, 8, 400),
    };
  })
  .handler(async ({ data }) => {
    const { sendToCursor } = await import("./reimagine.server");
    return sendToCursor(data);
  });

export const checkDomainName = createServerFn({ method: "POST" })
  .validator((input: { name?: string }) => {
    const name = typeof input?.name === "string" ? input.name.trim().slice(0, 80) : "";
    if (!name) throw new Error("Enter a domain name, like northline.com.");
    return { name };
  })
  .handler(async ({ data }): Promise<DomainCheck> => {
    const { checkDomainAvailability } = await import("./logicboxes.server");
    return checkDomainAvailability(data.name);
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