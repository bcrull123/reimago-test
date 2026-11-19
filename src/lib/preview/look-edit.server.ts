/**
 * Targeted refinement: the owner's feedback names one of the looks ("The Night Brick is best just a little too
 * dark."), so that look is EDITED, not replaced. Its name, layout, fonts, photo, copy and structure stay; only the
 * requested change is applied, deterministically (look-edit.ts), as three stored copies: as asked, a half step
 * more, a full step more ("Night Brick, lighter" / "…a bit lighter still" / "…noticeably lighter").
 *
 * The Grok planner reads the request into {targetLook, adjustments, copy, photo}; the wording rules
 * (readAdjustments / findTargetLook) are the fallback and the safety net (a look counts as named only when the
 * owner's words actually name it).
 */
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import {
  addLevels,
  changedLine,
  cleanAdjustments,
  findBorrow,
  findLookRefs,
  findTargetLook,
  lightingOnly,
  mergePhotoRequest,
  photoRequestLabel,
  photoVariantLabel,
  illustrationFits,
  illustrationPrompt,
  photoOutcomeNote,
  readAdjustments,
  readPhotoRequest,
  requestedStyle,
  wantsNewPhoto,
  tuneNumbers,
  tunePalette,
  variantLabel,
  variationScales,
  type Adjustment,
  type BorrowAsset,
  type LookEdit,
  type LookRef,
  type LookTune,
  type PhotoOutcome,
} from "./look-edit.ts";
import type { StoredSite } from "./render.ts";
import type { StoredImage } from "./types.ts";

/** The looks on screen, as read back from storage (never the browser's copy). */
export function lookRefs(sites: StoredSite[]): LookRef[] {
  return sites.map((s, i) => ({
    id: s.id,
    name: s.design?.tune?.base.name ?? s.design?.name ?? s.name,
    archetype: s.design?.archetype ?? "editorial",
    index: s.lookIndex ?? i,
    background: s.palette.background,
    primary: s.palette.primary,
    custom: Boolean(s.custom && !s.design?.custom?.failed) || undefined,
  }));
}

/** Rules-only reading (no AI): which look, which tweaks. */
export function editByWording(text: string, looks: LookRef[], focusedId?: string): LookEdit {
  const target = findTargetLook(text, looks, focusedId);
  const borrow = findBorrow(text, looks, focusedId);
  return {
    targetId: target?.id,
    how: target?.how,
    adjustments: readAdjustments(text),
    borrow: borrow && borrow.targetId === target?.id ? { fromId: borrow.fromId, assets: borrow.assets } : undefined,
    ...(() => {
      const req = borrow?.assets.includes("photo") ? undefined : readPhotoRequest(text);
      return req ? { photoRequest: req, photo: photoRequestLabel(req) } : {};
    })(),
    from: "wording",
  };
}

/**
 * The Grok planner's reading, merged with the wording rules. The target must be named in the owner's words
 * (rules), or be a look whose name the planner returned AND that appears (fuzzily) in the text; the planner's
 * adjustments win when it returned any.
 */
