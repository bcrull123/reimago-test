#!/usr/bin/env node
/**
 * Local stand-in for the xAI/OpenAI APIs, for testing the live preview's AI path
 * without spending credits. It answers like a creative model would: three design
 * directions, page plans, section JSON, a designer critique, and photos.
 *
 *   node scripts/fake-ai-server.mjs            # listens on :9999
 *   AI_PROVIDER=openai OPENAI_API_KEY=fake AI_BASE_URL=http://localhost:9999/v1 \
 *   IMAGE_PROVIDER=openai IMAGE_BASE_URL=http://localhost:9999/v1 npm run dev
 *
 * Photos come from Openverse (openly licensed / CC0 search), keyed off the prompt,
 * with picsum.photos as a fallback. On purpose, some answers contain things the
 * app must reject (an invented phone number, a made-up statistic, an invented
 * review) so the validators are exercised.
 */
import http from "node:http";

const PORT = Number(process.env.PORT ?? 9999);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function textOf(content) {
  if (typeof content === "string") return content;
  return (content ?? []).map((p) => (p.type === "text" ? p.text : "")).join("\n");
}
function hasImage(content) {
  return Array.isArray(content) && content.some((p) => p.type === "image_url");
}
function firstJson(text) {
  const start = text.indexOf("{");
  if (start < 0) return {};
  for (let end = text.length; end > start; end = text.lastIndexOf("}", end - 1)) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // keep shrinking
    }
    if (end <= start) break;
  }
  return {};
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const city = (facts) => (facts.address?.match(/([A-Z][a-z]+(?: [A-Z][a-z]+)*),? (?:OK|TX|CA|NY|FL|[A-Z]{2})\b/)?.[1] ?? "");
const kindOf = (facts) => (facts.industry || facts.services_or_products?.[0] || "local business").replace(/\s+services?$/i, "");

