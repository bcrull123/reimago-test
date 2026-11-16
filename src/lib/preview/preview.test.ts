import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeHref, sanitizeHtml, scrubInventedContacts, type SanitizeContext } from "./sanitize.ts";
import { pageHref, renderSitePage, type StoredSite } from "./render.ts";
import { contrast, safePalette } from "./theme.ts";

const ctx: SanitizeContext = {
  slugs: ["home", "about", "services", "contact"],
  phone: "(405) 555-0123",
  email: "hello@joesplumbing.com",
  images: ["https://joesplumbing.com/truck.jpg"],
  sourceHost: "joesplumbing.com",
};

describe("sanitizeHtml", () => {
  it("strips scripts, iframes, forms, event handlers and inline styles", () => {
    const out = sanitizeHtml(
      `<section class="hero" onclick="x()" style="color:red"><script>alert(1)</script><iframe src="https://evil"></iframe><form action="https://evil"><input name=a></form><h1 onmouseover='y'>Hi</h1><a href="javascript:alert(1)">bad</a></section>`,
      ctx,
    );
    assert.doesNotMatch(out, /script|iframe|<form|<input|onclick|onmouseover|style=|javascript:/i);
    assert.match(out, /<section class="hero"><h1>Hi<\/h1><a href="#">bad<\/a><\/section>/);
  });

  it("rewrites internal links to page tokens and keeps external links in a new tab", () => {
    const out = sanitizeHtml(
      `<a href="/about">A</a><a href="/">H</a><a href="https://www.joesplumbing.com/services/">S</a><a href="/contact-us">C</a><a href="https://maps.google.com/x">M</a>`,
      ctx,
    );
    assert.match(out, /href="@page:about"/);
    assert.match(out, /href="@page:home"/);
    assert.match(out, /href="@page:services"/);
    assert.match(out, /href="@page:contact"/);
    assert.match(out, /href="https:\/\/maps.google.com\/x" target="_blank" rel="noopener noreferrer"/);
  });

  it("only keeps tel/mailto links that match the scraped facts", () => {
    assert.equal(normalizeHref("tel:405-555-0123", ctx).href, "tel:+14055550123");
    assert.equal(normalizeHref("tel:212-555-9999", ctx).href, "@page:contact");
    assert.equal(normalizeHref("mailto:hello@joesplumbing.com", ctx).href, "mailto:hello@joesplumbing.com");
    assert.equal(normalizeHref("mailto:fake@x.com", ctx).href, "@page:contact");
  });

  it("removes invented phone numbers and emails from text", () => {
    const text = scrubInventedContacts("Call (212) 555-9999 or (405) 555-0123, email info@fake.com", ctx);
    assert.match(text, /\(405\) 555-0123/);
    assert.doesNotMatch(text, /212|info@fake\.com/);
  });

  it("replaces images that did not come from the site with gradient placeholders", () => {
    const out = sanitizeHtml(
      `<img src="https://joesplumbing.com/truck.jpg" alt="Truck"><img src="https://stock.example/fake.jpg" alt="Fake">`,
      ctx,
    );
    assert.match(out, /<img src="https:\/\/joesplumbing.com\/truck.jpg" alt="Truck" loading="lazy">/);
    assert.match(out, /<div class="ph ph-\d" role="img" aria-label="Fake"><\/div>/);
  });
});

describe("renderSitePage", () => {
  const site: StoredSite = {
    version: 2,
    id: "0123456789abcdef",
    createdAt: "2026-11-16T12:00:00.000Z",
    mode: "reimagine",
    mock: false,
    host: "joesplumbing.com",
    sourceUrl: "https://joesplumbing.com/",
    name: "Joe's Plumbing",
    tagline: "Fast, honest plumbing",
    logo: "",
    phone: "(405) 555-0123",
    email: "hello@joesplumbing.com",
    address: "",
    hours: ["Mon–Fri 8am–5pm"],
    social: [],
    palette: { primary: "#1f4e79", accent: "#e8a33d", background: "#ffffff", surface: "#f4f6f9", text: "#16202b", muted: "#5b6573" },
    fonts: { heading: "Fraunces", body: "Inter" },
    cta: { label: "Get a quote", slug: "contact" },
    pages: [
      { slug: "home", title: "Home", navLabel: "Home", body: `<section><a href="@page:services">Services</a></section>` },
      { slug: "services", title: "Services", navLabel: "Services", body: `<section><a href="@page:home">Back</a></section>` },
      { slug: "contact", title: "Contact", navLabel: "Contact", body: `<section><h1>Contact</h1></section>` },
    ],
  };

  it("uses relative links that work from /made/<id> and /made/<id>/<slug>", () => {
    assert.equal(pageHref(site.id, "home", "services"), `${site.id}/services`);
    assert.equal(pageHref(site.id, "home", "home"), site.id);
    assert.equal(pageHref(site.id, "services", "contact"), "contact");
    assert.equal(pageHref(site.id, "services", "home"), `../${site.id}`);
    const home = renderSitePage(site, "home")!;
    assert.match(home, new RegExp(`href="${site.id}/services"`));
    const services = renderSitePage(site, "services")!;
    assert.match(services, new RegExp(`href="\\.\\./${site.id}"`));
    // Resolve like a browser would.
    assert.equal(new URL(`${site.id}/services`, `https://x.test/made/${site.id}`).pathname, `/made/${site.id}/services`);
    assert.equal(new URL(`../${site.id}`, `https://x.test/made/${site.id}/services`).pathname, `/made/${site.id}`);
  });

  it("adds a Formcarry contact form with honeypot and mode only on the contact page", () => {
    const contact = renderSitePage(site, "contact")!;
    assert.match(contact, /action="https:\/\/formcarry.com\/s\/NipZS0fF4w4"/);
    assert.match(contact, /name="_gotcha"/);
    assert.match(contact, /name="mode" value="preview_contact"/);
    assert.doesNotMatch(renderSitePage(site, "home")!, /<form/);
    assert.match(contact, /href="tel:\+14055550123"/);
    assert.doesNotMatch(contact, /<script/i);
  });

  it("returns undefined for unknown pages", () => {
    assert.equal(renderSitePage(site, "nope"), undefined);
  });
});

describe("safePalette", () => {
  it("fixes unreadable text colors", () => {
    const p = safePalette({ primary: "#ffff00", accent: "#00ff00", background: "#ffffff", surface: "#fefefe", text: "#eeeeee", muted: "#f0f0f0" }, {
      primary: "#000000", accent: "#000000", background: "#ffffff", surface: "#f4f4f4", text: "#111111", muted: "#555555",
    });
    assert.ok(contrast(p.text, p.background) >= 7);
    assert.ok(contrast(p.muted, p.background) >= 4.5);
    assert.ok(contrast(p.primary, p.background) >= 2.5);
  });
});
