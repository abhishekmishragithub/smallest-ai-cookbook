import { assetCorsHeaders } from "@/lib/cors";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const headers = assetCorsHeaders(request, process.env);
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin");
    const allowed = !origin || headers.has("access-control-allow-origin");
    return new NextResponse(null, { status: allowed ? 204 : 403, headers });
  }
  const response = NextResponse.next();
  headers.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
}

export const config = {
  matcher: "/mock-audio/:path*",
};
