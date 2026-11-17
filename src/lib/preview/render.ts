/** Turns a stored preview site into full HTML documents, one per page. */
import { escapeHtml } from "./sanitize.ts";
import { darkSurface, designClasses, fontsHref, siteCss } from "./theme.ts";
import { logoTreatment } from "./logo.ts";
import { legacyCss } from "./legacy-theme.ts";
import { renderSection, type RenderContext } from "./sections.ts";
import type { AiDebug, PreviewTrace, DesignDirection, LogoMeta, Section, SiteFacts, SitePalette, SitePlan, StoredImage } from "./types.ts";

export const FORMCARRY_ENDPOINT = "https://formcarry.com/s/NipZS0fF4w4";

export type StoredPage = {
  slug: string;
  title: string;
  navLabel: string;
  /** Legacy (v2) sanitized HTML body. v3 pages render from `sections`. */
  body: string;
  sections?: Section[];
  /** True while the page has not been built yet (homepage-only looks). */
  pending?: boolean;
};

export type PolishInfo = { method: "vision" | "html" | "skipped"; notes: string[]; reason?: string };

export type StoredSite = {
  version: 2 | 3;
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
  // ---- v3 (design directions / looks)
  industry?: string;
  design?: DesignDirection;
  images?: Record<string, StoredImage>;
  /** Facts + plan kept server-side so later steps never trust the browser's copy. */
  facts?: SiteFacts;
  plan?: SitePlan;
  lookIndex?: number;
  finished?: boolean;
  polish?: PolishInfo;
  /** Why the AI could not write a page (slug → reason), shown to the visitor with a "Retry with AI" button. */
  aiErrors?: Record<string, string>;
  /** Why AI sections were dropped, with a short masked raw sample (debugging real-model output). */
  aiDebug?: Record<string, AiDebug>;
  /** Which AI steps got the owner's request and which image prompts were used (debugging "it ignored my note"). */
  trace?: PreviewTrace;
  /** How the scraped logo is shown on light and dark surfaces (see logo.server.ts). */
  logoMeta?: LogoMeta;
};

export type RenderOptions = {
  /** Override image URLs (e.g. data: URLs for a server-side screenshot). */
  imageUrl?: (name: string) => string | undefined;
  /** Hide the preview ribbon (screenshots). */
  ribbon?: boolean;
};

/** Relative link from the page being viewed to another page of the same preview. */
export function pageHref(id: string, from: string, to: string): string {
  if (from === "home") return to === "home" ? id : `${id}/${to}`;
  return to === "home" ? `../${id}` : to;
}

/** Relative URL of a stored image, from the page being viewed. */
export function imageHref(id: string, from: string, name: string): string {
  return from === "home" ? `${id}/img/${name}` : `img/${name}`;
}

function rewriteTokens(html: string, id: string, from: string, options?: RenderOptions): string {
  return html
    .replace(/@page:([a-z0-9-]+)/g, (_, slug: string) => pageHref(id, from, slug))
    .replace(/@img:([a-z0-9-]+)/g, (_, name: string) => options?.imageUrl?.(name) ?? imageHref(id, from, name));
}

function telHref(phone: string): string {
  const d = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `tel:+1${d}` : `tel:${d}`;
}

export function contactFormHtml(site: Pick<StoredSite, "id" | "host" | "name" | "version">): string {
  const fields = `<form class="contact-form" action="${FORMCARRY_ENDPOINT}" method="POST" target="_blank" accept-charset="UTF-8">
      <input type="hidden" name="mode" value="preview_contact">
      <input type="hidden" name="preview_site" value="${escapeHtml(site.host)}">
      <input type="hidden" name="preview_id" value="${escapeHtml(site.id)}">
      <div class="hp" aria-hidden="true"><label>Leave this empty<input type="text" name="_gotcha" tabindex="-1" autocomplete="off"></label></div>
      <div class="two"><label>Name<input type="text" name="name" autocomplete="name" required></label>
      <label>Email<input type="email" name="email" autocomplete="email" required></label></div>
      <label>Phone<input type="tel" name="phone" autocomplete="tel"></label>
      <label>How can we help?<textarea name="message" required></textarea></label>
      <div><button class="btn primary" type="submit">Send message</button></div>
    </form>`;
  if (site.version !== 3) {
    return `<section class="section alt" id="contact-form">
  <div class="container" style="max-width:760px">
    <span class="eyebrow">Send a message</span>
    <h2>Get in touch with ${escapeHtml(site.name)}</h2>
    <p class="muted">Fill out the form and we will get back to you.</p>
    ${fields}
  </div>
</section>`;
  }
  return `<section class="sec t-tint" id="contact-form">
  <div class="wrap narrow"><div class="form-card">
    <span class="eyebrow">Send a message</span>
    <h2>Get in touch with ${escapeHtml(site.name)}</h2>
    <p class="muted">Fill out the form and we will get back to you.</p>
    ${fields}
  </div></div>
</section>`;
}

