import "server-only";

import { listRequests, readJson, requestPath } from "@/lib/blob";
import type { DecisionRequest, UsageSnapshot } from "@/lib/types";

const urgencyRank = { high: 0, medium: 1, low: 2 } as const;

export function sortOpenRequests(requests: DecisionRequest[]) {
  return requests
    .filter((request) => request.status === "open")
    .sort((a, b) => {
      const urgency = urgencyRank[a.urgency] - urgencyRank[b.urgency];
      if (urgency !== 0) return urgency;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
}

export async function getOpenRequests(project?: string) {
  try {
    const requests = await listRequests();
    const open = sortOpenRequests(requests);
    return {
      requests: project ? open.filter((request) => request.project === project) : open,
      unavailable: false,
    };
  } catch (error) {
    console.error("결정 목록을 불러오지 못했습니다.", error);
    return { requests: [] as DecisionRequest[], unavailable: true };
  }
}

export async function getDecisionRequest(slug: string) {
  try {
    return await readJson<DecisionRequest>(requestPath(slug));
  } catch (error) {
    console.error(`결정을 불러오지 못했습니다: ${slug}`, error);
    return null;
  }
}

export async function getUsageSnapshot(): Promise<UsageSnapshot | null> {
  try {
    return await readJson<UsageSnapshot>("usage/latest.json");
  } catch {
    // No snapshot yet (pusher hasn't posted) — render nothing, not an error.
    return null;
  }
}
