import type { ListBlobResultBlob } from "@vercel/blob";
import { NextResponse } from "next/server";

import { requireBearer } from "@/lib/auth";
import {
  listPrefix,
  readListedBlobs,
  readListedJson,
  slugFromAnswerPath,
  slugFromRequestPath,
} from "@/lib/blob";
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

async function readAnswers(
  blobs: ListBlobResultBlob[],
  since: number | null,
  unpickedOnly: boolean,
): Promise<DecisionAnswer[]> {
  return (await readListedBlobs<DecisionAnswer>(blobs))
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
    // Two list calls for the whole store, then read only cards that have at
    // least one answer blob. Listing ans/<slug>/ once per card plus a head()
    // per blob took this route past the 300 s function limit (2026-09-27).
    const [requestBlobs, answerBlobs] = await Promise.all([
      listPrefix("req/"),
      listPrefix("ans/"),
    ]);

    const answerBlobsBySlug = new Map<string, ListBlobResultBlob[]>();
    for (const blob of answerBlobs) {
      const slug = slugFromAnswerPath(blob.pathname);
      if (!slug) continue;
      const group = answerBlobsBySlug.get(slug);
      if (group) group.push(blob);
      else answerBlobsBySlug.set(slug, [blob]);
    }

    const answeredRequestBlobs = requestBlobs.flatMap((blob) => {
      const slug = slugFromRequestPath(blob.pathname);
      const answers = slug ? answerBlobsBySlug.get(slug) : undefined;
      // A slug always starts with its project (POST builds it that way), so
      // the project filter can skip reads here; it is re-checked on content.
      if (!slug || !answers || (project && !slug.startsWith(`${project}/`))) {
        return [];
      }
      return [{ blob, answers }];
    });

    const loaded = await Promise.allSettled(
      answeredRequestBlobs.map(async ({ blob, answers }) => ({
        decisionRequest: await readListedJson<DecisionRequest>(blob),
        answerBlobs: answers,
      })),
    );
    const matchingRequests = loaded
      .flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      )
      .filter(({ decisionRequest }) => !cwd || decisionRequest.cwd === cwd)
      .filter(
        ({ decisionRequest }) =>
          !project || decisionRequest.project === project,
      );

    const resolved = await Promise.all(
      matchingRequests.map(async ({ decisionRequest, answerBlobs }) => {
        const answers = await readAnswers(answerBlobs, since, unpickedOnly);
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
