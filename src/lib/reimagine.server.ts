import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getRequestIP } from "@tanstack/react-start/server";
import { pickLogo } from "@/lib/preview/logo-pick";

/*
 * Crawl helpers shared by the live preview builder (src/lib/preview/*).
 * The old Grok Imagine picture pipeline (grok-imagine-image-2.0 via
 * /v1/images/generations and /v1/images/edits) was removed: previews are now
 * real HTML pages built from the scraped facts.
 */

const hits = new Map<string, number[]>();

export const REIMAGO_HOSTS = new Set(["reimago.ai", "www.reimago.ai"]);

export const REIMAGO_SNAPSHOT = {
  title: "Reimago — Social Network Software, Community Software, Social Login and Enterprise Single Sign-On",
  description:
    "Reimago provides social network software, community software, social login, and enterprise single sign-on for brands and agencies.",
  headings: [
    "Features",
    "Activity Feed",
    "Blog Posts",
    "Photo Galleries",
    "Moderation and Permissions",
    "Customization",
    "Hosting Platform",
  ],
  text: `Reimago is social networking software, community software, social login, and enterprise single sign-on. Features include an activity feed, blog posts, bookmarks, calendars and events, document management, extensible profiles, friending and following, photo galleries, a setup wizard with social registration, status and mood updates, and videos. Advanced user-generated content covers commenting, forums, loyalty rewards and badges, live chat, polls, private messaging, questions and answers, ratings, reviews, sharing, and wiki. Moderation includes age gateways, user permissions, spam and profanity filters, trigger-word actions, pre-moderation, and flagged content. Customization includes an advertisement module, asset manager, custom menus, custom templating, drag-and-drop layout, theming, and integration. Call (405) 753-5300 or email sales@reimago.ai. Reimago is for brands, agencies, and outsourcing any website. Copyright Reimago, Inc., a subsidiary of Catalog.com, Inc., Oklahoma City.`,
};

export function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function blockedIp(ip: string): boolean {
  const raw = ip.toLowerCase().replace(/^\[|\]$/g, "");
  let v4 = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  if (v4.includes(":")) {
    if (raw === "::1" || raw === "::") return true;
    if (raw.startsWith("fe80:") || raw.startsWith("fc") || raw.startsWith("fd")) return true;
    return false;
  }
  if (!isIP(v4)) return true;
  const parts = v4.split(".").map((n) => Number(n));
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 168 || b === 0)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

export async function assertPublic(url: URL): Promise<void> {
  if (url.username || url.password) throw new Error("Remove any login from that address.");
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Use an http or https address.");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new Error("Only ordinary website addresses can be read.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    throw new Error("That address cannot be crawled.");
  }
  if (isIP(host)) {
    if (blockedIp(host)) throw new Error("That address cannot be crawled.");
    return;
  }
  let records: { address: string }[] = [];
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("That website address could not be found.");
  }
  if (records.length === 0 || records.some((record) => blockedIp(record.address))) {
    throw new Error("That address cannot be crawled.");
  }
}

export function normalizeInput(raw: string): URL {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("Enter a full website address, like https://example.com.");
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  return url;
}

export async function fetchPage(start: URL, timeoutMs = 30_000): Promise<{ url: string; html: string }> {
  const deadline = Date.now() + timeoutMs;
  let current = start;
  let hops = 0;
  let lastError: unknown;
  while (Date.now() < deadline && hops < 4) {
    const remaining = deadline - Date.now();
    if (remaining < 250) break;
    await assertPublic(current);
    try {
      const response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(remaining),
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5",
          "User-Agent": "ReimagoReimagine/1.0 (+https://reimago.ai)",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("That site redirected without a destination.");
        current = new URL(location, current);
        current.hash = "";
        hops += 1;
        if (hops >= 4) throw new Error("That site redirected too many times.");
        continue;
      }
      if (!response.ok) throw new Error(`That site responded with status ${response.status}.`);
      const type = response.headers.get("content-type") ?? "";
      if (type && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(type)) {
        throw new Error("That address did not return a web page.");
      }
      const html = (await readCapped(response, 600_000)).toString("utf8");
      if (!html.trim()) throw new Error("That site returned an empty page.");
      return { url: current.toString(), html };
    } catch (error) {
      lastError = error;
      const left = deadline - Date.now();
      if (left < 1000) break;
      const message = error instanceof Error ? error.message : "";
      if (!/fetch failed|aborted|timeout|Timeout|ECONN|socket|network/i.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1500, left)));
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("That site did not respond in time.");
}

