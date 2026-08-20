import { NextResponse } from "next/server";

import { hasPin, hasValidBearer } from "@/lib/auth";
import {
  getKstIso,
  padSeq,
  readJson,
  requestPath,
  slugifyProject,
  writeJson,
} from "@/lib/blob";
import type { DecisionRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ project: string; date: string; seq: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Clear (or restore) an UNANSWERED decision.
 *
 * The owner often resolves a decision outside the app — the situation changes, or
 * the work lands another way — and the card then keeps resurfacing in the inbox and
 * in `pending`. Dismissing flips status to "dismissed" so it drops out of the open
 * list, while the blob itself is kept: a mis-tap is undone with {restore:true}.
 *
 * Answered requests are refused (409) — their answer is a real decision record and
 * the pickup flow, not this route, owns their lifecycle.
 */
export async function POST(request: Request, context: RouteContext) {
  const viaPin = hasPin(request);
  if (!viaPin && !hasValidBearer(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { project: rawProject, date, seq: rawSeq } = await context.params;
  let project: string;
  try {
    project = slugifyProject(rawProject);
  } catch {
    return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{3}$/.test(rawSeq)) {
    return NextResponse.json({ error: "Invalid request slug" }, { status: 400 });
  }
  const numericSeq = Number(rawSeq);
  if (numericSeq < 1 || numericSeq > 999) {
    return NextResponse.json({ error: "Invalid request slug" }, { status: 400 });
  }
  const slug = `${project}/${date}/${padSeq(numericSeq)}`;

  // Body is optional: no body / empty body = dismiss.
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const restore = isRecord(body) && body.restore === true;

  let decisionRequest: DecisionRequest;
  try {
    decisionRequest = await readJson<DecisionRequest>(requestPath(slug));
  } catch {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  if (decisionRequest.status === "answered") {
    return NextResponse.json(
      { error: "Answered decisions cannot be dismissed" },
      { status: 409 },
    );
  }

  const nextStatus: DecisionRequest["status"] = restore ? "open" : "dismissed";
  if (decisionRequest.status === nextStatus) {
    // Idempotent: a double-tap (or a retried request) is not an error.
    return NextResponse.json({ ok: true, slug, status: nextStatus });
  }

  const updated: DecisionRequest = {
    ...decisionRequest,
    status: nextStatus,
    dismissedAt: restore ? null : getKstIso(),
    ...(restore ? {} : { dismissedVia: viaPin ? "pin" : "bearer" }),
  };
  if (restore) delete updated.dismissedVia;

  try {
    await writeJson(requestPath(slug), updated);
  } catch (error) {
    console.error("Unable to update dismissal", error);
    return NextResponse.json(
      { error: "Unable to update request" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, slug, status: nextStatus });
}
