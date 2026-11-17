/**
 * POST /api/photo-search — the master server's Google Images search for white-label clones that have no
 * Serper key of their own (they set PHOTO_SEARCH_PROXY_URL to this endpoint and PHOTO_SEARCH_PROXY_KEY to the
 * shared key). Enabled only where both SERPER_API_KEY and PHOTO_SEARCH_PROXY_KEY are set; otherwise 404.
 *
 *   request:  Authorization: Bearer <PHOTO_SEARCH_PROXY_KEY>, JSON {"q": "red bricks Pauls Valley Oklahoma"}
 *   response: {"images": [{title, imageUrl, imageWidth, imageHeight, link, domain, source, position}]}
 *
 * The Serper key never leaves this server: it is not echoed, logged or returned. Rate-limited per caller IP
 * (PHOTO_SEARCH_RATE_PER_MINUTE, default 30; PHOTO_SEARCH_RATE_PER_HOUR, default 300). Results are cached per
 * query, so repeat searches cost no Serper credits.
 */
import { createHash, timingSafeEqual } from "node:crypto";

const hits = new Map<string, number[]>();

/** Sliding-window limiter (exported for tests). */
export function overLimit(key: string, perMinute: number, perHour: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
  const lastMinute = recent.filter((t) => now - t < 60_000).length;
  if (lastMinute >= perMinute || recent.length >= perHour) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value!);
  return false;
}

/** Constant-time check of the Bearer key (hashing first makes the lengths equal). */
export function keyMatches(header: string | null, expected: string): boolean {
  const given = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? "")?.[1]?.trim() ?? "";
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });

export async function photoSearchResponse(request: Request, search?: (q: string) => Promise<unknown[]>): Promise<Response> {
  const serperKey = process.env.SERPER_API_KEY?.trim();
  const proxyKey = process.env.PHOTO_SEARCH_PROXY_KEY?.trim();
  if (!serperKey || !proxyKey) return json({ error: "Not found." }, 404);
  if (request.method !== "POST") return json({ error: "Use POST." }, 405, { allow: "POST" });
  if (!keyMatches(request.headers.get("authorization"), proxyKey)) return json({ error: "Unauthorized." }, 401);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "anonymous";
  const perMinute = Number(process.env.PHOTO_SEARCH_RATE_PER_MINUTE) || 30;
  const perHour = Number(process.env.PHOTO_SEARCH_RATE_PER_HOUR) || 300;
  if (overLimit(`photo-search:${ip}`, perMinute, perHour)) return json({ error: "Too many searches; try again later." }, 429, { "retry-after": "60" });
  let q = "";
  try {
    const body = (await request.json()) as { q?: unknown };
    q = typeof body?.q === "string" ? body.q.replace(/\s+/g, " ").trim() : "";
  } catch {
    // fall through to 400
  }
  if (!q || q.length > 200) return json({ error: "Send JSON {\"q\": \"…\"} (1-200 characters)." }, 400);
  const images = await (search ?? (await import("./google-photo.server.ts")).googleImages)(q);
  return json({ images });
}
