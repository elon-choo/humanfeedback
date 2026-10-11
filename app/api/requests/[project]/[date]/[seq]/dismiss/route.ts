import { NextResponse } from "next/server";

import { hasPin, hasValidBearer } from "@/lib/auth";
import {
  getKstIso,
  isBlobNotFound,
  padSeq,
  requestPath,
  slugifyProject,
  updateJson,
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

  const nextStatus: DecisionRequest["status"] = restore ? "open" : "dismissed";
  // Decided inside updateJson, on the version that is then written: a read
  // from before an answer must not put "dismissed" (or "open") back over it.
  let answered = false;
  try {
    await updateJson<DecisionRequest>(requestPath(slug), (current) => {
      answered = current.status === "answered";
      // Idempotent: a double-tap (or a retried request) is not an error.
      if (answered || current.status === nextStatus) return null;

      const updated: DecisionRequest = {
        ...current,
        status: nextStatus,
        dismissedAt: restore ? null : getKstIso(),
        ...(restore ? {} : { dismissedVia: viaPin ? "pin" : "bearer" }),
      };
      if (restore) delete updated.dismissedVia;
      return updated;
    });
  } catch (error) {
    if (isBlobNotFound(error)) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    console.error("Unable to update dismissal", error);
    return NextResponse.json(
      { error: "Unable to update request" },
      { status: 500 },
    );
  }

  if (answered) {
    return NextResponse.json(
      { error: "Answered decisions cannot be dismissed" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, slug, status: nextStatus });
}
