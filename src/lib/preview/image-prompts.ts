/**
 * Image-generation prompts. Pure (no I/O) so tests can check them.
 *
 * The owner's request comes FIRST: when their words name a scene, subject or place ("use the brick
 * streets"), the hero photo must depict it; their wishes are also given to every other image. Prompts never
 * include the business name (models love to paint it as a fake logo).
 */
import { TEMP_PHOTO_LINE } from "./google-photo.ts";
import { imageWishes, requestedPhoto, sceneToFind } from "./owner-request.ts";
import { creditLine, placeOf } from "./web-photo.ts";
import type { DesignDirection, PreviewTrace, SiteFacts } from "./types.ts";

const TRADES: [RegExp, string][] = [
  [/plumb|drain|sewer|water heater/i, "plumbing company"],
  [/roof/i, "roofing company"],
  [/hvac|heating|air condition|furnace/i, "heating and air-conditioning company"],
  [/electric/i, "electrical contractor"],
  [/landscap|lawn|garden|tree service/i, "landscaping company"],
  [/dentist|dental|orthodont/i, "dental practice"],
  [/attorney|law firm|lawyer|legal/i, "law firm"],
  [/restaurant|bistro|kitchen|grill|pizza|taco|sushi/i, "restaurant"],
  [/bakery|cafe|coffee/i, "cafe"],
  [/salon|barber|spa\b|nails/i, "salon"],
  [/clean|maid|janitor/i, "cleaning company"],
  [/auto|mechanic|collision|tire/i, "auto repair shop"],
  [/fitness|gym|yoga|pilates/i, "fitness studio"],
  [/paint/i, "painting company"],
  [/pest|exterminat/i, "pest control company"],
  [/construct|remodel|contractor|builder/i, "construction company"],
  [/start(?:ing)?\s+(?:a|your)\s+(?:own\s+)?business|startups?\b|start-ups?\b|founders?\b|entrepreneur|incubator|accelerator|coworking|co-working/i, "community for startup founders and small-business owners"],
];

/** Scraped "services" that are really merch, shop items or page furniture ("Bob.me Golf Hat", "Specs", "Report"). */
const NOT_A_SERVICE = /\b(?:hats?|caps?|shirts?|t-shirts?|tees?|hoodies?|mugs?|stickers?|merch(?:andise)?|swag|gift\s+cards?|specs?|description|report|forum|login|log\s+in|sign\s+(?:in|up)|cart|checkout|terms|privacy|cookies?|reviews?|faqs?|home|menu|search)\b/i;