// ---------------------------------------------------------------- directions
const LOOKS = {
  "bold-photo": (f, brand) => ({
    name: "Wrench & Daylight",
    mood: "Big, sunlit photography and blunt headlines — the confidence of a crew that shows up and fixes it.",
    rationale: `Homeowners with an urgent problem want proof and a phone number in two seconds; ${f.business_name} gets both above the fold.`,
    palette: { primary: brand ?? "#0b3d91", accent: "#ffc72c", background: "#ffffff", surface: "#f2f5fb", text: "#0b1222", muted: "#4a5568" },
    fonts: { heading: "Anton", body: "Archivo" },
    imagery: "Bright midday light, crisp detail, close working angles, copper and chrome textures, saturated but natural color.",
    heroSubject: `A ${kindOf(f).toLowerCase()} kneeling at work under a sunlit kitchen sink, copper pipes and tools in sharp focus`,
    motifs: ["diagonal-cuts", "outlined-type", "stamp-badges"],
    radius: "sharp", buttons: "square", hero: "photo", header: "overlay", footer: "columns",
    headline: "Fixed *today*. Done right.",
  }),
  "warm-craft": (_f) => ({
    name: "Copper Workshop",
    mood: "Warm, tactile and neighborly — earthy terracotta, aged copper and the pride of a family trade.",
    rationale: "Leans into the family-owned story so the business feels like the trusted neighbor, not a call center.",
    palette: { primary: "#9a3f18", accent: "#2e6b5e", background: "#fbf5ec", surface: "#f1e4d1", text: "#2b1d12", muted: "#6c5644" },
    fonts: { heading: "Fraunces", body: "DM Sans" },
    imagery: "Golden-hour window light, warm wood and copper tones, hands and tools in focus, gentle film grain.",
    heroSubject: `Close-up of weathered hands tightening a gleaming copper fitting with a vintage wrench, warm workshop light`,
    motifs: ["stamp-badges", "underline-marks", "grain"],
    radius: "soft", buttons: "pill", hero: "split", header: "light", footer: "statement",
    headline: "Family hands. *Honest* work.",
  }),
  "dark-premium": (_f) => ({
    name: "Midnight Pressure",
    mood: "Cinematic and calm under pressure — deep graphite, brass highlights, and photography that glows like a flashlight in the crawlspace.",
    rationale: "Positions emergency work as premium expertise, not a commodity.",
    palette: { primary: "#c9a227", accent: "#e8d39a", background: "#0e1013", surface: "#171a1f", text: "#f3efe6", muted: "#a9a49a" },
    fonts: { heading: "Cormorant Garamond", body: "Manrope" },
    imagery: "Low-key lighting, deep shadows, warm brass highlights on metal, shallow depth of field, cinematic.",
    heroSubject: "Polished brass and copper pipes lit dramatically against a dark background, water droplets catching the light",
    motifs: ["glow", "thin-rules", "grain"],
    radius: "soft", buttons: "outline", hero: "photo", header: "overlay", footer: "minimal",
    headline: "Calm hands when it *counts*.",
  }),
  editorial: (_f) => ({
    name: "The Neighborhood Ledger",
    mood: "Reads like a beautifully printed local magazine: oversized serif headlines, cream paper, and numbered stories.",
    rationale: "Gives a long-running local business the gravitas of a trusted institution.",
    palette: { primary: "#1f3b2d", accent: "#d1492f", background: "#f7f2e8", surface: "#ece3d0", text: "#18170f", muted: "#5d584b" },
    fonts: { heading: "Playfair Display", body: "Source Sans 3" },
    imagery: "Soft natural light, documentary framing, muted film tones, quiet details of craft.",
    heroSubject: "A tidy row of hand tools on a workbench beside rolled plans, soft morning light, documentary style",
    motifs: ["thin-rules", "oversized-numbers"],
    radius: "sharp", buttons: "square", hero: "type", header: "light", footer: "statement",
    headline: "The plumber your *neighbors* call.",
  }),
  playful: () => ({
    name: "Splash Zone",
    mood: "Cheerful and disarming — bright color, bouncy shapes and copy that makes a bad day feel fixable.",
    rationale: "Breaks the stiff-contractor mold and feels friendly to first-time homeowners.",
    palette: { primary: "#2443d6", accent: "#ff7a45", background: "#fffaf1", surface: "#ffeedd", text: "#1b1740", muted: "#5b5675" },
    fonts: { heading: "Bricolage Grotesque", body: "Nunito" },
    imagery: "Bright cheerful light, pastel backgrounds, playful overhead compositions, soft shadows.",
    heroSubject: "Overhead flat lay of colorful plumbing tools and fittings arranged playfully on a pastel background",
    motifs: ["soft-blobs", "underline-marks"],
    radius: "round", buttons: "pill", hero: "split", header: "light", footer: "columns",
    headline: "Leaks happen. We make it *easy*.",
  }),
  "minimal-luxury": () => ({
    name: "Quiet Water",
    mood: "Serene and exacting — stone, linen and hairline details for clients who notice the finish.",
    rationale: "Speaks to remodel and fixture clients who care about craftsmanship and calm.",
    palette: { primary: "#2a2926", accent: "#9c8155", background: "#fbfaf6", surface: "#f0ece4", text: "#1b1a17", muted: "#6c675d" },
    fonts: { heading: "Instrument Serif", body: "Jost" },
    imagery: "Soft diffused light, matte stone and brushed brass fixtures, minimal symmetric compositions.",
    heroSubject: "A minimalist stone bathroom with a brushed brass faucet, soft diffused daylight",
    motifs: ["thin-rules", "grid-lines"],
    radius: "sharp", buttons: "outline", hero: "type", header: "light", footer: "minimal",
    headline: "Water, *perfectly* placed.",
  }),
};

