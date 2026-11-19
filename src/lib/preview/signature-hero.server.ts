/**
 * Round 9 — when a site's only strong asset is one signature graphic (bob.me's rocket; any mascot / illustration)
 * or, failing that, its logo, Grok Imagine REIMAGINES it into the hero art: the real file goes to Imagine as the
 * reference image and Imagine returns a dramatic, cinematic hero version (same identity and colors). The original
 * stays the fallback (shown whole, as a cutout) when Imagine is off or fails. Cached per site + look style.
 */
import type { DesignDirection, SiteFacts, StoredImage } from "./types.ts";

export type SignatureHero = {
  image: StoredImage;
  bytes: Buffer;
  type: string;
  /** "reimagined": Imagine's hero art; "original": the site's own file (Imagine off / failed). */
  how: "reimagined" | "original";
  /** What the graphic is ("rocket"), for the card line. */
  subject: string;
  from: "signature graphic" | "logo";
};

const cache = new Map<string, { at: number; result: Promise<SignatureHero | undefined> }>();

/** "Blast off rocket transparent bg" -> "rocket"; "Acme logo" -> "logo". */
export function signatureSubject(label: string, from: "signature graphic" | "logo"): string {
  if (from === "logo") return "logo";
  // Generic: drop file-name noise, then the last content word names the thing (English noun-last phrases).
  const words = label
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(?:transparent|background|bg|png|svg|webp|jpe?g|img|image|graphic|art|artwork|illustration|copy|final|new|hero|home|homepage|scaled|cropped|removebg|preview|icon|the|and|with|of|for|our|your)\b/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  // Labels often repeat ("rocket transparent bg rocket transparent bg"): the first phrase is enough.
  const first = words.slice(0, Math.max(1, words.indexOf(words[0]!, 1) > 0 ? words.indexOf(words[0]!, 1) : words.length));
  return first.at(-1) ?? "brand graphic";
}

/** The Imagine prompt (no text in the art; the headline sits on the page). */
export function signaturePrompt(subject: string, facts: Pick<SiteFacts, "name">, design: Pick<DesignDirection, "mood" | "archetype" | "palette">): string {
  return (
    `REIMAGINE THE SIGNATURE graphic in the reference image as a dramatic, cinematic website hero artwork: the same ${subject}, ` +
    `clearly recognizable — keep its identity, silhouette, proportions and its exact colors — but redesigned as a stylized, premium hero ` +
    `illustration with depth, cinematic lighting, atmosphere and a sense of motion and scale. ` +
    `Mood: ${design.mood || "bold, optimistic"}; a ${design.archetype} website for ${facts.name || "the business"}, colors around ${design.palette.primary} and ${design.palette.accent}. ` +
    `Wide composition with the ${subject} as the centerpiece slightly to one side and calm space for a headline. ` +
    `No text, letters, numbers, words, watermarks or extra logos anywhere in the image.`
  );
}

export function signatureHero(id: string, facts: SiteFacts, design: DesignDirection, aspect: "16:9" | "4:3", timeoutMs: number): Promise<SignatureHero | undefined> {
  const key = `${facts.sourceUrl}|${design.archetype}|${aspect}`;
  const hit = cache.get(key);
  const result =
    hit && Date.now() - hit.at < 10 * 60_000 ? hit.result : make(facts, design, aspect, timeoutMs).catch(() => undefined);
  if (!hit || hit.result !== result) cache.set(key, { at: Date.now(), result });
  if (cache.size > 60) cache.delete(cache.keys().next().value!);
  return result.then(async (r) => {
    if (!r) return undefined;
    const { saveImage } = await import("@/lib/pages.server");
    await saveImage(id, "hero", r.type, r.bytes);
    return r;
  });
}

async function make(facts: SiteFacts, design: DesignDirection, aspect: "16:9" | "4:3", timeoutMs: number): Promise<SignatureHero | undefined> {
  const { signatureArt } = await import("./keep-art.server");
  // Imagine takes PNG / JPEG / WebP references: an SVG "signature" (often an icon sprite) is not reimagined.
  let art = await signatureArt(facts).catch(() => undefined);
  if (art && !/^image\/(png|jpeg|webp)$/.test(art.type)) art = undefined;
  let from: SignatureHero["from"] = "signature graphic";
  let label = art?.art.label ?? "";
  let src: { bytes: Buffer; type: string; width?: number; height?: number } | undefined = art;
  // The logo only when it really is the site's only asset (no usable photo anywhere on the site).
  const { scanSitePhotos } = await import("./site-photos.server");
  const noPhotos = !(await scanSitePhotos(facts).catch(() => undefined))?.photos.length;
  if (!art && facts.logo && noPhotos) {
    // No signature graphic and no photos: the logo, when it is a raster image big enough to reimagine.
    const { fetchLogoFile, imageSize } = await import("./images.server");
    const logo = await fetchLogoFile(facts.logo).catch(() => null);
    const size = logo && logo.type !== "image/svg+xml" ? imageSize(logo.bytes) : undefined;
    if (logo && size && size.width >= 200 && size.height >= 120) {
      src = { bytes: logo.bytes, type: logo.type, ...size };
      from = "logo";
      label = `${facts.name} logo`;
    }
  }
  if (!src) return undefined;
  const subject = signatureSubject(label, from);
  const { generateImage, imageProvider } = await import("@/lib/ai-provider.server");
  const t = Date.now();
  if (imageProvider() !== "none") {
    const img = await generateImage({
      prompt: signaturePrompt(subject, facts, design),
      aspect,
      guard: false,
      sourceImages: [`data:${src.type};base64,${src.bytes.toString("base64")}`],
      timeoutMs,
    }).catch(() => undefined);
    if (img && /^image\/(jpeg|png|webp)$/.test(img.type)) {
      const { imageSize } = await import("./images.server");
      const size = imageSize(img.bytes);
      console.info(`[imagine] ${from} “${subject}” reimagined as hero art for ${design.name} in ${Math.round((Date.now() - t) / 100) / 10}s (the site's ${from} sent as the reference image)`);
      return {
        image: { name: "hero", type: img.type, source: "generated", imagine: true, signature: true, alt: `${facts.name ? `${facts.name}: ` : ""}${subject}, reimagined`, ...(size ?? {}) },
        bytes: img.bytes,
        type: img.type,
        how: "reimagined",
        subject,
        from,
      };
    }
    console.info(`[imagine] reimagining the ${from} “${subject}” failed for ${design.name}: the original is the hero instead`);
  }
  return {
    image: { name: "hero", type: src.type, source: "photo", alt: `${facts.name ? `${facts.name} ` : ""}${subject}`, width: src.width, height: src.height, cutout: true, signature: true },
    bytes: src.bytes,
    type: src.type,
    how: "original",
    subject,
    from,
  };
}
