/**
 * Domain name helpers shared by the browser and the server (no Node APIs).
 */

export type DomainStatus = "" | "owned" | "selected-pending-checkout";

/**
 * Normalize what a visitor typed into a bare domain: lowercase, no scheme, no "www.", no path, port, or trailing dot.
 * Returns an error message instead when it is not a valid domain name.
 */
export function normalizeDomain(input: string): { domain: string; error?: undefined } | { domain?: undefined; error: string } {
  let host = (input ?? "").trim().toLowerCase();
  if (!host) return { error: "Enter your domain, like yourbusiness.com." };
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.replace(/^[^@/]*@/, "");
  host = host.replace(/[/?#].*$/, "");
  host = host.replace(/:\d*$/, "");
  host = host.replace(/\.+$/, "");
  host = host.replace(/^www\d*\./, "");
  if (/\s/.test(host)) return { error: "A domain cannot contain spaces." };
  if (host.length > 253) return { error: "That domain is too long." };
  const labels = host.split(".");
  if (labels.length < 2) return { error: "Include the ending, like .com — for example yourbusiness.com." };
  for (const label of labels) {
    if (!label) return { error: "That domain has an empty part (two dots in a row)." };
    if (label.length > 63) return { error: "Each part of a domain must be 63 characters or fewer." };
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) return { error: "Use only letters, numbers, and hyphens (not at the start or end)." };
  }
  const tld = labels.at(-1)!;
  if (!/^([a-z]{2,24}|xn--[a-z0-9-]{1,59})$/.test(tld)) return { error: `".${tld}" is not a valid ending.` };
  return { domain: host };
}
