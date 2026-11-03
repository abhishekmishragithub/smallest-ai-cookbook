import { describe, expect, it } from "vitest";
import { assetCorsHeaders, corsHeaders, originAllowed, parseAllowlist } from "@/lib/cors";
import { createRateLimiter } from "@/lib/rate-limit";
import { handlePreflight } from "@/lib/token-handler";

describe("CORS", () => {
  it("allows the docs origin and a Fern preview, and never a star", () => {
    const list = parseAllowlist(undefined);
    expect(originAllowed("https://docs.smallest.ai", list)).toBe(true);
    expect(originAllowed("https://preview-123.docs.buildwithfern.com", list)).toBe(true);
    expect(originAllowed("https://evil.example", list)).toBe(false);
    expect(originAllowed("https://docs.smallest.ai.evil.example", list)).toBe(false);

    const star = parseAllowlist("*");
    expect(star).not.toContain("*");
    const headers = corsHeaders(new Request("https://hey.example/api/token", { headers: { origin: "*" } }), star);
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(Object.values(headers).join(" ")).not.toBe("*");
  });

  it("echoes an allowed origin and omits the header for everyone else", () => {
    const req = new Request("https://hey.example/api/token", {
      method: "OPTIONS",
      headers: { origin: "https://docs.smallest.ai" },
    });
    const ok = handlePreflight(req, {});
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://docs.smallest.ai");
    expect(ok.headers.get("access-control-allow-origin")).not.toBe("*");

    const blocked = handlePreflight(
      new Request("https://hey.example/api/token", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" },
      }),
      {},
    );
    expect(blocked.status).toBe(403);
    expect(blocked.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows mock-audio from the docs origin and Fern previews, never a star", () => {
    const docs = assetCorsHeaders(
      new Request("https://hey.example/mock-audio/call-flow.mp3", {
        headers: { origin: "https://docs.smallest.ai" },
      }),
      {},
    );
    expect(docs.get("access-control-allow-origin")).toBe("https://docs.smallest.ai");
    expect(docs.get("access-control-allow-methods")).toContain("GET");

    const preview = assetCorsHeaders(
      new Request("https://hey.example/mock-audio/call-flow.timestamps.json", {
        headers: { origin: "https://preview-123.docs.buildwithfern.com" },
      }),
      {},
    );
    expect(preview.get("access-control-allow-origin")).toBe("https://preview-123.docs.buildwithfern.com");

    const blocked = assetCorsHeaders(
      new Request("https://hey.example/mock-audio/call-flow.mp3", {
        headers: { origin: "https://evil.example" },
      }),
      {},
    );
    expect(blocked.get("access-control-allow-origin")).toBeNull();
    expect([...docs.values(), ...preview.values(), ...blocked.values()]).not.toContain("*");

    const custom = assetCorsHeaders(
      new Request("https://hey.example/mock-audio/phone.mp3", {
        headers: { origin: "https://branch.preview.example" },
      }),
      { ALLOWED_ORIGINS: "https://*.preview.example" },
    );
    expect(custom.get("access-control-allow-origin")).toBe("https://branch.preview.example");
  });

  it("reads ALLOWED_ORIGINS and ignores a bare star entry", () => {
    const list = parseAllowlist("https://docs.example, * , https://*.preview.example");
    expect(list).toEqual(["https://docs.example", "https://*.preview.example"]);
    expect(originAllowed("https://branch.preview.example", list)).toBe(true);
  });
});

describe("rate limiter", () => {
  it("limits each ip inside the window", () => {
    let now = 1_000;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1_000, now: () => now });
    expect(limiter.check("10.0.0.1").ok).toBe(true);
    expect(limiter.check("10.0.0.1").ok).toBe(true);
    const blocked = limiter.check("10.0.0.1");
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(limiter.check("10.0.0.2").ok).toBe(true);
    now += 1_001;
    expect(limiter.check("10.0.0.1").ok).toBe(true);
  });
});