export async function planEdit(text: string, looks: LookRef[], focusedId: string | undefined, useAi: boolean, cardId?: string): Promise<LookEdit> {
  const card = cardId ? looks.find((l) => l.id === cardId) : undefined;
  if (card) {
    // The card's own "Change this look" box: the target is that card, sent explicitly (no name matching).
    const planned = await planEdit(text, looks, card.id, useAi);
    const restyle = card.custom ? undefined : requestedStyle(text, card.archetype);
    const borrow = planned.borrow && planned.borrow.fromId !== card.id ? planned.borrow : undefined;
    return { ...planned, targetId: card.id, how: `its own “Change this look” box (card ${card.index + 1})`, borrow, restyle };
  }
  const rules = editByWording(text, looks, focusedId);
  if (!useAi) return rules;
  try {
    const { chatJson, aiModel } = await import("@/lib/ai-provider.server");
    const raw = await chatJson<{ targetLook?: unknown; adjustments?: unknown; copy?: unknown; photo?: unknown; borrowFrom?: unknown; borrow?: unknown }>({
      model: aiModel(),
      temperature: 0,
      maxTokens: 600,
      timeoutMs: 20_000,
      retry: false,
      messages: [
        {
          role: "system",
          content: `You are editing ONE existing website look from the owner's feedback. The owner sees these looks (left to right):
${looks.map((l, i) => `${i + 1}. "${l.name}" (${l.custom ? "designed from scratch; the owner may call it “the custom one”" : l.archetype}${l.id === focusedId ? ", currently previewed" : ""})`).join("\n")}
Return ONLY JSON: {"targetLook": exact look name or null, "adjustments": [{"type": one of lighten|darken|more-contrast|less-contrast|saturate|desaturate|warmer|cooler|bigger-text|smaller-text|more-space|less-space|more-color|less-busy|daylight, "amount": "slight"|"medium"|"strong"}], "copy": {"headline"?: string, "lead"?: string} or null, "photo": string or null, "borrowFrom": exact look name or null, "borrow": subset of ["photo","palette","fonts"]}
Rules:
- targetLook only when the feedback names or clearly points at one look (its name, its style such as "Dark Premium" or "editorial", "the second one", "the dark one", "this one" = the currently previewed look). Otherwise null.
- "Use X's picture on Y" / "give Y X's colors": targetLook = Y (the look that changes), borrowFrom = X, borrow = what moves; then "photo" is null (no search: the picture comes from X).
- "a little", "a bit", "slightly", "just a touch" = slight; no qualifier = medium; "much", "way", "a lot" = strong.
- "too dark" = lighten; "too bright"/"washed out" = darken; "too busy" = less-busy; "hard to read" = more-contrast.
- "make the image daylight" / "sunny" / "daytime" = daylight (the SAME photo, brighter and sunnier); "adjust the text to show contrast" = more-contrast.
- copy only when the owner dictates new words for the hero headline or intro; photo only when they ask for a DIFFERENT hero photo or subject (the subject, 2-6 words), never for lighting or color changes to the current photo.
- Never invent changes the owner did not ask for.`,
        },
        { role: "user", content: text.slice(0, 400) },
      ],
    });
    const named = typeof raw.targetLook === "string" ? looks.find((l) => l.name.toLowerCase() === raw.targetLook!.toString().toLowerCase().trim()) : undefined;
    // The planner may only pick a look the owner's words actually refer to (name, style label or position).
    const mentioned = new Set(findLookRefs(text, looks).map((m) => m.id));
    if (focusedId && /\b(?:this|current)\s+(?:one|look|design|version)\b/i.test(text)) mentioned.add(focusedId);
    const aiTarget = named && mentioned.has(named.id) ? named : undefined;
    const lender = typeof raw.borrowFrom === "string" ? looks.find((l) => l.name.toLowerCase() === String(raw.borrowFrom).toLowerCase().trim()) : undefined;
    const aiAssets = (Array.isArray(raw.borrow) ? raw.borrow : []).filter((a): a is BorrowAsset => a === "photo" || a === "palette" || a === "fonts");
    const targetId = rules.targetId ?? aiTarget?.id;
    const borrow =
      rules.borrow ??
      (lender && targetId && lender.id !== targetId && mentioned.has(lender.id) && aiAssets.length ? { fromId: lender.id, assets: [...new Set(aiAssets)] } : undefined);
    const adjustments = cleanAdjustments(raw.adjustments);
    const c = (raw.copy && typeof raw.copy === "object" ? raw.copy : {}) as Record<string, unknown>;
    const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
    const copy = { headline: clip(c.headline, 120) || undefined, lead: clip(c.lead, 300) || undefined };
    // A new photo only when the owner asked for a different one; "make the image daylight" adjusts the current photo.
    const asked = clip(raw.photo, 80);
    const plannerPhoto = asked && wantsNewPhoto(text) && !lightingOnly(asked) ? asked : undefined;
    if (asked && !plannerPhoto) console.info(`[refine] planner photo “${asked}” ignored: the owner asked to adjust the current photo, not for a new one`);
    // The owner's own subject words win over the planner's summary (which once turned "the brick streets, maybe
    // Pine Street" into the town's generic "downtown Pauls Valley").
    const photoRequest = borrow?.assets.includes("photo") ? undefined : mergePhotoRequest(text, plannerPhoto);
    const photo = photoRequest ? photoRequestLabel(photoRequest) : undefined;
    if (photoRequest || plannerPhoto)
      console.info(
        `[refine] photo request: ${photoRequest ? `subject “${photoRequest.subject}”${photoRequest.named.length ? `, named ${photoRequest.named.map((n) => `“${n}”`).join(", ")}` : ""}` : "none"}${plannerPhoto ? ` · planner said “${plannerPhoto}”${photoRequest && photoRequest.subject !== plannerPhoto ? " (kept the owner's words)" : ""}` : ""}`,
      );
    return {
      targetId,
      how: rules.how ?? (aiTarget ? `named “${aiTarget.name}” (AI)` : undefined),
      // The planner's reading, plus anything the wording rules caught that it missed ("daylight", "text contrast").
      adjustments: adjustments.length ? [...adjustments, ...rules.adjustments.filter((r) => !adjustments.some((a) => a.type === r.type))].slice(0, 6) : rules.adjustments,
      copy: copy.headline || copy.lead ? copy : undefined,
      // A borrowed picture comes from the other look, never from a new search.
      photo,
      photoRequest,
      borrow,
      from: adjustments.length || copy.headline || copy.lead || photo || (borrow && !rules.borrow) ? "AI planner" : "wording",
    };
  } catch (error) {
    console.warn("[refine] AI edit planner failed; using the wording rules", error instanceof Error ? error.message.slice(0, 120) : "");
    return rules;
  }
}

