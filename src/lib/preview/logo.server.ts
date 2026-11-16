/** Fetch the scraped logo once, analyse it (logo.ts) and store a trimmed copy with the site as image "logo". */
import { saveImage } from "@/lib/pages.server";
import { fetchPhoto } from "@/lib/preview/images.server";
import { analyzeLogo, type LogoAnalysis } from "@/lib/preview/logo";
import type { LogoMeta, StoredImage } from "@/lib/preview/types";

const cache = new Map<string, { at: number; analysis: LogoAnalysis }>();

async function analysisFor(url: string): Promise<LogoAnalysis> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.analysis;
  const photo = await fetchPhoto(url);
  const analysis = photo ? analyzeLogo(photo.bytes, photo.type) : { meta: { bg: "unknown" as const } };
  cache.set(url, { at: Date.now(), analysis });
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  return analysis;
}

/** Never throws: on any problem the logo stays hotlinked and is shown with the safe "unknown" treatment. */
export async function prepareLogo(siteId: string, url: string, name: string): Promise<{ meta: LogoMeta; images?: StoredImage[] }> {
  if (!/^https?:\/\//.test(url) || /\.svg(\?|$)/i.test(url)) return { meta: { bg: "unknown" } };
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
    return { meta: { bg: "unknown" } };
  }
}
