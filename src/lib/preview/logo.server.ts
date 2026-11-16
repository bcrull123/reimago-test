/** Fetch the scraped logo once, analyse it (logo.ts) and store a trimmed copy with the site as image "logo". */
import { saveImage } from "@/lib/pages.server";
import { fetchLogoFile } from "@/lib/preview/images.server";
import { analyzeLogo, analyzeSvg, type LogoAnalysis } from "@/lib/preview/logo";
import type { LogoMeta, StoredImage } from "@/lib/preview/types";

const cache = new Map<string, { at: number; analysis: LogoAnalysis }>();

/** Why a logo could not be used (logged; the site then shows its name as a text wordmark). */
function wordmark(reason: string, url: string): LogoAnalysis {
  console.error(`[preview] logo ${reason}: ${url.slice(0, 160)}`);
  return { meta: { bg: "unknown", wordmark: true } };
}

async function analysisFor(url: string): Promise<LogoAnalysis> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.analysis;
  let analysis: LogoAnalysis;
  const file = await fetchLogoFile(url);
  if (!file) analysis = wordmark("could not be loaded", url);
  else if (file.type === "image/svg+xml") analysis = { meta: analyzeSvg(file.bytes.toString("utf8").slice(0, 400_000)) };
  else if (file.type === "image/png" || file.type === "image/jpeg") {
    analysis = analyzeLogo(file.bytes, file.type);
    // Decoded but nothing usable came out (corrupt file): never show an empty chip.
    if (!analysis.png && analysis.meta.bg === "unknown") analysis = wordmark("could not be decoded", url);
  } else analysis = wordmark(`is ${file.type}, which can't be analysed here`, url);
  cache.set(url, { at: Date.now(), analysis });
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  return analysis;
}

/**
 * Never throws. PNG/JPEG logos are stored (trimmed, with reversed copies when needed); SVG logos stay at
 * their URL and are styled from their colors; anything that can't be loaded or read becomes a text wordmark.
 */
export async function prepareLogo(siteId: string, url: string, name: string): Promise<{ meta: LogoMeta; images?: StoredImage[] }> {
  if (!/^https?:\/\//.test(url)) return { meta: { bg: "unknown", wordmark: true } };
  try {
    const analysis = await analysisFor(url);
    if (!analysis.png) return { meta: analysis.meta };
    const images: StoredImage[] = [];
    const meta: LogoMeta = { ...analysis.meta };
    const store = async (file: string, png: Buffer) => {
      await saveImage(siteId, file, "image/png", png);
      images.push({ name: file, type: "image/png", source: "photo", alt: `${name} logo` });
    };
    await store("logo", analysis.png);
    meta.image = "logo";
    if (analysis.darkPng) {
      await store("logo-dark", analysis.darkPng);
      meta.darkImage = "logo-dark";
    }
    if (analysis.lightPng) {
      await store("logo-light", analysis.lightPng);
      meta.lightImage = "logo-light";
    }
    return { meta, images };
  } catch (error) {
    console.error("[preview] logo", error instanceof Error ? error.message : error);
    return { meta: { bg: "unknown", wordmark: true } };
  }
}
