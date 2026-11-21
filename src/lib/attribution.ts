/** Round 12: where the visitor came from (utm_* / ref / click ids / referrer), kept for the whole tab session. Browser only. */
const KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "gclid", "fbclid"];
const STORE = "rmg_attribution";

export function captureAttribution(): Record<string, string> {
  if (typeof window === "undefined") return {};
  let out: Record<string, string> = {};
  try {
    out = JSON.parse(window.sessionStorage.getItem(STORE) ?? "{}") as Record<string, string>;
  } catch {
    out = {};
  }
  try {
    const params = new URLSearchParams(window.location.search);
    let fresh = false;
    for (const key of KEYS) {
      const v = params.get(key);
      if (v) {
        out[key] = v.slice(0, 200);
        fresh = true;
      }
    }
    const ref = document.referrer;
    if (ref && !out.referrer) {
      try {
        if (new URL(ref).origin !== window.location.origin) out.referrer = ref.slice(0, 300);
      } catch {
        /* ignore a malformed referrer */
      }
    }
    if (fresh || !out.landing) out.landing = window.location.pathname.slice(0, 200);
    window.sessionStorage.setItem(STORE, JSON.stringify(out));
  } catch {
    /* storage can be blocked; the attribution just is not kept */
  }
  return out;
}
