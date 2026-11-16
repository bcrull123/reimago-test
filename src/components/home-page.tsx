import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { SiteShell, Wordmark } from "@/components/site-shell";
import { CreateSiteWizard, type CreateBrief, type CreateFiles } from "@/components/create-site-wizard";
import { checkDomainName, handOffToCursor } from "@/lib/reimagine.functions";
import { cursorStatus, previewDirections, previewFinish, previewFromBrief, previewLook, previewRead, previewRetryAi, savePreviewPicture } from "@/lib/preview.functions";
import { capturePreviewPicture, pictureFileName } from "@/lib/preview-picture";
import { LivePreview } from "@/components/live-preview";
import { LooksPicker } from "@/components/looks-picker";
import { ARCHETYPE_LABEL } from "@/lib/preview/archetype-label";
import type { LookInfo, PreviewInfo, SiteFacts } from "@/lib/preview/types";
import type { DomainOffer } from "@/lib/logicboxes-types";
import type { ReimagineOk } from "@/lib/reimagine-types";


const REBUILDS = [
  ["Website", "A new first impression. Structure, copy, and conversion — rebuilt from what you already have."],
  ["Business", "Positioning, offers, and the story a stranger can understand in ten seconds."],
  ["Customer Service", "Help that feels like the brand: clearer answers, calmer paths, fewer dead ends."],
  ["Life", "Personal sites, practices, and reputations that should look like the work behind them."],
] as const;


type Stage = "" | "read" | "dream" | "paint" | "picture" | "send" | "finish";

/** Progress shown while looks are made (phase 1) and while the chosen look is finished (phase 2). */
const LOOK_STAGES: { key: Stage; label: string }[] = [
  { key: "read", label: "Reading your site…" },
  { key: "dream", label: "Dreaming up looks…" },
  { key: "paint", label: "Painting images and homepages…" },
  { key: "picture", label: "Preparing your preview image…" },
  { key: "send", label: "Sending your preview link…" },
];
const FINISH_STAGES: { key: Stage; label: string }[] = [
  { key: "finish", label: "Building pages…" },
  { key: "finish", label: "Polishing the homepage…" },
];
/** After "Choose this look" when the brief hasn't been sent yet: build, picture, send. */
const CHOOSE_STAGES: { key: Stage; label: string }[] = [
  { key: "finish", label: "Building every page in this look…" },
  { key: "picture", label: "Preparing your picture…" },
  { key: "send", label: "Sending it to your email…" },
];

/** A homepage-only look shown in the viewer before the visitor picks one. */
function lookPreview(look: LookInfo): PreviewInfo {
  return { id: look.id, url: look.url, mock: look.mock, look: look.name, pages: [{ slug: "home", title: `${look.name} · Home`, url: look.url }] };
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function briefMailto(email: string, url: string, notes: string, result: ReimagineOk): string {
  const body = [
    email,
    "",
    `Website: ${url}`,
    `What should change: ${notes || "(not specified)"}`,
    "",
    `Read: ${result.diagnosis}`,
    `Draft headline: ${result.draft.headline}`,
    result.preview ? `Live preview: ${result.preview.url}` : "",
  ].join("\n");
  return `mailto:marketing@reimago.ai?subject=${encodeURIComponent(result.host)}&body=${encodeURIComponent(body)}`;
}

const fieldClass =
  "mt-1.5 flex h-11 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring/70";

const FORMCARRY = "https://formcarry.com/s/NipZS0fF4w4";
const THANKS = "Sent! Check your email. The site, your email, the note, the look you chose, a picture of it, and a link to it were sent. Nothing on the live site was changed.";
const THANKS_NO_PICTURE = "Sent! Check your email. The site, your email, the note, the look you chose, and a link to it were sent. Nothing on the live site was changed.";
/** Shown when the looks are ready: the brief waits until the visitor chooses one. */
const CHOOSE_PROMPT = "Your looks are ready below. Choose the one you like and we'll build every page in that style and email you a picture. Nothing is sent until you choose.";
/** The wizard's brief when no looks could be built (it is sent right away, as before). */
const THANKS_NO_LOOKS = "We got the brief. The site, your email, and your answers were sent. Nothing on the live site was changed.";

/** The visitor's form, held until they choose a look (Formcarry is sent once, then). */
type PendingLead =
  | { kind: "reimagine"; email: string; website: string; note: string; gotcha: string }
  | { kind: "create"; email: string; gotcha: string; brief: CreateBrief; files: CreateFiles };

/** The screenshot sent with the form as `picture` (plus `picture_url` when stored, or `picture_error`). */
type PictureFields = { file?: File; url?: string; error?: string };

/** Screenshot a look's homepage for the lead email. Never throws: a failure becomes `picture_error`. */
async function previewPicture(look: LookInfo | undefined, domain: string): Promise<PictureFields> {
  if (!look) return { error: "No preview was built." };
  try {
    const shot = await capturePreviewPicture(look);
    const file = new File([shot.blob], pictureFileName(domain), { type: "image/png" });
    const stored = await savePreviewPicture({ data: { id: look.id, png: shot.dataUrl } }).catch(() => null);
    return { file, url: stored?.ok ? stored.url : undefined };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn("[reimago] preview picture failed:", reason);
    return { error: `The preview picture could not be made (${reason.slice(0, 200)}). Use the preview link.` };
  }
}

function appendPicture(data: FormData, picture?: PictureFields) {
  if (!picture) return;
  if (picture.file) data.append("picture", picture.file, picture.file.name);
  if (picture.url) data.append("picture_url", picture.url);
  if (picture.error) data.append("picture_error", picture.error);
}

function bareDomain(site: string): string {
  try {
    const withProto = /^https?:\/\//i.test(site) ? site : `https://${site}`;
    return new URL(withProto).hostname.replace(/^www\./i, "");
  } catch {
    return site.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0] || site;
  }
}

