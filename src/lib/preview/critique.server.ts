/**
 * Critique-and-revise pass for a homepage.
 *
 * PREVIEW_CRITIQUE = auto (default) | vision | html | off
 *   auto   - screenshot the page with headless Chrome when a Chrome binary exists
 *            (CHROME_PATH or a standard path) and send it to the model; otherwise
 *            critique the rendered HTML as text.
 *   vision - same as auto (falls back to html when no Chrome / the model rejects images)
 *   html   - text critique of the rendered HTML + section JSON only
 *   off    - skip
 * The model critiques like a senior designer, then returns revised sections once.
 * Revised sections go through the same validator as any AI output.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aiAvailable, chatText, isMockMode, parseJsonObject, type ContentPart } from "@/lib/ai-provider.server";
import { env } from "@/lib/env.server";
import { readImage } from "@/lib/pages.server";
import { renderSitePage, type PolishInfo, type StoredSite } from "@/lib/preview/render";
import { SECTION_GUIDE, normalizeSections, type NormalizeContext } from "@/lib/preview/sections";
import type { Section } from "@/lib/preview/types";

export function critiqueMode(): "auto" | "vision" | "html" | "off" {
  const raw = (env("PREVIEW_CRITIQUE") ?? "auto").toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false" || raw === "none") return "off";
  if (raw === "vision" || raw === "html" || raw === "text") return raw === "text" ? "html" : raw;
  return "auto";
}

export function chromePath(): string | undefined {
  const candidates = [env("CHROME_PATH"), "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((p): p is string => Boolean(p && existsSync(p)));
}

/** Screenshot the homepage (images inlined as data URLs) with headless Chrome. */
export async function screenshotHome(site: StoredSite, timeoutMs: number): Promise<string | undefined> {
  const chrome = chromePath();
  if (!chrome || timeoutMs < 4000) return undefined;
  const dir = await mkdtemp(join(tmpdir(), "reimago-shot-"));
  try {
    const inline = new Map<string, string>();
    await Promise.all(
      Object.keys(site.images ?? {}).map(async (name) => {
        const image = await readImage(site.id, name);
        if (image && image.bytes.length < 3_000_000) inline.set(name, `data:${image.type};base64,${image.bytes.toString("base64")}`);
      }),
    );
    const html = renderSitePage(site, "home", { imageUrl: (name) => inline.get(name) ?? "data:,", ribbon: false });
    if (!html) return undefined;
    const page = join(dir, "home.html");
    const out = join(dir, "home.png");
    await writeFile(page, html, "utf8");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        chrome,
        [
          "--headless=new",
          "--no-sandbox",
          "--disable-gpu",
          "--hide-scrollbars",
          "--disable-dev-shm-usage",
          "--force-prefers-reduced-motion",
          "--window-size=1280,2400",
          "--virtual-time-budget=6000",
          `--screenshot=${out}`,
          `file://${page}`,
        ],
        { stdio: "ignore" },
      );
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("screenshot timed out"));
      }, timeoutMs);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const png = await readFile(out).catch(() => undefined);
    if (!png || png.length < 2000 || png.length > 5_000_000) return undefined;
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch (error) {
    console.error("[preview] screenshot failed", error instanceof Error ? error.message : error);
    return undefined;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/i, "")
    .replace(/\s+/g, " ")
    .slice(0, 14_000);
}

const CRITIQUE_SYSTEM = `You are a senior art director reviewing a small-business homepage draft before it goes to the client.
Critique it honestly like a top agency designer: hierarchy, rhythm of section tones, headline strength, how bold and on-brief it is for the design direction, image use, whitespace, repetition, weak or generic copy, missing persuasion (proof, process, clear call to action), mobile concerns.
Then revise the page ONCE by returning an improved list of sections from the same section library.
Return ONLY JSON: {"critique": [3-6 short, specific notes], "sections": [ ...revised sections... ]}
Rules for the revision:
- Keep the design direction. Keep the hero type. Make it more striking and more specific, not longer for its own sake (5-8 sections).
- NEVER invent phone numbers, emails, addresses, prices, statistics, awards, years in business, staff names, guarantees, or reviews. Reviews only quote the provided testimonials word for word. Stats only use numbers present in the facts.
- Use only the provided image names and page slugs.
${SECTION_GUIDE}`;

