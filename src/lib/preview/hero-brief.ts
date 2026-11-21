/**
 * What a great homepage hero looks like for THIS kind of business (pure, no I/O).
 *
 * Bob: "remember we have to have this work on other kinds of sites like business sites so be flexible." The hero
 * quality gate is not a list of town rules: the business type (read from the site's industry, name, tagline and
 * services) picks a brief — what a designer would put in the hero, and what is off-topic for it — and the vision
 * model rates every candidate photo against that brief (1-10). The generic rules (low quality, dim, cluttered,
 * signs/logos, stock-looking, off-topic) apply to every business.
 */
import { businessKind, isCivic, nameWords, realServices } from "./image-prompts.ts";
import { placeOf } from "./web-photo.ts";
import type { SiteFacts } from "./types.ts";
import { wantsVintage } from "./era-style.ts";

export type HeroCategory =
  | "town"
  | "restaurant"
  | "trades"
  | "legal-finance"
  | "medical"
  | "retail"
  | "beauty"
  | "real-estate"
  | "nonprofit"
  | "tech"
  | "startup-community"
  | "fitness"
  | "auto"
  | "hospitality"
  | "general";

export type HeroBrief = {
  category: HeroCategory;
  /** "plumbing company in Oklahoma City, Oklahoma". */
  kind: string;
  /** What a great hero shows for this kind of business (given to the vision rating). */
  good: string;
  /** What is off-topic or unflattering for this kind of business (given to the vision rating). */
  avoid: string;
  /** No-AI fallback: titles/alt text that are off-topic for this kind of business. */
  offTopic: RegExp;
  /** Round 13: the owner asked for something vintage / a period look, so old photos are welcome. */
  allowVintage?: boolean;
  /** Scenes to search for (Google Images / free-license photos), best first; {city} {state} {service} filled in. */
  scenes: string[];
};

/** Low-quality / unflattering for ANY business (titles, alt text, file names, vision labels). */
export const LOW_QUALITY =
  /\b(?:clutter(?:ed)?|mess(?:y)?|debris|trash|garbage|dumpster|junk|screenshots?|diagram|chart|infographic|clip\s*art|clipart|icon|watermark(?:ed)?|blurry|blurred|out\s+of\s+focus|pixelated|low[\s-]res(?:olution)?|placeholder|stock\s+photo|power\s+lines?|utility\s+poles?|telephone\s+poles?|wires|gravel\s+lot|parking\s+lots?|parking\s+garage|rv\s+park|empty\s+lot|vacant\s+lot|chain[\s-]link\s+fence|portable\s+toilet|porta[\s-]potty|storage\s+room|boiler\s+room|document|pdf|agenda|map)\b/i;

/** For EVERY business: a photo that is old/archival or a portrait of some unrelated person is never on-brand. */
const UNRELATED = /\b(?:1[89]\d\d|vintage|archival|historical\s+photo|portrait\s+of|cowboy)\b/i;

