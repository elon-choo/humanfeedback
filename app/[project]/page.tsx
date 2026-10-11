import type { Metadata } from "next";

import { BatchAnswerView } from "@/components/batch-answer-view";
import { getOpenRequests } from "@/components/server-data";
import { slugifyProject } from "@/lib/blob";

export const dynamic = "force-dynamic";

type ProjectPageProps = {
  params: Promise<{ project: string }>;
};

// Decode (page params can arrive URL-encoded for unicode) then canonicalize
// (slugify/NFKC) so a unicode project resolves regardless of URL form.
function canonicalProject(raw: string): string {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* malformed %-sequence: fall back to raw */
  }
  try {
    return slugifyProject(decoded);
  } catch {
    return decoded;
  }
}

export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  const { project } = await params;
  return { title: `${canonicalProject(project)} 결정` };
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { project: rawProject } = await params;
  const project = canonicalProject(rawProject);
  const { requests, hidden, unavailable } = await getOpenRequests(project);

  return (
    <BatchAnswerView
      project={project}
      requests={requests}
      hidden={hidden}
      unavailable={unavailable}
      renderedAt={Date.now()}
    />
  );
}