// Food businesses (bakery, cafe, restaurant) get their own creative copy on top of the same archetypes.
const FOOD = {
  "bold-photo": { name: "Fresh Out of the Oven", mood: "Huge, steamy close-ups and loud confident type — hunger at first scroll.", imagery: "Bright window light, extreme close-ups of crust and crumb, flour in the air.", heroSubject: "Extreme close-up of a crackling sourdough crust being torn open, steam rising, warm window light", headline: "Baked *this* morning." },
  "warm-craft": { name: "Flour & Hearth", mood: "Warm, floury and handmade — terracotta, linen and the glow of the oven door.", imagery: "Golden-hour light, flour-dusted hands, wooden boards, gentle film grain.", heroSubject: "Flour-dusted hands shaping a loaf on a worn wooden bench, golden morning light", headline: "Made by *hand*, every day." },
  "dark-premium": { name: "After Hours", mood: "Moody and indulgent — candlelit pastry, deep chocolate tones and glossy highlights.", imagery: "Low-key lighting, dark backgrounds, glossy glazes catching warm light.", heroSubject: "A glossy chocolate tart on a dark stone plate, a single warm light catching the glaze", headline: "Slow bread. *Late* nights." },
  editorial: { name: "The Morning Edition", mood: "A beautifully printed food magazine: oversized serif headlines, cream paper and recipe-card details.", imagery: "Soft natural light, overhead documentary framing, muted film tones.", heroSubject: "Overhead view of a bakery counter with rows of croissants and country loaves, soft morning light", headline: "Bread worth *crossing* town for." },
  playful: { name: "Sprinkle Shop", mood: "Sweet and cheerful — candy colors and bouncy shapes.", imagery: "Pastel backgrounds, playful overhead compositions.", heroSubject: "Colorful pastries arranged playfully on a pastel background, overhead", headline: "Treat *yourself*." },
  "minimal-luxury": { name: "Quiet Crumb", mood: "Calm and exacting — stone, linen and a single perfect loaf.", imagery: "Soft diffused light, matte stone, minimal compositions.", heroSubject: "A single country loaf on a linen cloth on pale stone, soft diffused light", headline: "One loaf, *perfected*." },
};
const isFood = (facts) => /bake|bread|pastr|cafe|coffee|restaurant|kitchen|food/i.test([facts.business_name, facts.description, facts.tagline, facts.industry].join(" "));

const FOOD_COPY = [
  ["Got a leak? *Let's fix it.*", "Hungry? *Come by.*"],
  ["Tell us what's going on and we'll get you on the schedule.", "Order ahead or just walk in — the ovens are already on."],
  ["Every job, *done properly*", "From the *oven* this week"],
  ["Three steps to *sorted*", "How a loaf is *made*"],
  ["Call or message", "Mix"], ["Tell us what's happening.", "Flour, water, salt and a very old starter."],
  ["We diagnose", "Rest"], ["Clear options before any work starts.", "A long, slow overnight ferment."],
  ["Fixed & checked", "Bake"], ["We test everything before we leave.", "A hot oven and a dark, crackling crust."],
  ["Need it handled?", "Order ahead"], ["We'll get you on the schedule.", "Cakes and tarts by pre-order."],
  ["Let's get you *sorted*", "Come *say hello*"],
];
function foodCopy(out) {
  let text = JSON.stringify(out);
  for (const [from, to] of FOOD_COPY) text = text.split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1));
  return JSON.parse(text.replace(/, \*handled\*/g, ", *fresh daily*"));
}

function directions(system, facts) {
  const suggested = (system.match(/good starting points for this business: ([a-z\-, ]+)\./)?.[1] ?? "bold-photo, warm-craft, dark-premium").split(/,\s*/);
  const brand = (facts.brand_colors ?? [])[0];
  const food = isFood(facts);
  return {
    looks: suggested.slice(0, 3).map((a) => ({
      archetype: a,
      ...(LOOKS[a] ?? LOOKS.editorial)(facts, brand),
      ...(food ? { ...FOOD[a], rationale: `Makes ${facts.business_name} feel as good as it tastes.` } : {}),
    })),
  };
}

