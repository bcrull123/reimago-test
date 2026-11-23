import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PUBLIC_ORIGIN, envPublicOrigin, isPublicAppHost, isVercelSystemHost, publicAbsoluteBaseFrom, publicBaseFrom, publicLookUrlFrom, requestPathPrefixFrom, rewriteCustomerLookUrl, rewritePreviewPages } from "./public-base.ts";

const app = { protocol: "https:", hostname: "app.example", host: "app.example", pathname: "/" };
const port = "/hds-up68yqz8egcm-6014-7b575";
const vercel = { protocol: "https:", hostname: "01a1d5b9-bacc-7401-815d-3546c91d678a-ct1efse89.vercel.app", host: "01a1d5b9-bacc-7401-815d-3546c91d678a-ct1efse89.vercel.app", pathname: "/" };

describe("round 10f: publicBase ignores a foreign Referer", () => {
  it("uses the request URL when there is no Referer", () => {
    assert.equal(publicBaseFrom(app), "https://app.example");
  });
  it("keeps a same-host Referer, including a path-based preview prefix", () => {
    assert.equal(publicBaseFrom({ ...app, hostname: "preview.grokgsac.com", host: "preview.grokgsac.com" }, `https://preview.grokgsac.com${port}/`), `https://preview.grokgsac.com${port}`);
  });
  it("ignores a Referer from another site (Grok, email, etc.) so look URLs stay on this app", () => {
    assert.equal(publicBaseFrom(app, "https://grok.com/chat"), "https://app.example");
    assert.equal(publicBaseFrom(app, "https://x.com/i/status/1"), "https://app.example");
    assert.equal(publicBaseFrom({ ...app, protocol: "https:" }, "http://app.example/"), "https://app.example");
  });
  it("still reads the preview prefix from a same-host Referer when the request path was already stripped", () => {
    const req = { protocol: "https:", hostname: "preview.grokgsac.com", host: "preview.grokgsac.com", pathname: "/made/abc" };
    assert.equal(requestPathPrefixFrom(req, `https://preview.grokgsac.com${port}/`), port);
    assert.equal(requestPathPrefixFrom(req), "");
  });
});

describe("round 14: never hand back a Vercel SSO host", () => {
  it("treats VERCEL_URL-style hosts as system domains", () => {
    assert.equal(isVercelSystemHost("01a1d5b9-bacc-7401-815d-3546c91d678a-ct1efse89.vercel.app"), true);
    assert.equal(isVercelSystemHost("foo.vercel.app:443"), true);
    assert.equal(isVercelSystemHost("vercel.app"), true);
    assert.equal(isVercelSystemHost("something.vercel.com"), true);
    assert.equal(isVercelSystemHost("reimago.ai"), false);
    assert.equal(isVercelSystemHost("localhost:8090"), false);
    assert.equal(isPublicAppHost("reimago.ai"), true);
    assert.equal(isPublicAppHost("localhost"), true);
    assert.equal(isPublicAppHost(vercel.host), false);
  });

  it("uses PUBLIC_BASE_URL when the request host is a protected *.vercel.app deployment", () => {
    assert.equal(publicBaseFrom(vercel, undefined, { publicBaseUrl: "https://reimago.ai" }), "https://reimago.ai");
    assert.equal(publicBaseFrom(vercel, undefined, { publicBaseUrl: "https://reimago.ai/" }), "https://reimago.ai");
    assert.equal(publicBaseFrom(vercel, undefined, { publicHostname: "testreimago.grok.me" }), "https://testreimago.grok.me");
  });

  it("ignores PUBLIC_BASE_URL / VITE_PUBLIC_HOSTNAME when they are themselves vercel.app", () => {
    assert.equal(envPublicOrigin({ publicBaseUrl: "https://not-real.vercel.app", publicHostname: "reimago.ai" })?.host, "reimago.ai");
    assert.equal(envPublicOrigin({ publicBaseUrl: "https://foo.vercel.app" }), undefined);
    assert.equal(publicBaseFrom(vercel, undefined, { publicBaseUrl: "https://foo.vercel.app" }), "");
  });

  it("prefers the request's own public host over PUBLIC_BASE_URL (white-label / custom domain)", () => {
    assert.equal(publicBaseFrom(app, undefined, { publicBaseUrl: "https://reimago.ai" }), "https://app.example");
  });

  it("does not use a vercel Referer, even when it matches the request", () => {
    assert.equal(publicBaseFrom(vercel, `https://${vercel.host}/made/bea06de169ccd871`, { publicBaseUrl: "https://reimago.ai" }), "https://reimago.ai");
    assert.equal(requestPathPrefixFrom(vercel, `https://${vercel.host}${port}/`), "");
  });

  it("keeps localhost for local dev and builds a relative /made path when no public host exists", () => {
    const local = { protocol: "http:", hostname: "localhost", host: "localhost:8090", pathname: "/" };
    assert.equal(publicBaseFrom(local), "http://localhost:8090");
    assert.equal(publicBaseFrom(vercel), "");
    assert.equal(publicLookUrlFrom("", "bea06de169ccd871"), "/made/bea06de169ccd871");
    assert.equal(publicLookUrlFrom("https://reimago.ai", "bea06de169ccd871", "/img/capture"), "https://reimago.ai/made/bea06de169ccd871/img/capture");
  });
});