const BRIEFS: { category: HeroCategory; match: RegExp; good: string; avoid: string; offTopic: RegExp; scenes: string[] }[] = [
  {
    category: "startup-community",
    match: /start(?:ing)?\s+(?:a|your)\s+(?:own\s+)?business|startups?\b|start-ups?\b|founders?\b|entrepreneur|incubator|accelerator|coworking|co-working|business\s+community|small[\s-]business\s+(?:help|resources|owners)/i,
    good: "founders and small-business owners building something together: a bright modern coworking space, an energetic meetup or workshop, a team around a laptop or whiteboard, or a launch/rocket metaphor; optimistic, modern, colorful",
    avoid: "unrelated people or portraits, vintage or archival photos, anything that only matches a word in the brand name, empty offices, generic clip-art, signage",
    offTopic: /\b(?:portrait|vintage|archival|1[89]\d\d|cowboy|old\s+man|elderly|golf\s+hat|hat)\b/i,
    scenes: ["startup founders working together", "entrepreneurs community meetup", "modern coworking space"],
  },
  {
    category: "restaurant",
    match: /restaurant|bistro|kitchen|grill|pizza|taco|sushi|diner|eatery|bbq|barbecue|steak|cafe|caf[eé]|coffee|bakery|brew|winery|bar\b|pub\b|food/i,
    good: "a warm, inviting dining room or patio, beautifully plated signature dishes, drinks, or the bustle of the open kitchen, in appetizing light",
    avoid: "empty parking lots, building exteriors with signage only, menus or text, dim or greasy-looking food, stock-looking generic food, back-of-house storage",
    offTopic: /\b(?:menu|parking|exterior\s+sign|storefront\s+sign|kitchen\s+equipment|freezer|storage)\b/i,
    scenes: ["{service} plated dish", "restaurant dining room {city}", "{city} {state} restaurant patio"],
  },
  {
    category: "trades",
    match: /plumb|drain|sewer|water heater|roof|hvac|heating|air condition|furnace|electric|landscap|lawn|tree service|paint|pest|exterminat|construct|remodel|contractor|builder|handyman|concrete|fenc|gutter|clean|maid|janitor|pool|garage door|window|floor|cabinet/i,
    good: "finished, beautiful work (a spotless modern bathroom or kitchen, a new roof, a manicured yard, a bright finished room) or a professional technician or crew at work in a clean, well-lit home",
    avoid: "clutter, dirty pipes or drains up close, debris, tool piles, damage or leaks, cramped dark crawlspaces, trucks parked in empty lots, logos and signage",
    offTopic: /\b(?:leak|clog|sewage|mold|damage|broken|rust|debris|crawl\s*space|dirty|truck\s+wrap|van\s+wrap|logo)\b/i,
    scenes: ["{service} finished modern home", "{service} technician at work in a home", "{city} {state} beautiful home"],
  },
  {
    category: "legal-finance",
    match: /attorney|law firm|lawyer|legal|account|cpa|tax|financ|wealth|advis|insur|bank|consult/i,
    good: "a refined modern office or conference room, a confident professional team, a handshake or client meeting, or a striking skyline or landmark of their city",
    avoid: "gavels and scales clip-art, stock-looking cheesy handshakes, paperwork close-ups, empty corridors, signage",
    offTopic: /\b(?:gavel|scales\s+of\s+justice|paperwork|calculator|piggy\s+bank)\b/i,
    scenes: ["{city} {state} skyline", "modern law office conference room", "professional team meeting office"],
  },
  {
    category: "medical",
    match: /dentist|dental|orthodont|clinic|medical|doctor|physician|chiropract|therapy|therap|physio|pediatric|vision|optometr|veterin|vet\b|health/i,
    good: "a bright, calm modern clinic or treatment room, a friendly practitioner with a smiling patient, or a welcoming reception area",
    avoid: "needles, instruments up close, blood, X-rays, sterile empty hallways, signage",
    offTopic: /\b(?:needle|syringe|x-?ray|blood|surgery|scalpel|drill)\b/i,
    scenes: ["modern {service} clinic interior", "friendly {service} with patient", "{city} {state} clinic"],
  },
  {
    category: "beauty",
    match: /salon|barber|spa\b|nails|beauty|lash|brow|makeup|stylist|massage/i,
    good: "a stylish, well-lit salon or spa interior, a stylist at work on a happy client, or a beautiful finished look",
    avoid: "product shelves with labels, cluttered stations, close-ups of hair on the floor, signage",
    offTopic: /\b(?:product\s+shelf|hair\s+on\s+the\s+floor|price\s+list)\b/i,
    scenes: ["stylish {service} salon interior", "{service} stylist with client", "{city} salon"],
  },
  {
    category: "real-estate",
    match: /real estate|realtor|realty|homes for sale|property|properties|mortgage|apartment|leasing/i,
    good: "a beautiful home exterior at golden hour, a bright staged interior, or an attractive neighborhood or skyline of their area",
    avoid: "for-sale signs, floor plans, keys clip-art, empty lots",
    offTopic: /\b(?:for\s+sale\s+sign|floor\s*plan|keys)\b/i,
    scenes: ["beautiful home {city} {state}", "{city} {state} neighborhood", "bright modern living room"],
  },
  {
    category: "retail",
    match: /shop|store|boutique|retail|gift|florist|flower|jewel|furniture|apparel|clothing|book/i,
    good: "an attractive shop interior with well-merchandised products, a hero product shot, or a welcoming storefront on a lively street",
    avoid: "price tags, empty shelves, clearance signs, cluttered storage",
    offTopic: /\b(?:price\s+tag|clearance|empty\s+shelves)\b/i,
    scenes: ["{service} boutique interior", "{service} product display", "{city} {state} shopping street"],
  },
  {
    category: "fitness",
    match: /fitness|gym|yoga|pilates|crossfit|martial|dance|studio/i,
    good: "an energetic class or athlete in action in a bright, modern studio or gym",
    avoid: "empty equipment rows, locker rooms, signage",
    offTopic: /\b(?:locker\s+room|empty\s+gym)\b/i,
    scenes: ["{service} class in a bright studio", "athlete training {service}", "{city} fitness studio"],
  },
  {
    category: "auto",
    match: /auto|mechanic|collision|tire|car wash|detailing|dealership|motor/i,
    good: "a gleaming car, a clean modern service bay, or a technician at work in good light",
    avoid: "grease, junk cars, oil stains, cluttered garages, signage",
    offTopic: /\b(?:junk(?:yard)?|wreck|oil\s+stain|grease)\b/i,
    scenes: ["{service} clean modern auto shop", "shiny car detail", "{city} {state} auto service"],
  },
  {
    category: "hospitality",
    match: /hotel|inn\b|motel|bed and breakfast|b&b|resort|lodge|venue|wedding|event|camp/i,
    good: "an inviting room, lobby, pool, venue or view in beautiful light",
    avoid: "hallways, parking lots, signage, unmade rooms",
    offTopic: /\b(?:hallway|corridor|unmade)\b/i,
    scenes: ["{service} {city} {state}", "inviting hotel room", "{city} {state} scenic view"],
  },
  {
    category: "nonprofit",
    match: /church|ministr|nonprofit|non-profit|foundation|charity|volunteer|school|academy|library|museum|association|club/i,
    good: "people engaged in the mission (volunteers, a community gathering, students, a service) or the organization's most attractive building or landmark",
    avoid: "empty rooms, documents, signage, logos, people at desks",
    offTopic: /\b(?:empty\s+room|document|newsletter)\b/i,
    scenes: ["{service} community event {city}", "volunteers {city} {state}", "{city} {state} landmark"],
  },
  {
    category: "tech",
    match: /software|saas|app\b|platform|cloud|data|ai\b|tech|startup|digital|agency|marketing|web design|it services/i,
    good: "a polished product shot or a modern, bright workspace with a team collaborating",
    avoid: "screenshots full of text, server racks, cables, generic stock clip-art",
    offTopic: /\b(?:server\s+rack|cables?|binary|code\s+on\s+screen)\b/i,
    scenes: ["modern office team collaborating", "{service} product on laptop", "{city} {state} tech office"],
  },
];

