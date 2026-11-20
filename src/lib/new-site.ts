/** Round 10 — "Build a New Site": the owner's answers (no source site), checked and mapped for factsFromBrief. */
export type NewSiteDomainChoice = "" | "have" | "get";

export type NewSiteBrief = {
  business_name: string;
  /** What the business does and who it serves (one box). */
  what: string;
  location: string;
  style: string;
  /** "have" = "I have a domain" (+ domain); "get" = "Get me a domain, email & hosting" (recorded only). */
  domain_choice: NewSiteDomainChoice;
  domain: string;
};

export const emptyNewSite = (): NewSiteBrief => ({ business_name: "", what: "", location: "", style: "", domain_choice: "", domain: "" });

/** What's missing before we can build (empty = ready). */
export function newSiteProblem(brief: NewSiteBrief): string {
  if (!brief.business_name.trim()) return "Enter your business name.";
  if (brief.what.trim().length < 8) return "Tell us what the business does and who it serves.";
  if (!brief.domain_choice) return "Choose “I have a domain” or “Get me a domain, email & hosting”.";
  if (brief.domain_choice === "have" && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(bareHost(brief.domain))) return "Enter your domain, like yourbusiness.com.";
  return "";
}

export function bareHost(value: string): string {
  return value.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0] ?? "";
}

/** The fields factsFromBrief reads (the same keys the older Create a New Site wizard sent). */
export function briefForFacts(brief: NewSiteBrief, logoUrl?: string): Record<string, unknown> {
  return {
    business_name: brief.business_name.trim(),
    what: brief.what.trim(),
    customers: "",
    location: brief.location.trim(),
    style: brief.style.trim(),
    domain: brief.domain_choice === "have" ? bareHost(brief.domain) : "",
    domain_status: brief.domain_choice === "have" ? "owned" : "",
    logo_url: logoUrl ?? "",
  };
}