describe("round 14b: absolute email links default to reimago.ai", () => {
  it("falls back to https://reimago.ai when the request is a Vercel host and PUBLIC_BASE_URL is unset", () => {
    assert.equal(publicBaseFrom(vercel), "");
    assert.equal(publicAbsoluteBaseFrom(vercel), DEFAULT_PUBLIC_ORIGIN);
    assert.equal(publicAbsoluteBaseFrom(vercel), "https://reimago.ai");
    assert.equal(publicLookUrlFrom(publicAbsoluteBaseFrom(vercel), "bea06de169ccd871"), "https://reimago.ai/made/bea06de169ccd871");
  });

  it("still prefers PUBLIC_BASE_URL or a real request host over the reimago.ai default", () => {
    assert.equal(publicAbsoluteBaseFrom(vercel, undefined, { publicBaseUrl: "https://testreimago.grok.me" }), "https://testreimago.grok.me");
    const local = { protocol: "http:", hostname: "localhost", host: "localhost:8090", pathname: "/" };
    assert.equal(publicAbsoluteBaseFrom(local), "http://localhost:8090");
    assert.equal(publicAbsoluteBaseFrom(app), "https://app.example");
  });

  it("rewrites vercel.app and relative /made links for the email payload, and leaves a public host alone", () => {
    const id = "bea06de169ccd871";
    const base = "https://reimago.ai";
    assert.equal(rewriteCustomerLookUrl("", id, base), "https://reimago.ai/made/bea06de169ccd871");
    assert.equal(rewriteCustomerLookUrl("/made/bea06de169ccd871", id, base), "https://reimago.ai/made/bea06de169ccd871");
    assert.equal(
      rewriteCustomerLookUrl("https://01a1d5b9-bacc-7401-815d-3546c91d678a-ct1efse89.vercel.app/made/bea06de169ccd871", id, base),
      "https://reimago.ai/made/bea06de169ccd871",
    );
    assert.equal(
      rewriteCustomerLookUrl("https://01a1d5b9-bacc-7401-815d-3546c91d678a-ct1efse89.vercel.app/made/bea06de169ccd871/img/capture", id, base),
      "https://reimago.ai/made/bea06de169ccd871/img/capture",
    );
    assert.equal(rewriteCustomerLookUrl("https://reimago.ai/made/bea06de169ccd871", id, base), "https://reimago.ai/made/bea06de169ccd871");
    assert.equal(rewriteCustomerLookUrl("https://testreimago.grok.me/made/bea06de169ccd871", id, base), "https://testreimago.grok.me/made/bea06de169ccd871");
    const pages = rewritePreviewPages("Home: https://foo.vercel.app/made/bea06de169ccd871\nAbout: /made/bea06de169ccd871/about", id, base);
    assert.equal(pages, "Home: https://reimago.ai/made/bea06de169ccd871\nAbout: https://reimago.ai/made/bea06de169ccd871/about");
  });
});
