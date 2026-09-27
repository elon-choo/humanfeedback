import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { hasPin, hasValidBearer } from "@/lib/auth";
import {
  answerPath,
  answerPrefix,
  getKstIso,
  listPrefix,
  padSeq,
  requestPath,
  slugifyProject,
  writeJson,
  readJson,
} from "@/lib/blob";
import { parseOptionNumber } from "@/lib/parseNumber";
import { transcribeAudioUrls } from "@/lib/stt";
import type {
  AnswerKind,
  CreateDecisionAnswer,
  DecisionAnswer,
  DecisionRequest,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ project: string; date: string; seq: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validKind(value: unknown): value is AnswerKind {
  return value === "voice" || value === "text" || value === "number";
}

function generateAnswerId(): string {
  return `a_${randomBytes(6).toString("base64url").slice(0, 6)}`;
}

function audioPathname(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname.endsWith(".blob.vercel-storage.com")
    ) {
      return null;
    }
    return decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
}

function validateAudioUrls(
  audioUrls: string[],
  slug: string,
): { error: string | null; answerId: string | null } {
  if (audioUrls.length > 120) {
    return { error: "A maximum of 120 audio segments is allowed", answerId: null };
  }

  const prefix = `audio/${slug}/`;
  let sharedAnswerId: string | null = null;

  for (let index = 0; index < audioUrls.length; index += 1) {
    const pathname = audioPathname(audioUrls[index]);
    if (!pathname || !pathname.startsWith(prefix)) {
      return { error: "Every audio URL must be associated with this request", answerId: null };
    }

    const filename = pathname.slice(prefix.length);
    const match = /^(a_[A-Za-z0-9_-]{6})-(\d+)\.webm$/.exec(
      filename,
    );
    if (!match) {
      return { error: "Invalid audio segment pathname", answerId: null };
    }

    if (Number(match[2]) !== index) {
      return { error: "Audio segment indexes must match array order", answerId: null };
    }
    if (sharedAnswerId && sharedAnswerId !== match[1]) {
      return { error: "Audio segments must share one answer ID", answerId: null };
    }
    sharedAnswerId = match[1];
  }

  return { error: null, answerId: sharedAnswerId };
}

function clampChosenOption(value: unknown, optionCount: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(optionCount, Math.max(1, Math.trunc(value)));
}

function validateBody(value: unknown): string | null {
  if (!isRecord(value)) return "Body must be a JSON object";
  if (!validKind(value.kind)) return "kind must be voice, text, or number";
  if (
    value.chosenOption !== undefined &&
    (typeof value.chosenOption !== "number" || !Number.isFinite(value.chosenOption))
  ) {
    return "chosenOption must be a number";
  }
  if (value.text !== undefined && typeof value.text !== "string") {
    return "text must be a string";
  }
  if (
    value.audioUrls !== undefined &&
    (!Array.isArray(value.audioUrls) ||
      !value.audioUrls.every((url) => typeof url === "string"))
  ) {
    return "audioUrls must be an array of strings";
  }
  if (
    value.durationSec !== undefined &&
    (typeof value.durationSec !== "number" ||
      !Number.isFinite(value.durationSec) ||
      value.durationSec < 0)
  ) {
    return "durationSec must be a non-negative number";
  }
  if (value.secrets !== undefined && !Array.isArray(value.secrets)) {
    return "secrets must be an array";
  }
  if (value.attachments !== undefined && !Array.isArray(value.attachments)) {
    return "attachments must be an array";
  }
  return null;
}

// Answers for ONE request, bearer-only. GET /api/answers lists every request and every
// answer blob (bounded Blob concurrency), which times out once the store holds hundreds
// of cards; this path reads only ans/<slug>/ so a caller waiting on a single card stays fast.
export async function GET(request: Request, context: RouteContext) {
  if (!hasValidBearer(request)) {
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

  try {
    const blobs = (await listPrefix(answerPrefix(slug))).filter((blob) =>
      blob.pathname.endsWith(".json"),
    );
    const settled = await Promise.allSettled(
      blobs.map((blob) => readJson<DecisionAnswer>(blob.pathname)),
    );
    const answers = settled
      .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    return NextResponse.json({ slug, answers, unreadable: blobs.length - answers.length });
  } catch (error) {
    console.error("Unable to read answers for", slug, error);
    return NextResponse.json({ error: "Unable to read answers" }, { status: 500 });
  }
}

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
  // Build the slug from the CANONICAL (slugified/NFKC) project so a Korean/unicode
  // project delivered in a different normalization form (e.g. NFD) still matches the
  // stored blob key. slugifyProject already strips "/" and "." so no path traversal.
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^\d{3}$/.test(rawSeq)
  ) {
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

  const validationError = validateBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  const input = body as CreateDecisionAnswer;

  let decisionRequest: DecisionRequest;
  try {
    decisionRequest = await readJson<DecisionRequest>(requestPath(slug));
  } catch {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const audioUrls = input.audioUrls ?? [];
  const audioValidation = validateAudioUrls(audioUrls, slug);
  if (audioValidation.error) {
    return NextResponse.json(
      { error: audioValidation.error },
      { status: 400 },
    );
  }

  let transcript: string | null = null;
  if (audioUrls.length > 0) {
    try {
      transcript = await transcribeAudioUrls(audioUrls);
    } catch (error) {
      console.error("Unable to transcribe answer", error);
      return NextResponse.json(
        { error: "Unable to transcribe audio" },
        { status: 502 },
      );
    }
  }

  const optionCount = decisionRequest.options.length;
  let chosenOption =
    input.chosenOption === undefined
      ? null
      : clampChosenOption(input.chosenOption, optionCount);
  if (chosenOption === null) {
    chosenOption = parseOptionNumber(
      [transcript, input.text].filter(Boolean).join(" "),
      optionCount,
    );
  }

  const answerId = audioValidation.answerId ?? generateAnswerId();
  const createdAt = getKstIso();
  const answer: DecisionAnswer = {
    answerId,
    slug,
    createdAt,
    kind: input.kind,
    chosenOption,
    transcript,
    text: input.kind === "text" ? input.text?.trim() || null : null,
    audioUrls,
    durationSec: input.durationSec ?? 0,
    pickedUp: false,
    // Server-stamped, never from the client body: which credential authenticated
    // THIS POST. hasPin() = owner PIN cookie (phone); otherwise the shared bearer
    // token. A downstream that must prove a human answered requires "pin".
    answeredVia: hasPin(request) ? "pin" : "bearer",
    ...(input.secrets !== undefined ? { secrets: input.secrets } : {}),
    ...(input.attachments !== undefined
      ? { attachments: input.attachments }
      : {}),
  };

  try {
    await writeJson(answerPath(slug, answerId), answer);
    await writeJson(requestPath(slug), {
      ...decisionRequest,
      status: "answered",
      answeredAt: decisionRequest.answeredAt ?? createdAt,
    } satisfies DecisionRequest);
  } catch (error) {
    console.error("Unable to save answer", error);
    return NextResponse.json(
      { error: "Unable to save answer" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    answerId,
    transcript,
    chosenOption,
  });
}