function pendingBody(site: StoredSite, page: StoredPage): string {
  return `<section class="sec s-page-hero t-tint"><div class="wrap"><div class="hero-copy"><span class="eyebrow">${escapeHtml(page.navLabel)}</span><h1>${escapeHtml(page.title)}</h1><p class="lead">This page is built when you choose this look.</p></div></div></section>
<section class="sec t-light"><div class="wrap narrow"><div class="notice"><p><strong>Homepage preview only.</strong> Go back to Reimago and press <em>Choose this look</em> to build ${escapeHtml(
    page.navLabel,
  )} and every other page in this style.</p><div class="actions"><a class="btn primary" href="@page:home">Back to the homepage</a></div></div></div></section>`;
}

export function renderSitePage(site: StoredSite, slug: string, options?: RenderOptions): string | undefined {
  const page = site.pages.find((p) => p.slug === slug);
  if (!page) return undefined;
  const v3 = site.version === 3;
  const link = (to: string) => pageHref(site.id, slug, to);
  const nav = site.pages
    .map((p) => `<a href="${link(p.slug)}"${p.slug === slug ? ' aria-current="page"' : ""}>${escapeHtml(p.navLabel || p.title)}</a>`)
    .join("");
  const ctaSlug = site.pages.some((p) => p.slug === site.cta.slug) ? site.cta.slug : site.pages.at(-1)!.slug;
  const firstIsPhoto = v3 && !page.pending && page.sections?.[0]?.type === "hero-photo";
  // The logo: our stored, trimmed copy when we have one, styled for the surface it sits on.
  const stored = (name: string | undefined) => (name && site.images?.[name] ? options?.imageUrl?.(name) ?? imageHref(site.id, slug, name) : undefined);
  const logoOn = (surface: string) => {
    const t = logoTreatment(site.logoMeta, surface);
    if (t.kind === "wordmark") return `<span class="wordmark">${escapeHtml(site.name)}</span>`;
    const src = stored(t.image) ?? stored(site.logoMeta?.image) ?? site.logo;
    return `<span class="logo ${t.kind}"${t.plate ? ` style="--plate:${t.plate}"` : ""}><img src="${escapeHtml(src)}" alt="${escapeHtml(site.name)}"></span>`;
  };
  const headerKind = site.design ? (site.design.header === "overlay" && !firstIsPhoto ? "light" : site.design.header) : "light";
  const headerSurface = headerKind === "dark" ? darkSurface(site.palette) : headerKind === "overlay" ? "#1c1c1c" : site.palette.background;
  // No logo, or one that couldn't be loaded/read: the business name as a text wordmark (never an empty chip).
  const hasLogo = Boolean(site.logo) && !site.logoMeta?.wordmark;
  const brand = !hasLogo ? `<span>${escapeHtml(site.name)}</span>` : v3 ? logoOn(headerSurface) : `<img src="${escapeHtml(site.logo)}" alt="${escapeHtml(site.name)}">`;
  const footerBrand = v3 && hasLogo ? `<div class="flogo">${logoOn(darkSurface(site.palette))}</div>` : "";
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
    : `Preview of a redesign${site.mode === "reimagine" ? ` for ${escapeHtml(site.host)}` : ""}${site.design ? ` · Look: ${escapeHtml(site.design.name)}` : ""}. Built by Reimago. Not the live site.`;

  let body: string;
  if (page.pending) body = pendingBody(site, page);
  else if (v3 && page.sections) {
    const images = new Set(Object.keys(site.images ?? {}));
    const ctx: RenderContext = {
      name: site.name,
      industry: site.industry ?? "",
      phone: site.phone,
      email: site.email,
      address: site.address,
      hours: site.hours,
      images,
      imageAlt: (name) => site.images?.[name]?.alt ?? site.name,
      page: slug,
    };
    body = page.sections.map((s) => renderSection(s, ctx)).join("\n");
  } else body = page.body;
  body = rewriteTokens(body, site.id, slug, options);
  const form = slug === "contact" && !page.pending ? contactFormHtml(site) : "";
  const bodyClass = v3 ? designClasses(site.design, firstIsPhoto) : "";
  const css = v3 ? siteCss(site) : legacyCss(site);
  const ctaLabel = escapeHtml(site.cta.label || "Contact us");
  const year = new Date(site.createdAt).getFullYear();

  const header = v3
    ? `<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="${link("home")}">${brand}</a>
    <nav class="site-nav" aria-label="Main">${nav}</nav>
    <a class="btn primary header-cta" href="${link(ctaSlug)}">${ctaLabel}</a>
    <details class="menu"><summary>Menu</summary><div class="menu-list">${nav}<a href="${link(ctaSlug)}">${ctaLabel}</a></div></details>
  </div>
</header>`
    : `<header class="site-header">
  <div class="container bar">
    <a class="brand" href="${link("home")}">${brand}</a>
    <nav class="site-nav" aria-label="Main">${nav}</nav>
    <a class="btn primary header-cta" href="${link(ctaSlug)}">${ctaLabel}</a>
    <details class="menu"><summary>Menu</summary><div class="menu-list">${nav}<a href="${link(ctaSlug)}">${ctaLabel}</a></div></details>
  </div>
</header>`;

  const pagesList = site.pages.map((p) => `<li><a href="${link(p.slug)}">${escapeHtml(p.navLabel || p.title)}</a></li>`).join("");
  const contactList = contactItems || `<li><a href="${link(ctaSlug)}">Send us a message</a></li>`;
  let footer: string;
  if (!v3) {
    footer = `<footer class="site-footer">
  <div class="container">
    <div class="cols">
      <div><h4>${escapeHtml(site.name)}</h4><p>${escapeHtml(site.tagline)}</p></div>
      <div><h4>Pages</h4><ul>${pagesList}</ul></div>
      <div><h4>Contact</h4><ul>${contactList}</ul>${social ? `<h4 style="margin-top:1.2rem">Follow</h4><ul>${social}</ul>` : ""}</div>
    </div>
    <div class="legal"><span>© ${year} ${escapeHtml(site.name)}</span><span>Preview by Reimago</span></div>
  </div>
</footer>`;
  } else if (site.design?.footer === "minimal") {
    footer = `<footer class="site-footer"><div class="wrap"><div class="row">${footerBrand || `<span class="fbrand">${escapeHtml(site.name)}</span>`}<ul>${pagesList}</ul><ul>${contactList}</ul></div><div class="legal"><span>© ${year} ${escapeHtml(
      site.name,
    )}</span><span>Preview by Reimago</span></div></div></footer>`;
  } else {
    const statement = site.design?.footer === "statement" ? `<a class="say" href="${link(ctaSlug)}">${ctaLabel}</a>` : "";
    footer = `<footer class="site-footer"><div class="wrap">${statement}<div class="cols">
      <div>${footerBrand}<div class="fbrand">${escapeHtml(site.name)}</div><p>${escapeHtml(site.tagline)}</p></div>
      <div><h4>Pages</h4><ul>${pagesList}</ul></div>
      <div><h4>Contact</h4><ul>${contactList}</ul>${social ? `<h4 style="margin-top:1.4rem">Follow</h4><ul>${social}</ul>` : ""}</div>
    </div><div class="legal"><span>© ${year} ${escapeHtml(site.name)}</span><span>Preview by Reimago</span></div></div></footer>`;
  }

  // Free-license web photos need their credit (title, author, license link) wherever they appear.
  footer = footer.replace("<span>Preview by Reimago</span>", `${photoCredit(site)}<span>Preview by Reimago</span>`);

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
<style>${css}</style>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
${options?.ribbon === false ? "" : `<div class="preview-ribbon">${ribbon}</div>`}
${header}
<main id="main">
${body}
${form}
</main>
${footer}
</body>
</html>`;
}

/** CSP for preview pages: no scripts at all, fonts from Google, images from this site or https, form posts only to Formcarry. */
export const PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' https: data:; base-uri 'none'; form-action https://formcarry.com; script-src 'none'";

const httpLink = (url: string) => (/^https?:\/\//i.test(url) ? escapeHtml(url) : "");

/** "Photo: “Pauls Valley Historic District” by X, CC BY-SA 3.0, via Wikimedia Commons" for a web photo in the site. */
export function photoCredit(site: Pick<StoredSite, "images">): string {
  const credits = Object.values(site.images ?? {})
    .filter((i) => i.source === "web" && i.credit)
    .map((i) => i.credit!);
  return credits
    .map((c) => {
      const source = httpLink(c.sourceUrl);
      const license = httpLink(c.licenseUrl);
      const title = escapeHtml(c.title.slice(0, 90));
      return `<span class="photo-credit">Photo: ${source ? `<a href="${source}" target="_blank" rel="noopener">“${title}”</a>` : `“${title}”`}${c.author ? ` by ${escapeHtml(c.author.slice(0, 60))}` : ""}, ${
        license ? `<a href="${license}" target="_blank" rel="noopener">${escapeHtml(c.license)}</a>` : escapeHtml(c.license)
      }, via ${escapeHtml(c.provider)}</span>`;
    })
    .join("");
}