const TOWN: Omit<HeroBrief, "kind"> = {
  category: "town",
  good: "an attractive establishing shot of the place itself: its downtown or main street, historic buildings, best-known landmark, a scenic park, skyline or aerial view, in good light",
  avoid: "airports, utility or infrastructure (towers, poles, wires, water plants), parking or gravel lots, office or library interiors, people sitting at desks or in meetings, signs and seals",
  offTopic: /\b(?:airport|runway|hangar|antenna|substation|water\s+(?:plant|treatment)|industrial|pipes|pipelines?|valves?|machinery|pump\s+station|storage\s+tanks?|wastewater|landfill|council\s+meeting|meeting|desks?|office\s+interior|library\s+interior|people\s+sitting|reading\s+books|taking\s+notes|classroom|seal|agenda)\b/i,
  scenes: ["{city} {state} downtown historic main street", "{city} {state} landmark", "{city} {state} aerial view", "{city} {state} park", "{city} {state} courthouse", "{city} {state} festival"],
};

const GENERAL: Omit<HeroBrief, "kind"> = {
  category: "general",
  good: "the business at its best: its work, product, people or place, sharp and in good light, on-topic for what it sells",
  avoid: "signage and logos, empty rooms or lots, clutter, unrelated stock-looking scenes",
  offTopic: /\b(?:logo|sign)\b/i,
  scenes: ["{service} {city} {state}", "{service} at work", "{city} {state}"],
};