// ---------------------------------------------------------------- plan
function plan(facts) {
  const nav = (facts.current_navigation ?? []).map((n) => n.toLowerCase());
  const pages = [{ slug: "home", title: "Home", navLabel: "Home", purpose: "Win the call in five seconds.", sections: [] }];
  pages.push({ slug: "services", title: `${cap(kindOf(facts))} services`, navLabel: "Services", purpose: "Everything they do, scannable.", sections: [] });
  const special = (facts.pages_read ?? []).map((p) => p.url).map((u) => { try { return new URL(u).pathname.split("/").filter(Boolean).pop() ?? ""; } catch { return ""; } })
    .find((s) => s && !/about|contact|service|home|index|blog|faq/.test(s));
  if (special) pages.push({ slug: special.slice(0, 30), title: cap(special.replace(/-/g, " ")), navLabel: cap(special.replace(/-/g, " ")).split(" ").slice(0, 2).join(" "), purpose: "A specialty page carried over from the current site.", sections: [] });
  pages.push({ slug: "about", title: `About ${facts.business_name}`, navLabel: "About", purpose: "The people and the story.", sections: [] });
  pages.push({ slug: "contact", title: "Contact", navLabel: "Contact", purpose: "Every way to reach them.", sections: [] });
  return {
    tagline: facts.tagline?.slice(0, 80) || `${facts.business_name}`,
    summary: `The current ${facts.source_url ? "site" : "brief"} hides the phone number and repeats itself across pages. The new site leads with what ${facts.business_name} is known for and makes calling one tap.`,
    changes: ["One clear call to action on every page", "Services grouped so visitors find theirs in seconds", nav.length ? "Navigation trimmed to the pages people actually use" : "A simple five-page structure"],
    cta: { label: facts.phone ? "Book a visit" : "Get in touch", slug: "contact" },
    pages,
  };
}

// ---------------------------------------------------------------- sections
const BLURBS = [
  "Tell us what's going on and we'll walk you through the options before any work starts.",
  "Careful, tidy work with updates while we're on the job.",
  "Straight answers up front, so there are no surprises when we're done.",
  "We bring the right parts and tools so it gets handled in one visit whenever possible.",
  "From the first call to the final check, you'll know exactly what's happening.",
  "Ask anything — we'd rather explain it twice than leave you guessing.",
];

