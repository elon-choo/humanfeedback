import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DecisionContent } from "@/components/decision-content";
import { getDecisionRequest } from "@/components/server-data";
import { slugifyProject } from "@/lib/blob";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DecisionPageProps = {
  params: Promise<{ project: string; date: string; seq: string }>;
};

async function loadRequest(params: DecisionPageProps["params"]) {
  const { project, date, seq } = await params;
  // Page-component params can arrive URL-ENCODED for unicode segments (Next.js App
  // Router route-handlers decode, page params may not), so decode first, then
  // canonicalize (slugify/NFKC) to match the stored blob key. Both steps are safe
  // no-ops on already-decoded/ASCII input.
  let canonical: string;
  try {
    let decoded = project;
    try {
      decoded = decodeURIComponent(project);
    } catch {
      /* malformed %-sequence: fall back to raw */
    }
    canonical = slugifyProject(decoded);
  } catch {
    return null;
  }
  return getDecisionRequest(`${canonical}/${date}/${seq}`);
}

export async function generateMetadata({ params }: DecisionPageProps): Promise<Metadata> {
  const request = await loadRequest(params);
  return {
    title: request?.title ?? "결정을 찾을 수 없음",
    description: request?.tldr,
  };
}

export default async function DecisionPage({ params }: DecisionPageProps) {
  const request = await loadRequest(params);
  if (!request) notFound();

  return <DecisionContent request={request} />;
}