async function submitFormcarry(fields: {
  email: string;
  website: string;
  note: string;
  gotcha: string;
  previewUrl?: string;
  previewPages?: string[];
  chosenLook?: string;
  picture?: PictureFields;
}): Promise<void> {
  const domain = bareDomain(fields.website);
  const data = new FormData();
  data.append("email", fields.email);
  data.append("website", domain);
  data.append("note", fields.note);
  data.append("_gotcha", fields.gotcha);
  data.append("preview_url", fields.previewUrl ?? "");
  data.append("preview_pages", (fields.previewPages ?? []).join("\n"));
  data.append("chosen_look", fields.chosenLook ?? "");
  appendPicture(data, fields.picture);

  const response = await fetch(FORMCARRY, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: data,
  });
  const json = (await response.json().catch(() => null)) as { code?: number; message?: string } | null;
  if (json?.code !== 200) {
    throw new Error(json?.message || "The form could not be sent. Try again.");
  }
}

async function submitCreateBrief(
  email: string,
  gotcha: string,
  brief: CreateBrief,
  files: CreateFiles,
  chosen?: { previewUrl: string; previewPages: string[]; chosenLook: string; picture?: PictureFields },
): Promise<void> {
  const pages = brief.pages.length ? brief.pages : ["Home", "About", "Services", "Contact"];
  const industry = [brief.industry, brief.what].filter(Boolean).join(": ");
  const data = new FormData();
  data.append("email", email);
  data.append("website", bareDomain(brief.domain || brief.existing_site || brief.business_name || "new-site"));
  data.append("note", brief.anything_else);
  data.append("_gotcha", gotcha);
  data.append("mode", "create_new_site");
  data.append("business_name", brief.business_name);
  data.append("industry", industry);
  data.append("location", brief.location);
  data.append("existing_site", brief.existing_site);
  data.append("emulate_url_1", brief.emulate_url_1);
  data.append("emulate_url_2", brief.emulate_url_2);
  data.append("emulate_url_3", brief.emulate_url_3);
  data.append("emulate_likes", brief.emulate_likes.join(", "));
  data.append("emulate_note", brief.emulate_note);
  data.append("goal", brief.goal);
  data.append("customers", brief.customers);
  data.append("services", brief.services);
  data.append("pages", pages.join(", "));
  data.append("style", brief.style);
  data.append("brand_color", brief.brand_color);
  data.append("phone", brief.phone);
  data.append("contact_email", brief.contact_email);
  data.append("address", brief.address);
  data.append("hours", brief.hours);
  data.append("domain_choice", brief.domain_choice);
  data.append("domain", brief.domain);
  // "owned" or "selected-pending-checkout" (chosen in the wizard, not registered or paid for yet).
  data.append("domain_status", brief.domain_status ?? "");
  if (brief.domain_checkout_url) data.append("domain_checkout_url", brief.domain_checkout_url);
  data.append("features", brief.features.join(", "));
  data.append("product_count", brief.product_count);
  data.append("files_link", brief.files_link);
  data.append("copy_text", brief.copy_text);
  data.append("video_link", brief.video_link);
  data.append("anything_else", brief.anything_else);
  data.append("ai_suggested", (brief.ai_suggested ?? []).join(", "));
  data.append("preview_url", chosen?.previewUrl ?? "");
  if (chosen) {
    data.append("preview_pages", chosen.previewPages.join("\n"));
    data.append("chosen_look", chosen.chosenLook);
  }
  appendPicture(data, chosen?.picture);
  const named: [string, File | null][] = [
    ["logo", files.logo],
    ["brand_guide", files.brand],
    ["copy_file", files.copy],
    ["testimonials", files.testimonials],
    ["licenses", files.licenses],
    ["video", files.video],
  ];
  for (const [name, file] of named) {
    if (file && file.size < 10_000_000) data.append(name, file, file.name);
  }
  for (const photo of files.photos) {
    if (photo.size < 10_000_000) data.append("photo", photo, photo.name);
  }
  const response = await fetch(FORMCARRY, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: data,
  });
  const json = (await response.json().catch(() => null)) as { code?: number; message?: string } | null;
  if (json?.code !== 200) {
    throw new Error(json?.message || "The form could not be sent. Try again.");
  }
}

