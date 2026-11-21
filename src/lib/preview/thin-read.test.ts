import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { embeddedStrings, readableLines, sitemapUrls } from "./scrape.server.ts";

const html = (body: string, head = "") => `<!doctype html><html><head><title>Acme</title>${head}</head><body>${body}</body></html>`;

describe("readableLines (Round 13: thin sites)", () => {
  it("keeps using paragraphs when a page has them", () => {
    const r = readableLines(html("<p>We repair vintage bicycles in downtown Tulsa, Oklahoma every day.</p>"));
    assert.equal(r.source, "paragraphs");
  });
  it("reads table / font / br text with no <p> (old sites)", () => {
    const r = readableLines(html(`<center><table><tr><td><font size=3>Welcome to Dave's! We have fixed cars in Tulsa since 1988.<br>Call for a free estimate on any repair.</font></td></tr></table></center>`));
    assert.equal(r.source, "blocks");
    assert.match(r.lines.join(" "), /fixed cars in Tulsa/);
  });
  it("reads div text", () => {
    const r = readableLines(html(`<div class="x"><div>Hand-poured candles made in small batches in Austin, Texas.</div></div>`));
    assert.equal(r.source, "blocks");
  });
  it("falls back to noscript copy, but not 'enable JavaScript'", () => {
    const real = readableLines(html(`<noscript><div>Riverbend Yoga offers morning vinyasa and gentle evening stretch classes.</div></noscript>`));
    assert.equal(real.source, "noscript");
    const shell = readableLines(html(`<div id=root></div><noscript>You need to enable JavaScript to run this app.</noscript>`));
    assert.equal(shell.source, "none");
  });
  it("pulls sentence-like strings out of __NEXT_DATA__ and ignores css/urls/ids", () => {
    const data = { props: { hero: "Gentle family dentistry on the Gulf Coast since 1998", css: "body{margin:0;padding:0}", url: "https://x.com/a/b/c/d/e/f/g", id: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4", items: [{ text: "Routine cleanings and exams every six months keep small problems small." }] } };
    const out = embeddedStrings(html(`<div id=__next></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`));
    assert.equal(out.length, 2);
    assert.ok(out.every((t) => !/body\{|https:/.test(t)));
  });
  it("reads window.__INITIAL_STATE__ and Squarespace-style assignments", () => {
    const out = embeddedStrings(html(`<script>window.__INITIAL_STATE__ = {"page":{"blurb":"<p>Locally owned flower shop serving Denver weddings and events since 2004.</p>"}};</script>`));
    assert.equal(out.length, 1);
    assert.match(out[0]!, /flower shop/);
  });
  it("never throws on junk JSON", () => {
    assert.deepEqual(embeddedStrings(html(`<script type="application/json">{not json</script><script>window.__X__ = {"a":</script>`)), []);
  });
  it("returns nothing for an empty JS shell", () => {
    assert.equal(readableLines(html(`<div id=root></div><script src=/app.js></script>`)).source, "none");
  });
});

describe("sitemapUrls", () => {
  const base = new URL("https://example.com/");
  it("ranks about/menu/services/contact first, same site only, no legal or xml", () => {
    const xml = `<urlset><url><loc>https://example.com/blog/post-1</loc></url><url><loc>https://example.com/about</loc></url><url><loc>https://example.com/privacy-policy</loc></url><url><loc>https://other.com/menu</loc></url><url><loc>https://example.com/menu</loc></url><url><loc>https://example.com/sitemap-2.xml</loc></url></urlset>`;
    const urls = sitemapUrls(xml, base).map((u) => u.pathname);
    assert.deepEqual(urls.slice(0, 2).sort(), ["/about", "/menu"]);
    assert.ok(!urls.includes("/privacy-policy") && !urls.some((p) => p.endsWith(".xml")));
  });
});
