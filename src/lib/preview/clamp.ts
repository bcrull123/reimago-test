/** Re-validate facts/plans that round-trip through the browser between steps. */
import type { SiteFacts, SitePlan } from "@/lib/preview/types";

const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const strs = (value: unknown, count: number, max: number) =>
  Array.isArray(value) ? value.map((v) => str(v, max)).filter(Boolean).slice(0, count) : [];
const https = (value: unknown) => {
  const v = str(value, 600);
  return /^https:\/\/[^\s"'<>]+$/.test(v) ? v : "";
};

export function clampFacts(input: unknown): SiteFacts {
  if (!input || typeof input !== "object") throw new Error("The site facts are missing. Start again.");
  const f = input as Record<string, unknown>;
  const name = str(f.name, 80);
  if (!name) throw new Error("The site facts are missing. Start again.");
  return {
    mode: f.mode === "create" ? "create" : "reimagine",
    sourceUrl: str(f.sourceUrl, 300),
    host: str(f.host, 200).replace(/[^a-zA-Z0-9.\- ]/g, "") || name,
    name,
    tagline: str(f.tagline, 160),
    description: str(f.description, 500),
    logo: https(f.logo),
    colors: strs(f.colors, 4, 7).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c)),
    phone: str(f.phone, 40),
    email: str(f.email, 200),
    address: str(f.address, 200),
    hours: strs(f.hours, 7, 80),
    services: strs(f.services, 12, 100),
    about: str(f.about, 1600),
    testimonials: (Array.isArray(f.testimonials) ? f.testimonials : [])
      .map((t) => ({ quote: str((t as Record<string, unknown>)?.quote, 500), author: str((t as Record<string, unknown>)?.author, 80) }))
      .filter((t) => t.quote)
      .slice(0, 4),
    images: (Array.isArray(f.images) ? f.images : []).map(https).filter(Boolean).slice(0, 12),
    nav: (Array.isArray(f.nav) ? f.nav : [])
      .map((n) => ({ label: str((n as Record<string, unknown>)?.label, 40), url: str((n as Record<string, unknown>)?.url, 300) }))
      .filter((n) => n.label)
      .slice(0, 10),
    pages: (Array.isArray(f.pages) ? f.pages : [])
      .map((p) => {
        const r = (p ?? {}) as Record<string, unknown>;
        return { url: str(r.url, 300), title: str(r.title, 140), headings: strs(r.headings, 12, 140), text: str(r.text, 2000) };
      })
      .slice(0, 9),
    social: (Array.isArray(f.social) ? f.social : []).map(https).filter(Boolean).slice(0, 6),
    industry: str(f.industry, 60),
    notes: str(f.notes, 800),
    brief: str(f.brief, 4000) || undefined,
    note: str(f.note, 400) || undefined,
  };
}

export function clampPlanInput(input: unknown): unknown {
  // The plan is fully re-normalized server-side (normalizePlan); just cap the size here.
  const json = JSON.stringify(input ?? null);
  if (json.length > 40_000) throw new Error("The site plan is too large.");
  return input;
}

export type { SiteFacts, SitePlan };
