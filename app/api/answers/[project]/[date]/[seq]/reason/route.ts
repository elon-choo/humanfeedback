import { NextResponse } from "next/server";

import { hasPin, hasValidBearer } from "@/lib/auth";
import {
  answerPath,
  getKstIso,
  isBlobNotFound,
  padSeq,
  slugifyProject,
  updateJson,
} from "@/lib/blob";
import type { DecisionAnswer } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ project: string; date: string; seq: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Adds the owner's one-line reason to a number answer he just gave.
 *
 * Written onto that answer (as its `text`) rather than posted as a new answer:
 * a new answer would become "the latest answer" and could undo a correction he
 * made in the meantime, and it would show up as a second decision. The choice,
 * the answer time and the pickup state are left as they were.
 */
export async function POST(request: Request, context: RouteContext) {
  if (!hasPin(request) && !hasValidBearer(request)) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const answerId = isRecord(body) ? body.answerId : undefined;
  const reason = isRecord(body) && typeof body.reason === "string" ? body.reason.trim() : "";
  if (typeof answerId !== "string" || !/^a_[A-Za-z0-9_-]{1,40}$/.test(answerId)) {
    return NextResponse.json({ error: "Invalid answerId" }, { status: 400 });
  }
  if (!reason || reason.length > 500) {
    return NextResponse.json({ error: "reason must be 1–500 characters" }, { status: 400 });
  }

  let refused: string | null = null;
  try {
    await updateJson<DecisionAnswer>(answerPath(slug, answerId), (current) => {
      if (current.kind !== "number" || current.chosenOption === null) {
        refused = "Only a number answer takes a reason";
        return null;
      }
      if (current.text === reason) return null; // a retried request
      if (current.text) {
        refused = "This answer already has a reason";
        return null;
      }
      return { ...current, text: reason, reasonAt: getKstIso() };
    });
  } catch (error) {
    if (isBlobNotFound(error)) {
      return NextResponse.json({ error: "Answer not found" }, { status: 404 });
    }
    console.error("Unable to save reason", error);
    return NextResponse.json({ error: "Unable to save reason" }, { status: 500 });
  }
  if (refused) return NextResponse.json({ error: refused }, { status: 409 });

  return NextResponse.json({ ok: true });
}
