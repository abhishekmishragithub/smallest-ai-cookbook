export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
};

export type RateLimiter = {
  check: (key: string) => RateLimitResult;
};

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const hits = new Map<string, number[]>();
  const now = options.now ?? Date.now;

  return {
    check(key: string): RateLimitResult {
      const time = now();
      const recent = (hits.get(key) ?? []).filter((stamp) => time - stamp < options.windowMs);
      if (recent.length >= options.limit) {
        const retryAfterSec = Math.max(1, Math.ceil((recent[0] + options.windowMs - time) / 1000));
        hits.set(key, recent);
        return { ok: false, limit: options.limit, remaining: 0, retryAfterSec };
      }
      recent.push(time);
      hits.set(key, recent);
      return {
        ok: true,
        limit: options.limit,
        remaining: options.limit - recent.length,
        retryAfterSec: 0,
      };
    },
  };
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip")?.trim();
  return real || "unknown";
}
