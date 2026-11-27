import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { MarketingBubble } from "@/components/marketing-bubble";
import { DomainChip, DomainPicker } from "@/components/domain-picker";
import { ModeChoices, NewSiteForm, type LogoSource, type ModeChoice } from "@/components/new-site-form";
import { SELECTED_NOT_REGISTERED } from "@/lib/domain-ideas";
import { bareHost, briefForFacts, emptyNewSite, extraLeadFields, newSiteProblem, type NewSiteBrief } from "@/lib/new-site";
import { checkSiteReachable, recordRenderTime, renderAverage } from "@/lib/preview.functions";
import { ProgressRing, RotatingStatus } from "@/components/progress-ring";
import { statusLines } from "@/lib/status-copy";
import { previewCustom, previewDirections, previewImagine, previewFinish, previewFromBrief, previewLook, previewRead, previewRefine, previewRetryAi, previewUploadLogo, previewUploadPhotos, savePreviewPicture } from "@/lib/preview.functions";
import { capturePreviewPicture, pictureFileName } from "@/lib/preview-picture";
import { logSubmit, notifyReplyWebhook } from "@/lib/reply-webhook.functions";
import { saveLead } from "@/lib/leads.functions";
import { newLeadId } from "@/lib/leads";
import { captureAttribution } from "@/lib/attribution";
import { LivePreview } from "@/components/live-preview";
import { CardEditBox, LooksPicker } from "@/components/looks-picker";
import type { LookInfo, PreviewInfo, SiteFacts } from "@/lib/preview/types";
import type { ReimagineOk } from "@/lib/reimagine-types";


const REBUILDS = [
  ["Website", "A new first impression. Structure, copy, and conversion — rebuilt from what you already have."],
  ["Business", "Positioning, offers, and the story a stranger can understand in ten seconds."],
  ["Customer Service", "Help that feels like the brand: clearer answers, calmer paths, fewer dead ends."],
  ["Life", "Personal sites, practices, and reputations that should look like the work behind them."],
] as const;


type Stage = "" | "check" | "read" | "dream" | "paint" | "picture" | "send" | "finish";

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
// Round 13: "check your email" only when the reply webhook (Email Bot) answered 2xx. Otherwise be honest: the team has it, the reply follows.
const LATER = "Got it! We'll email you shortly. The site, your email, the note, the look you chose, and a link to it were sent to our team. Nothing on the live site was changed.";
const thanksFor = (picture: boolean, replied: boolean) => (replied ? (picture ? THANKS : THANKS_NO_PICTURE) : LATER);
/** Shown when the looks are ready: the brief waits until the visitor chooses one. */
const CHOOSE_PROMPT = "Your looks are ready below. Choose the one you like and we'll build every page in that style and email you a picture. Nothing is sent until you choose.";

/**
 * The visitor's form, held until they choose a look. Round 10: every look they choose is sent (once per look),
 * so a second "Choose this look" on a different look or variant is never silently dropped.
 */
type PendingLead =
  | { kind: "reimagine"; email: string; website: string; note: string; gotcha: string }
  | { kind: "new_site"; email: string; gotcha: string; brief: NewSiteBrief; logo: File | null; logoUrl: string; logoSource: LogoSource; photos: File[]; photoUrls: string[] };

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

/** "Not quite right?" rounds for the email, numbered, oldest first. */
function changeRequestsText(rounds?: string[]): string {
  return (rounds ?? []).map((text, i) => `${i + 1}. ${text}`).join("\n");
}

const MAX_FEEDBACK = 5;

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
  changeRequests?: string[];
  picture?: PictureFields;
  designMockupUrl?: string;
}): Promise<void> {
  const domain = bareDomain(fields.website);
  const data = new FormData();
  data.append("email", fields.email);
  data.append("website", domain);
  data.append("note", fields.note);
  data.append("_gotcha", fields.gotcha);
  data.append("mode", "reimagine");
  data.append("preview_url", fields.previewUrl ?? "");
  data.append("preview_pages", (fields.previewPages ?? []).join("\n"));
  data.append("chosen_look", fields.chosenLook ?? "");
  data.append("change_requests", changeRequestsText(fields.changeRequests));
  appendPicture(data, fields.picture);
  // The Custom Design look's Grok Imagine mockup (the picture stays the built page's screenshot).
  if (fields.designMockupUrl) data.append("design_mockup_url", fields.designMockupUrl);

  await postFormcarry(data);
}

/** Round 10: one POST to Formcarry; throws (with the HTTP status) unless Formcarry answers code 200. */
class SubmitError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
async function postFormcarry(data: FormData): Promise<number> {
  const response = await fetch(FORMCARRY, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: data,
  });
  const json = (await response.json().catch(() => null)) as { code?: number; message?: string } | null;
  if (json?.code !== 200) {
    // Formcarry answers HTTP 200 with its own code in the body: report that code (else the HTTP status).
    throw new SubmitError(json?.message || `The form could not be sent (status ${response.status}). Try again.`, typeof json?.code === "number" && json.code !== 200 ? json.code : response.status);
  }
  return response.status;
}

