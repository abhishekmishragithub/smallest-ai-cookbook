export const DEFAULT_ALLOWED_ORIGINS = [
  "https://docs.smallest.ai",
  "https://*.docs.buildwithfern.com",
];

/** Drop a bare star. Empty or missing config keeps the docs and Fern defaults. */
export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [...DEFAULT_ALLOWED_ORIGINS];
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== "*");
  return entries.length > 0 ? entries : [...DEFAULT_ALLOWED_ORIGINS];
}

export function originAllowed(origin: string, allowlist: string[]): boolean {
  return allowlist.some((pattern) => pattern !== "*" && matchOrigin(pattern, origin));
}

function matchOrigin(pattern: string, origin: string): boolean {
  if (!pattern.includes("*")) return pattern === origin;
  const parts = pattern.split("*");
  if (parts.length !== 2) return false;
  const [prefix, suffix] = parts;
  if (!prefix || !suffix) return false;
  if (!origin.startsWith(prefix) || !origin.endsWith(suffix)) return false;
  const middle = origin.slice(prefix.length, origin.length - suffix.length);
  return middle.length > 0 && !middle.includes("/") && !middle.includes(".");
}

export function corsHeaders(req: Request, allowlist: string[]): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  const origin = req.headers.get("origin");
  if (!origin || !originAllowed(origin, allowlist)) return headers;
  headers["Access-Control-Allow-Origin"] = origin;
  headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type";
  headers["Access-Control-Max-Age"] = "600";
  return headers;
}

export function isPreflightRejected(req: Request, allowlist: string[]): boolean {
  const origin = req.headers.get("origin");
  if (!origin || isSameOrigin(req, origin)) return false;
  return !originAllowed(origin, allowlist);
}

function isSameOrigin(req: Request, origin: string): boolean {
  try {
    const source = new URL(origin);
    const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || req.headers.get("host") || new URL(req.url).host;
    return source.host === host;
  } catch {
    return false;
  }
}