function sectionsFor(system, user) {
  const { page, facts, site_plan } = user;
  const direction = firstJson(system.slice(system.indexOf("Design direction"), system.indexOf("Section library")));
  const images = [...system.matchAll(/"([a-z0-9-]+)" \((real photo|generated)/g)].map((m) => m[1]);
  const photos = images.filter((n) => n.startsWith("photo-"));
  const img = (pref, i = 0) => (images.includes(pref) ? pref : photos[i % Math.max(photos.length, 1)]);
  const name = facts.business_name;
  const services = facts.services_or_products ?? [];
  const where = city(facts);
  const cta = site_plan?.cta ?? { label: "Get in touch", slug: "contact" };
  const heroType = { split: "hero-split", photo: "hero-photo", type: "hero-type" }[direction.hero] ?? "hero-split";
  const yearMatch = JSON.stringify(facts).match(/since (\d{4})/i);
  const testimonials = facts.testimonials ?? [];
  const svcItems = (n, withImg) =>
    services.slice(0, n).map((s, i) => ({ title: s, text: BLURBS[i % BLURBS.length], ...(withImg ? { image: img(`service-${i + 1}`, i + 1) } : {}) }));
  const dark = direction.archetype === "dark-premium";
  if (page.slug === "home") {
    const out = [
      {
        type: heroType,
        tone: "light",
        eyebrow: where ? `${cap(kindOf(facts))} · ${where}` : cap(kindOf(facts)),
        heading: direction.headline_idea || `${name}, at your door *fast*`,
        text: `${(facts.description || facts.about || "").split(/(?<=\.)\s/)[0] ?? ""} Call (212) 555-0199 any time.`.trim(),
        image: img("hero"),
        cta: { label: cta.label, page: cta.slug },
        call: true,
      },
      { type: "stat-bar", tone: dark ? "tint" : "light", items: [yearMatch ? { title: yearMatch[1], text: "Serving the area since" } : null, { title: "10,000+", text: "Happy customers" }, { title: "4.9★", text: "Average rating" }].filter(Boolean) },
      direction.archetype === "bold-photo" ? { type: "marquee", tone: "brand", items: services.slice(0, 7).map((s) => ({ title: s })) } : null,
      {
        type: "services-grid",
        tone: dark ? "light" : "tint",
        variant: { editorial: "list", "minimal-luxury": "list", "warm-craft": "bento", playful: "icons" }[direction.archetype] ?? (photos.length >= 3 ? "images" : "icons"),
        eyebrow: "What we fix",
        heading: "Every job, *done properly*",
        text: `The work ${name} is asked for most, start to finish.`,
        items: svcItems(direction.archetype === "warm-craft" ? 5 : 6, photos.length >= 3),
        cta: { label: "All services", page: "services" },
      },
      {
        type: "feature-split",
        tone: dark ? "tint" : "light",
        reverse: direction.archetype === "playful",
        eyebrow: "Who we are",
        heading: `Meet *${name}*`,
        text: (facts.about || facts.description || "").slice(0, 520),
        items: services.slice(0, 3).map((s) => ({ title: s })),
        image: img("feature", 1),
        cta: { label: "Our story", page: "about" },
      },
      testimonials.length
        ? { type: "reviews", tone: dark ? "light" : "tint", eyebrow: "Neighbors say", heading: "Words we're *proud* of", items: [...testimonials.map((t) => ({ title: t.author, text: t.quote })), { title: "Jane D.", text: "Absolutely the best plumber in the entire state, 11/10!" }] }
        : { type: "process", tone: "light", eyebrow: "How it works", heading: "Three steps to *sorted*", items: [{ title: "Call or message", text: "Tell us what's happening." }, { title: "We diagnose", text: "Clear options before any work starts." }, { title: "Fixed & checked", text: "We test everything before we leave." }] },
      facts.description ? { type: "statement", tone: dark ? "light" : "dark", eyebrow: "Our promise", text: `Straight answers, careful work, and a *clean* job site — every visit.` } : null,
      { type: "faq", tone: "light", heading: "Questions, *answered*", items: services.slice(0, 3).map((s) => ({ title: `Do you handle ${s.toLowerCase()}?`, text: `Yes — ${s.toLowerCase()} is part of what ${name} does. Call or send a message to book a visit.` })) },
      { type: "cta-band", tone: "light", heading: "Got a leak? *Let's fix it.*", text: "Tell us what's going on and we'll get you on the schedule. Or email help@fake-plumbing-example.com.", cta: { label: cta.label, page: cta.slug }, call: true },
    ].filter(Boolean);
    return { sections: out };
  }
  const hero = (eyebrow, heading, text, image) => ({ type: "page-hero", tone: dark ? "light" : "tint", eyebrow, heading, text, image });
  if (page.slug === "contact") {
    return { sections: [hero("Contact", `Let's get you *sorted*`, `Call, email, or send a message — ${name} will get right back to you.`), { type: "contact-block", tone: "light", heading: "Reach us", text: facts.hours?.length ? `Office hours: ${facts.hours.join(", ")}.` : "" }] };
  }
  if (page.slug === "about") {
    return {
      sections: [
        hero("About", `The people behind *${name}*`, (facts.description || "").slice(0, 200), img("feature", 2)),
        { type: "rich-text", tone: "light", heading: "Our story", text: (facts.about || facts.description || "").replace(/\. /g, ".\n").slice(0, 1200) },
        { type: "statement", tone: dark ? "tint" : "brand", text: "We treat every home like it's *our own*." },
        testimonials.length ? { type: "reviews", tone: "light", heading: "In their words", items: testimonials.map((t) => ({ title: t.author, text: t.quote })) } : null,
        { type: "cta-band", tone: "light", heading: "Ready when you are", text: "Send a message and we'll take it from there.", cta: { label: cta.label, page: cta.slug }, call: true },
      ].filter(Boolean),
    };
  }
  if (page.slug === "services") {
    return {
      sections: [
        hero("Services", `${cap(kindOf(facts))}, *handled*`, "Everything we do, in one place. Don't see it? Ask — chances are we can help."),
        { type: "services-grid", tone: "light", variant: images.some((n) => n.startsWith("service-")) ? "images" : "icons", heading: "What we do", items: svcItems(9, true) },
        { type: "process", tone: "tint", eyebrow: "How it works", heading: "Simple from the first *call*", items: [{ title: "Reach out", text: "Call or message with what you need." }, { title: "Clear options", text: "We explain the fix before we start." }, { title: "Done & tested", text: "Everything checked before we leave." }] },
        { type: "faq", tone: "light", heading: "Good to know", items: services.slice(0, 4).map((s) => ({ title: `Can you help with ${s.toLowerCase()}?`, text: `Yes. ${s} is one of our services — call or send a message to book.` })) },
        { type: "cta-band", tone: "light", heading: "Need it handled?", text: "We'll get you on the schedule.", cta: { label: cta.label, page: cta.slug }, call: true },
      ],
    };
  }
  const source = (facts.pages_read ?? []).find((p) => (p.url ?? p.title ?? "").toLowerCase().includes(page.slug));
  return {
    sections: [
      hero(page.navLabel, page.title, source?.headings?.[1] ?? page.purpose, img("feature", 3)),
      { type: "feature-split", tone: "light", eyebrow: "The details", heading: `${page.title}, *explained*`, text: (source?.text ?? page.purpose).slice(0, 700), image: img("service-1", 0) },
      { type: "cta-band", tone: "light", heading: "Think you need this?", text: "Call and we'll talk it through.", cta: { label: cta.label, page: cta.slug }, call: true },
    ],
  };
}

// ---------------------------------------------------------------- critique
function critique(userText, vision) {
  const brief = firstJson(userText.slice(userText.indexOf("Brief and current sections:")));
  const sections = brief.current_sections ?? [];
  const revised = sections.map((s) => ({ ...s }));
  if (revised[0]) revised[0].heading = (revised[0].heading ?? "").replace(/\*$/, "*").replace(/^(.*)$/, (h) => (h.length > 48 ? h.slice(0, 46) : h));
  const ctaIndex = revised.findIndex((s) => s.type === "cta-band");
  if (ctaIndex >= 0 && ctaIndex !== revised.length - 1) revised.push(...revised.splice(ctaIndex, 1));
  for (let i = 1; i < revised.length; i += 1) if (revised[i].tone === revised[i - 1].tone && revised[i].tone !== "light") revised[i].tone = "light";
  const faqIndex = revised.findIndex((s) => s.type === "faq");
  if (faqIndex > 0 && revised.length > 7) revised.splice(faqIndex, 1);
  return {
    critique: [
      vision ? "From the screenshot: the hero is strong, but the second band competes with it — quieter tone needed." : "Hero and services read well; the page is a little long.",
      "Two adjacent tinted sections flatten the rhythm; alternate light and tinted backgrounds.",
      "The closing call to action should be the last thing before the footer.",
      faqIndex > 0 && sections.length > 7 ? "The FAQ repeats the services list; cut it from the homepage." : "Keep the FAQ short and specific.",
    ],
    sections: revised,
  };
}

// ---------------------------------------------------------------- images
const imageCache = new Map();
async function photoFor(prompt, wide) {
  const words = prompt
    .split(/Photograph only|Art direction/)[0]
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !/website|photograph|photo|hero|composition|negative|space|headline|calm|wide|authentic|business|illustrating|clear|single|subject|editorial|style|product|behind|scenes|skilled|work|progress|details|tools|materials|craft|natural|candid|framing|local|striking|scene|represents/.test(w));
  const query = [...new Set(words)].slice(0, 3).join(" ") || "workshop";
  const key = `${query}|${hash(prompt) % 7}`;
  if (imageCache.has(key)) return imageCache.get(key);
  let bytes;
  try {
    const res = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=12&size=large${wide ? "&aspect_ratio=wide" : ""}&license_type=all-cc`, { signal: AbortSignal.timeout(10000) });
    const json = await res.json();
    const results = (json.results ?? []).filter((r) => /\.(jpe?g)(\?|$)/i.test(r.url) || /rawpixel|staticflickr|wikimedia/.test(r.url));
    for (let i = 0; i < Math.min(4, results.length) && !bytes; i += 1) {
      const pick = results[(hash(prompt) + i) % results.length];
      const r = await fetch(pick.url, { signal: AbortSignal.timeout(12000) }).catch(() => null);
      if (r?.ok) {
        const b = Buffer.from(await r.arrayBuffer());
        if (b.length > 20000 && b.length < 7_000_000 && b[0] === 0xff && b[1] === 0xd8) bytes = b;
      }
    }
    log("openverse", query, bytes ? `${bytes.length} bytes` : "no usable result");
  } catch (e) {
    log("openverse failed", e.message);
  }
  if (!bytes) {
    const r = await fetch(`https://picsum.photos/seed/${hash(prompt)}/${wide ? "1536/864" : "1200/900"}`);
    bytes = Buffer.from(await r.arrayBuffer());
  }
  imageCache.set(key, bytes);
  return bytes;
}

