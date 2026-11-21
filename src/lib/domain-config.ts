/**
 * Round 11 — the ONE place that says which domain endings ("TLDs") the "Pick your domain" pop-up may offer.
 *
 * Webhero is adding more endings but they are not live yet, so only endings known to work today are listed.
 * To turn one on when Webhero says it is live, EITHER:
 *   - add it to DOMAIN_TLDS below (commit), OR
 *   - set the optional server env var DOMAIN_TLDS, a comma list such as `com,net,org,co,biz`
 *     (it replaces this list; order = display order, first = preferred).
 *
 * Why these four: Webhero's signup order is com, net, org, us, info, biz, co, io (see
 * attachments/LOGICBOXES-REMOTE-FOR-BOB.md). `.us` needs a nexus purpose/category from the customer and
 * `.info/.biz/.io` are among the endings Webhero is still adding, so the safe default is the four below.
 * AI ideas and the typed-domain check never go outside this list.
 *
 * Pure (no Node APIs): shared by the browser and the server.
 */
export const DOMAIN_TLDS = ["com", "net", "org", "co"] as const;

/** Names the Webhero/LogicBoxes proxy token may be stored under (first one that is set wins). Never logged. */
export const DOMAIN_TOKEN_ENV_NAMES = ["Onesite_Domains_API", "ONESITE_DOMAINS_API", "LOGICBOXES_PROXY_TOKEN"] as const;

const TLD_RE = /^[a-z]{2,24}$/;

/** "com, .NET ,org" -> ["com","net","org"] (valid, unique, in the order given). Empty/invalid -> the default list. */
export function parseTldList(raw: string | undefined | null): string[] {
  const out: string[] = [];
  for (const part of String(raw ?? "").split(/[\s,;]+/)) {
    const tld = part.trim().toLowerCase().replace(/^\./, "");
    if (TLD_RE.test(tld) && !out.includes(tld)) out.push(tld);
  }
  return out.length ? out : [...DOMAIN_TLDS];
}