/** Round 10 — "Build a New Site": mode=new_site, the business details and the domain choice. */
async function submitNewSite(
  email: string,
  gotcha: string,
  brief: NewSiteBrief,
  logo: File | null,
  logoUrl: string,
  logoSource: LogoSource,
  photos: File[],
  photoUrls: string[],
  chosen?: { previewUrl: string; previewPages: string[]; chosenLook: string; changeRequests?: string[]; picture?: PictureFields },
  pickedDomain = "",
): Promise<void> {
  const data = new FormData();
  data.append("email", email);
  data.append("website", brief.domain_choice === "have" ? bareHost(brief.domain) : brief.business_name.trim() || "new-site");
  data.append("note", brief.style.trim());
  data.append("_gotcha", gotcha);
  data.append("mode", "new_site");
  data.append("business_name", brief.business_name.trim());
  data.append("what_and_who", brief.what.trim());
  data.append("location", brief.location.trim());
  data.append("style", brief.style.trim());
  // "have" (they own it; the domain is sent) or "get" (domain, email & hosting wanted; only recorded, nothing bought).
  data.append("domain_choice", brief.domain_choice === "have" ? "have_domain" : brief.domain_choice === "get" ? "get_domain_email_hosting" : "");
  data.append("domain", brief.domain_choice === "have" ? bareHost(brief.domain) : "");
  // Round 11: the name picked in the "Pick your domain" pop-up. NOT registered: it is reserved at checkout later.
  if (brief.domain_choice === "get") {
    data.append("chosen_domain", pickedDomain);
    data.append("domain_status", pickedDomain ? SELECTED_NOT_REGISTERED : "not_selected");
  }
  if (logoUrl) data.append("logo_url", logoUrl);
  if (logo && logo.size < 10_000_000) data.append("logo", logo, logo.name);
  if (logoSource && (logoUrl || logo)) data.append("logo_source", logoSource);
  const extras = extraLeadFields(brief, photoUrls);
  for (const [key, value] of Object.entries(extras)) data.append(key, value);
  photos.slice(0, 12).forEach((file, i) => {
    if (file.size < 10_000_000) data.append(i === 0 ? "photos" : `photos_${i + 1}`, file, file.name);
  });
  data.append("preview_url", chosen?.previewUrl ?? "");
  if (chosen) {
    data.append("preview_pages", chosen.previewPages.join("\n"));
    data.append("chosen_look", chosen.chosenLook);
    data.append("change_requests", changeRequestsText(chosen.changeRequests));
  }
  appendPicture(data, chosen?.picture);
  await postFormcarry(data);
}

