import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

export const PIN_COOKIE_NAME = "hf_pin";
// backward-compat with the original elonfeedback naming
const LEGACY_PIN_COOKIE_NAME = "elon_pin";

type RequestLike = Pick<Request, "headers">;

export function safeStringEqual(
  actual: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (typeof actual !== "string" || typeof expected !== "string") {
    return false;
  }

  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (actualBytes.length !== expectedBytes.length) return false;

  return timingSafeEqual(actualBytes, expectedBytes);
}

function readCookie(request: RequestLike, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;

    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

export function hasValidBearer(request: RequestLike): boolean {
  // backward-compat with the original elonfeedback naming
  const expected =
    process.env.HUMANFEEDBACK_TOKEN || process.env.ELONFEEDBACK_TOKEN;
  if (!expected) return false;

  const authorization = request.headers.get("authorization");
  return safeStringEqual(authorization, `Bearer ${expected}`);
}

export function requireBearer(request: RequestLike): NextResponse | null {
  if (hasValidBearer(request)) return null;

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function hasPin(request: RequestLike): boolean {
  // backward-compat with the original elonfeedback naming
  const expected = process.env.HUMANFEEDBACK_PIN || process.env.ELON_PIN;
  if (!expected) return false;

  // backward-compat with the original elonfeedback naming
  return (
    safeStringEqual(readCookie(request, PIN_COOKIE_NAME), expected) ||
    safeStringEqual(readCookie(request, LEGACY_PIN_COOKIE_NAME), expected)
  );
}
