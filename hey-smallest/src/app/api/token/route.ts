import { tokenLimiter } from "@/lib/limiters";
import { handlePreflight, handleToken } from "@/lib/token-handler";

export const dynamic = "force-dynamic";

export function POST(req: Request): Promise<Response> {
  return handleToken(req, {
    env: process.env,
    fetchImpl: fetch,
    limiter: tokenLimiter,
  });
}

export function OPTIONS(req: Request): Response {
  return handlePreflight(req, process.env);
}
