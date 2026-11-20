/**
 * One place for every text-AI call the app makes.
 *
 * Switch providers with env vars only — no code changes:
 *   AI_PROVIDER = xai (default) | openai | mock
 *   AI_MODEL    = optional model override (default grok-4.5 for xai, gpt-4.1-mini for openai)
 *   AI_BASE_URL = optional OpenAI-compatible base URL override (e.g. https://api.together.xyz/v1)
 *   AI_REASONING_EFFORT = low (default) | medium | high | none — sent to reasoning models (Grok 4.5+), which otherwise think at "high" and are slow
 *   AI_FALLBACK_MODEL = faster model for one retry after a timeout/failure (default grok-4.20-0309-non-reasoning for xai; "none" disables)
 *   XAI_API_KEY / OPENAI_API_KEY = the key for the chosen provider
 *   PREVIEW_MOCK=1 forces mock mode (no network AI calls; deterministic output for testing)
 *
 * Images (only for in-site photos — hero, section, service cards; never logos or text):
 *   IMAGE_PROVIDER = xai (default) | openai | none
 *   IMAGE_MODEL    = optional override (default grok-imagine-image-2.0 for xai, gpt-image-1 for openai)
 *   IMAGE_BASE_URL = optional OpenAI-compatible base URL for the images endpoint (testing / proxies)
 *   PREVIEW_MOCK=1 also turns image generation off (placeholders and real scraped photos only)
 *
 * Vision (design critique of a screenshot):
 *   CRITIQUE_MODEL = optional model for the critique call (default: AI_MODEL / provider default)
 */
import { stopOrTimeout } from "@/lib/abort.server";
import { env } from "@/lib/env.server";
import { AiError, parseJsonObject, redact } from "@/lib/ai-json";

export { AiError, parseJsonObject };

export type AiProvider = "xai" | "openai" | "mock";

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };

export type ChatOptions = {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Absolute time (Date.now() ms) after which no attempt may run. */
  deadline?: number;
  /** Retry once on 429 / 5xx / network failures (not on timeouts). Default true. */
  retry?: boolean;
  /** Model override for this call (e.g. a vision model). */
  model?: string;
  /** Ask the API for a JSON object (response_format json_object); dropped automatically if the API rejects it. */
  json?: boolean;
};

const ENDPOINTS: Record<Exclude<AiProvider, "mock">, { url: string; key: string; model: string; fallback?: string }> = {
  xai: { url: "https://api.x.ai/v1/chat/completions", key: "XAI_API_KEY", model: "grok-4.5", fallback: "grok-4.20-0309-non-reasoning" },
  openai: { url: "https://api.openai.com/v1/chat/completions", key: "OPENAI_API_KEY", model: "gpt-4.1-mini" },
};

export function isMockMode(): boolean {
  const flag = (env("PREVIEW_MOCK") ?? "").toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export function aiProvider(): AiProvider {
  if (isMockMode()) return "mock";
  const raw = (env("AI_PROVIDER") ?? "xai").toLowerCase();
  if (raw === "openai" || raw === "mock") return raw;
  return "xai";
}

/** True when a real model can be called (provider configured and key present). */
export function aiAvailable(): boolean {
  const provider = aiProvider();
  if (provider === "mock") return false;
  return Boolean(env(ENDPOINTS[provider].key));
}

/** The text model used by default (AI_MODEL or the provider default). */
export function aiModel(): string {
  const provider = aiProvider();
  return env("AI_MODEL") ?? (provider === "mock" ? "mock" : ENDPOINTS[provider].model);
}

/** A faster model for one retry when the main model times out or fails (AI_FALLBACK_MODEL; "none" disables). */
export function aiFallbackModel(): string | undefined {
  const raw = env("AI_FALLBACK_MODEL");
  if (raw && /^(none|off|0)$/i.test(raw)) return undefined;
  const provider = aiProvider();
  const model = raw ?? (provider === "mock" ? undefined : ENDPOINTS[provider].fallback);
  return model && model !== aiModel() ? model : undefined;
}

/** Grok 4.5+ always reason; reasoning_effort "low" keeps page writing fast (AI_REASONING_EFFORT overrides). */
function reasoningEffort(provider: AiProvider, model: string): string | undefined {
  const raw = (env("AI_REASONING_EFFORT") ?? "low").toLowerCase();
  if (raw === "none" || raw === "off" || raw === "default") return undefined;
  if (provider === "xai" && /^grok-(4\.(5|6|7|8|9)|[5-9])/i.test(model) && !/non-reasoning/i.test(model)) return raw;
  if (provider === "openai" && /^(o\d|gpt-5)/i.test(model)) return raw;
  return undefined;
}

function apiErrorText(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as { error?: string | { message?: string }; message?: string; code?: string };
    const message = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message ?? parsed.code;
    if (message) return redact(String(message)).slice(0, 220);
  } catch {
    // not JSON
  }
  return redact(detail.replace(/\s+/g, " ")).slice(0, 220);
}