export function HomePage() {
  const [url, setUrl] = useState("");
  const [intent, setIntent] = useState<"reimagine" | "register" | "create" | null>(null);
  const [siteFocused, setSiteFocused] = useState(false);
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [working, setWorking] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [stage, setStage] = useState<Stage>("");
  const [handing, setHanding] = useState(false);
  const [handoff, setHandoff] = useState("");
  const [cursorApi, setCursorApi] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReimagineOk | null>(null);
  const [looks, setLooks] = useState<LookInfo[] | null>(null);
  const [focusedLook, setFocusedLook] = useState("");
  const [chosenLook, setChosenLook] = useState("");
  const [looksNote, setLooksNote] = useState("");
  const [retryingId, setRetryingId] = useState("");
  const [facts, setFacts] = useState<SiteFacts | null>(null);
  const [variation, setVariation] = useState(0);
  const [mailed, setMailed] = useState<string>("");
  const [checkingName, setCheckingName] = useState(false);
  const [offers, setOffers] = useState<DomainOffer[] | null>(null);
  const [domainNote, setDomainNote] = useState("");
  const [leadSent, setLeadSent] = useState(false);
  const [choosingSend, setChoosingSend] = useState(false);
  const lead = useRef<{ form: PendingLead; sent: boolean } | null>(null);
  const choosing = useRef(false);
  const draftRef = useRef<HTMLElement>(null);
  const scrollOnResult = useRef(false);

  // A page reload starts fresh: results, looks, and wizard answers are kept only in memory.
  // Earlier versions saved them in localStorage; remove those copies so they can't come back.
  // Previews stay reachable at their /made/<id> links.
  useEffect(() => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (/^reimago-(reimagine|create-brief)-v\d+$/.test(key)) localStorage.removeItem(key);
      }
    } catch {
      // Storage may be blocked; nothing to clean.
    }
  }, []);

  useEffect(() => {
    cursorStatus()
      .then((status) => setCursorApi(Boolean(status?.api)))
      .catch(() => setCursorApi(false));
  }, []);

  useEffect(() => {
    if (!scrollOnResult.current || (!result && !looks)) return;
    scrollOnResult.current = false;
    draftRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result, looks]);

  /**
   * Phase 1: plan the pages + three design directions, then build each look's images and
   * homepage in parallel (three separate requests, so none of them runs into host time limits).
   */
  async function makeLooks(nextFacts: SiteFacts, nextVariation: number): Promise<{ looks: LookInfo[]; note: string }> {
    setStage("dream");
    const planned = await previewDirections({ data: { facts: nextFacts, variation: nextVariation } });
    if (!planned.ok) throw new Error(planned.error);
    setStage("paint");
    const settled = await Promise.allSettled(
      planned.directions.map((direction, index) =>
        previewLook({ data: { facts: nextFacts, plan: planned.plan, direction, index, variation: nextVariation } }),
      ),
    );
    const made: LookInfo[] = [];
    const notes = [planned.note ?? ""];
    let firstError = "";
    for (const item of settled) {
      if (item.status === "fulfilled" && item.value.ok) {
        made.push(item.value.look);
        // Per-look AI failures are shown (with the exact reason) on that look's card.
      } else if (!firstError) {
        firstError = item.status === "fulfilled" ? (item.value.ok ? "" : item.value.error) : item.reason instanceof Error ? item.reason.message : "";
      }
    }
    if (!made.length) throw new Error(firstError || "The looks could not be built. Try again.");
    if (made.length < planned.directions.length) notes.push(`${planned.directions.length - made.length} look could not be built this time.`);
    made.sort((a, b) => a.index - b.index);
    const note = notes.filter(Boolean).filter((v, i, list) => list.indexOf(v) === i).join(" ");
    return { looks: made, note };
  }

  function showLooks(nextLooks: LookInfo[], note: string) {
    setLooks(nextLooks);
    setFocusedLook(nextLooks[0]!.id);
    setChosenLook("");
    setLooksNote(note);
    setResult(null);
  }

  /** "Retry with AI": re-run the AI for a look's homepage (or a finished site's fallback pages). */
  async function retryAi(look: LookInfo) {
    setError("");
    setRetryingId(look.id);
    try {
      const done = await previewRetryAi({ data: { id: look.id } });
      if (!done.ok) throw new Error(done.error);
      const nextLooks = (looks ?? []).map((item) =>
        item.id === look.id ? { ...item, aiError: done.errors.home, aiWarning: undefined, rev: (item.rev ?? 0) + 1 } : item,
      );
      setLooks(nextLooks);
      const nextResult = done.result ? { ...done.result, preview: done.result.preview ? { ...done.result.preview, rev: (result?.preview?.rev ?? 0) + 1 } : undefined } : result;
      if (done.result) setResult(nextResult);
      if (done.note) setError(done.note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The AI retry failed. Try again.");
    } finally {
      setRetryingId("");
    }
  }

  /**
   * Phase 2: the visitor chose a look — build every page in that style, then (once per preview) take a
   * picture of that look's homepage and send the held form to Formcarry. Double clicks are ignored.
   */
  async function chooseLook(look: LookInfo) {
    if (choosing.current) return;
    choosing.current = true;
    const pending = lead.current && !lead.current.sent ? lead.current : null;
    // Claim the submission before any await, so a second click can never send it again.
    if (pending) pending.sent = true;
    setError("");
    setChoosingSend(Boolean(pending));
    setRetrying(true);
    setStage("finish");
    let built: ReimagineOk | undefined;
    try {
      try {
        const finished = await previewFinish({ data: { id: look.id } });
        if (!finished.ok) throw new Error(finished.error);
        built = finished.result;
        setChosenLook(look.id);
        setFocusedLook(look.id);
        setResult(finished.result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "That look could not be finished. Try again.");
      }
      if (!pending) return;
      // Even if the other pages failed, the brief goes out with this look's homepage (never lose the lead).
      const form = pending.form;
      const domain = form.kind === "reimagine" ? bareDomain(form.website) : bareDomain(form.brief.domain || form.brief.existing_site || form.brief.business_name || "new-site");
      setStage("picture");
      const picture = await previewPicture(look, domain);
      setStage("send");
      const previewUrl = built?.preview?.url ?? look.url;
      const previewPages = built?.preview?.pages.map((page) => `${page.title}: ${page.url}`) ?? [`${look.name} · Home: ${look.url}`];
      const chosenLookName = `${look.name} (${ARCHETYPE_LABEL[look.archetype] ?? look.archetype})`;
      try {
        if (form.kind === "reimagine") {
          await submitFormcarry({ email: form.email, website: form.website, note: form.note, gotcha: form.gotcha, previewUrl, previewPages, chosenLook: chosenLookName, picture });
        } else {
          await submitCreateBrief(form.email, form.gotcha, form.brief, form.files, { previewUrl, previewPages, chosenLook: chosenLookName, picture });
        }
        setLeadSent(true);
        setMailed(picture.file ? THANKS : THANKS_NO_PICTURE);
      } catch (err) {
        pending.sent = false;
        setError(`Your site is built, but the form could not be sent: ${err instanceof Error ? err.message : "try again"}. Press Choose this look again to resend.`);
      }
    } finally {
      choosing.current = false;
      setRetrying(false);
      setChoosingSend(false);
      setStage("");
    }
  }

  async function lookupDomain(nameInput?: string) {
    setError("");
    setOffers(null);
    setDomainNote("");
    const name = (nameInput ?? url).trim();
    if (!name) {
      setError("Enter your domain.");
      return;
    }
    setCheckingName(true);
    try {
      const result = await checkDomainName({ data: { name } });
      setOffers(result.offers);
      setDomainNote(result.note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The domain check did not answer.");
    } finally {
      setCheckingName(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const site = url.trim();
    if (!intent) {
      setError("Choose Reimagine My Website, Register a Domain, or Create a New Site.");
      return;
    }
    if (intent === "create") return;
    if (!site || site === "https://" || site === "http://") {
      setError(
        intent === "reimagine" ? "Enter your site." : intent === "register" ? "Enter your domain." : "Enter a site to emulate.",
      );
      return;
    }
    if (intent === "register") {
      await lookupDomain(site);
      return;
    }
    if (!isEmail(email.trim())) {
      setError("Enter an email so sales can follow up.");
      return;
    }
    if (!agreed) {
      setError("Agree to the terms before we fetch the site.");
      return;
    }
    setWorking(true);
    setMailed("");
    setHandoff("");
    setLeadSent(false);
    lead.current = null;
    const gotcha = new FormData(event.currentTarget).get("_gotcha");
    try {
      setStage("read");
      const read = await previewRead({ data: { url: site, notes: notes.trim() } });
      if (!read.ok) {
        setError(read.error);
        return;
      }
      const made = await makeLooks(read.facts, 0);
      setFacts(read.facts);
      setVariation(0);
      scrollOnResult.current = true;
      showLooks(made.looks, [read.facts.note, made.note].filter(Boolean).join(" "));
      // Nothing is sent yet: the form goes to Formcarry once, when the visitor chooses a look.
      lead.current = {
        form: { kind: "reimagine", email: email.trim(), website: site, note: notes.trim(), gotcha: typeof gotcha === "string" ? gotcha : "" },
        sent: false,
      };
      setMailed(CHOOSE_PROMPT);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The preview could not be made.");
    } finally {
      setWorking(false);
      setStage("");
    }
  }

  async function buildNewSite(brief: CreateBrief, files: CreateFiles) {
    setError("");
    if (!isEmail(email.trim())) {
      setError("Enter an email so sales can follow up.");
      return;
    }
    if (!agreed) {
      setError("Agree to the terms before we build the site.");
      return;
    }
    setWorking(true);
    setMailed("");
    setHandoff("");
    setLeadSent(false);
    lead.current = null;
    let made: { looks: LookInfo[]; note: string } | null = null;
    let buildError = "";
    try {
      const gotcha = document.querySelector<HTMLInputElement>('input[name="_gotcha"]')?.value ?? "";
      try {
        setStage("read");
        const start = await previewFromBrief({ data: { brief: brief as unknown as Record<string, unknown> } });
        if (!start.ok) throw new Error(start.error);
        made = await makeLooks(start.facts, 0);
        setFacts(start.facts);
        setVariation(0);
      } catch (err) {
        buildError = err instanceof Error ? err.message : "The preview could not be built.";
      }
      if (!made) {
        // No looks to choose from: send the brief now (as before), so the answers still reach sales.
        setStage("send");
        await submitCreateBrief(email.trim(), gotcha, brief, files);
        setLeadSent(true);
        setMailed(THANKS_NO_LOOKS);
        setError(buildError);
        return;
      }
      // Looks were built: hold the brief until the visitor chooses one (sent once, with its picture).
      lead.current = { form: { kind: "create", email: email.trim(), gotcha, brief, files }, sent: false };
      setMailed(CHOOSE_PROMPT);
      scrollOnResult.current = true;
      showLooks(made.looks, made.note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The form could not be sent. Try again.");
    } finally {
      setWorking(false);
      setStage("");
    }
  }

  async function tryAgain() {
    if (!result && !looks) return;
    if (!facts) {
      setError("Run the site again to build a new version.");
      return;
    }
    setRetrying(true);
    setError("");
    try {
      const nextVariation = variation + 1;
      const made = await makeLooks(facts, nextVariation);
      setVariation(nextVariation);
      showLooks(made.looks, made.note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "A new version could not be built.");
    } finally {
      setRetrying(false);
      setStage("");
    }
  }

  function downloadBlob(blob: Blob, name: string) {
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = name;
    link.click();
    URL.revokeObjectURL(href);
  }

  async function handOff() {
    const previewUrl = result?.preview?.url ?? result?.pageUrl;
    if (!result || !previewUrl) return;
    const submitted = url.trim() || result.layout?.submitted || result.finalUrl;
    const layout = {
      submitted,
      url: result.layout?.url || result.finalUrl,
      title: result.layout?.title || result.foundTitle,
      description: result.layout?.description || result.foundDescription,
      nav: result.layout?.nav?.length ? result.layout.nav : result.draft.nav,
      headings: result.layout?.headings ?? [],
      text: result.layout?.text || result.diagnosis,
    };
    const pages = result.preview?.pages.map((page) => `${page.title}: ${page.url}`) ?? [previewUrl];
    const domain = bareDomain(submitted || result.host);
    setHanding(true);
    setHandoff("");
    try {
      if (cursorApi) {
        const sent = await handOffToCursor({
          data: { host: result.host, ...layout, notes: notes.trim(), previewUrl, pages },
        });
        if (sent.ok) {
          setHandoff(`Cursor started building it: ${sent.url}`);
          return;
        }
        setHandoff(`${sent.error} Downloading the brief instead.`);
      }
      const brief = [
        "# Cursor handoff",
        "",
        "Open this folder in the Cursor you already use. Do not sign out of that account.",
        "",
        `Rebuild the website from the form: ${submitted}`,
        `Start from the live preview: ${previewUrl}`,
        "Open every preview page below and match its layout, colors, type, copy, and navigation.",
        pages.map((page) => `- ${page}`).join("\n"),
        "Never invent phone numbers, emails, or addresses. Do not change the live site.",
        "",
        `Fetched page: ${layout.url}`,
        layout.title ? `Title: ${layout.title}` : "",
        layout.description ? `Description: ${layout.description}` : "",
        layout.nav.length ? `Navigation: ${layout.nav.join(" · ")}` : "",
        layout.headings.length ? `Headings:\n${layout.headings.map((heading) => `- ${heading}`).join("\n")}` : "",
        notes.trim() ? `Customer note: ${notes.trim()}` : "",
        layout.text ? `Page text:\n${layout.text}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      downloadBlob(new Blob([brief], { type: "text/markdown" }), `${domain}-cursor.md`);
      setHandoff((current) =>
        `${current ? `${current} ` : ""}Saved ${domain}-cursor.md with the preview links. Open it in the Cursor you already use.`,
      );
    } catch (err) {
      setHandoff(err instanceof Error ? err.message : "The handoff could not be saved.");
    } finally {
      setHanding(false);
    }
  }

  async function copyBrief() {
    if (!result) return;
    const text = `${result.draft.name}\n${result.draft.headline}\n${result.draft.subhead}\n\n${result.diagnosis}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError("Copy failed in this browser. Use the email link instead.");
    }
  }

  return (
    <SiteShell>
      {working || retrying ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/50 backdrop-blur-[3px]"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center">
            <div className="relative size-48" aria-hidden>
              <div className="absolute inset-3 rounded-full border border-fg/30" />
              <div
                className="clock-sweep absolute top-1/2 left-[calc(50%-1.25rem)] h-20 w-10 origin-bottom"
                style={{ marginTop: "-5rem" }}
              >
                <span className="clock-digit absolute left-1/2 top-0 font-display text-5xl italic leading-none text-fg">
                  1
                </span>
                <span className="absolute top-10 bottom-0 left-1/2 w-px -translate-x-1/2 bg-fg" />
              </div>
              <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg" />
            </div>
            <p className="mt-6 text-sm font-medium text-fg">
              {choosingSend
                ? "Building your site and preparing your picture…"
                : stage === "finish"
                  ? "Building your site in this look"
                  : (LOOK_STAGES.find((item) => item.key === stage)?.label ?? "Building your site")}
            </p>
            <ol className="mt-4 space-y-1.5 text-sm">
              {(choosingSend
                ? CHOOSE_STAGES
                : stage === "finish"
                  ? FINISH_STAGES
                  : LOOK_STAGES.filter((item) => (item.key !== "send" && item.key !== "picture") || stage === "send" || stage === "picture")
              ).map((item) => {
                const list = choosingSend ? CHOOSE_STAGES : stage === "finish" ? FINISH_STAGES : LOOK_STAGES;
                const order = list.findIndex((entry) => entry.key === item.key);
                const current = list.findIndex((entry) => entry.key === stage);
                const done = current > order;
                const active = current === order;
                return (
                  <li
                    key={item.label}
                    className={`flex items-center gap-2 ${active ? "text-fg" : done ? "text-muted" : "text-faint"}`}
                  >
                    <span aria-hidden className="inline-block w-4 text-center">
                      {done ? "✓" : active ? "•" : "○"}
                    </span>
                    {item.label}
                  </li>
                );
              })}
            </ol>
            <p className="mt-4 max-w-xs text-center text-xs text-muted">
              {choosingSend || stage === "finish" ? "This usually takes about a minute." : "Three looks take a minute or two — worth the wait."}
            </p>
          </div>
        </div>
      ) : null}
      <main>
        <section className="mx-auto grid w-full max-w-6xl grid-cols-[250px_minmax(0,1fr)] items-start gap-3 px-4 py-6 sm:gap-8 sm:px-6">
          <div className="w-[250px]">
            <Wordmark className="size-[250px]" />
            <h1 className="mt-3 text-center font-display leading-tight">
              <span className="block text-4xl text-ink">Let AI:</span>
              <span className="mt-1 block whitespace-nowrap font-display text-[1.75rem] italic text-primary">
                Reimagine Your Website
              </span>
            </h1>
          </div>
          <div className="min-w-0">
            <form onSubmit={onSubmit} className="rounded-2xl border-2 border-primary bg-bg p-4 shadow-[0_18px_40px_-24px_rgba(0,104,232,0.85)] sm:p-6">
              <div className="space-y-4">
                <fieldset className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                  <label className="flex items-center gap-2.5 text-sm font-medium text-fg">
                    <input
                      type="checkbox"
                      checked={intent === "reimagine"}
                      onChange={(event) => setIntent(event.target.checked ? "reimagine" : null)}
                      className="size-4 shrink-0 accent-primary"
                    />
                    Reimagine My Website
                  </label>
                  <label className="flex items-center gap-2.5 text-sm font-medium text-fg">
                    <input
                      type="checkbox"
                      checked={intent === "register"}
                      onChange={(event) => {
                        setIntent(event.target.checked ? "register" : null);
                        setOffers(null);
                        setDomainNote("");
                      }}
                      className="size-4 shrink-0 accent-primary"
                    />
                    Register a Domain
                  </label>
                  <label className="flex items-center gap-2.5 text-sm font-medium text-fg">
                    <input
                      type="checkbox"
                      checked={intent === "create"}
                      onChange={(event) => setIntent(event.target.checked ? "create" : null)}
                      className="size-4 shrink-0 accent-primary"
                    />
                    Create a New Site
                  </label>
                </fieldset>
                <input
                  type="text"
                  name="_gotcha"
                  tabIndex={-1}
                  autoComplete="off"
                  defaultValue=""
                  aria-hidden="true"
                  className="pointer-events-none absolute -left-[9999px] h-px w-px opacity-0"
                />
                {intent === "create" ? (
                  <CreateSiteWizard
                    email={email}
                    setEmail={setEmail}
                    agreed={agreed}
                    setAgreed={setAgreed}
                    working={working}
                    error={error}
                    mailed={mailed}
                    onBuild={(brief, files) => void buildNewSite(brief, files)}
                  />
                ) : (
                  <>
                <label className="block" htmlFor="site-url">
                  <input
                    id="site-url"
                    name="url"
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value);
                      setOffers(null);
                      setDomainNote("");
                    }}
                    onFocus={() => setSiteFocused(true)}
                    onBlur={() => setSiteFocused(false)}
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={
                      intent === "register"
                        ? "Enter your domain here. Let AI help you find a good one."
                        : siteFocused && intent === "reimagine"
                          ? "Enter Your Site Here"
                          : "https://www.site.com"
                    }
                    className={
                      intent
                        ? `${fieldClass} border-2 border-primary bg-bg ring-2 ring-primary/30 placeholder:text-primary`
                        : fieldClass
                    }
                  />
                </label>
                {intent === "register" && domainNote ? <p className="text-sm text-muted">{domainNote}</p> : null}
                {intent === "register" && offers ? (
                  <ul className="space-y-1 text-sm">
                    {offers.map((offer) => (
                      <li key={offer.domain} className="flex items-center justify-between gap-3">
                        <span className="text-fg">{offer.domain}</span>
                        <span className={offer.state === "available" ? "font-medium text-primary" : "text-muted"}>
                          {offer.state === "available"
                            ? "Available"
                            : offer.state === "taken"
                              ? "Taken"
                              : offer.state === "premium"
                                ? "Premium, not offered"
                                : "Unknown"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block" htmlFor="site-email">
                    <span className="text-sm font-medium text-fg">Email</span>
                    <input
                      id="site-email"
                      name="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      type="email"
                      autoComplete="email"
                      required
                      placeholder="you@company.com"
                      className={fieldClass}
                    />
                  </label>
                  <label className="block" htmlFor="site-notes">
                    <span className="text-sm font-medium text-fg">What should change?</span>
                    <textarea
                      id="site-notes"
                      name="notes"
                      value={notes}
                      maxLength={800}
                      onChange={(event) => setNotes(event.target.value)}
                      rows={2}
                      placeholder="Clearer offer. Faster. Feels like us."
                      className="mt-1.5 flex min-h-16 w-full rounded-md border border-border bg-bg px-3 py-2.5 text-sm text-fg outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring/70 sm:min-h-22"
                    />
                  </label>
                </div>
                <label className="flex items-start gap-2.5 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(event) => setAgreed(event.target.checked)}
                    className="mt-1 size-4 shrink-0 accent-fg"
                  />
                  <span>
                    I agree to the{" "}
                    <Link to="/terms" className="text-fg underline-offset-4 hover:underline">
                      Terms of Service
                    </Link>{" "}
                    and{" "}
                    <Link to="/privacy" className="text-fg underline-offset-4 hover:underline">
                      Privacy Policy
                    </Link>
                    .
                  </span>
                </label>
                <button
                  type="submit"
                  disabled={working || checkingName}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-accent px-6 text-sm font-semibold text-ink transition-transform duration-150 ease-out hover:bg-accent/90 active:scale-[0.96] disabled:opacity-40 sm:w-auto"
                >
                  {working ? "Building the site…" : checkingName ? "Checking…" : intent === "register" ? "Find a domain" : "Reimagine my site"}
                  {working || checkingName ? null : <ArrowRight className="size-4" aria-hidden />}
                </button>
                {error ? (
                  <p className="text-sm text-danger" role="alert">
                    {error}
                  </p>
                ) : null}
                {mailed ? <p className="text-sm text-muted">{mailed}</p> : null}
                  </>
                )}
                <button
                  type="button"
                  className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline"
                  onClick={() => {
                    setIntent("reimagine");
                    setUrl("https://reimago.ai");
                    setNotes(
                      "Retire the feature catalog. Make this a studio that reimagines a customer's website.",
                    );
                  }}
                >
                  Try it on reimago.ai
                </button>
              </div>
            </form>
          </div>
        </section>

        {result || looks ? (
          <section ref={draftRef} className="scroll-mt-16 border-t border-border">
            <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
              {looks ? (
                <LooksPicker
                  looks={looks}
                  focused={focusedLook}
                  chosen={chosenLook || undefined}
                  busy={retrying || working}
                  onFocus={setFocusedLook}
                  onChoose={(look) => void chooseLook(look)}
                  onRetry={(look) => void retryAi(look)}
                  retryingId={retryingId}
                  sent={leadSent}
                />
              ) : null}
              {looksNote && !result ? <p className="mt-3 text-sm text-faint">{looksNote}</p> : null}
              <div className="mt-6">
                {(() => {
                  const focused = looks?.find((look) => look.id === focusedLook);
                  if (result?.preview && (!focused || focused.id === chosenLook)) {
                    return <LivePreview key={`full-${result.preview.id}-${result.preview.rev ?? 0}`} preview={result.preview} host={result.host} />;
                  }
                  if (focused)
                    return (
                      <LivePreview
                        key={`look-${focused.id}-${focused.rev ?? 0}`}
                        preview={lookPreview(focused)}
                        host={facts?.host || bareDomain(url) || focused.name}
                        choice={{
                          lookName: focused.name,
                          onChoose: () => void chooseLook(focused),
                          disabled: retrying || working || (focused.id === chosenLook && leadSent),
                          chosen: focused.id === chosenLook,
                        }}
                      />
                    );
                  return (
                    <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
                      This saved draft was made with an older preview. Run the site again to build new looks.
                    </p>
                  );
                })()}
              </div>
              {looks && !result ? (
                <p className="mt-3 text-sm text-muted">
                  Homepages only for now — press <strong>Choose this look</strong> to build every page in that style and get a picture by email.
                </p>
              ) : null}
              {result?.preview?.polish && result.preview.polish.notes.length ? (
                <div className="mt-4 rounded-2xl border border-border bg-surface p-4 text-sm">
                  <p className="font-medium text-fg">
                    Designer polish{result.preview.polish.method === "vision" ? " (reviewed from a screenshot)" : ""}
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                    {result.preview.polish.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void tryAgain()}
                  disabled={retrying || !facts}
                  className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-surface px-6 text-sm font-medium disabled:opacity-40"
                >
                  {retrying && stage !== "finish" ? "Dreaming up new looks…" : "Try Again: new looks"}
                </button>
                {result ? (
                  <button
                    type="button"
                    onClick={() => void handOff()}
                    disabled={handing || !result.preview}
                    className="inline-flex h-12 items-center justify-center rounded-md bg-ink px-6 text-sm font-medium text-white disabled:opacity-40"
                  >
                    {handing ? "Handing off…" : cursorApi ? "Send to Cursor" : "Hand off to Cursor"}
                  </button>
                ) : null}
              </div>
              {handoff ? <p className="mt-3 text-sm text-muted">{handoff}</p> : null}
            </div>
            {result ? (
            <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[16rem_1fr]">
              <aside>
                <p className="text-xs font-medium uppercase tracking-eyebrow text-faint">What we read</p>
                <p className="mt-3 font-display text-2xl italic leading-tight">{result.foundTitle}</p>
                {result.foundDescription ? (
                  <p className="mt-3 text-sm leading-relaxed text-muted">{result.foundDescription}</p>
                ) : null}
                <p className="mt-4 text-sm leading-relaxed text-muted">{result.diagnosis}</p>
                <ul className="mt-4 space-y-2 text-sm">
                  {result.honored.map((item) => (
                    <li key={item} className="border-l border-border pl-3 text-fg">
                      {item}
                    </li>
                  ))}
                </ul>
                {result.note ? <p className="mt-4 text-sm leading-relaxed text-faint">{result.note}</p> : null}
                {result.preview?.aiErrors && Object.keys(result.preview.aiErrors).length && chosenLook ? (
                  <button
                    type="button"
                    disabled={Boolean(retryingId) || retrying}
                    onClick={() => {
                      const look = looks?.find((item) => item.id === chosenLook);
                      if (look) void retryAi(look);
                    }}
                    className="mt-3 inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium disabled:opacity-50"
                  >
                    {retryingId ? "Retrying with AI…" : "Retry with AI"}
                  </button>
                ) : null}
              </aside>
              <div>
                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <a
                    href={briefMailto(email, url, notes, result)}
                    className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-fg"
                  >
                    Email this brief
                  </a>
                  <button
                    type="button"
                    onClick={() => void copyBrief()}
                    className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-surface px-6 text-sm"
                  >
                    Copy the draft
                  </button>
                </div>
                <p className="mt-3 text-sm text-muted">
                  {mailed || "The preview link is emailed to marketing@reimago.ai."}{" "}
                  Nothing was changed on {result.host}.
                </p>
              </div>
            </div>
            ) : (
              <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
                <p className="text-sm text-muted">{mailed || "The look links are emailed to marketing@reimago.ai."}</p>
              </div>
            )}
          </section>
        ) : null}

        <section id="how-it-works" className="scroll-mt-16 border-t border-primary/20 bg-surface">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-4 pb-16 sm:px-6 md:grid-cols-3">
            {[
              ["01", "Enter your site", "URL, email, and what you want changed. That is the brief."],
              ["02", "We crawl it", "The Reimago bot reads public pages — titles, structure, voice — then Grok designs."],
              ["03", "Review the draft", "A new site, on screen. Call us when you want it built."],
            ].map(([index, title, body]) => (
              <div key={index}>
                <p className="font-display text-2xl italic text-accent tabular-nums">{index}</p>
                <h2 className="mt-3 text-lg font-medium">{title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="flex items-end justify-between gap-4">
              <h2 className="font-display text-3xl leading-tight sm:text-4xl">Four things we rebuild</h2>
              <ArrowRight className="hidden size-8 -rotate-45 text-accent sm:block" aria-hidden />
            </div>
            <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
              {REBUILDS.map(([title, body]) => (
                <article key={title} className="border-t-4 border-accent bg-bg p-6 sm:p-8">
                  <h3 className="font-display text-2xl italic">{title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border bg-ink text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-2 md:items-center">
            <div>
              <p className="text-xs font-medium uppercase tracking-eyebrow text-accent">Twenty years</p>
              <h2 className="mt-3 font-display text-3xl leading-tight sm:text-4xl">
                We used to power the networks. Now we redesign the rest of the web.
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-white/80 sm:text-base">
              Reimago spent two decades shipping social software, community platforms, and enterprise sign-on —
              including work for clubs and brands that needed their own network, not a rented one. That market
              moved to Instagram, Facebook, and X. The craft stayed. Enter a URL. We will show you what your site
              should have been.
            </p>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
