import { aiAvailable, chatText } from "@/lib/ai-provider.server";
import type { CreateBrief } from "@/components/create-site-wizard";
import { CREATE_STEP_IDS, type CreateStepId } from "@/lib/create-steps";
import { normalizeDomain } from "@/lib/domain-name";

const INDUSTRIES = ["Restaurant", "Professional services", "Retail", "Home services", "Health", "Nonprofit", "Other"];
const LIKES = ["Layout", "Colors", "Fonts", "Imagery", "Features", "Tone of writing"];
const GOALS = ["Call us", "Book an appointment", "Buy online", "Get a quote", "Sign up", "Other"];
const PAGES = ["Home", "About", "Services/Products", "Pricing", "Portfolio", "Blog", "Contact", "Booking", "Shop", "FAQ"];
const STYLES = ["Professional", "Warm", "Bold", "Minimal", "Playful", "Elegant"];
const FEATURES = ["Booking", "Store/payments", "Blog", "Contact form", "Newsletter", "Chat", "Member login", "Multi-language"];

const STEP_RULES: Record<CreateStepId, string> = {
  domain:
    "Suggest exactly 3 short, memorable .com domain names for this business (use the business name or description if known). Return them in choices as bare domains like example.com. Leave the patch empty. Do not claim they are available.",
  business_name: "Suggest exactly 3 business names. If a domain is chosen, names should match it. Do not fill business_name. Return them in choices.",
  industry:
    "Infer what the business does. Set what to one short sentence and industry to exactly one of: Restaurant, Professional services, Retail, Home services, Health, Nonprofit, Other.",
  location: "Set location. If the existing site or name implies a place, use that city and state. Otherwise use the text Your city, State.",
  existing_site:
    "If domain_status is owned, set existing_site to that domain. Otherwise set existing_site to a likely address from the business name, like the name with spaces removed plus .com. Do not claim it is registered.",
  emulate:
    "Set emulate_url_1, emulate_url_2, and emulate_url_3 to real, well-designed websites in this industry. Set emulate_likes to 2 or 3 of: Layout, Colors, Fonts, Imagery, Features, Tone of writing. Set emulate_note to one sentence about what to borrow.",
  goal: "Set goal to exactly one of: Call us, Book an appointment, Buy online, Get a quote, Sign up, Other. Pick the most common goal for this industry.",
  customers: "Set customers to one sentence describing the likely customers.",
  services: "Set services to 4 to 6 typical services, one per line.",
  pages: "Set pages to the page names that fit, using only: Home, About, Services/Products, Pricing, Portfolio, Blog, Contact, Booking, Shop, FAQ.",
  style: "Set style to exactly one of: Professional, Warm, Bold, Minimal, Playful, Elegant. Set brand_color to one hex color that fits the industry.",
  contact: "Set hours to typical hours for this industry. Leave phone, contact_email, and address empty. Never invent a phone number, email, or street address.",
  features:
    "Set features using only: Booking, Store/payments, Blog, Contact form, Newsletter, Chat, Member login, Multi-language. If retail, include Store/payments.",
  files: "Do not invent files. Return an empty patch. The app will note that AI will draft the pages and use placeholder images until you send photos.",
};

function list(value: unknown, allowed: string[]): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter((item) => allowed.includes(item));
}

function text(value: unknown, max = 400): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function suggestCreateStep(step: number, brief: CreateBrief, attempt: number): Promise<{
  patch: Partial<CreateBrief>;
  choices: string[];
  note: string;
}> {
  if (!aiAvailable()) throw new Error("AI is not available.");
  const id = CREATE_STEP_IDS[step];
  const rule = id ? STEP_RULES[id] : undefined;
  if (!id || !rule) throw new Error("That step cannot be suggested.");
  let raw = "";
  try {
    raw = await chatText({
      temperature: 0.8,
      maxTokens: 4000,
      timeoutMs: 25000,
      retry: false,
      messages: [
        {
          role: "system",
          content:
            "You help a website wizard. Use the answers so far. Return only JSON with keys patch and choices. patch is an object of fields to fill. choices is an array of strings. No markdown.",
        },
        {
          role: "user",
          content: `Step ${step + 1}. Attempt ${attempt}. Rule: ${rule}\nKnown answers:\n${JSON.stringify(brief)}`,
        },
      ],
    });
  } catch {
    throw new Error("AI could not suggest an answer.");
  }
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) throw new Error("AI could not suggest an answer.");
  const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as { patch?: Record<string, unknown>; choices?: unknown };
  const incoming = parsed.patch ?? {};
  const choices = Array.isArray(parsed.choices) ? parsed.choices.map((item) => String(item).trim()).filter(Boolean).slice(0, 3) : [];
  const patch: Partial<CreateBrief> = {};
  if (id === "industry") {
    patch.what = text(incoming.what, 180);
    patch.industry = INDUSTRIES.includes(String(incoming.industry)) ? String(incoming.industry) : "";
  } else if (id === "location") {
    patch.location = text(incoming.location, 80) || "Your city, State";
  } else if (id === "existing_site") {
    // The visitor's own domain wins; otherwise the AI's guess, which the note asks them to confirm.
    patch.existing_site = brief.domain && brief.domain_status === "owned" ? brief.domain : text(incoming.existing_site, 120);
  } else if (id === "emulate") {
    patch.emulate_url_1 = text(incoming.emulate_url_1, 160);
    patch.emulate_url_2 = text(incoming.emulate_url_2, 160);
    patch.emulate_url_3 = text(incoming.emulate_url_3, 160);
    patch.emulate_likes = list(incoming.emulate_likes, LIKES).slice(0, 3);
    patch.emulate_note = text(incoming.emulate_note, 240);
  } else if (id === "goal") {
    patch.goal = GOALS.includes(String(incoming.goal)) ? String(incoming.goal) : "";
  } else if (id === "customers") {
    patch.customers = text(incoming.customers, 240);
  } else if (id === "services") {
    patch.services = text(incoming.services, 400);
  } else if (id === "pages") {
    patch.pages = list(incoming.pages, PAGES);
  } else if (id === "style") {
    patch.style = STYLES.includes(String(incoming.style)) ? String(incoming.style) : "";
    const color = text(incoming.brand_color, 7);
    patch.brand_color = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "";
  } else if (id === "contact") {
    patch.hours = text(incoming.hours, 80);
    patch.phone = "";
    patch.contact_email = "";
    patch.address = "";
  } else if (id === "features") {
    patch.features = list(incoming.features, FEATURES);
  }
  // Domain ideas must be valid names; the visitor checks availability and selects one.
  const ideas = id === "domain" ? choices.map((item) => normalizeDomain(item).domain).filter((item): item is string => Boolean(item)) : choices;
  const note =
    id === "domain"
      ? "AI ideas — tap one to check if it is available."
      : id === "existing_site"
        ? "AI suggestion — please confirm this address. Edit anything you like."
        : id === "files"
        ? "AI will draft the pages and use placeholder images until you send photos."
        : "AI suggestion — edit anything you like.";
  return { patch, choices: ideas, note };
}