/** The brief for this site: its business type decides what a good hero is. */
export function heroBrief(facts: SiteFacts): HeroBrief {
  const place = placeOf(facts);
  const where = place ? ` in ${place.city}${place.state ? `, ${place.state}` : ""}` : "";
  if (isCivic(facts)) return { ...TOWN, kind: `the town's own website${where}` };
  const kind = businessKind(facts);
  const text = [facts.industry, kind, facts.tagline, facts.description, ...realServices(facts).slice(0, 6)].filter(Boolean).join(" ");
  const hit = BRIEFS.find((b) => b.match.test(kind)) ?? BRIEFS.find((b) => b.match.test(text));
  const brief = hit ?? GENERAL;
  // Old/archival photos and portraits of unrelated people are off-topic for every business.
  const vintage = wantsVintage(facts);
  // Round 13: when the owner asked for something vintage / a period look ("make it look 90s"), old photos are welcome.
  const stripVintage = (source: string) =>
    ["1[89]\\d\\d", "vintage", "archival"].reduce((acc, tok) => acc.split(`${tok}|`).join("").split(`|${tok}`).join(""), source);
  const offTopic = vintage ? new RegExp(stripVintage(brief.offTopic.source), "i") : new RegExp(`${brief.offTopic.source}|${UNRELATED.source}`, "i");
  const avoid = vintage ? brief.avoid.replace(/vintage or archival photos,?\s*/g, "") : brief.avoid;
  return { ...brief, offTopic, avoid, allowVintage: vintage || undefined, kind: `${kind}${where}` };
}

/** Search queries for the brief's scenes, filled with the site's town and its main service. */
export function briefQueries(facts: SiteFacts, brief: HeroBrief): string[] {
  const place = placeOf(facts);
  const service = (realServices(facts)[0] || businessKind(facts) || "").replace(/\s+/g, " ").trim().slice(0, 40);
  // Never search the brand name: "Bob.me" finds people called Bob (Bob's round 5: "Wolf River Bob 10-1974").
  const own = `${place?.city ?? ""} ${service} ${businessKind(facts)} ${facts.tagline}`.toLowerCase();
  const brand = nameWords(facts).filter((w) => !new RegExp(`\\b${w}\\b`).test(own));
  const unbrand = (q: string) => q.split(" ").filter((w) => !brand.includes(w.toLowerCase().replace(/[^a-z0-9]/g, ""))).join(" ");
  return [
    ...new Set(
      brief.scenes
        .map((s) =>
          s
            .replace("{city}", place?.city ?? "")
            .replace("{state}", place?.state ?? "")
            .replace("{service}", service)
            .replace(/\s+/g, " ")
            .trim(),
        )
        .map(unbrand)
        .filter((q) => q.split(" ").length >= 2),
    ),
  ];
}

const FILLER = /^(?:the|a|an|of|and|in|on|at|for|to|with|by|from|photo|image|picture|jpg|jpeg|png|file)$/;

/**
 * True when a photo's title shares only BRAND-name words with what we searched ("Wolf River Bob 10-1974" for
 * "Bob.me"): a name match is not evidence the photo is about the business, so it counts as off-topic.
 */
export function brandOnlyMatch(title: string, facts: Pick<SiteFacts, "name" | "host">, queries: string[]): boolean {
  const brand = new Set(nameWords(facts));
  const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !FILLER.test(w));
  const titleWords = words(title);
  if (!titleWords.some((w) => brand.has(w))) return false;
  const searched = new Set(queries.flatMap(words).filter((w) => !brand.has(w)));
  return !titleWords.some((w) => !brand.has(w) && (searched.has(w) || searched.has(w.replace(/s$/, "")) || searched.has(`${w}s`)));
}

/** One line about what the business actually does, for the vision rating (never just a product or the name). */
export function businessAbout(facts: SiteFacts, brief: HeroBrief): string {
  const services = realServices(facts).slice(0, 5);
  return [brief.kind, facts.tagline, (facts.description || "").slice(0, 200), services.length ? `services: ${services.join(", ")}` : ""].filter(Boolean).join(" · ").slice(0, 420);
}
