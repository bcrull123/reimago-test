/**
 * Proactive photo searches for the first round (no note needed): 2-3 Google Images queries describing the kinds
 * of photos that fit this business and place. The AI planner writes them from the scrape ("downtown Pauls Valley
 * Oklahoma brick streets", "Pauls Valley Oklahoma landmark"); without AI they come from the business type and town.
 */
import { businessKind, isCivic } from "./image-prompts.ts";
import { placeOf } from "./web-photo.ts";
import type { SiteFacts } from "./types.ts";

const SIGNISH_QUERY = /\b(?:welcome|sign|signs|signage|logo|logos|seal|emblem|flag|map|maps|city\s+limits?|plaque|marker|banner|clip\s*art|icon|vector)\b/i;

/** Clean planner output: 2-3 short plain queries (no search operators, no quotes, no URLs). */
export function cleanImageQueries(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\n|;|\|/) : [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const q = item
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/\b(?:site|inurl|intitle|filetype):\S*/gi, " ")
      .replace(/["“”'`*_#<>{}[\]\\]/g, " ")
      .replace(/^[\s\-–•\d.)]+/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (q.length < 4 || q.length > 80 || q.split(" ").length < 2) continue;
    // Searches that come back as signs, logos and maps make bad heroes ("welcome to Pauls Valley", "city seal").
    if (SIGNISH_QUERY.test(q)) continue;
    if (!out.some((x) => x.toLowerCase() === q.toLowerCase())) out.push(q);
    if (out.length === 3) break;
  }
  return out;
}

/** Queries without AI: the business type in its town, and what such a business looks like at work. */
export function defaultImageQueries(facts: SiteFacts): string[] {
  const place = placeOf(facts);
  const where = place ? `${place.city} ${place.state}`.trim() : "";
  // A town: its best-looking scenes (downtown, historic district, main street), never its name alone (signs).
  if (isCivic(facts) && place) return cleanImageQueries([`downtown ${where}`, `${place.city} historic district`, `${where} main street`]);
  const trade = businessKind(facts);
  const kind = /^(other|local business)$/i.test(trade) ? facts.services[0] || "" : trade;
  if (!kind) return where ? cleanImageQueries([`downtown ${where}`]) : [];
  // A business: its work, its storefront, its team, in its setting.
  const worker = WORKER[kind.toLowerCase()];
  return cleanImageQueries([
    worker ? `${worker} at work` : `${kind} at work`,
    where ? `${kind} storefront ${place!.city}` : `${kind} storefront`,
    worker ? `${worker} team ${where}`.trim() : `${kind} team ${where}`.trim(),
  ]);
}

/** The person doing the work, for the business types whose photos are best of people at work. */
const WORKER: Record<string, string> = {
  plumbing: "plumber",
  "plumbing company": "plumber",
  plumber: "plumber",
  electrical: "electrician",
  electrician: "electrician",
  roofing: "roofer",
  hvac: "hvac technician",
  landscaping: "landscaper",
  bakery: "baker",
  "auto repair": "mechanic",
  salon: "hair stylist",
  barbershop: "barber",
  dental: "dentist",
  "law firm": "lawyer",
};
