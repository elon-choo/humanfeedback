import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { PIN_COOKIE_NAME, safeStringEqual } from "@/lib/auth";
import { deletePath, readJson, writeJson } from "@/lib/blob";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 8;

type RateLimitRecord = {
  count: number;
  windowStart: number;
};

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const firstForwarded = forwarded?.split(",", 1)[0]?.trim();
  if (firstForwarded) return firstForwarded;

  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    null
  );
}

function rateLimitPath(request: Request): string | null {
  const ip = clientIp(request);
  if (!ip) return null;

  const ipHash = createHash("sha256").update(ip, "utf8").digest("hex");
  return `ratelimit/${ipHash}.json`;
}

function isRateLimitRecord(value: unknown): value is RateLimitRecord {
  if (typeof value !== "object" || value === null) return false;

  const record = value as Partial<RateLimitRecord>;
  return (
    Number.isInteger(record.count) &&
    typeof record.count === "number" &&
    record.count >= 0 &&
    typeof record.windowStart === "number" &&
    Number.isFinite(record.windowStart) &&
    record.windowStart >= 0
  );
}

async function readRateLimit(
  pathname: string | null,
  now: number,
): Promise<RateLimitRecord | null> {
  if (!pathname) return null;

  try {
    const value = await readJson<unknown>(pathname);
    if (!isRateLimitRecord(value)) return null;
    if (value.windowStart > now) return null;
    if (now - value.windowStart >= RATE_LIMIT_WINDOW_MS) return null;
    return value;
  } catch {
    // Rate limiting is defense-in-depth. Blob failures must never lock out Elon.
    return null;
  }
}

async function recordFailure(
  pathname: string | null,
  current: RateLimitRecord | null,
  now: number,
): Promise<void> {
  if (!pathname) return;

  const record: RateLimitRecord = current
    ? { count: current.count + 1, windowStart: current.windowStart }
    : { count: 1, windowStart: now };

  try {
    await writeJson(pathname, record);
  } catch {
    // Fail open on storage errors; the primary defense is a high-entropy ELON_PIN.
  }
}

async function resetFailures(pathname: string | null): Promise<void> {
  if (!pathname) return;

  try {
    await deletePath(pathname);
  } catch {
    // Unlock success must not depend on Blob availability.
  }
}

export async function POST(request: Request) {
  const now = Date.now();
  const limiterPath = rateLimitPath(request);
  const limiter = await readRateLimit(limiterPath, now);

  if (limiter && limiter.count >= MAX_FAILED_ATTEMPTS) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(
        (limiter.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000,
      ),
    );
    return NextResponse.json(
      { ok: false },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    await recordFailure(limiterPath, limiter, now);
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const pin =
    typeof body === "object" &&
    body !== null &&
    "pin" in body &&
    typeof body.pin === "string"
      ? body.pin
      : null;
  const expected = process.env.ELON_PIN;

  if (!expected || !safeStringEqual(pin, expected)) {
    await recordFailure(limiterPath, limiter, now);
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  await resetFailures(limiterPath);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(PIN_COOKIE_NAME, expected, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS_SECONDS,
  });
  return response;
}