// ------------------------------------------------------------------------------------------- hero photo measure

/** sRGB luma (0..1) of the hero photo region where the headline sits, at the 80th percentile. */
export function heroLuma(bytes: Buffer, type: string, region: { x0: number; x1: number; y0: number; y1: number }): number | undefined {
  try {
    let width = 0;
    let height = 0;
    let data: Uint8Array;
    if (type === "image/jpeg") {
      const img = jpeg.decode(bytes, { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 600 });
      ({ width, height, data } = img);
    } else if (type === "image/png") {
      const img = PNG.sync.read(bytes);
      ({ width, height } = img);
      data = img.data;
    } else return undefined;
    const values: number[] = [];
    const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 40_000)));
    for (let y = Math.floor(region.y0 * height); y < Math.floor(region.y1 * height); y += step) {
      for (let x = Math.floor(region.x0 * width); x < Math.floor(region.x1 * width); x += step) {
        const i = (y * width + x) * 4;
        values.push((0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255);
      }
    }
    if (!values.length) return undefined;
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length * 0.8)]!;
  } catch {
    return undefined;
  }
}

/**
 * The lowest scrim factor (1 = the designed overlay) that keeps white hero text at 4.5:1 over this photo after the
 * brightness boost. `alpha` is the designed overlay opacity behind the text.
 */
export function scrimFloor(luma: number | undefined, brightness: number, alpha: number): number {
  if (luma === undefined) return 0.6;
  const lin = Math.min(1, luma * brightness) ** 2.2;
  const maxBehind = 1.05 / 4.5 - 0.05; // relative luminance that still gives white text 4.5:1
  if (lin <= maxBehind) return 0;
  const needed = 1 - maxBehind / lin; // overlay opacity needed
  return Math.min(1, needed / alpha);
}

// ------------------------------------------------------------------------------------------- building the edits

export type EditedLook = { site: StoredSite; variant: string; changed: string; measured: { backgroundBefore: number; backgroundAfter: number; scrim: number; brightness: number } };

async function copyImages(from: StoredSite, toId: string): Promise<void> {
  const { readImage, saveImage } = await import("@/lib/pages.server");
  await Promise.all(
    // The Custom Design look's Imagine mockup travels with it (shown on the card next to the built page).
    [...Object.keys(from.images ?? {}), ...(from.customMockup ? ["mockup"] : [])].map(async (name) => {
      const img = await readImage(from.id, name);
      if (img) await saveImage(toId, name, img.type, img.bytes);
    }),
  );
}