export function stripTags(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function extract(html: string): {
  title: string;
  description: string;
  headings: string[];
  text: string;
} {
  const title = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? "");
  const descMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
  const description = stripTags(descMatch?.[1] ?? "");
    const cleaned = stripChrome(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const headings = [...cleaned.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => stripTags(match[1] ?? ""))
    .filter((heading) => heading.length > 1 && heading.length < 140)
    .slice(0, 16);
  const text = stripTags(cleaned).slice(0, 7000);
  return { title: title.slice(0, 180), description: description.slice(0, 300), headings, text };
}

export function httpUrl(value: string, base: string): string {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function extractLogo(html: string, base: string, siteName = ""): string {
  const page = stripChrome(html);
  const picked = pickLogo(page, base, siteName);
  if (picked) return picked;
  const icons: { href: string; score: number }[] = [];
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const raw = tag[0] ?? "";
    const rel = (raw.match(/\brel=["']([^"']+)["']/i)?.[1] ?? "").toLowerCase();
    const href = raw.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    let score = 0;
    if (rel.includes("apple-touch-icon")) score = 4;
    else continue;
    if (/svg|png/i.test(href)) score += 1;
    icons.push({ href, score });
  }
  icons.sort((a, b) => b.score - a.score);
  return icons[0] ? httpUrl(icons[0].href, base) : "";
}

export function stripChrome(html: string): string {
  const open = /<([a-z0-9]+)[^>]*\bid=["']wpadminbar["'][^>]*>/i.exec(html);
  if (!open) {
    return html.replace(/https?:\/\/wordpress\.org\/?/gi, " ").replace(/About WordPress/gi, " ");
  }
  const tag = open[1] ?? "div";
  const tags = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  tags.lastIndex = open.index;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(html))) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      return html.slice(0, open.index) + html.slice(tags.lastIndex);
    }
  }
  return html.slice(0, open.index) + html.slice(open.index + open[0].length);
}

export function scrubPlatform(value: string): string {
  return value
    .replace(/\babout\s*\.?\s*org\b/gi, "")
    .replace(/\babout\s+wordpress(?:\.org)?\b/gi, "")
    .replace(/\bwordpress\.org\b/gi, "")
    .replace(/\s*[|\-–—:]\s*just another wordpress site/gi, "")
    .replace(/just another wordpress site\.?/gi, "")
    .replace(/proudly powered by wordpress\.?/gi, "")
    .replace(/\bpowered by wordpress\b\.?/gi, "")
    .replace(/\blearn wordpress\b/gi, "")
    .replace(/\bwordpress\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/\s*\.\s*org\b/gi, "")
    .trim();
}

export function isWordPress(html: string): boolean {
  return /wp-content\/|wp-includes\/|wpadminbar|generator["'][^>]*wordpress|wordpress[^"']*["'][^>]*generator/i.test(html);
}

export const MENU_NOISE =
  /^(sample page|hello world!?|uncategorized|log in|login|sign in|sign up|register|my account|cart|checkout|wishlist|skip to content|search|shopping cart|about wordpress|wordpress\.org|about\.org|about \.org|documentation|learn wordpress|feedback|dashboard|updates|edit page|edit with elementor|howdy|log out|visit site|customize)$/i;

export function usefulNav(labels: string[]): string[] {
  return labels.map(scrubPlatform).filter((label) => label.length > 1 && !MENU_NOISE.test(label));
}

