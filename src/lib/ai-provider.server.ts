/**
 * One place for every text-AI call the app makes.
 *
 * Switch providers with env vars only — no code changes:
 *   AI_PROVIDER = xai (default) | openai | mock
 *   AI_MODEL    = optional model override (default grok-4.5 for xai, gpt-4.1-mini for openai)
 *   AI_BASE_URL = optional OpenAI-compatible base URL override (e.g. https://api.together.xyz/v1)
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
import { env } from "@/lib/env.server";

export type AiProvider = "xai" | "openai" | "mock";

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };

export type ChatOptions = {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Retry once on 429 / 5xx / network failures. Default true. */
  retry?: boolean;
  /** Model override for this call (e.g. a vision model). */
  model?: string;
};

const ENDPOINTS: Record<Exclude<AiProvider, "mock">, { url: string; key: string; model: string }> = {
  xai: { url: "https://api.x.ai/v1/chat/completions", key: "XAI_API_KEY", model: "grok-4.5" },
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

export class AiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

/** Plain chat completion. Returns the assistant text. Throws AiError on failure. */
export async function chatText(options: ChatOptions): Promise<string> {
  const provider = aiProvider();
  if (provider === "mock") throw new AiError("AI is in mock mode (PREVIEW_MOCK=1).");
  const config = ENDPOINTS[provider];
  const apiKey = env(config.key);
  if (!apiKey) throw new AiError("AI is not available.");
  const model = options.model ?? env("AI_MODEL") ?? config.model;
  const baseUrl = env("AI_BASE_URL");
  const endpoint = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/chat/completions` : config.url;
  const body = JSON.stringify({
    model,
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 2000,
    messages: options.messages,
  });
  const call = async (): Promise<string> => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(`[ai:${provider}]`, response.status, detail.slice(0, 300));
      throw new AiError(`${provider} API error ${response.status}`, response.status);
    }
    const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? "";
  };
  try {
    return await call();
  } catch (error) {
    if (options.retry === false) throw error;
    const status = error instanceof AiError ? error.status : 0;
    if (status && status !== 429 && status < 500) throw error;
    return call();
  }
}

/** Chat completion that must return one JSON object. */
export async function chatJson<T = unknown>(options: ChatOptions): Promise<T> {
  const text = await chatText(options);
  return parseJsonObject<T>(text);
}

export function parseJsonObject<T = unknown>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("The AI answer was not JSON.");
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    // Common model slip: trailing commas.
    return JSON.parse(text.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1")) as T;
  }
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
export async function generateImage(options: { prompt: string; aspect: "16:9" | "4:3" | "1:1" | "3:4"; timeoutMs?: number }): Promise<GeneratedImage | undefined> {
  const provider = imageProvider();
  if (provider === "none" || !options.prompt.trim()) return undefined;
  const config = IMAGE_ENDPOINTS[provider];
  const apiKey = env(config.key);
  if (!apiKey) return undefined;
  const base = env("IMAGE_BASE_URL");
  const endpoint = base ? `${base.replace(/\/+$/, "")}/images/generations` : config.url;
  const model = env("IMAGE_MODEL") ?? config.model;
  const prompt = `${options.prompt.trim()} ${IMAGE_GUARD}`.slice(0, 3800);
  const body =
    provider === "xai"
      ? { model, prompt, aspect_ratio: options.aspect, resolution: "1k", quality: "low", response_format: "b64_json", n: 1 }
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
      signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
    });
    if (!response.ok) {
      console.error(`[image:${provider}]`, response.status, (await response.text().catch(() => "")).slice(0, 300));
      return undefined;
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

export function sniffImageType(bytes: Buffer): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
  return "application/octet-stream";
}
