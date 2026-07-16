import { NextRequest, NextResponse } from "next/server";

import { hasPin, hasValidBearer } from "@/lib/auth";

const PUBLIC_PATHS = new Set(["/unlock", "/api/auth"]);
const STATIC_FILE =
  /\/[^/]+\.(?:js|css|png|jpe?g|svg|ico|webp|woff2?|map|txt)$/i;

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/_next/") ||
    (STATIC_FILE.test(pathname) && !pathname.startsWith("/api/"))
  ) {
    return NextResponse.next();
  }

  if (hasPin(request) || hasValidBearer(request)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const unlockUrl = new URL("/unlock", request.url);
  unlockUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(unlockUrl);
}

// Node.js middleware is required because the shared authentication helper uses
// crypto.timingSafeEqual rather than a timing-variable string comparison.
export const runtime = "nodejs";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