export function HomePage() {
  const [url, setUrl] = useState("");
  const [intent, setIntent] = useState<ModeChoice | null>(null);
  const [newSite, setNewSite] = useState<NewSiteBrief>(emptyNewSite);
  const [newLogo, setNewLogo] = useState<File | null>(null);
  const [newLogoUrl, setNewLogoUrl] = useState("");
  const [logoSource, setLogoSource] = useState<LogoSource>("");
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  const [siteFocused, setSiteFocused] = useState(false);
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [working, setWorking] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [stage, setStage] = useState<Stage>("");
  const [error, setError] = useState("");
  // Round 13: a read that can't continue offers the next step inline (never a bare error).
  const [recovery, setRecovery] = useState<{ kind: "thin" | "unreadable" | "unreachable" } | null>(null);
  const [details, setDetails] = useState("");
  const [result, setResult] = useState<ReimagineOk | null>(null);
  const [looks, setLooks] = useState<LookInfo[] | null>(null);
  const [focusedLook, setFocusedLook] = useState("");
  const [chosenLook, setChosenLook] = useState("");
  // Round 11: "Pick your domain" pop-up (New Site + "Get me a domain, email & hosting"). Read-only: nothing is registered.
  const [domainBrief, setDomainBrief] = useState<NewSiteBrief | null>(null);
  const [domainOpen, setDomainOpen] = useState(false);
  const [pickedDomain, setPickedDomain] = useState("");
  const pickedDomainRef = useRef("");
  const [looksNote, setLooksNote] = useState("");
  const [retryingId, setRetryingId] = useState("");
  const [facts, setFacts] = useState<SiteFacts | null>(null);
  const [variation, setVariation] = useState(0);
  const [mailed, setMailed] = useState<string>("");
  const [leadSent, setLeadSent] = useState(false);
  /** Round 13: the Email Bot reply webhook answered 2xx for the latest pick (false = "We'll email you shortly"). */
  const [replyOk, setReplyOk] = useState(false);
  const [feedback, setFeedback] = useState<string[]>([]);
  const [refining, setRefining] = useState(false);
  /** The card being changed from its own "Change this look" box. */
  const [editingId, setEditingId] = useState("");
  /** The look the last refine edited in place ("" after a full new round). */
  const [editedName, setEditedName] = useState("");
  /** Every look id shown this session (oldest first). */
  const seenIds = useRef<string[]>([]);
  const [choosingSend, setChoosingSend] = useState(false);
  const lead = useRef<{ form: PendingLead; sent: boolean; sentIds: string[]; visitId: string; attribution: Record<string, string> } | null>(null);
  /** Round 10: the render in progress (for the ring, the status copy and Stop). */
  const [run, setRun] = useState<{ kind: "round1" | "edit" | "newsite"; start: number; avg: number } | null>(null);
  const runAbort = useRef<AbortController | null>(null);
  const runRef = useRef<{ kind: "round1" | "edit" | "newsite"; start: number; signal: AbortSignal } | null>(null);
  const [stopped, setStopped] = useState("");
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
    if (!scrollOnResult.current || (!result && !looks)) return;
    scrollOnResult.current = false;
    draftRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result, looks]);

  /** Round 10: start a render — a fresh AbortController for Stop, and the ring's yardstick from the server. */
  function beginRun(kind: "round1" | "edit" | "newsite"): AbortSignal {
    runAbort.current?.abort();
    const controller = new AbortController();
    runAbort.current = controller;
    const start = Date.now();
    setStopped("");
    runRef.current = { kind, start, signal: controller.signal };
    setRun({ kind, start, avg: kind === "edit" ? 25_000 : kind === "newsite" ? 80_000 : 95_000 });
    renderAverage({ data: { kind } })
      .then((a) => setRun((r) => (r && r.start === start ? { ...r, avg: a.ms } : r)))
      .catch(() => undefined);
    return controller.signal;
  }

  /** A finished render's wall time goes to the server's rolling average (never a stopped or failed one). */
  function endRun(signal: AbortSignal, ok: boolean) {
    const r = runRef.current;
    if (!r || r.signal !== signal) return;
    runRef.current = null;
    setRun(null);
    if (runAbort.current?.signal === signal) runAbort.current = null;
    if (ok && !signal.aborted) void recordRenderTime({ data: { kind: r.kind, ms: Date.now() - r.start } }).catch(() => undefined);
  }

  /** Stop: abort the server work in flight, and go back to the form with everything still filled in. */
  function stopRun() {
    runAbort.current?.abort();
    runAbort.current = null;
    runRef.current = null;
    setRun(null);
    setWorking(false);
    setRetrying(false);
    setRefining(false);
    setEditingId("");
    setStage("");
    setError("");
    setStopped("Stopped. Nothing was sent, and your answers are still here. Change anything and try again.");
  }

  /**
   * Phase 1: plan the pages + three design directions, then build each look's images and
   * homepage in parallel (three separate requests, so none of them runs into host time limits).
   */
  async function makeLooks(nextFacts: SiteFacts, nextVariation: number, signal?: AbortSignal): Promise<{ looks: LookInfo[]; note: string }> {
    const stop = () => {
      if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
    };
    stop();
    setStage("dream");
    // Earlier rounds' looks (the server reads them itself) so a new round comes back visibly different.
    const planned = await previewDirections({ data: { facts: nextFacts, variation: nextVariation, previous: nextVariation ? seenIds.current.slice(-12) : [], current: nextVariation ? (looks ?? []).map((l) => l.id) : [] }, signal });
    stop();
    if (!planned.ok) throw new Error(planned.error);
    setStage("paint");
    const settled = await Promise.allSettled(
      planned.directions.map(async (direction, index) => {
        const built = await previewLook({ data: { facts: nextFacts, plan: planned.plan, direction, index, variation: nextVariation, siblings: planned.directions.filter((_, j) => j !== index) }, signal });
        stop();
        // The from-scratch look: its template build first (images, sub-pages, the fallback), then Grok's own design.
        if (!built.ok || !direction.custom) return built;
        // Grok Imagine designs it first (the mockup), then Grok builds the page to match (or from the text brief).
        await previewImagine({ data: { id: built.look.id }, signal }).catch(() => undefined);
        stop();
        let custom = await previewCustom({ data: { id: built.look.id }, signal }).catch(() => undefined);
        stop();
        // Round 14: retry once (text-brief only) before falling back to the template — timeouts and
        // host kills on the published app were leaving Bob with a bland third card.
        if (!custom?.ok) {
          custom = await previewCustom({ data: { id: built.look.id, retry: true }, signal }).catch(() => undefined);
          stop();
        }
        if (!custom?.ok) {
          const reason = custom && "error" in custom && custom.error ? ` (${String(custom.error).slice(0, 140)})` : "";
          return { ...built, look: { ...built.look, custom: { concept: direction.custom.brief.concept, status: "fallback" as const, note: `The from-scratch design could not be built this time${reason}, so this card shows a template look.` } } };
        }
        // The custom page's own picture line (Imagine art / the site's signature graphic) replaces the template step's.
        return { ...built, look: { ...built.look, name: custom.name, layout: custom.layout ?? built.look.layout, photos: custom.custom.photoLine ?? built.look.photos, custom: custom.custom, rev: (built.look.rev ?? 0) + 1 } };
      }),
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
    stop();
    if (!made.length) throw new Error(firstError || "The looks could not be built. Try again.");
    if (made.length < planned.directions.length) notes.push(`${planned.directions.length - made.length} look could not be built this time.`);
    made.sort((a, b) => a.index - b.index);
    const note = notes.filter(Boolean).filter((v, i, list) => list.indexOf(v) === i).join(" ");
    return { looks: made, note };
  }

  function showLooks(nextLooks: LookInfo[], note: string) {
    seenIds.current = [...seenIds.current, ...nextLooks.map((l) => l.id)];
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
    // Round 10: each chosen look is sent once (a different look or variant is a new submission, never dropped).
    const pending = lead.current && !lead.current.sentIds.includes(look.id) ? lead.current : null;
    const leadMode = lead.current?.form.kind === "new_site" ? "new_site" : "reimagine";
    const lookName = `${look.name}${look.edit ? ` · ${look.edit.variant}` : ""}`;
    void logSubmit({ data: { id: look.id, mode: leadMode, look: lookName, event: pending ? "choose" : "not-resent" } }).catch(() => undefined);
    // Claim the submission before any await, so a second click can never send it again.
    if (pending) pending.sentIds = [...pending.sentIds, look.id];
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
      const domain = form.kind === "reimagine" ? bareDomain(form.website) : form.brief.domain_choice === "have" ? bareHost(form.brief.domain) : form.brief.business_name.trim() || "new-site";
      setStage("picture");
      const picture = await previewPicture(look, domain);
      setStage("send");
      const previewUrl = built?.preview?.url ?? look.url;
      const previewPages = built?.preview?.pages.map((page) => `${page.title}: ${page.url}`) ?? [`${look.name} · Home: ${look.url}`];
      // One name per look (its style), plus the edit variant: "Dark Premium · lighter".
      const chosenLookName = `${look.name}${look.edit ? ` · ${look.edit.variant}` : ""}`;
      // Round 12: store the lead on the server FIRST (every pick of this visit merges into one lead), so it is never
      // lost if Formcarry or the Email Bot webhook fails. Fast, never throws, never blocks the visitor's flow.
      const leadId = pending.visitId;
      const extras = form.kind === "new_site" ? extraLeadFields(form.brief, form.photoUrls) : {};
      await saveLead({
        data: {
          id: leadId,
          gotcha: form.gotcha,
          mode: form.kind === "new_site" ? "new_site" : "reimagine",
          name: form.kind === "new_site" ? form.brief.business_name : "",
          email: form.email,
          phone: extras.phone ?? "",
          source: form.kind === "reimagine" ? form.website : form.brief.business_name,
          what: form.kind === "reimagine" ? form.note : form.brief.what,
          location: form.kind === "new_site" ? form.brief.location : "",
          style: form.kind === "new_site" ? form.brief.style : "",
          domain_choice: form.kind === "new_site" ? form.brief.domain_choice : "",
          chosen_domain: form.kind === "new_site" && form.brief.domain_choice === "get" ? pickedDomainRef.current : form.kind === "new_site" ? bareHost(form.brief.domain) : "",
          domain_status: form.kind === "new_site" ? (form.brief.domain_choice === "get" ? (pickedDomainRef.current ? SELECTED_NOT_REGISTERED : "not_selected") : "owned") : "",
          logo_source: form.kind === "new_site" ? (form.logoUrl || form.logo ? form.logoSource : "") : "",
          logo_url: form.kind === "new_site" ? form.logoUrl : "",
          change_requests: feedback,
          looks: (looks ?? []).map((l) => ({ look_id: l.id, name: `${l.name}${l.edit ? ` · ${l.edit.variant}` : ""}`, url: l.url })),
          extras,
          attribution: pending.attribution,
          pick: { look_id: look.id, look: chosenLookName, preview_url: previewUrl, pages: previewPages },
        },
      }).catch(() => undefined);
      // Email Bot's instant reply: the server posts to its webhook (key stays server-side). Not awaited — the
      // visitor's "check your email" never waits on it; retries reuse the same submission id.
      const hook = notifyReplyWebhook({
        data: {
          id: look.id,
          leadId,
          email: form.email,
          website: domain,
          note: form.kind === "reimagine" ? form.note : form.brief.style,
          mode: form.kind === "new_site" ? "new_site" : "reimagine",
          ...(form.kind === "new_site"
            ? {
                businessName: form.brief.business_name,
                domainChoice: form.brief.domain_choice,
                domain: form.brief.domain_choice === "have" ? bareHost(form.brief.domain) : "",
                ...(form.brief.domain_choice === "get" ? { chosenDomain: pickedDomainRef.current, domainStatus: pickedDomainRef.current ? SELECTED_NOT_REGISTERED : "not_selected" } : {}),
                details: extraLeadFields(form.brief, form.photoUrls),
              }
            : {}),
          previewUrl,
          previewPages,
          chosenLook: chosenLookName,
          changeRequests: feedback,
          pictureError: picture.error ?? (picture.url ? "" : "The picture was attached to the form but could not be stored."),
        },
      }).catch(() => undefined);
      try {
        if (form.kind === "reimagine") {
          await submitFormcarry({ email: form.email, website: form.website, note: form.note, gotcha: form.gotcha, previewUrl, previewPages, chosenLook: chosenLookName, changeRequests: feedback, picture, designMockupUrl: look.custom?.mockupUrl });
        } else {
          await submitNewSite(form.email, form.gotcha, form.brief, form.logo, form.logoUrl, form.logoSource, form.photos, form.photoUrls, { previewUrl, previewPages, chosenLook: chosenLookName, changeRequests: feedback, picture }, pickedDomainRef.current);
        }
        pending.sent = true;
        void logSubmit({ data: { id: look.id, mode: leadMode, look: lookName, event: "sent", status: 200, leadId } }).catch(() => undefined);
        // Round 13: wait briefly for the Email Bot webhook so the message is true. Slow or failed → "We'll email you shortly"
        // (and it upgrades itself if the webhook answers later).
        const replied = await Promise.race([hook.then((r) => Boolean(r?.ok)), new Promise<"slow">((resolve) => setTimeout(() => resolve("slow"), 6000))]);
        const hasPicture = Boolean(picture.file);
        setLeadSent(true);
        setReplyOk(replied === true);
        setMailed(thanksFor(hasPicture, replied === true));
        if (replied !== true) {
          void hook.then((r) => {
            if (!r?.ok) return;
            setReplyOk(true);
            setMailed((current) => (current === LATER ? thanksFor(hasPicture, true) : current));
          });
        }
      } catch (err) {
        // Round 10: never show "Sent" when Formcarry didn't accept it; the look can be chosen again to resend.
        pending.sentIds = pending.sentIds.filter((id) => id !== look.id);
        const status = err instanceof SubmitError ? err.status : 0;
        void logSubmit({ data: { id: look.id, mode: leadMode, look: lookName, event: "failed", status, leadId, reason: err instanceof Error ? err.message.slice(0, 150) : "network error" } }).catch(() => undefined);
        setLeadSent(false);
        setMailed("");
        setError(`Your site is built, but the form could not be sent${status ? ` (status ${status})` : ""}: ${err instanceof Error ? err.message : "try again"}. Press Choose this look again to resend.`);
      }
    } finally {
      choosing.current = false;
      setRetrying(false);
      setChoosingSend(false);
      setStage("");
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const site = url.trim();
    if (!intent) {
      setError("Choose Reimagine My Site or Build a New Site.");
      return;
    }
    if (intent === "newsite") return void buildNewSite();
    if (!site || site === "https://" || site === "http://") {
      setError("Enter your site.");
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
    setRecovery(null);
    setDetails("");
    await runReimagine(site, "normal", "");
  }

  /**
   * Reimagine's long run. Round 13: `mode` "allow-thin" builds from the site's photos/colors when it has no readable text,
   * "note-only" skips reading the site ("Build from your note instead"); `details` is what the visitor typed about the business.
   */
  async function runReimagine(site: string, mode: "normal" | "allow-thin" | "note-only", aboutText: string) {
    setError("");
    setRecovery(null);
    setWorking(true);
    setMailed("");
    setLeadSent(false);
    setFeedback([]);
    setEditedName("");
    seenIds.current = [];
    lead.current = null;
    const gotcha = document.querySelector<HTMLInputElement>('input[name="_gotcha"]')?.value ?? "";
    const signal = beginRun("round1");
    let ok = false;
    try {
      // Round 10: a quick (≈3 s) check that the domain exists before the long work starts.
      if (mode !== "note-only") {
        setStage("check");
        const reach = await checkSiteReachable({ data: { url: site }, signal }).catch(() => undefined);
        if (reach && !reach.ok) {
          setError(reach.error);
          setRecovery({ kind: "unreachable" });
          return;
        }
      }
      setStage("read");
      const read = await previewRead({ data: { url: site, notes: notes.trim(), details: aboutText, mode }, signal });
      if (!read.ok) {
        setError(read.error);
        if (read.needsDetails) setRecovery({ kind: "thin" });
        else if (read.canBuildFromNote) setRecovery({ kind: "unreadable" });
        return;
      }
      const made = await makeLooks(read.facts, 0, signal);
      ok = true;
      setFacts(read.facts);
      setVariation(0);
      scrollOnResult.current = true;
      showLooks(made.looks, [read.facts.note, made.note].filter(Boolean).join(" "));
      // Nothing is sent yet: the form goes to Formcarry once, when the visitor chooses a look.
      lead.current = {
        form: { kind: "reimagine", email: email.trim(), website: site, note: [notes.trim(), aboutText && `About the business: ${aboutText}`].filter(Boolean).join(" · "), gotcha },
        sent: false,
        sentIds: [],
        visitId: newLeadId(),
        attribution: captureAttribution(),
      };
      setMailed(CHOOSE_PROMPT);
    } catch (err) {
      if (!signal.aborted) setError(err instanceof Error ? err.message : "The preview could not be made.");
    } finally {
      endRun(signal, ok);
      if (!signal.aborted) {
        setWorking(false);
        setStage("");
      }
    }
  }

  /** Round 10 — "Build a New Site": no source site; the owner's answers become the site facts. */
  async function buildNewSite() {
    setError("");
    const problem = newSiteProblem(newSite);
    if (problem) {
      setError(problem);
      return;
    }
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
    setLeadSent(false);
    setFeedback([]);
    setEditedName("");
    seenIds.current = [];
    lead.current = null;
    setDomainBrief(null);
    setDomainOpen(false);
    setPickedDomain("");
    pickedDomainRef.current = "";
    const brief = { ...newSite };
    const logo = newLogo;
    const signal = beginRun("newsite");
    let ok = false;
    try {
      const gotcha = document.querySelector<HTMLInputElement>('input[name="_gotcha"]')?.value ?? "";
      setStage("read");
      // The optional logo is stored first, so the looks can use it like a scraped site's logo.
      // An AI-made logo is already stored; an upload is stored now.
      let logoUrl = newLogoUrl;
      if (!logoUrl && logo && /^image\/(png|jpeg)$/.test(logo.type) && logo.size <= 1_500_000) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(new Error("The logo could not be read."));
          reader.readAsDataURL(logo);
        });
        const up = await previewUploadLogo({ data: { image: dataUrl }, signal }).catch(() => undefined);
        if (up?.ok) logoUrl = up.url;
      }
      let photosStored = photoUrls;
      const pendingPhotos = newPhotos.filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type) && f.size <= 2_500_000).slice(0, 12);
      if (pendingPhotos.length) {
        const images = await Promise.all(
          pendingPhotos.map(
            (file) =>
              new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result ?? ""));
                reader.onerror = () => reject(new Error("A photo could not be read."));
                reader.readAsDataURL(file);
              }),
          ),
        );
        const up = await previewUploadPhotos({ data: { images }, signal }).catch(() => undefined);
        if (up?.ok) {
          photosStored = up.urls;
          setPhotoUrls(up.urls);
        }
      }
      if (signal.aborted) return;
      const start = await previewFromBrief({ data: { brief: briefForFacts(brief, logoUrl, photosStored) }, signal });
      if (!start.ok) throw new Error(start.error);
      const made = await makeLooks(start.facts, 0, signal);
      ok = true;
      setFacts(start.facts);
      setVariation(0);
      // Looks were built: hold the brief until the visitor chooses one (sent with its picture).
      lead.current = { form: { kind: "new_site", email: email.trim(), gotcha, brief, logo, logoUrl, logoSource, photos: newPhotos, photoUrls: photosStored }, sent: false, sentIds: [], visitId: newLeadId(), attribution: captureAttribution() };
      setMailed(CHOOSE_PROMPT);
      scrollOnResult.current = true;
      showLooks(made.looks, made.note);
      // Round 11: "Get me a domain, email & hosting" -> the "Pick your domain" pop-up opens as the looks appear.
      if (brief.domain_choice === "get") {
        setDomainBrief(brief);
        setDomainOpen(true);
      }
    } catch (err) {
      if (!signal.aborted) setError(err instanceof Error ? err.message : "The looks could not be built. Try again.");
    } finally {
      endRun(signal, ok);
      if (!signal.aborted) {
        setWorking(false);
        setStage("");
      }
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

  /**
   * "Not quite right?": three new looks from the original note plus every feedback round so far
   * (capped at MAX_FEEDBACK). Same browser-orchestrated steps as the first looks, so each request stays
   * inside the step budget. Never sends the form — that only happens on "Choose this look".
   */
  async function refineLooks(text: string, card?: LookInfo) {
    const wish = text.replace(/\s+/g, " ").trim().slice(0, 400);
    if (!wish || !facts || refining || retrying || working) return;
    if (feedback.length >= MAX_FEEDBACK) {
      setError("That's all the rounds for this preview. Choose the closest look.");
      return;
    }
    const nextFeedback = [...feedback, wish];
    const nextFacts: SiteFacts = { ...facts, feedback: nextFeedback };
    const nextVariation = variation + 1;
    setError("");
    setRefining(true);
    setRetrying(true);
    setEditingId(card?.id ?? "");
    const signal = beginRun(card ? "edit" : "round1");
    let ok = false;
    try {
      // Feedback that names a look ("The Night Brick is best, just a little too dark") edits THAT look:
      // same name, layout, photo and copy, only the requested change, as three close variations.
      // A card's own box sends that card's identity explicitly (id, index, style name): it always wins targeting.
      const routed = await previewRefine({
        data: { text: wish, ids: (looks ?? []).map((l) => l.id), focused: focusedLook, feedback, card: card ? { id: card.id, index: card.index, style: card.name } : undefined },
        signal,
      }).catch(() => undefined);
      if (signal.aborted) return;
      // Round 14: a named look with no change verb (or a prefilled change box) is applied as a
      // free-form note to all three looks, never as a red "couldn't tell what to change" error.
      if (routed?.ok && routed.mode === "none") {
        // kept for older servers; treat like "new"
      } else if (card && !(routed?.ok && (routed.mode === "edit" && routed.looks.length || routed.mode === "new"))) {
        // A per-card request that failed (not a free-form fallback) stays on that card.
        setError(routed && !routed.ok ? routed.error : `That change to ${card.name} could not be made. Try again.`);
        return;
      }
      if (routed?.ok && routed.mode === "edit" && routed.looks.length) {
        // Only the named look changes, in place: same card, same name; the other two stay exactly as they were.
        // Its variations ("lighter" / "a bit lighter still" / …) are chips on that card.
        const alternatives = routed.looks;
        const edited: LookInfo = { ...alternatives[0]!, edit: { ...alternatives[0]!.edit!, alternatives } };
        setFacts(nextFacts);
        setFeedback(nextFeedback);
        setEditedName(routed.target);
        seenIds.current = [...seenIds.current, ...alternatives.map((l) => l.id)];
        setLooks((prev) => (prev ?? []).map((l) => (l.id === routed.targetId ? edited : l)));
        setFocusedLook(edited.id);
        setChosenLook("");
        setResult(null);
        window.setTimeout(() => document.querySelector(`[data-look="${edited.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
        ok = true;
        return;
      }
      const made = await makeLooks(nextFacts, nextVariation, signal);
      ok = true;
      setFacts(nextFacts);
      setVariation(nextVariation);
      setFeedback(nextFeedback);
      setEditedName("");
      showLooks(made.looks, made.note);
      window.setTimeout(() => document.querySelector("[data-choose-banner]")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (err) {
      if (!signal.aborted) setError(err instanceof Error ? err.message : "New looks could not be made. Try again.");
    } finally {
      endRun(signal, ok);
      if (!signal.aborted) {
        setRefining(false);
        setRetrying(false);
        setEditingId("");
        setStage("");
      }
    }
  }

  function goToRefine() {
    const box = document.getElementById("refine-looks");
    box?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => document.getElementById("refine-text")?.focus({ preventScroll: true }), 400);
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
            {/* Round 10: a segmented ring that fills by elapsed / the server's average for this kind of render. */}
            <ProgressRing start={run?.start ?? Date.now()} averageMs={run?.avg ?? (choosingSend || stage === "finish" ? 60_000 : 95_000)} />
            <RotatingStatus
              lines={
                choosingSend
                  ? ["Building every page in this look…", "Snapping a picture of your look…", "Sending it your way…"]
                  : statusLines(refining && editingId ? "edit" : lead.current?.form.kind === "new_site" || run?.kind === "newsite" ? "newsite" : "reimagine", refining && editingId ? (stage === "dream" || stage === "paint" ? stage : "") : stage)
              }
            />
            <ol className="mt-4 space-y-1.5 text-sm">
              {(choosingSend
                ? CHOOSE_STAGES
                : stage === "finish"
                  ? FINISH_STAGES
                  : LOOK_STAGES.filter((item) => ((item.key !== "send" && item.key !== "picture") || stage === "send" || stage === "picture") && !(refining && item.key === "read"))
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
                    {item.key === "read" && run?.kind === "newsite" ? "Getting to know your business…" : item.label}
                  </li>
                );
              })}
            </ol>
            <p className="mt-4 max-w-xs text-center text-xs text-muted">
              {choosingSend || stage === "finish" ? "This usually takes about a minute." : run?.kind === "edit" ? "A change usually takes under half a minute." : "Three looks take a minute or two — worth the wait."}
            </p>
            {run && !choosingSend ? (
              <button
                type="button"
                onClick={stopRun}
                data-stop
                className="mt-4 inline-flex h-10 items-center justify-center rounded-md border border-border bg-bg px-5 text-sm font-medium text-fg shadow-sm transition-transform duration-150 hover:bg-surface active:scale-[0.96]"
              >
                Stop
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <main>
        {/* Round 10e: marketing bubble left of the form on desktop; stacks above it on phones so the form is never squeezed. */}
        <section className="mx-auto grid w-full max-w-6xl grid-cols-1 items-start gap-6 px-4 py-6 md:grid-cols-[minmax(16.5rem,19.5rem)_minmax(0,1fr)] md:gap-8 sm:px-6">
          <MarketingBubble />
          <div className="min-w-0">
            <form onSubmit={onSubmit} className="rounded-2xl border-2 border-primary bg-bg p-4 shadow-[0_18px_40px_-24px_rgba(0,104,232,0.85)] sm:p-6">
              <div className="space-y-4">
                <ModeChoices
                  value={intent}
                  onChange={(next) => {
                    setIntent(next);
                    setError("");
                  }}
                />
                <input
                  type="text"
                  name="_gotcha"
                  tabIndex={-1}
                  autoComplete="off"
                  defaultValue=""
                  aria-hidden="true"
                  className="pointer-events-none absolute -left-[9999px] h-px w-px opacity-0"
                />
                {intent === "newsite" ? (
                  <>
                    <NewSiteForm
                      brief={newSite}
                      setBrief={setNewSite}
                      logo={newLogo}
                      setLogo={setNewLogo}
                      setLogoUrl={setNewLogoUrl}
                      logoSource={logoSource}
                      setLogoSource={setLogoSource}
                      photos={newPhotos}
                      setPhotos={setNewPhotos}
                      email={email}
                      setEmail={setEmail}
                      agreed={agreed}
                      setAgreed={setAgreed}
                      working={working}
                      onBuild={() => void buildNewSite()}
                    />
                    {error ? (
                      <p className="text-sm text-danger" role="alert">
                        {error}
                      </p>
                    ) : null}
                    {stopped && !working ? <p className="text-sm text-muted" data-stopped role="status">{stopped}</p> : null}
                    {mailed ? <p className="text-sm text-muted">{mailed}</p> : null}
                  </>
                ) : (
                  <>
                <label className="block" htmlFor="site-url">
                  <input
                    id="site-url"
                    name="url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    onFocus={() => setSiteFocused(true)}
                    onBlur={() => setSiteFocused(false)}
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={siteFocused && intent === "reimagine" ? "Enter Your Site Here" : "https://www.site.com"}
                    className={
                      intent
                        ? `${fieldClass} border-2 border-primary bg-bg ring-2 ring-primary/30 placeholder:text-primary`
                        : fieldClass
                    }
                  />
                </label>
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
                  disabled={working}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-accent px-6 text-sm font-semibold text-ink transition-transform duration-150 ease-out hover:bg-accent/90 active:scale-[0.96] disabled:opacity-40 sm:w-auto"
                >
                  {working ? "Building the site…" : "Reimagine my site"}
                  {working ? null : <ArrowRight className="size-4" aria-hidden />}
                </button>
                {error ? (
                  <p className="text-sm text-danger" role="alert">
                    {error}
                  </p>
                ) : null}
                {recovery && !working ? (
                  <div data-recovery={recovery.kind} className="space-y-3 rounded-xl border-2 border-accent bg-surface p-4">
                    <label htmlFor="site-details" className="block text-sm font-semibold text-fg">
                      {recovery.kind === "thin" ? "Tell us a bit about the business" : "Or build it from your note instead"}
                    </label>
                    <p className="text-xs text-muted">
                      {recovery.kind === "thin"
                        ? "A sentence or two is plenty. We'll build from this plus the site's photos, colors and logo."
                        : "We'll skip reading the site and build from what you tell us (and your “What should change?” note)."}
                    </p>
                    <textarea
                      id="site-details"
                      rows={3}
                      value={details}
                      onChange={(event) => setDetails(event.target.value.slice(0, 600))}
                      placeholder="e.g. Family-owned Italian restaurant in Tulsa, known for wood-fired pizza and a big patio."
                      className="w-full rounded-md border border-border bg-bg px-3 py-2 text-base text-fg outline-none"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        data-recovery-build
                        onClick={() => {
                          if (recovery.kind !== "thin" && (details + notes).trim().length < 10) {
                            setError("Tell us a bit about the business (a sentence is plenty) and we'll build from that.");
                            return;
                          }
                          void runReimagine(url.trim(), recovery.kind === "thin" ? "allow-thin" : "note-only", details.trim());
                        }}
                        className="inline-flex h-11 items-center justify-center rounded-md bg-accent px-5 text-sm font-semibold text-ink hover:bg-accent/90"
                      >
                        {recovery.kind === "thin" ? "Build it from this" : "Build from your note instead"}
                      </button>
                      {recovery.kind === "thin" ? (
                        <button
                          type="button"
                          data-recovery-skip
                          onClick={() => void runReimagine(url.trim(), "allow-thin", "")}
                          className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-bg px-5 text-sm font-medium text-fg hover:bg-surface"
                        >
                          Skip: just use the site's photos and colors
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {stopped && !working ? <p className="text-sm text-muted" data-stopped role="status">{stopped}</p> : null}
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
                  replyOk={replyOk}
                  feedback={feedback}
                  maxFeedback={MAX_FEEDBACK}
                  refining={refining}
                  onRefine={facts ? (text) => void refineLooks(text) : undefined}
                  onEditCard={facts ? (card, text) => void refineLooks(text, card) : undefined}
                  editingId={editingId}
                  editedName={editedName}
                  onVariant={(card, pick) => {
                    const swapped: LookInfo = { ...pick, edit: { ...pick.edit!, alternatives: card.edit?.alternatives } };
                    setLooks((prev) => (prev ?? []).map((l) => (l.id === card.id ? swapped : l)));
                    setFocusedLook(swapped.id);
                    setChosenLook("");
                    setResult(null);
                  }}
                />
              ) : null}
              {looks && domainBrief ? <DomainChip value={pickedDomain} onOpen={() => setDomainOpen(true)} /> : null}
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
                          lookName: `${focused.name}${focused.edit ? ` · ${focused.edit.variant}` : ""}`,
                          onChoose: () => void chooseLook(focused),
                          disabled: retrying || working || (focused.id === chosenLook && leadSent),
                          chosen: focused.id === chosenLook,
                          onChangeRequest: facts ? goToRefine : undefined,
                          // The same per-look box as on the card, with the full-size rendering.
                          editBox:
                            facts && !leadSent ? (
                              <CardEditBox
                                key={`preview-box-${focused.id}`}
                                look={focused}
                                where="preview"
                                disabled={refining || retrying || working || feedback.length >= MAX_FEEDBACK}
                                working={editingId === focused.id}
                                onSubmit={(text) => void refineLooks(text, focused)}
                              />
                            ) : undefined,
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
              </div>
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
      {domainBrief ? (
        <DomainPicker
          brief={{ business_name: domainBrief.business_name, what: domainBrief.what, location: domainBrief.location, style: domainBrief.style }}
          open={domainOpen}
          onClose={() => setDomainOpen(false)}
          value={pickedDomain}
          onPick={(domain) => {
            pickedDomainRef.current = domain;
            setPickedDomain(domain);
          }}
        />
      ) : null}
    </SiteShell>
  );
}