/** Plain chat completion. Returns the assistant text. Throws AiError with a readable reason on failure. */
export async function chatText(options: ChatOptions): Promise<string> {
  const provider = aiProvider();
  if (provider === "mock") throw new AiError("AI is in mock mode (PREVIEW_MOCK=1).");
  const config = ENDPOINTS[provider];
  const apiKey = env(config.key);
  if (!apiKey) throw new AiError(`AI is not available (${config.key} is not set).`);
  const model = options.model ?? env("AI_MODEL") ?? config.model;
  const baseUrl = env("AI_BASE_URL");
  const endpoint = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/chat/completions` : config.url;
  let effort = reasoningEffort(provider, model);
  let json = options.json === true;

  const call = async (): Promise<string> => {
    const left = options.deadline ? options.deadline - Date.now() : Infinity;
    const timeoutMs = Math.min(options.timeoutMs ?? 30_000, left);
    if (timeoutMs < 3000) throw new AiError(`no time left to call ${model}`);
    const body: Record<string, unknown> = {
      model,
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 2000,
      messages: options.messages,
    };
    if (effort) body.reasoning_effort = effort;
    if (json) body.response_format = { type: "json_object" };
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: stopOrTimeout(timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") throw new AiError(`${model} timed out after ${Math.round((Date.now() - started) / 1000)}s`, 408);
      throw new AiError(`${model} could not be reached (${redact(error instanceof Error ? error.message : String(error)).slice(0, 120)})`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const reason = apiErrorText(detail);
      console.error(`[ai:${provider}] ${model}`, response.status, reason);
      // Some models/endpoints reject optional parameters: drop them and try again once.
      if (response.status === 400 && (effort || json) && /reasoning|response_format|json_object|unsupported|not supported|unknown (field|parameter)|invalid/i.test(reason)) {
        if (/response_format|json/i.test(reason) && json) json = false;
        else if (effort) effort = undefined;
        else json = false;
        return call();
      }
      throw new AiError(`${provider} API error ${response.status} from ${model}: ${reason || response.statusText}`, response.status);
    }
    let parsed: { choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
    try {
      parsed = await response.json();
    } catch {
      throw new AiError(`${model} sent an unreadable response`);
    }
    const choice = parsed.choices?.[0];
    const content = choice?.message?.content ?? "";
    if (choice?.finish_reason === "length" && !/\}\s*$/.test(content.trim())) {
      throw new AiError(`${model} ran out of tokens before finishing (max_tokens ${body.max_tokens})`, 413);
    }
    if (!content.trim()) throw new AiError(`${model} returned an empty answer${choice?.finish_reason ? ` (finish_reason ${choice.finish_reason})` : ""}`);
    return content;
  };
  try {
    return await call();
  } catch (error) {
    if (options.retry === false) throw error;
    const status = error instanceof AiError ? error.status : 0;
    // Timeouts and token-limit cut-offs are not retried with the same model (no time / same result).
    if (status === 408 || status === 413 || (status && status !== 429 && status < 500)) throw error;
    return call();
  }
}

/** Chat completion that must return one JSON object. */
export async function chatJson<T = unknown>(options: ChatOptions): Promise<T> {
  const text = await chatText({ json: true, ...options });
  return parseJsonObject<T>(text);
}

// ---------------------------------------------------------------- images

export type ImageProvider = "xai" | "openai" | "none";

export function imageProvider(): ImageProvider {
  if (isMockMode()) return "none";
  const raw = (env("IMAGE_PROVIDER") ?? "xai").toLowerCase();
  if (raw === "none" || raw === "off" || raw === "0") return "none";
  if (raw === "openai") return env("OPENAI_API_KEY") ? "openai" : "none";
  return env("XAI_API_KEY") ? "xai" : "none";
}

export type GeneratedImage = { bytes: Buffer; type: string };

const IMAGE_ENDPOINTS: Record<Exclude<ImageProvider, "none">, { url: string; key: string; model: string }> = {
  xai: { url: "https://api.x.ai/v1/images/generations", key: "XAI_API_KEY", model: "grok-imagine-image-2.0" },
  openai: { url: "https://api.openai.com/v1/images/generations", key: "OPENAI_API_KEY", model: "gpt-image-1" },
};

/** Words appended to every image prompt: photos only, never text, logos, or watermarks. */
export const IMAGE_GUARD =
  "Photograph only. Absolutely no text, letters, numbers, words, logos, brand marks, signage, labels, or watermarks anywhere in the image. No fake company names.";

/**
 * Generate one photo for a website section. Returns the image bytes (stored with
 * the site record; we never hotlink expiring provider URLs). Returns undefined on
 * any failure so callers fall back to real photos or placeholders.
 */
export async function generateImage(options: {
  prompt: string;
  aspect: "16:9" | "4:3" | "1:1" | "3:4";
  timeoutMs?: number;
  /** false = no "photograph only, no text" guard (a homepage design mockup has real words in it). Default true. */
  guard?: boolean;
  /** xAI only: edit from this public image (the site's logo, like the original Imagine flow); falls back to a plain generation. */
  sourceImageUrl?: string;
  /**
   * xAI only: reference images (https URLs or data: URIs of PNG/JPEG/WebP, at most 5 per the API) for
   * /images/edits — the site's own logo, brand art and photos for Imagine to recompose. Falls back to a plain
   * generation when the edit is refused.
   */
  sourceImages?: string[];
  /** xAI resolution ("1k" default, "2k"). */
  resolution?: string;
}): Promise<GeneratedImage | undefined> {
  const provider = imageProvider();
  if (provider === "none" || !options.prompt.trim()) return undefined;
  const config = IMAGE_ENDPOINTS[provider];
  const apiKey = env(config.key);
  if (!apiKey) return undefined;
  const base = env("IMAGE_BASE_URL");
  const sources = [...(options.sourceImageUrl ? [options.sourceImageUrl] : []), ...(options.sourceImages ?? [])]
    .filter((u) => /^https:\/\//.test(u) || /^data:image\/(png|jpeg|webp);base64,/.test(u))
    .slice(0, 5);
  const editing = provider === "xai" && sources.length > 0;
  const path = editing ? "images/edits" : "images/generations";
  const endpoint = base ? `${base.replace(/\/+$/, "")}/${path}` : editing ? config.url.replace(/images\/generations$/, "images/edits") : config.url;
  const model = env("IMAGE_MODEL") ?? config.model;
  const prompt = (options.guard === false ? options.prompt.trim() : `${options.prompt.trim()} ${IMAGE_GUARD}`).slice(0, 3800);
  const body =
    provider === "xai"
      ? { model, prompt, ...(editing ? (sources.length === 1 ? { image: { url: sources[0], type: "image_url" } } : { images: sources.map((url) => ({ url, type: "image_url" })) }) : {}), aspect_ratio: options.aspect, resolution: options.resolution ?? "1k", quality: "low", response_format: "b64_json", n: 1 }
      : {
          model,
          prompt,
          n: 1,
          size: options.aspect === "16:9" || options.aspect === "4:3" ? "1536x1024" : options.aspect === "3:4" ? "1024x1536" : "1024x1024",
          quality: "low",
        };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: stopOrTimeout(options.timeoutMs ?? 45_000),
    });
    if (!response.ok) {
      console.error(`[image:${provider}]${editing ? " edit" : ""}`, response.status, (await response.text().catch(() => "")).slice(0, 300));
      // The logo edit was refused (unreachable logo, unsupported image): a plain generation instead.
      return editing ? generateImage({ ...options, sourceImageUrl: undefined, sourceImages: undefined }) : undefined;
    }
    const json = (await response.json()) as { data?: { b64_json?: string; url?: string }[] };
    const item = json.data?.[0];
    if (item?.b64_json) {
      const bytes = Buffer.from(item.b64_json, "base64");
      return bytes.length > 1000 ? { bytes, type: sniffImageType(bytes) } : undefined;
    }
    if (item?.url && /^https:\/\//.test(item.url)) {
      // Download right away: provider URLs expire.
      const download = await fetch(item.url, { signal: AbortSignal.timeout(20_000) });
      if (!download.ok) return undefined;
      const bytes = Buffer.from(await download.arrayBuffer());
      return bytes.length > 1000 && bytes.length < 8_000_000 ? { bytes, type: sniffImageType(bytes) } : undefined;
    }
    return undefined;
  } catch (error) {
    console.error(`[image:${provider}] failed`, error instanceof Error ? error.message : error);
    return undefined;
  }
}

/** The Imagine model and endpoint actually used (for logs; no secrets). */
export function imageModelInfo(): { provider: ImageProvider; model: string; endpoint: string } {
  const provider = imageProvider();
  if (provider === "none") return { provider, model: "", endpoint: "" };
  const base = env("IMAGE_BASE_URL");
  return { provider, model: env("IMAGE_MODEL") ?? IMAGE_ENDPOINTS[provider].model, endpoint: base ? `${base.replace(/\/+$/, "")}/images/generations` : IMAGE_ENDPOINTS[provider].url };
}

export function sniffImageType(bytes: Buffer): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
  return "application/octet-stream";
}
