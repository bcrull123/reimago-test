/**
 * What the owner already saw this session, read from the stored looks (never from the browser's copy): the last
 * round's names, archetypes, hero treatments and palettes, plus every earlier hero photo. A regenerated round uses
 * it to come back visibly different instead of reshuffling the same three looks.
 */
import type { StoredSite } from "@/lib/preview/render";
import type { PreviousRound } from "@/lib/preview/types";

export async function previousRound(ids: string[], current: string[] = []): Promise<PreviousRound | undefined> {
  const ok = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{16}$/.test(id);
  const onScreen = [...new Set(current.filter(ok))].slice(0, 3);
  const clean = [...new Set([...ids.filter(ok), ...onScreen])].slice(-15);
  if (!clean.length) return undefined;
  const { readSite, readImage } = await import("@/lib/pages.server");
  const { measurePhoto } = await import("@/lib/preview/hero-pick.server");
  const sites = (await Promise.all(clean.map((id) => readSite(id).catch(() => undefined)))).filter((s): s is StoredSite => !!s?.design);
  if (!sites.length) return undefined;
  // "The last round" = the looks on screen (an edited look counts once, as its current version).
  const last = onScreen.length ? sites.filter((s) => onScreen.includes(s.id)) : sites.slice(-3);
  const keys = new Set<string>();
  const hashes = new Set<string>();
  await Promise.all(
    sites.map(async (site) => {
      const heroName = site.pages.find((p) => p.slug === "home")?.sections?.[0]?.image;
      if (!heroName) return;
      const img = site.images?.[heroName];
      for (const k of [img?.temporary?.imageUrl, img?.credit?.sourceUrl]) if (k && /^https?:\/\//.test(k)) keys.add(k);
      const bytes = await readImage(site.id, heroName).catch(() => undefined);
      const m = bytes ? measurePhoto(bytes.bytes, bytes.type) : undefined;
      if (m) hashes.add(m.hash);
    }),
  );
  return {
    names: last.map((s) => s.design!.tune?.base.name ?? s.design!.name),
    archetypes: last.map((s) => s.design!.archetype),
    heroStyles: last.map((s) => s.design!.heroStyle).filter((h): h is NonNullable<typeof h> => !!h),
    palettes: last.map((s) => ({ primary: s.palette.primary, background: s.palette.background })),
    photoKeys: [...keys].slice(-40),
    photoHashes: [...hashes].slice(-40),
  };
}
