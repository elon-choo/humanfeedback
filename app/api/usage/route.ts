import { NextResponse } from "next/server";

import { requireBearer } from "@/lib/auth";
import { getKstIso, readJson, writeJson } from "@/lib/blob";
import type { UsageAccount, UsageSnapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

const USAGE_PATH = "usage/latest.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A usage window ({pct, resetsAt?, countdown?}) sanitized to known primitive fields. */
function window(value: unknown) {
  if (!isRecord(value)) return null;
  const pct = num(value.pct);
  if (pct === null) return null;
  return {
    pct,
    resetsAt: str(value.resetsAt) ?? undefined,
    countdown: str(value.countdown) ?? undefined,
  };
}

/** Accept only the fields we render; drop anything else the pusher may send. */
function sanitizeAccounts(value: unknown): UsageAccount[] | null {
  if (!Array.isArray(value)) return null;
  const out: UsageAccount[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const number = num(raw.number);
    const email = str(raw.email);
    if (number === null || email === null) continue;
    out.push({
      number,
      email,
      active: raw.active === true,
      fiveHour: window(raw.fiveHour),
      sevenDay: window(raw.sevenDay),
      fable: window(raw.fable),
    });
  }
  return out;
}

export async function POST(request: Request): Promise<NextResponse> {
  const unauthorized = requireBearer(request);
  if (unauthorized) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const accounts = sanitizeAccounts(body.accounts);
  if (!accounts) {
    return NextResponse.json({ error: "accounts must be an array" }, { status: 400 });
  }

  const snapshot: UsageSnapshot = {
    accounts,
    // The pusher's own clock (best-effort) plus the server receipt time (authoritative for staleness).
    sourceUpdatedAt: str(body.updatedAt) ?? undefined,
    receivedAt: getKstIso(),
  };

  await writeJson(USAGE_PATH, snapshot);
  return NextResponse.json({ ok: true, accounts: accounts.length });
}

export async function GET(): Promise<NextResponse> {
  try {
    const snapshot = await readJson<UsageSnapshot>(USAGE_PATH);
    return NextResponse.json(snapshot);
  } catch {
    // No snapshot yet (pusher hasn't run) — not an error, just empty.
    return NextResponse.json({ accounts: [], receivedAt: null });
  }
}