/** A different hero photo for the edit ("…but use the depot photo"): Google Images, then free-license photos. */
function hero0(site: StoredSite) {
  return site.pages.find((p) => p.slug === "home")?.sections?.[0];
}

async function findEditPhoto(site: StoredSite, subject: string, step: number): Promise<{ bytes: Buffer; type: string; image: StoredImage } | undefined> {
  if (!site.facts) return undefined;
  const { findGooglePhotos, photoSearchEnabled } = await import("./google-photo.server.ts");
  if (photoSearchEnabled()) {
    const g = await findGooglePhotos(subject, site.facts, false, Date.now() + 25_000, 3).catch(() => undefined);
    const pick = g?.photos[step % Math.max(1, g.photos.length)];
    if (pick) {
      const { googleCredit } = await import("./builder.server.ts");
      return { bytes: pick.photo.bytes, type: pick.photo.type, image: { name: "hero", type: pick.photo.type, source: "web", alt: pick.temp.title, width: pick.photo.width, height: pick.photo.height, credit: googleCredit(pick.temp), temporary: pick.temp } };
    }
  }
  const { findWebPhotos, webPhotosEnabled } = await import("./web-photo.server.ts");
  const { placeOf } = await import("./web-photo.ts");
  if (!webPhotosEnabled()) return undefined;
  const web = await findWebPhotos(subject, placeOf(site.facts), 8_000, 3).catch(() => []);
  const w = web[step % Math.max(1, web.length)];
  return w ? { bytes: w.photo.bytes, type: w.photo.type, image: { name: "hero", type: w.photo.type, source: "web", alt: w.credit.title, width: w.photo.width, height: w.photo.height, credit: w.credit } } : undefined;
}

/**
 * Round 8c: the owner's requested photo ("one of the brick streets, maybe Pine Street"), searched by their own
 * subject words — the site's photos and the photos the other looks show first, then Google most-specific-first —
 * judged by vision for whether it SHOWS the request, never the current photo. Returns the honest card line.
 */
