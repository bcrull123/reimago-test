/** Turns a stored preview site into full HTML documents, one per page. */
import { escapeHtml } from "./sanitize.ts";
import { fontsHref, siteCss } from "./theme.ts";
import type { SitePalette } from "@/lib/preview/types";

export const FORMCARRY_ENDPOINT = "https://formcarry.com/s/NipZS0fF4w4";

export type StoredPage = { slug: string; title: string; navLabel: string; body: string };

export type StoredSite = {
  version: 2;
  id: string;
  createdAt: string;
  mode: "reimagine" | "create";
  mock: boolean;
  host: string;
  sourceUrl: string;
  name: string;
  tagline: string;
  logo: string;
  phone: string;
  email: string;
  address: string;
  hours: string[];
  social: string[];
  palette: SitePalette;
  fonts: { heading: string; body: string };
  cta: { label: string; slug: string };
  pages: StoredPage[];
};

/** Relative link from the page being viewed to another page of the same preview. */
export function pageHref(id: string, from: string, to: string): string {
  if (from === "home") return to === "home" ? id : `${id}/${to}`;
  return to === "home" ? `../${id}` : to;
}

function rewriteTokens(html: string, id: string, from: string): string {
  return html.replace(/@page:([a-z0-9-]+)/g, (_, slug: string) => pageHref(id, from, slug));
}

function telHref(phone: string): string {
  const d = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `tel:+1${d}` : `tel:${d}`;
}

export function contactFormHtml(site: Pick<StoredSite, "id" | "host" | "name">): string {
  return `<section class="section alt" id="contact-form">
  <div class="container" style="max-width:760px">
    <span class="eyebrow">Send a message</span>
    <h2>Get in touch with ${escapeHtml(site.name)}</h2>
    <p class="muted">Fill out the form and we will get back to you.</p>
    <form class="contact-form" action="${FORMCARRY_ENDPOINT}" method="POST" target="_blank" accept-charset="UTF-8">
      <input type="hidden" name="mode" value="preview_contact">
      <input type="hidden" name="preview_site" value="${escapeHtml(site.host)}">
      <input type="hidden" name="preview_id" value="${escapeHtml(site.id)}">
      <div class="hp" aria-hidden="true"><label>Leave this empty<input type="text" name="_gotcha" tabindex="-1" autocomplete="off"></label></div>
      <label>Name<input type="text" name="name" autocomplete="name" required></label>
      <label>Email<input type="email" name="email" autocomplete="email" required></label>
      <label>Phone<input type="tel" name="phone" autocomplete="tel"></label>
      <label>How can we help?<textarea name="message" required></textarea></label>
      <div><button class="btn primary" type="submit">Send message</button></div>
    </form>
  </div>
</section>`;
}

export function renderSitePage(site: StoredSite, slug: string): string | undefined {
  const page = site.pages.find((p) => p.slug === slug);
  if (!page) return undefined;
  const link = (to: string) => pageHref(site.id, slug, to);
  const nav = site.pages
    .map(
      (p) =>
        `<a href="${link(p.slug)}"${p.slug === slug ? ' aria-current="page"' : ""}>${escapeHtml(p.navLabel || p.title)}</a>`,
    )
    .join("");
  const ctaSlug = site.pages.some((p) => p.slug === site.cta.slug) ? site.cta.slug : site.pages.at(-1)!.slug;
  const brand = site.logo
    ? `<img src="${escapeHtml(site.logo)}" alt="${escapeHtml(site.name)}">`
    : `<span>${escapeHtml(site.name)}</span>`;
  const contactItems = [
    site.phone ? `<li><a href="${telHref(site.phone)}">${escapeHtml(site.phone)}</a></li>` : "",
    site.email ? `<li><a href="mailto:${escapeHtml(site.email)}">${escapeHtml(site.email)}</a></li>` : "",
    site.address ? `<li>${escapeHtml(site.address)}</li>` : "",
    ...site.hours.slice(0, 4).map((h) => `<li>${escapeHtml(h)}</li>`),
  ].join("");
  const social = site.social
    .map((url) => {
      const label = (url.match(/(facebook|instagram|twitter|x|linkedin|youtube|yelp|tiktok)\.com/i)?.[1] ?? "Social").replace(/^x$/i, "X");
      return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label[0]!.toUpperCase() + label.slice(1))}</a></li>`;
    })
    .join("");
  const ribbon = site.mock
    ? `MOCK PREVIEW (PREVIEW_MOCK=1): layout and copy were assembled without AI from the scraped facts.`
    : `Preview of a redesign${site.mode === "reimagine" ? ` for ${escapeHtml(site.host)}` : ""}. Built by Reimago. Not the live site.`;
  const body = rewriteTokens(page.body, site.id, slug);
  const form = slug === "contact" ? contactFormHtml(site) : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(page.title)} | ${escapeHtml(site.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fontsHref(site)}">
<style>${siteCss(site)}</style>
</head>
<body>
<div class="preview-ribbon">${ribbon}</div>
<header class="site-header">
  <div class="container bar">
    <a class="brand" href="${link("home")}">${brand}</a>
    <nav class="site-nav" aria-label="Main">${nav}</nav>
    <a class="btn primary header-cta" href="${link(ctaSlug)}">${escapeHtml(site.cta.label || "Contact us")}</a>
    <details class="menu"><summary>Menu</summary><div class="menu-list">${nav}<a href="${link(ctaSlug)}">${escapeHtml(site.cta.label || "Contact us")}</a></div></details>
  </div>
</header>
<main id="main">
${body}
${form}
</main>
<footer class="site-footer">
  <div class="container">
    <div class="cols">
      <div><h4>${escapeHtml(site.name)}</h4><p>${escapeHtml(site.tagline)}</p></div>
      <div><h4>Pages</h4><ul>${site.pages.map((p) => `<li><a href="${link(p.slug)}">${escapeHtml(p.navLabel || p.title)}</a></li>`).join("")}</ul></div>
      <div><h4>Contact</h4><ul>${contactItems || `<li><a href="${link(ctaSlug)}">Send us a message</a></li>`}</ul>${social ? `<h4 style="margin-top:1.2rem">Follow</h4><ul>${social}</ul>` : ""}</div>
    </div>
    <div class="legal"><span>© ${new Date(site.createdAt).getFullYear()} ${escapeHtml(site.name)}</span><span>Preview by Reimago</span></div>
  </div>
</footer>
</body>
</html>`;
}

/** CSP for preview pages: no scripts at all, fonts from Google, images over https, form posts only to Formcarry. */
export const PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data:; base-uri 'none'; form-action https://formcarry.com; script-src 'none'";
