import { env } from "@/lib/env.server";

/**
 * Hook for real domain registration / checkout.
 *
 * Today the Create a New Site wizard only *selects* a domain: when a visitor picks an available
 * name it is stored on the brief as `domain_status: "selected-pending-checkout"` and the rest of the
 * flow treats it as theirs. Nothing is registered or charged, and no registrar purchase API is called.
 *
 * TODO(webhero-cart): the Webhero shopping cart at alpha.webhero.com will handle real registration and
 * payment. When it is ready, set DOMAIN_CHECKOUT_URL (for example https://alpha.webhero.com/cart) and
 * implement `startDomainCheckout` to hand the selected domain to that cart (add-to-cart link or API),
 * then send the visitor there from the review step. Until then this is unused and returns null.
 */
export type DomainCheckout = {
  domain: string;
  status: "selected-pending-checkout";
  /** Where the visitor would finish registration, or null while no cart is configured. */
  checkoutUrl: string | null;
};

export function domainCheckoutUrl(): string | null {
  const value = env("DOMAIN_CHECKOUT_URL")?.trim();
  return value && /^https:\/\//i.test(value) ? value : null;
}

export async function startDomainCheckout(domain: string): Promise<DomainCheckout> {
  const base = domainCheckoutUrl();
  // TODO(webhero-cart): call the Webhero cart here instead of building a link. Never register a domain
  // without the visitor completing checkout.
  const checkoutUrl = base ? `${base}${base.includes("?") ? "&" : "?"}domain=${encodeURIComponent(domain)}` : null;
  return { domain, status: "selected-pending-checkout", checkoutUrl };
}
