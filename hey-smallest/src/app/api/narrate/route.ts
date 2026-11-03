import { narrateLimiter } from "@/lib/limiters";
import { handleNarrate } from "@/lib/narrate-handler";
import { handlePreflight } from "@/lib/token-handler";

export const dynamic = "force-dynamic";

export function POST(req: Request): Promise<Response> {
  return handleNarrate(req, {
    env: process.env,
    fetchImpl: fetch,
    limiter: narrateLimiter,
  });
}

export function OPTIONS(req: Request): Response {
  return handlePreflight(req, process.env);
}