async function findRequestHero(site: StoredSite, req: NonNullable<LookEdit["photoRequest"]>, others: StoredSite[]): Promise<{ bytes: Buffer; type: string; image: StoredImage; note: string; label: string; match: PhotoOutcome } | { note: string; label: string; match: "nothing" }> {
  const t0 = Date.now();
  const { readImage } = await import("@/lib/pages.server");
  const { findRequestedPhoto, judgeSubject, storedHeroFor, sha1Of } = await import("./photo-request.server.ts");
  const { measurePhoto, sitePhotoText } = await import("./hero-pick.server.ts");
  const { fetchPhoto, goodPhotos, imageSize, imagesEnabled } = await import("./images.server.ts");
  const { googleImages, photoSearchEnabled, photoSearchMode } = await import("./google-photo.server.ts");
  const { placeOf } = await import("./web-photo.ts");
  const deadline = Date.now() + 45_000;
  const heroName = site.pages.find((p) => p.slug === "home")?.sections?.[0]?.image;
  const heroImg = heroName ? site.images?.[heroName] : undefined;
  const heroBytes = heroName ? await readImage(site.id, heroName) : undefined;
  // The photo the hero shows now (and the stored copy it was made from): never offered as the "new" photo.
  const origin = heroImg?.heroOf ? site.images?.[heroImg.heroOf] : undefined;
  const originBytes = heroImg?.heroOf ? await readImage(site.id, heroImg.heroOf) : undefined;
  const specific = (t?: string) => (t && t.trim().length >= 15 && t.trim() !== site.name && t.trim() !== site.facts?.name ? [t] : []);
  const current = {
    urls: [heroImg?.sourceUrl, heroImg?.temporary?.imageUrl, heroImg?.temporary?.sourcePage, heroImg?.credit?.sourceUrl, origin?.sourceUrl].filter((u): u is string => Boolean(u)),
    hash: heroBytes ? measurePhoto(heroBytes.bytes, heroBytes.type)?.hash : undefined,
    sha1: [heroBytes, originBytes].flatMap((b) => (b ? [sha1Of(b.bytes)] : [])),
    captions: [...specific(heroImg?.alt), ...specific(heroImg?.shows), ...specific(heroImg?.credit?.title)],
  };
  type Own = Parameters<typeof findRequestedPhoto>[2]["own"][number];
  const own: Own[] = [];
  const asPhoto = (url: string, b: { bytes: Buffer; type: string }) => {
    const size = imageSize(b.bytes) ?? { width: 0, height: 0 };
    return { url, bytes: b.bytes, type: b.type, ...size };
  };
  // Round 9b: every usable photo the round-9 deep crawl found on the site (not just the hero-sized few), wide enough
  // for a hero (≥800px, not portrait). Cached from round 1 on this server; re-read within a time box otherwise.
  let scanNote = "";
  if (site.facts) {
    const facts = site.facts;
    const tScan = Date.now();
    const sitePhotos = await Promise.race([goodPhotos(facts, 40).catch(() => []), new Promise<[]>((r) => setTimeout(() => r([]), 15_000))]);
    const wide = sitePhotos.filter((p) => p.width >= 800 && p.width / p.height >= 1);
    scanNote = `deep crawl: ${sitePhotos.length} usable site photos, ${wide.length} wide enough for a hero, ${Date.now() - tScan}ms`;
    for (const p of wide.slice(0, 30)) {
      const caption = facts.imageText?.[p.url] || sitePhotoText(p.url, facts);
      own.push({ id: p.url, from: "your site", caption, photo: p, hash: measurePhoto(p.bytes, p.type)?.hash, level: 0, caption_match: "none" });
    }
  }
  // The photos the other looks already show.
  for (const o of others) {
    const name = o.pages.find((p) => p.slug === "home")?.sections?.[0]?.image;
    const img = name ? o.images?.[name] : undefined;
    const bytes = name ? await readImage(o.id, name) : undefined;
    if (!img || !bytes) continue;
    const id = img.sourceUrl ?? img.temporary?.imageUrl ?? img.credit?.sourceUrl ?? `${o.id}/${name}`;
    const caption = [img.temporary?.title, img.alt, img.shows, img.credit?.title].filter(Boolean).join(" · ") || "photo";
    own.push({ id, from: "another look", caption, photo: asPhoto(id, bytes), hash: measurePhoto(bytes.bytes, bytes.type)?.hash, level: 0, caption_match: "none", ...(img.credit ? { credit: img.credit } : {}) });
  }
  console.info(`[photo-search] requested photo “${req.subject}”: current hero ${heroName ?? "?"} (${current.urls.length} URL(s), ${current.sha1.length} file hash(es), ${current.hash ? "image hash" : "no image hash"}, ${current.captions.length} caption(s)) excluded first · ${scanNote || "no site facts"}`);
  const { aiAvailable, isMockMode } = await import("@/lib/ai-provider.server");
  const useVision = process.env.PREVIEW_PHOTO_VISION !== "0" && !isMockMode() && aiAvailable();
  const result = await findRequestedPhoto(req, site.facts ? placeOf(site.facts) : undefined, { own, current }, {
    search: googleImages,
    fetch: (u) => fetchPhoto(u),
    hash: (b, t) => measurePhoto(b, t)?.hash,
    judge: useVision ? judgeSubject : undefined,
    log: (l) => console.info(l),
  }, { deadline, googleEnabled: photoSearchEnabled() });
  const tFind = Date.now() - t0;
  // Last guard: the picked picture must really differ from the current one.
  if (result.pick && current.sha1.includes(sha1Of(result.pick.photo.bytes))) {
    console.info(`[photo] requested “${result.label}”: the pick is the current photo; dropped`);
    result.pick = undefined;
    result.match = "nothing";
  }
  if (result.pick) {
    console.info(`[timing] photo request: ${tFind}ms (found a real photo)`);
    const via = photoSearchMode()?.mode === "proxy" ? "photo-search proxy" : "Serper";
    const image = storedHeroFor(result.pick, via);
    if (result.pick.from === "your site") image.sourceUrl = result.pick.id;
    return { bytes: result.pick.photo.bytes, type: result.pick.photo.type, image, note: result.note, label: result.label, match: result.match };
  }
  // No real photo shows it: an Imagine illustration of the request, clearly labeled, when one makes sense.
  if (imagesEnabled() && illustrationFits(req) && process.env.PREVIEW_REQUEST_ILLUSTRATION !== "0" && Date.now() < deadline + 15_000) {
    const { generateImage } = await import("@/lib/ai-provider.server");
    const { heroBrief } = await import("./hero-brief.ts");
    const prompt = illustrationPrompt(req, site.facts ? placeOf(site.facts) : undefined, site.facts ? heroBrief(site.facts).kind : undefined);
    const tImg = Date.now();
    const art = await generateImage({ prompt, aspect: "16:9", timeoutMs: 45_000, guard: false }).catch(() => undefined);
    if (art && /^image\/(jpeg|png|webp)$/.test(art.type)) {
      const note = photoOutcomeNote(req, "illustrated");
      console.info(`[imagine] requested “${result.label}”: no real photo shows it → illustration by Grok Imagine in ${((Date.now() - tImg) / 1000).toFixed(1)}s (${Math.round(art.bytes.length / 1024)} KB) · card: ${note}`);
      console.info(`[timing] photo request: ${Date.now() - t0}ms (search ${tFind}ms + illustration ${Date.now() - tImg}ms)`);
      const size = imageSize(art.bytes);
      const image: StoredImage = { name: "hero", type: art.type, source: "generated", imagine: true, alt: `Illustration of a ${req.subject}`, ...(size ?? {}) };
      return { bytes: art.bytes, type: art.type, image, note, label: result.label, match: "illustrated" };
    }
    console.info(`[imagine] requested “${result.label}”: illustration failed; the current photo is kept`);
  } else if (!illustrationFits(req)) console.info(`[photo] requested “${result.label}”: an illustration would not fit this request; the current photo is kept`);
  console.info(`[timing] photo request: ${Date.now() - t0}ms (kept the current photo)`);
  return { note: photoOutcomeNote(req, "nothing"), label: result.label, match: "nothing" };
}

