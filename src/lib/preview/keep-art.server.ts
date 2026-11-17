/**
 * "Keep the rocket": the owner's own picture of the subject, taken ONLY from their scraped site — never a web
 * search or an AI image. Matching (site-art.ts) reads every picture's words; when none name the subject and AI
 * is on, the vision model is shown the site's pictures and asked which one shows it.
 *
 * The answer is cached per site + subject, so all three looks keep the same picture (and vision runs once).
 */
import { aiModel, chatJson, sniffImageType } from "@/lib/ai-provider.server";
import { fetchLogoFile, imageSize } from "@/lib/preview/images.server";
import { analyzeLogo } from "@/lib/preview/logo";
import { matchSiteArt, sanitizeSvg, visionCandidates, type SiteArt } from "@/lib/preview/site-art";
import type { SiteFacts } from "@/lib/preview/types";

export type KeptArt = {
  bytes: Buffer;
  type: string;
  width?: number;
  height?: number;
  cutout: boolean;
  art: SiteArt;
  /** How it was matched, for the trace: "words: Blast off rocket transparent bg" or "vision". */
  how: string;
};

export type KeepResult = { kept?: KeptArt; looked: number; how: string };

const cache = new Map<string, { at: number; result: Promise<KeepResult> }>();

/** The site's art list, plus the scraped photos that predate siteArt (older facts). */
function artOf(facts: SiteFacts): SiteArt[] {
  const art = [...(facts.siteArt ?? [])];
  for (const url of facts.images) {
    if (!art.some((a) => a.url === url)) art.push({ url, label: facts.imageText?.[url] ?? "", kind: "img", page: facts.sourceUrl, home: false });
  }
  if (facts.logo && !art.some((a) => a.url === facts.logo)) art.push({ url: facts.logo, label: "logo", kind: "logo", page: facts.sourceUrl, home: true });
  return art;
}

async function load(art: SiteArt): Promise<Omit<KeptArt, "art" | "how"> | undefined> {
  if (art.kind === "svg") {
    const svg = art.svg && sanitizeSvg(art.svg);
    return svg ? { bytes: Buffer.from(svg, "utf8"), type: "image/svg+xml", width: art.width, height: art.height, cutout: true } : undefined;
  }
  const file = await fetchLogoFile(art.url);
  if (!file) return undefined;
  if (file.type === "image/svg+xml") {
    const svg = sanitizeSvg(file.bytes.toString("utf8"));
    return svg ? { bytes: Buffer.from(svg, "utf8"), type: "image/svg+xml", width: art.width, height: art.height, cutout: true } : undefined;
  }
  const type = sniffImageType(file.bytes);
  if (!/^image\/(png|jpeg|webp|gif)$/.test(type) || file.bytes.length > 5_000_000) return undefined;
  const size = imageSize(file.bytes);
  // Transparent art (or a drawing on a flat color) is shown whole, not cropped into a photo frame.
  let cutout = type === "image/gif";
  if (type === "image/png" || type === "image/jpeg") {
    try {
      const bg = analyzeLogo(file.bytes, type).meta.bg;
      cutout = bg === "transparent" || (bg === "solid" && type === "image/png");
    } catch {
      cutout = false;
    }
  }
  return { bytes: file.bytes, type, width: size?.width ?? art.width, height: size?.height ?? art.height, cutout };
}

/** Ask the vision model which of the site's pictures shows the subject. Returns the index or -1. */
async function visionPick(subject: string, candidates: { art: SiteArt; bytes: Buffer; type: string }[], deadline: number): Promise<number> {
  if (!candidates.length) return -1;
  const content: unknown[] = [
    {
      type: "text",
      text: `The owner of a website asked us to keep "${subject}" from their site. Below are ${candidates.length} pictures from their site, numbered 1-${candidates.length} in order. Which picture shows ${subject}? Answer only JSON: {"index": <number 1-${candidates.length}>} or {"index": 0} if none clearly shows it.`,
    },
  ];
  candidates.forEach((c, i) => {
    content.push({ type: "text", text: `Picture ${i + 1}:` });
    content.push({ type: "image_url", image_url: { url: `data:${c.type};base64,${c.bytes.toString("base64")}`, detail: "low" } });
  });
  try {
    const answer = await chatJson<{ index?: unknown }>({
      model: process.env.PREVIEW_VISION_MODEL || aiModel(),
      messages: [{ role: "user", content: content as never }],
      maxTokens: 200,
      temperature: 0,
      timeoutMs: Math.max(3000, Math.min(20_000, deadline - Date.now())),
      deadline,
      retry: false,
    });
    const n = Number(answer.index);
    return Number.isInteger(n) && n >= 1 && n <= candidates.length ? n - 1 : -1;
  } catch {
    return -1;
  }
}

async function find(subject: string, facts: SiteFacts, useVision: boolean, deadline: number): Promise<KeepResult> {
  const art = artOf(facts);
  for (const match of matchSiteArt(subject, art).slice(0, 4)) {
    const file = await load(match);
    if (file) return { kept: { ...file, art: match, how: `matched the words on your site: “${match.label.slice(0, 80)}”` }, looked: art.length, how: "words" };
  }
  if (!useVision) return { looked: art.length, how: "words (no picture on the site is named for it)" };
  const loaded = (
    await Promise.all(
      visionCandidates(art).map(async (a) => {
        const file = await load(a).catch(() => undefined);
        return file && file.type !== "image/svg+xml" && file.bytes.length < 1_500_000 ? { art: a, ...file } : undefined;
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const index = await visionPick(subject, loaded, deadline);
  const hit = loaded[index];
  if (hit) {
    const { art: a, ...file } = hit;
    return { kept: { ...file, art: a, how: `the AI looked at ${loaded.length} pictures from your site and picked this one` }, looked: art.length, how: "vision" };
  }
  return { looked: art.length, how: `words and AI vision (${loaded.length} pictures checked)` };
}

/** The owner's own picture of `subject` from their site, or why there is none. Never searches elsewhere. */
export function keepFromSite(subject: string, facts: SiteFacts, useVision: boolean, deadline: number): Promise<KeepResult> {
  const key = `${facts.sourceUrl}|${subject.toLowerCase()}|${useVision ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.result;
  const result = find(subject, facts, useVision, deadline).catch(() => ({ looked: 0, how: "error" }) as KeepResult);
  cache.set(key, { at: Date.now(), result });
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  return result;
}
