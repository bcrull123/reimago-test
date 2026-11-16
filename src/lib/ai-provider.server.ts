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
 * No image-generation calls live here on purpose: previews are real HTML pages.
 */
import { env } from "@/lib/env.server";

export type AiProvider = "xai" | "openai" | "mock";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatOptions = {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Retry once on 429 / 5xx / network failures. Default true. */
  retry?: boolean;
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
  const model = env("AI_MODEL") ?? config.model;
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
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("The AI answer was not JSON.");
  return JSON.parse(text.slice(start, end + 1)) as T;
}
