import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { requireBearer } from "@/lib/auth";
import {
  createRequestAtNextSeq,
  getKstDate,
  getKstIso,
  listCompletenessHeader,
  listRequests,
  listedReadStats,
  newListCompleteness,
  slugifyProject,
} from "@/lib/blob";
import { withLifecycle } from "@/lib/lifecycle";
import type {
  CreateDecisionRequest,
  DecisionRequest,
  Urgency,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const urgencyOrder: Record<Urgency, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validRecipientPublicKey(value: string): boolean {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    return false;
  }

  const rawKey = Buffer.from(value, "base64");
  return (
    rawKey.length === 65 &&
    rawKey[0] === 0x04 &&
    rawKey.toString("base64") === value
  );
}

function validateCreateRequest(value: unknown): string | null {
  if (!isRecord(value)) return "Body must be a JSON object";

  const requiredStrings = [
    "project",
    "cwd",
    "machine",
    "title",
    "tldr",
    "whyNow",
    "context",
    "stakes",
    "ifIgnored",
  ];
  for (const field of requiredStrings) {
    if (typeof value[field] !== "string" || value[field].trim() === "") {
      return `${field} is required`;
    }
  }

  if ((value.title as string).length > 80) {
    return "title must be 80 characters or fewer";
  }
  if (!(["low", "medium", "high"] as unknown[]).includes(value.urgency)) {
    return "urgency must be low, medium, or high";
  }
  if (!Array.isArray(value.options) || value.options.length === 0) {
    return "options must be a non-empty array";
  }
  if (typeof value.allowFreeform !== "boolean") {
    return "allowFreeform must be a boolean";
  }
  if (value.recommendation !== null && !isRecord(value.recommendation)) {
    return "recommendation must be an object or null";
  }

  if (value.sessionId !== undefined && typeof value.sessionId !== "string") {
    return "sessionId must be a string";
  }
  if (value.sessionLabel !== undefined && typeof value.sessionLabel !== "string") {
    return "sessionLabel must be a string";
  }
  if (value.keepVisible !== undefined && typeof value.keepVisible !== "boolean") {
    return "keepVisible must be a boolean";
  }

  if (
    value.secretRequests !== undefined &&
    !Array.isArray(value.secretRequests)
  ) {
    return "secretRequests must be an array";
  }

  const secretRequests = value.secretRequests as unknown[] | undefined;
  if (
    secretRequests !== undefined &&
    !secretRequests.every(
      (secretRequest) =>
        isRecord(secretRequest) &&
        typeof secretRequest.id === "string" &&
        secretRequest.id.trim() !== "" &&
        typeof secretRequest.label === "string" &&
        secretRequest.label.trim() !== "" &&
        typeof secretRequest.hint === "string" &&
        typeof secretRequest.required === "boolean",
    )
  ) {
    return "secretRequests entries must include id, label, hint, and required";
  }

  if (
    value.recipientPubKey !== undefined &&
    (typeof value.recipientPubKey !== "string" ||
      !validRecipientPublicKey(value.recipientPubKey))
  ) {
    return "recipientPubKey must be a base64 raw uncompressed P-256 public key";
  }

  if (secretRequests) {
    const secretRequestIds = secretRequests.map(
      (secretRequest) => (secretRequest as Record<string, unknown>).id,
    );
    if (new Set(secretRequestIds).size !== secretRequestIds.length) {
      return "secretRequests ids must be unique";
    }
  }

  const hasSecretRequests = (secretRequests?.length ?? 0) > 0;
  const hasRecipientPubKey = typeof value.recipientPubKey === "string";
  if (hasSecretRequests !== hasRecipientPubKey) {
    return "recipientPubKey is required exactly when secretRequests are present";
  }

  const recommendedCount = value.options.filter(
    (option) => isRecord(option) && option.recommended === true,
  ).length;
  if (recommendedCount > 1) return "at most one option may be recommended";

  return null;
}

