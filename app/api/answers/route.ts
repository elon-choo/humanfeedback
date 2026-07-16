import { NextResponse } from "next/server";

import { requireBearer } from "@/lib/auth";
import { answerPrefix, listPrefix, listRequests, readJson } from "@/lib/blob";
import type {
  AnswerInboxItem,
  DecisionAnswer,
  DecisionRequest,
} from "@/lib/types";

export const dynamic = "force-dynamic";

function parseSince(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NaN : timestamp;
}

async function answersForRequest(
  request: DecisionRequest,
  since: number | null,
  unpickedOnly: boolean,
): Promise<DecisionAnswer[]> {
  const blobs = (await listPrefix(answerPrefix(request.slug))).filter((blob) =>
    blob.pathname.endsWith(".json"),
  );
  const settled = await Promise.allSettled(
    blobs.map((blob) => readJson<DecisionAnswer>(blob.pathname)),
  );

  return settled
    .flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    )
    .filter((answer) => !unpickedOnly || !answer.pickedUp)
    .filter(
      (answer) =>
        since === null || Date.parse(answer.createdAt) >= since,
    )
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

export async function GET(request: Request) {
  const unauthorized = requireBearer(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const cwd = searchParams.get("cwd");
  const project = searchParams.get("project");
  const since = parseSince(searchParams.get("since"));
  const unpickedOnly = searchParams.get("unpickedOnly") === "1";

  if (Number.isNaN(since)) {
    return NextResponse.json({ error: "Invalid since timestamp" }, { status: 400 });
  }

  try {
    const matchingRequests = (await listRequests())
      .filter((item) => !cwd || item.cwd === cwd)
      .filter((item) => !project || item.project === project);

    const resolved = await Promise.all(
      matchingRequests.map(async (decisionRequest) => {
        const answers = await answersForRequest(
          decisionRequest,
          since,
          unpickedOnly,
        );
        const effectiveRequest: DecisionRequest =
          answers.length > 0 && decisionRequest.status !== "answered"
            ? {
                ...decisionRequest,
                status: "answered",
                answeredAt: decisionRequest.answeredAt ?? answers[0].createdAt,
              }
            : decisionRequest;

        return {
          request: effectiveRequest,
          answers,
        } satisfies AnswerInboxItem;
      }),
    );

    const items = resolved
      .filter((item) => item.answers.length > 0)
      .sort(
        (left, right) =>
          Date.parse(left.answers[0].createdAt) -
          Date.parse(right.answers[0].createdAt),
      );

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Unable to list answers", error);
    return NextResponse.json(
      { error: "Unable to list answers" },
      { status: 500 },
    );
  }
}
