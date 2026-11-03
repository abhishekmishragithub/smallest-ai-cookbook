import { corsHeaders, isPreflightRejected, parseAllowlist } from "./cors";
import { json, rateHeaders, TOKEN_TTL_SECONDS } from "./http";
import { clientIp, type RateLimiter } from "./rate-limit";

export type TokenDeps = {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  limiter: RateLimiter;
};

type MintBody = {
  access_token?: string;
  expires_at?: string;
  expires_in?: number;
};

export async function handleToken(req: Request, deps: TokenDeps): Promise<Response> {
  const allowlist = parseAllowlist(deps.env.ALLOWED_ORIGINS);
  const headers = corsHeaders(req, allowlist);
  if (isPreflightRejected(req, allowlist)) {
    return json({ error: "Origin is not allowed." }, 403, headers);
  }

  const limit = deps.limiter.check(`token:${clientIp(req)}`);
  const withRate = { ...headers, ...rateHeaders(limit) };
  if (!limit.ok) {
    return json({ error: "Too many token requests. Wait and retry." }, 429, withRate);
  }

  const apiKey = deps.env.SMALLEST_API_KEY;
  if (!apiKey) {
    return json({ token: null, expires_at: null, mode: "mock" }, 200, withRate);
  }

  let upstream: Response;
  try {
    upstream = await deps.fetchImpl("https://api.smallest.ai/console/v1/auth/token", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return json({ error: "Token mint failed." }, 502, withRate);
  }

  if (!upstream.ok) {
    return json({ error: "Token mint failed." }, upstream.status, withRate);
  }

  const body = (await upstream.json()) as MintBody;
  if (!body.access_token || !body.access_token.startsWith("wat_")) {
    return json({ error: "Token mint failed." }, 502, withRate);
  }

  const expiresAt =
    body.expires_at ??
    new Date(Date.now() + (body.expires_in ?? TOKEN_TTL_SECONDS) * 1000).toISOString();

  return json({ token: body.access_token, expires_at: expiresAt, mode: "live" }, 200, withRate);
}

export function handlePreflight(req: Request, env: Record<string, string | undefined>): Response {
  const allowlist = parseAllowlist(env.ALLOWED_ORIGINS);
  const headers = corsHeaders(req, allowlist);
  if (isPreflightRejected(req, allowlist)) {
    return new Response(null, { status: 403, headers });
  }
  return new Response(null, { status: 204, headers });
}