export function extractNav(html: string): string[] {
  const page = stripChrome(html);
  const start = page.search(/id=["']primary-menu["']/i);
  const chunk = start >= 0 ? page.slice(start, start + 8000) : page.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0] ?? "";
  const labels = [...chunk.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => stripTags(match[1] ?? ""))
    .filter((label) => label.length > 1 && label.length < 28 && !MENU_NOISE.test(label));
  return [...new Set(labels)].slice(0, 7);
}

export function extractImage(html: string, base: string): string {
  const tag =
    html.match(/<meta[^>]+property=["']og:image["'][^>]*>/i)?.[0] ??
    html.match(/<meta[^>]+name=["']og:image["'][^>]*>/i)?.[0] ??
    "";
  const content = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1] ?? "";
  return content ? httpUrl(content, base) : "";
}


export function decode(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&hellip;/gi, "…")
    .replace(/&bull;/gi, "•")
    .replace(/&middot;/gi, "·")
    .replace(/&copy;/gi, "©")
    .replace(/&reg;/gi, "®")
    .replace(/&trade;/gi, "™")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => {
      const code = parseInt(n, 16);
      return code > 31 && code < 65535 ? String.fromCharCode(code) : " ";
    })
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      return code > 31 && code < 65535 ? String.fromCharCode(code) : " ";
    });
}

/** Read a response body but stop after `max` bytes (never buffer a huge download). */
export async function readCapped(response: Response, max: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared && declared > max * 4) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("That page is too large to read.");
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(Buffer.from(value));
    total += value.length;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).subarray(0, max);
}

export function rateLimited(key: string, max = 6): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < 60 * 60 * 1000);
  if (recent.length >= max) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

export function requestIp(): string {
  try {
    return getRequestIP({ xForwardedFor: true }) ?? "anonymous";
  } catch {
    return "anonymous";
  }
}

export type CursorHandoff = {
  host: string;
  submitted: string;
  url: string;
  title: string;
  description: string;
  nav: string[];
  headings: string[];
  text: string;
  notes: string;
  previewUrl: string;
  pages: string[];
};

export function cursorConfigured(): boolean {
  return Boolean(process.env.CURSOR_API_KEY?.trim());
}

export function cursorPrompt(input: CursorHandoff): string {
  const site = input.submitted || input.url || input.host;
  return [
    `Rebuild the website entered in the form: ${site}.`,
    "That address is the only site. Do not switch to a different business.",
    input.previewUrl
      ? `Start from the approved live preview at ${input.previewUrl}. Open every page and match its layout, colors, type, copy, and navigation.`
      : "",
    input.pages.length ? `Preview pages:\n${input.pages.map((page) => `- ${page}`).join("\n")}` : "",
    input.title ? `Title: ${input.title}` : "",
    input.description ? `Description: ${input.description}` : "",
    input.nav.length ? `Navigation: ${input.nav.join(" · ")}` : "",
    input.headings.length ? `Headings, in order:\n${input.headings.map((heading) => `- ${heading}`).join("\n")}` : "",
    input.text ? `Page text:\n${input.text}` : "",
    input.notes ? `Customer note: ${input.notes}` : "",
    "Never invent phone numbers, emails, or addresses. Ship static pages that open in a browser. Do not change the live site.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function sendToCursor(
  input: CursorHandoff,
): Promise<{ ok: true; url: string } | { ok: false; error: string; deeplink: string }> {
  const prompt = cursorPrompt(input);
  const deeplink = `https://cursor.com/link/prompt?text=${encodeURIComponent(prompt.slice(0, 1800))}`;
  const key = process.env.CURSOR_API_KEY?.trim();
  if (!key) {
    return { ok: false, error: "CURSOR_API_KEY is not set, so the brief was prepared as a download instead.", deeplink };
  }
  try {
    const response = await fetch("https://api.cursor.com/v1/agents", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `Reimago ${input.host || "site"}`.slice(0, 100),
        prompt: { text: prompt },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const json = (await response.json().catch(() => null)) as {
      agent?: { url?: string };
      message?: string;
    } | null;
    const url = json?.agent?.url;
    if (!response.ok || !url) {
      return { ok: false, error: json?.message || "Cursor did not start.", deeplink };
    }
    return { ok: true, url };
  } catch {
    return { ok: false, error: "Cursor did not answer.", deeplink };
  }
}