/** Words of the business name ("bob", "me" for "Bob.me"): never evidence a photo is about the business. */
export function nameWords(facts: Pick<SiteFacts, "name" | "host">): string[] {
  const host = (facts.host || "").replace(/^www\./, "").replace(/\.[a-z]{2,}$/i, "");
  return [...new Set(`${facts.name || ""} ${host}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2))];
}

/** The site's real services: no merch/shop items, no page furniture, none that are just the brand name + a product. */
export function realServices(facts: Pick<SiteFacts, "services" | "name" | "host">): string[] {
  const brand = nameWords(facts);
  return facts.services.filter((s) => {
    const words = s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.length || NOT_A_SERVICE.test(s)) return false;
    // "Bob.me Golf Hat": the brand plus a product name is a shop item, not what the business does.
    return !(words.some((w) => brand.includes(w)) && words.length <= 4);
  });
}

/** "City of Pauls Valley": a town's own site, where the place itself is the subject. */
export function isCivic(facts: Pick<SiteFacts, "name" | "address">): boolean {
  if (/^(?:the )?(?:city|town|village|county|borough) of\b/i.test(facts.name || "")) return true;
  // "Pauls Valley, Oklahoma": the site's name is just its town.
  const place = placeOf(facts);
  const bare = (facts.name || "").toLowerCase().replace(/[^a-z ]/g, " ").replace(new RegExp(`\\b${(place?.state ?? "#").toLowerCase()}\\b`), " ").replace(/\s+/g, " ").trim();
  return Boolean(place?.city && bare === place.city.toLowerCase());
}

export function businessKind(facts: SiteFacts): string {
  if (isCivic(facts)) return "small-town city website";
  if (facts.industry) return facts.industry;
  const services = realServices(facts);
  const text = [facts.name, facts.tagline, facts.description, ...services.slice(0, 6)].filter(Boolean).join(" ");
  const trade = TRADES.find(([pattern]) => pattern.test(text));
  return trade?.[1] ?? (services[0] || "local business");
}

function withoutName(text: string, facts: SiteFacts): string {
  return facts.name && facts.name.length > 2 ? text.split(facts.name).join("the business") : text;
}

/** The scene for a slot: the owner's requested scene wins for the hero; then the look's own scene. */
export function sceneFor(slot: "hero" | "feature" | "service", facts: SiteFacts, design: DesignDirection, subject = ""): string {
  // A subject to keep from the owner's site is never painted by AI (it would be a substitute, not theirs).
  const asked = sceneToFind(facts);
  if (slot === "hero") return asked || design.heroSubject || "";
  if (slot === "feature") return design.featureScene || "";
  return subject;
}

/** " in Pauls Valley, Oklahoma" when the business's town is known (a scene "of our town" should look like it). */
function where(scene: string, facts: SiteFacts): string {
  const place = placeOf(facts);
  if (!place || scene.toLowerCase().includes(place.city.toLowerCase())) return "";
  return ` in ${place.city}${place.state ? `, ${place.state}` : ""}`;
}

export function imagePrompt(slot: "hero" | "feature" | "service", facts: SiteFacts, design: DesignDirection, subject = ""): string {
  const kind = businessKind(facts);
  const style = `Art direction: ${design.imagery} Mood: ${design.mood}`.slice(0, 600);
  const asked = sceneToFind(facts);
  const wishes = requestedPhoto(facts).intent === "keep" ? "" : imageWishes(facts);
  const owner = wishes ? ` The business owner's request (top priority for what the photo shows, as long as it has no text or logos): "${wishes}".` : "";
  let body: string;
  if (slot === "hero") {
    const scene = sceneFor("hero", facts, design);
    body = asked
      ? // The look's own hero idea is used only when it already shows the requested scene (an idea about pipes would win otherwise).
        `The photo MUST clearly show: ${design.heroSubject && design.heroSubject.toLowerCase().includes(asked.toLowerCase()) ? design.heroSubject : asked}@@WHERE@@. Make ${asked} the main subject${isCivic(facts) ? "" : `, not ${kind} tools or equipment`}. Photorealistic website hero background photograph for a ${kind}, golden-hour light, wide composition with calm negative space for a headline, no text.`
      : `${scene || `A striking, authentic scene that represents a ${kind}`}. Website hero photograph for a ${kind}. Wide composition with calm negative space for a headline.`;
  } else if (slot === "feature") {
    const scene = sceneFor("feature", facts, design);
    body = scene
      ? `${scene}. Authentic photograph for a ${kind}, natural candid framing.`
      : `Authentic behind-the-scenes photograph of skilled ${kind} work in progress, details of tools, materials and craft, natural candid framing.`;
  } else {
    body = `Photograph illustrating "${subject}" for a ${kind}. Clear single subject, editorial product-style composition.`;
  }
  // The place goes in after the name is removed: a town's own site has the place in its name.
  return withoutName(`${body}${owner} ${style}`, facts).replace("@@WHERE@@", slot === "hero" && asked ? where(asked, facts) : "");
}

/** "the rocket" -> "rocket", "our old trucks" -> "old trucks". */
function bare(subject: string): string {
  return subject.replace(/^(?:the|a|an|my|our|your)\s+/i, "");
}

/** "the rocket" -> "a rocket", "the brick streets" -> "the brick streets" (plural stays definite), "the owl" -> "an owl". */
function aOrSome(subject: string): string {
  const b = bare(subject);
  if (/s$/i.test(b.split(/\s+/).pop() ?? "") && !/ss$/i.test(b)) return `the ${b}`;
  return `${/^[aeiou]/i.test(b) ? "an" : "a"} ${b}`;
}

/** The small "Photos: …" line on a look card, read from the build trace. */
export function photosLine(trace: PreviewTrace | undefined, ownPhotos: number): string {
  const hero = trace?.images.find((i) => i.slot === "hero");
  const scene = trace?.request.scene;
  const own = ownPhotos ? `${ownPhotos} of your photos` : "no usable photos from your site";
  if (trace?.request.intent === "keep" && scene) {
    if (hero?.status === "kept from your site") return `Photo: kept your ${bare(scene)} from your site, as you asked`;
    const other = trace.images.find((i) => i.slot === "hero" && i !== hero);
    const instead = other?.status === "generated" ? "the hero has an AI photo of this look's own idea" : ownPhotos ? "the hero uses your site's best photo" : "the hero has no photo";
    return `Couldn't find ${aOrSome(scene)} on your site to keep, and no web or AI ${bare(scene)} was swapped in · ${instead}`;
  }
  if (!hero) return `Photos: ${own}${scene ? "" : " (the note didn't name a photo subject)"}`;
  const what = scene ? `“${scene}”` : `“${hero.scene.slice(0, 60)}”`;
  if (hero.status === "preview photo (Google Images)") return TEMP_PHOTO_LINE;
  if (hero.status === "your site's photo") return `Photo: your site's own photo of ${what}${hero.credit?.title ? ` (“${hero.credit.title.slice(0, 50)}”)` : ""}`;
  if (hero.status === "web photo" && hero.credit) return `Photo: ${creditLine(hero.credit)}`;
  if (hero.status === "generated") return `AI photo of ${what}${scene ? " (no matching photo on your site or free photo sites)" : ""}`;
  if (hero.status === "failed") return `Photos: no photo of ${what} found and generating one failed, so the hero has ${scene ? "a plain background" : ownPhotos ? "your site's photo" : "a placeholder"}`;
  return `Photos: no photo of ${what} found; would generate one (mock mode / AI images off) · ${own}`;
}
