/** Pure helpers for AI answers (no server imports, so they are unit-testable). */

export class AiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

/** Never let anything that looks like a key reach a log line or the UI. */
export function redact(text: string): string {
  return text.replace(/(xai|sk)-[A-Za-z0-9_-]{8,}/g, "[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

/**
 * Find the JSON object in a model answer: tolerates code fences, prose before/after,
 * trailing commas and a few stray characters after the last brace.
 */
export function parseJsonObject<T = unknown>(text: string): T {
  const cleaned = text.replace(/^\uFEFF/, "").replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  if (start < 0) throw new AiError(`The AI answer was not JSON (it began: "${redact(text.trim().slice(0, 60))}")`);
  const attempt = (slice: string): T | undefined => {
    for (const candidate of [slice, slice.replace(/,\s*([}\]])/g, "$1")]) {
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // try the next form
      }
    }
    return undefined;
  };
  // Prefer the balanced object that starts at the first brace.
  let depth = 0;
  let inString = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const c = cleaned[i];
    if (inString) {
      if (c === "\\") i += 1;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        const found = attempt(cleaned.slice(start, i + 1));
        if (found !== undefined) return found;
        break;
      }
    }
  }
  const end = cleaned.lastIndexOf("}");
  const found = end > start ? attempt(cleaned.slice(start, end + 1)) : undefined;
  if (found !== undefined) return found;
  throw new AiError(depth > 0 ? "The AI answer was cut off mid-JSON" : "The AI answer was not valid JSON");
}