/** The card's Photo line for a hero the owner asked to change. */
function heroChangeLine(r: { image: StoredImage; match: PhotoOutcome; note: string }): string {
  if (r.match === "illustrated") return `${r.note} · as you asked`;
  if (r.image.temporary) return "Photo: from Google Images (preview only, replaced when your site is built) · as you asked";
  if (r.image.source === "web") return `Photo: ${r.image.credit?.title ? `“${r.image.credit.title.slice(0, 50)}” ` : ""}(${r.image.credit?.provider ?? "web"}, free license) · as you asked`;
  return `Photo: your site's own${r.image.alt ? ` (“${r.image.alt.slice(0, 50)}”)` : ""} · as you asked`;
}

/**
 * Three stored edits of `stored` (as asked, a half step more, a full step more), each a full look the owner
 * can preview and choose. Everything but the requested change is copied as is.
 */
export async function buildEdits(stored: StoredSite, edit: LookEdit, feedback: string[], lender?: StoredSite, others: StoredSite[] = []): Promise<EditedLook[]> {
  const { newPageId, readImage, saveImage, saveSite } = await import("@/lib/pages.server");
  const design = stored.design!;
  const borrowed = lender && edit.borrow ? edit.borrow.assets : [];
  const lenderName = lender ? (lender.design?.tune?.base.name ?? lender.design?.name ?? lender.name) : "";
  // Colors borrowed from another look become this look's new base (later tweaks are computed from them).
  const basePalette = borrowed.includes("palette") && lender ? { ...lender.palette } : (design.tune?.base.palette ?? stored.palette);
  const base: LookTune["base"] = { ...(design.tune?.base ?? { palette: stored.palette, motifs: [...design.motifs], name: design.name }), palette: basePalette };
  // An explicit style switch from the card's own box ("make it Bold Photo"): same photo, copy, colors and sections,
  // in the new style's type, motifs, corners and buttons; the card then goes by the new style's name.
  const { PRESETS } = await import("./design.ts");
  const { lookName } = await import("./archetype-label.ts");
  const preset = edit.restyle && !stored.custom ? PRESETS[edit.restyle] : undefined;
  if (preset) {
    base.name = lookName(preset.archetype);
    base.motifs = [...preset.motifs];
  }
  const intensity = edit.adjustments.length > 0;
  // The from-scratch look is edited once, in place, by Grok (no three variations: each would be a full AI call).
  const scales = intensity ? (stored.custom ? [variationScales(edit.adjustments)[0]] : variationScales(edit.adjustments)) : [1];
  // The lender's hero photo (bytes + credit), when the owner asked to use its picture here.
  const lenderHero = borrowed.includes("photo") && lender ? lender.pages.find((p) => p.slug === "home")?.sections?.[0]?.image : undefined;
  const lenderBytes = lender && lenderHero ? await readImage(lender.id, lenderHero) : undefined;
  const lenderImage = lender && lenderHero ? lender.images?.[lenderHero] : undefined;
  const home = stored.pages.find((p) => p.slug === "home");
  const heroSection = home?.sections?.[0];
  const photoHero = heroSection?.type === "hero-photo";
  // Where the headline sits over the photo: the left side (cinematic) or the lower part (full-bleed).
  const cinematic = photoHero && design.heroStyle === "cinematic";
  const heroName = heroSection?.image;
  const heroBytes = lenderBytes ?? (heroName ? await readImage(stored.id, heroName) : undefined);
  const luma = heroBytes ? heroLuma(heroBytes.bytes, heroBytes.type, cinematic ? { x0: 0, x1: 0.5, y0: 0.2, y1: 0.85 } : { x0: 0, x1: 1, y0: 0.45, y1: 0.95 }) : undefined;
  const out: EditedLook[] = [];
  // A requested photo is found once (by the owner's own words) and shared by the steps.
  const requested = hero0(stored) && edit.photoRequest ? await findRequestHero(stored, edit.photoRequest, others.filter((o) => o.id !== stored.id)) : undefined;
  for (const [step, scale] of scales.entries()) {
    const id = newPageId();
    await copyImages(stored, id);
    const levels = addLevels(design.tune?.levels, edit.adjustments, scale);
    const numbers = tuneNumbers(levels);
    const scrimMin = photoHero ? scrimFloor(luma, numbers.brightness, cinematic ? 0.72 : 0.8) : 0;
    const palette = intensity ? tunePalette(base.palette, levels) : borrowed.includes("palette") ? { ...base.palette } : stored.palette;
    const notes: string[] = [];
    const pages = stored.pages.map((p) => ({ ...p, sections: p.sections?.map((s) => ({ ...s })) }));
    const hero = pages.find((p) => p.slug === "home")?.sections?.[0];
    if (hero && edit.copy?.headline) {
      hero.heading = edit.copy.headline;
      notes.push("new headline");
    }
    if (hero && edit.copy?.lead) {
      hero.text = edit.copy.lead;
      notes.push("new intro text");
    }
    const images: Record<string, StoredImage> = { ...(stored.images ?? {}) };
    if (hero && lenderBytes) {
      await saveImage(id, "hero", lenderBytes.type, lenderBytes.bytes);
      images.hero = { ...(lenderImage ?? { source: "photo", alt: "" }), name: "hero", type: lenderBytes.type };
      hero.image = "hero";
      notes.push(`photo from “${lenderName}”`);
    }
    if (borrowed.includes("palette")) notes.push(`colors from “${lenderName}”`);
    let fonts = design.fonts;
    if (borrowed.includes("fonts") && lender?.design) {
      fonts = { ...lender.design.fonts };
      notes.push(`fonts from “${lenderName}”`);
    }
    if (preset) {
      if (!borrowed.includes("fonts")) fonts = { ...preset.fonts };
      notes.push(`style switched to ${base.name}, as asked (same photo, words and colors)`);
    }
    if (hero && requested) {
      if ("bytes" in requested) {
        await saveImage(id, "hero", requested.type, requested.bytes);
        images.hero = requested.image;
        hero.image = "hero";
      }
      notes.push(requested.note);
    } else if (hero && edit.photo) {
      const found = await findEditPhoto(stored, edit.photo, step);
      if (found) {
        await saveImage(id, "hero", found.type, found.bytes);
        images.hero = found.image;
        hero.image = "hero";
        notes.push(`new photo: ${edit.photo}`);
      } else notes.push(`couldn't find a photo of “${edit.photo}”, kept the current one`);
    }
    const photoLabel = requested && edit.photoRequest ? photoVariantLabel(edit.photoRequest, requested.match) : undefined;
    const variant = variantLabel(edit.adjustments, Math.min(step, 2) as 0 | 1 | 2, photoLabel ?? (!intensity ? notes[0] : undefined));
    const changed = changedLine(edit.adjustments, scale, photoHero, notes);
    const tune: LookTune = { levels, base, scrimMin: Math.round(scrimMin * 1000) / 1000, variant, changed };
    const site: StoredSite = {
      ...stored,
      id,
      createdAt: new Date().toISOString(),
      palette,
      fonts: borrowed.includes("fonts") || preset ? fonts : stored.fonts,
      design: {
        ...design,
        ...(preset ? { archetype: preset.archetype, name: base.name, radius: preset.radius, buttons: preset.buttons } : {}),
        palette,
        fonts,
        motifs: (levels["less-busy"] ?? 0) > 0 ? [] : (base.motifs as typeof design.motifs),
        tune,
      },
      images,
      pages,
      facts: stored.facts ? { ...stored.facts, feedback } : stored.facts,
      trace: stored.trace
        ? {
            ...stored.trace,
            request: { ...stored.trace.request, feedback },
            // Round 9b: the Photo line follows a changed hero (an unchanged one keeps its line).
            ...(requested && "bytes" in requested ? { heroChange: heroChangeLine(requested) } : {}),
            steps: [...stored.trace.steps, { step: `edit of “${base.name}” (${edit.how ?? "named"}; read by ${edit.from})${borrowed.length ? ` · borrowed ${borrowed.join(" + ")} from “${lenderName}” (${lender!.id})` : ""}`, ai: edit.from === "AI planner", ownerRequest: true }],
          }
        : stored.trace,
    };
    if (stored.custom && !design.custom?.failed) {
      const { editCustom } = await import("./custom-design.server.ts");
      const { aiAvailable, isMockMode } = await import("@/lib/ai-provider.server");
      const request = feedback.at(-1) ?? "";
      const done = await editCustom(stored, palette, request, edit.adjustments.map((a) => `${a.type} (${a.amount})`), aiAvailable() && !isMockMode());
      site.custom = done.design;
      site.palette = done.palette;
      site.design = { ...site.design!, palette: done.palette };
      tune.changed = `${changed} · ${done.how}`;
    }
    await saveSite(site);
    const n = tuneNumbers(levels, tune.scrimMin);
    out.push({
      site,
      variant,
      changed: tune.changed ?? changed,
      measured: { backgroundBefore: relLumOf(base.palette.background), backgroundAfter: relLumOf(palette.background), scrim: n.scrim, brightness: n.brightness },
    });
    console.info(
      `[refine] edited “${base.name}” (${stored.id} -> ${id}) ${variant}${borrowed.length ? ` · borrowed ${borrowed.join(" + ")} from “${lenderName}” (${lender!.id})` : ""}: ${JSON.stringify(levels)} · bg ${base.palette.background}->${palette.background} · scrim ${n.scrim}${scrimMin ? ` (AA floor ${tune.scrimMin}, hero luma p80 ${luma?.toFixed(2)})` : ""} · photo brightness ${n.brightness}`,
    );
  }
  return out;
}

function relLumOf(hex: string): number {
  const c = hex.replace("#", "").match(/../g)!.map((x) => {
    const s = parseInt(x, 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return Math.round((0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!) * 10000) / 10000;
}

export type { Adjustment };
