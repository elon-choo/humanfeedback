import { NextResponse } from "next/server";

import { requireBearer } from "@/lib/auth";
import { answerPrefix, listPrefix, readJson, writeJson } from "@/lib/blob";
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
        const answer = await readJson<DecisionAnswer>(blob.pathname);
        if (answer.pickedUp) continue;
        await writeJson(blob.pathname, { ...answer, pickedUp: true });
        updated += 1;
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
