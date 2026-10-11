import { NextResponse } from "next/server";

import { requireBearer } from "@/lib/auth";
import { answerPrefix, listPrefix, updateJson } from "@/lib/blob";
import type { DecisionAnswer } from "@/lib/types";

export const dynamic = "force-dynamic";

function validSlug(slug: string): boolean {
  return /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*\/\d{4}-\d{2}-\d{2}\/\d{3}$/u.test(
    slug,
  );
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

  if (
    typeof body !== "object" ||
    body === null ||
    !("slugs" in body) ||
    !Array.isArray(body.slugs) ||
    !body.slugs.every((slug) => typeof slug === "string" && validSlug(slug))
  ) {
    return NextResponse.json(
      { error: "slugs must be an array of request slugs" },
      { status: 400 },
    );
  }

  let updated = 0;
  try {
    for (const slug of new Set(body.slugs as string[])) {
      const blobs = (await listPrefix(answerPrefix(slug))).filter((blob) =>
        blob.pathname.endsWith(".json"),
      );
      for (const blob of blobs) {
        // Only the flag changes, on the stored version: a reason added to the
        // answer meanwhile must not be written over with an older copy.
        const { written } = await updateJson<DecisionAnswer>(blob.pathname, (answer) =>
          answer.pickedUp ? null : { ...answer, pickedUp: true },
        );
        if (written) updated += 1;
      }
    }
  } catch (error) {
    console.error("Unable to mark answers picked up", error);
    return NextResponse.json(
      { error: "Unable to pick up answers" },
      { status: 500 },
    );
  }

  return NextResponse.json({ updated });
}
