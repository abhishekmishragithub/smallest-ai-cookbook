import { describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";
import { TOKEN_TTL_SECONDS } from "@/lib/http";
import { handleToken } from "@/lib/token-handler";

function limiter() {
  return createRateLimiter({ limit: 3, windowMs: 60_000 });
}

describe("POST /api/token", () => {
  it("returns mock mode when no API key is configured", async () => {
    const response = await handleToken(new Request("https://hey.example/api/token", { method: "POST" }), {
      env: {},
      fetchImpl: vi.fn() as typeof fetch,
      limiter: limiter(),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ token: null, expires_at: null, mode: "mock" });
  });

  it("mints a wat token with ttl at most 300 seconds", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ ttl_seconds: TOKEN_TTL_SECONDS });
      expect(TOKEN_TTL_SECONDS).toBeLessThanOrEqual(300);
      const header = new Headers(init?.headers).get("authorization");
      expect(header).toBe("Bearer test-key");
      return new Response(
        JSON.stringify({
          access_token: "wat_test_token",
          token_type: "Bearer",
          expires_in: 300,
          expires_at: "2026-11-03T12:00:00.000Z",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });

    const response = await handleToken(
      new Request("https://hey.example/api/token", {
        method: "POST",
        headers: { origin: "https://docs.smallest.ai", "x-forwarded-for": "203.0.113.8" },
      }),
      { env: { SMALLEST_API_KEY: "test-key" }, fetchImpl: fetchImpl as typeof fetch, limiter: limiter() },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://docs.smallest.ai");
    await expect(response.json()).resolves.toMatchObject({
      token: "wat_test_token",
      expires_at: "2026-11-03T12:00:00.000Z",
      mode: "live",
    });
  });

  it("rate limits per IP and does not mint", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "wat_limited", expires_at: "2026-11-03T12:00:00.000Z" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const shared = limiter();
    const call = () =>
      handleToken(
        new Request("https://hey.example/api/token", {
          method: "POST",
          headers: { "x-forwarded-for": "198.51.100.4" },
        }),
        { env: { SMALLEST_API_KEY: "test-key" }, fetchImpl: fetchImpl as typeof fetch, limiter: shared },
      );
    await call();
    await call();
    await call();
    const blocked = await call();
    expect(blocked.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("allows a request from the same host", async () => {
    const response = await handleToken(
      new Request("http://127.0.0.1:3456/api/token", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:3456" },
      }),
      { env: {}, fetchImpl: vi.fn() as typeof fetch, limiter: limiter() },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ mode: "mock" });
  });

  it("rejects a disallowed origin", async () => {
    const response = await handleToken(
      new Request("https://hey.example/api/token", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
      { env: {}, fetchImpl: vi.fn() as typeof fetch, limiter: limiter() },
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
