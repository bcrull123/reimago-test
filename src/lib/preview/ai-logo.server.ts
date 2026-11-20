/**
 * Round 10b — make a few logo options with Grok Imagine (or lettered stand-in marks when PREVIEW_MOCK=1).
 */
import { throwIfStopped } from "@/lib/abort.server";
import { generateImage, isMockMode, sniffImageType } from "@/lib/ai-provider.server";
import { newPageId, saveImage } from "@/lib/pages.server";
import { publicBase } from "@/lib/publish.server";
import { logoSpecs, logoWord, standInLogoPng, type LogoBrief, type LogoOption } from "./ai-logo";
import { imageSize } from "./images.server";

function baseUrl(): string {
  try {
    return publicBase();
  } catch {
    return "";
  }
}

/** Store up to three logos and return the ones that succeeded (empty if Imagine produced nothing). */
export async function makeAiLogos(brief: LogoBrief, variation = 0): Promise<LogoOption[]> {
  const specs = logoSpecs(brief, variation);
  const word = logoWord(brief);
  const standIn = isMockMode();
  const t0 = Date.now();
  console.info(`[logo] making ${specs.length} options for "${word}" (${specs.map((s) => s.kind).join(", ")})${standIn ? " [stand-in]" : ""}`);
  const batchId = newPageId();
  const base = baseUrl();
  const settled = await Promise.all(
    specs.map(async (spec, i) => {
      const t = Date.now();
      try {
        throwIfStopped("logo");
        let bytes: Buffer | undefined;
        let type = "image/png";
        if (standIn) bytes = standInLogoPng(word, spec.kind, variation);
        else {
          const img = await generateImage({ prompt: spec.prompt, aspect: "1:1", timeoutMs: 40_000, guard: false });
          if (img?.bytes && img.bytes.length >= 500) {
            bytes = img.bytes;
            type = img.type.startsWith("image/") ? img.type : sniffImageType(img.bytes);
            if (type !== "image/jpeg" && type !== "image/png") type = "image/png";
          }
        }
        if (!bytes || bytes.length < 500) {
          console.info(`[logo] option ${i + 1} ${spec.kind}: failed (no image) ${((Date.now() - t) / 1000).toFixed(1)}s`);
          return null;
        }
        const size = imageSize(bytes);
        const name = `ai-logo-${i + 1}`;
        await saveImage(batchId, name, type, bytes);
        console.info(`[logo] option ${i + 1} ${spec.kind}: ${size ? `${size.width}x${size.height}` : "?"} ${type} ${Math.round(bytes.length / 1024)} KB ${((Date.now() - t) / 1000).toFixed(1)}s`);
        return { id: `${batchId}/${name}`, url: `${base}/made/${batchId}/img/${name}`, kind: spec.kind, label: spec.label } satisfies LogoOption;
      } catch (error) {
        if (error instanceof Error && error.name === "StoppedError") throw error;
        const reason = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 160) : "error";
        console.info(`[logo] option ${i + 1} ${spec.kind}: failed (${reason}) ${((Date.now() - t) / 1000).toFixed(1)}s`);
        return null;
      }
    }),
  );
  const options = settled.filter((row): row is LogoOption => Boolean(row));
  console.info(`[logo] done: ${options.length}/${specs.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return options;
}
