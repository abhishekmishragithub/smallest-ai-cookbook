export function json(body: unknown, status: number, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export const TOKEN_TTL_SECONDS = 300;
export const TOKEN_LIMIT = 10;
export const NARRATE_LIMIT = 12;
export const RATE_WINDOW_MS = 60_000;

export function rateHeaders(result: { limit: number; remaining: number; retryAfterSec: number }): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
  };
  if (result.retryAfterSec > 0) headers["Retry-After"] = String(result.retryAfterSec);
  return headers;
}