// ---------------------------------------------------------------- server
http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const json = JSON.parse(body || "{}");
        if (req.url.endsWith("/images/generations")) {
          await sleep(1500);
          if (/no text|letters|logos/i.test(json.prompt) === false) log("WARNING: image prompt without text/logo guard");
          if (/morgan|reddy|plumbing co/i.test(json.prompt)) log("WARNING: business name in image prompt");
          const wide = /16:9|1536x1024|4:3/.test(`${json.aspect_ratio ?? ""}${json.size ?? ""}`);
          const bytes = await photoFor(json.prompt ?? "", wide);
          log("image", (json.prompt ?? "").slice(0, 90));
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] }));
          return;
        }
        const system = textOf(json.messages?.[0]?.content);
        const userContent = json.messages?.[1]?.content;
        log("chat", json.model, `reasoning_effort=${json.reasoning_effort ?? "-"}`, `response_format=${json.response_format?.type ?? "-"}`, `max_tokens=${json.max_tokens}`);
        // FAKE_FAIL simulates real-API failure modes for page writing (the fallback model succeeds unless FAKE_FAIL_ALL=1).
        const failing = system.includes("composing ONE page") && process.env.FAKE_FAIL && (process.env.FAKE_FAIL_ALL === "1" || !/non-reasoning/.test(json.model ?? ""));
        if (process.env.FAKE_FAIL === "reject-reasoning" && json.reasoning_effort) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ code: "Client specified an invalid argument", error: "Argument not supported on this model: reasoning_effort" }));
          return;
        }
        if (failing && process.env.FAKE_FAIL === "slow") {
          log("simulating a slow model (no answer)");
          await sleep(180_000);
          res.writeHead(504).end();
          return;
        }
        if (failing && process.env.FAKE_FAIL === "length") {
          log("simulating a token-limit cut-off");
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: '{"sections": [{"type": "hero-split", "heading": "Start where' } }] }));
          return;
        }
        if (failing && process.env.FAKE_FAIL === "badjson") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "I'm sorry, I can't produce that layout." } }] }));
          return;
        }
        const user = textOf(userContent);
        let out;
        if (system.includes("website wizard")) out = { patch: { what: "Dog grooming salon", industry: "Other" }, choices: ["Prairie Paws", "Happy Tails OKC", "Bark & Bath"] };
        else if (system.includes("Propose THREE bold")) {
          await sleep(2500);
          out = directions(system, firstJson(user));
          log("directions", out.looks.map((l) => `${l.name} (${l.archetype})`).join(", "));
        } else if (system.includes("planning a clean, modern")) {
          await sleep(2000);
          out = plan(firstJson(user));
          log("plan", out.pages.map((p) => p.slug).join(", "));
        } else if (system.includes("composing ONE page")) {
          await sleep(3000);
          const u = firstJson(user);
          out = sectionsFor(system, u);
          if (isFood(u.facts ?? u)) out = foodCopy(out);
          log("page", u.page?.slug, out.sections.map((s) => s.type).join(","));
        } else if (system.includes("senior art director reviewing")) {
          await sleep(3000);
          out = critique(user, hasImage(userContent));
          log("critique", hasImage(userContent) ? "with screenshot" : "html only");
        } else out = {};
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "Here you go:\n```json\n" + JSON.stringify(out) + "\n```" } }] }));
      } catch (error) {
        log("error", error.message);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  })
  .listen(PORT, () => log(`fake AI server on :${PORT}`));