/**
 * Critique and revise the homepage once. Returns the (possibly) revised sections and notes.
 * Never throws: on any failure the original sections are kept.
 */
export async function polishHome(
  site: StoredSite,
  ctx: NormalizeContext,
  budgetMs: number,
): Promise<{ sections: Section[]; polish: PolishInfo }> {
  const home = site.pages.find((p) => p.slug === "home");
  const original = home?.sections ?? [];
  const mode = critiqueMode();
  if (!home || !original.length) return { sections: original, polish: { method: "skipped", notes: [], reason: "No homepage sections." } };
  if (mode === "off") return { sections: original, polish: { method: "skipped", notes: [], reason: "PREVIEW_CRITIQUE=off" } };
  if (isMockMode() || !aiAvailable()) return { sections: original, polish: { method: "skipped", notes: [], reason: isMockMode() ? "Mock mode (PREVIEW_MOCK=1)." : "AI is not configured." } };
  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);
  let shot: string | undefined;
  if (mode !== "html") shot = await screenshotHome(site, Math.min(22_000, left() - 25_000));
  const brief = {
    business: site.name,
    design_direction: site.design,
    available_images: Object.values(site.images ?? {}).filter((i) => !i.name.startsWith("logo")).map((i) => ({ name: i.name, source: i.source })),
    pages: site.pages.map((p) => ({ slug: p.slug, title: p.title })),
    facts: site.facts
      ? {
          phone: site.facts.phone || null,
          email: site.facts.email || null,
          address: site.facts.address || null,
          services: site.facts.services,
          testimonials: site.facts.testimonials,
          description: site.facts.description,
          about: site.facts.about.slice(0, 900),
        }
      : undefined,
    current_sections: original,
  };
  const attempt = async (method: "vision" | "html"): Promise<{ sections: Section[]; polish: PolishInfo }> => {
    const timeoutMs = Math.max(8000, left() - 2000);
    const content: ContentPart[] =
      method === "vision" && shot
        ? [
            { type: "text", text: `Screenshot of the current homepage (desktop, 1280px wide) is attached. Brief and current sections:\n${JSON.stringify(brief)}` },
            { type: "image_url", image_url: { url: shot, detail: "high" } },
          ]
        : [{ type: "text", text: `Rendered homepage text (for structure):\n${visibleText(renderSitePage(site, "home", { ribbon: false }) ?? "")}\n\nBrief and current sections:\n${JSON.stringify(brief)}` }];
    const text = await chatText({
      temperature: 0.5,
      maxTokens: 12_000,
      timeoutMs,
      retry: false,
      json: true,
      model: env("CRITIQUE_MODEL"),
      messages: [
        { role: "system", content: CRITIQUE_SYSTEM.replace("{IMAGES}", Object.keys(site.images ?? {}).filter((n) => !n.startsWith("logo")).join(", ") || "(none — use no image fields)") },
        { role: "user", content },
      ],
    });
    const json = parseJsonObject<{ critique?: unknown; sections?: unknown }>(text);
    const notes = (Array.isArray(json.critique) ? json.critique : [])
      .map((n) => (typeof n === "string" ? n.replace(/\s+/g, " ").trim().slice(0, 220) : ""))
      .filter(Boolean)
      .slice(0, 6);
    const revised = normalizeSections(json.sections, ctx);
    const heroOk = revised[0] && revised[0].type === original[0]?.type;
    if (revised.length < 3 || !heroOk) return { sections: original, polish: { method, notes, reason: "The revision was not usable, so the draft was kept." } };
    return { sections: revised, polish: { method, notes } };
  };
  try {
    if (shot && left() > 15_000) {
      try {
        return await attempt("vision");
      } catch (error) {
        console.error("[preview] vision critique failed, trying html", error instanceof Error ? error.message : error);
      }
    }
    if (left() < 12_000) return { sections: original, polish: { method: "skipped", notes: [], reason: "Out of time for this step." } };
    return await attempt("html");
  } catch (error) {
    console.error("[preview] critique failed", error instanceof Error ? error.message : error);
    return { sections: original, polish: { method: "skipped", notes: [], reason: "The critique did not answer in time." } };
  }
}
