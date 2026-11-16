/** Shapes a finished preview site into the result object the home page shows. */
import type { ReimagineOk } from "@/lib/reimagine-types";
import type { StoredSite } from "@/lib/preview/render";

export function resultFor(site: StoredSite, base: string, note?: string): ReimagineOk {
  const facts = site.facts!;
  const plan = site.plan!;
  return {
    ok: true,
    source: site.mock ? "crawl" : "grok",
    live: facts.mode === "reimagine" && !facts.note,
    finalUrl: facts.sourceUrl,
    host: facts.host,
    foundTitle: facts.name,
    foundDescription: facts.description,
    diagnosis: plan.summary,
    honored: plan.changes,
    draft: {
      name: facts.name,
      kicker: plan.tagline,
      headline: site.design?.headline.replace(/\*/g, "") || plan.tagline,
      subhead: facts.description,
      action: plan.cta.label,
      nav: site.pages.map((p) => p.navLabel),
      palette: "harbor",
      points: facts.services.slice(0, 3).map((s) => ({ title: s, body: "" })),
      bandTitle: "",
      bandBody: "",
      close: "",
      logo: facts.logo || undefined,
      template: "yours",
      change: facts.notes || undefined,
    },
    layout: {
      submitted: facts.sourceUrl,
      url: facts.sourceUrl,
      title: facts.name,
      description: facts.description,
      nav: facts.nav.map((n) => n.label).slice(0, 8),
      headings: facts.pages.flatMap((p) => p.headings).slice(0, 16),
      text: facts.pages.map((p) => p.text).join("\n").slice(0, 2500),
    },
    note: [facts.note, note, site.mock ? "Mock mode (PREVIEW_MOCK=1): this preview was assembled without AI." : ""].filter(Boolean).join(" ") || undefined,
    pageUrl: base,
    preview: {
      id: site.id,
      url: base,
      mock: site.mock,
      look: site.design?.name,
      polish: site.polish ? { method: site.polish.method, notes: site.polish.notes } : undefined,
      aiErrors: site.aiErrors,
      pages: site.pages.map((p) => ({ slug: p.slug, title: p.navLabel || p.title, url: p.slug === "home" ? base : `${base}/${p.slug}` })),
    },
  };
}
