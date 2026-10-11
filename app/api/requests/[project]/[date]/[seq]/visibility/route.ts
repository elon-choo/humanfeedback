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
 * Pin an open decision to the main list ("keep"), park it in the archive
 * ("dormant"), or hand it back to the age rule ("auto").
 *
 * The main list drops cards after a week (lib/lifecycle.ts). Some must stay in
 * front of the owner however old they get — a payment or send approval, an
 * incident still in progress — and some he wants out of the way without
 * calling them handled. Nothing is deleted either way, and who set it is
 * stamped like a dismissal.
 *
 * Answered and dismissed requests are refused (409): they are not listed.
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

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const visibility = isRecord(body) ? body.visibility : undefined;
  if (visibility !== "keep" && visibility !== "dormant" && visibility !== "auto") {
    return NextResponse.json(
      { error: "visibility must be keep, dormant, or auto" },
      { status: 400 },
    );
  }

  // Decided inside updateJson, on the version that is then written: an answer
  // or a dismissal landing in between is seen, not overwritten.
  let closed = false;
  try {
    await updateJson<DecisionRequest>(requestPath(slug), (current) => {
      closed = current.status !== "open";
      // Idempotent: a double-tap (or a retried request) is not an error.
      if (closed || (current.visibility ?? "auto") === visibility) return null;

      const updated: DecisionRequest = { ...current };
      if (visibility === "auto") {
        delete updated.visibility;
        delete updated.visibilitySetAt;
        delete updated.visibilitySetVia;
      } else {
        updated.visibility = visibility;
        updated.visibilitySetAt = getKstIso();
        updated.visibilitySetVia = viaPin ? "pin" : "bearer";
      }
      return updated;
    });
  } catch (error) {
    if (isBlobNotFound(error)) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    console.error("Unable to update visibility", error);
    return NextResponse.json(
      { error: "Unable to update request" },
      { status: 500 },
    );
  }

  if (closed) {
    return NextResponse.json(
      { error: "Only open decisions have a list placement" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, slug, visibility });
}