function requestOrigin(request: Request): string {
  const origin = request.headers.get("origin");
  if (origin) return origin.replace(/\/$/, "");

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const protocol = request.headers.get("x-forwarded-proto") ?? "https";
    return `${protocol}://${forwardedHost}`.replace(/\/$/, "");
  }

  return new URL(request.url).origin;
}

function validSince(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NaN : timestamp;
}

export async function POST(request: Request) {
  const unauthorized = requireBearer(request);
  if (unauthorized) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validationError = validateCreateRequest(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    const input = body as CreateDecisionRequest;
    const project = slugifyProject(input.project);
    const now = new Date();
    const date = getKstDate(now);
    const createdAt = getKstIso(now);
    const creationId = randomUUID();
    const buildRequest = (slug: string, seq: number) => ({
      creationId,
      slug,
      project,
      date,
      seq,
      status: "open" as const,
      urgency: input.urgency,
      createdAt,
      answeredAt: null,
      ...(input.keepVisible === true
        ? {
            visibility: "keep" as const,
            visibilitySetAt: createdAt,
            visibilitySetVia: "bearer" as const,
          }
        : {}),
      cwd: input.cwd,
      machine: input.machine,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.sessionLabel !== undefined
        ? { sessionLabel: input.sessionLabel }
        : {}),
      title: input.title,
      tldr: input.tldr,
      whyNow: input.whyNow,
      context: input.context,
      stakes: input.stakes,
      options: input.options,
      recommendation: input.recommendation,
      ifIgnored: input.ifIgnored,
      allowFreeform: input.allowFreeform,
      ...(input.secretRequests !== undefined
        ? { secretRequests: input.secretRequests }
        : {}),
      ...(input.recipientPubKey !== undefined
        ? { recipientPubKey: input.recipientPubKey }
        : {}),
    }) satisfies DecisionRequest;

    const { slug, seq } = await createRequestAtNextSeq(
      project,
      date,
      buildRequest,
    );

    return NextResponse.json({
      slug,
      url: `${requestOrigin(request)}/${slug}`,
      seq,
    });
  } catch (error) {
    console.error("Unable to create decision request", error);
    return NextResponse.json(
      { error: "Unable to create request" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const unauthorized = requireBearer(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const project = searchParams.get("project");
  const cwd = searchParams.get("cwd");
  const sessionId = searchParams.get("sessionId");
  const since = validSince(searchParams.get("since"));
  // Open cards only: where the card is shown (lib/lifecycle.ts).
  const view = searchParams.get("view");

  if (
    status &&
    status !== "open" &&
    status !== "answered" &&
    status !== "dismissed"
  ) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  if (view && view !== "active" && view !== "dormant" && view !== "superseded") {
    return NextResponse.json({ error: "Invalid view" }, { status: 400 });
  }
  if (Number.isNaN(since)) {
    return NextResponse.json({ error: "Invalid since timestamp" }, { status: 400 });
  }

  try {
    const completeness = newListCompleteness();
    // Annotated before filtering: a card is superseded by a newer copy of any
    // status, in any filter result.
    const requests = withLifecycle(
      await listRequests("req/", completeness),
      Date.now(),
    )
      .filter((item) => !status || item.status === status)
      .filter((item) => !view || item.view === view)
      .filter((item) => !project || item.project === project)
      .filter((item) => !cwd || item.cwd === cwd)
      .filter((item) => !sessionId || item.sessionId === sessionId)
      .filter(
        (item) =>
          since === null || new Date(item.createdAt).getTime() >= since,
      )
      .sort((left, right) => {
        const urgencyDifference =
          urgencyOrder[left.urgency] - urgencyOrder[right.urgency];
        if (urgencyDifference !== 0) return urgencyDifference;
        return Date.parse(left.createdAt) - Date.parse(right.createdAt);
      });

    return NextResponse.json(
      { requests, completeness },
      {
        headers: {
          "x-blob-reads": listedReadStats(),
          "x-list-completeness": listCompletenessHeader(completeness),
        },
      },
    );
  } catch (error) {
    console.error("Unable to list decision requests", error);
    return NextResponse.json(
      { error: "Unable to list requests" },
      { status: 500 },
    );
  }
}
