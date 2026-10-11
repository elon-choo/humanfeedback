import "server-only";

import { listRequests, readJson, requestPath } from "@/lib/blob";
import { type ListedDecisionRequest, withLifecycle } from "@/lib/lifecycle";
import type { DecisionRequest, UsageSnapshot } from "@/lib/types";

const urgencyRank = { high: 0, medium: 1, low: 2 } as const;

export function sortOpenRequests<T extends DecisionRequest>(requests: T[]) {
  return requests
    .filter((request) => request.status === "open")
    .sort((a, b) => {
      const urgency = urgencyRank[a.urgency] - urgencyRank[b.urgency];
      if (urgency !== 0) return urgency;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
}

/** Open cards kept out of the main list (lib/lifecycle.ts), by reason. */
export type HiddenCounts = { dormant: number; superseded: number };

// The main list: open cards the lifecycle rule keeps in front of the owner.
// The rest are counted here and listed by getArchive().
export async function getOpenRequests(project?: string) {
  try {
    const all = withLifecycle(await listRequests(), Date.now());
    const open = sortOpenRequests(
      project ? all.filter((request) => request.project === project) : all,
    );
    const hidden: HiddenCounts = {
      dormant: open.filter((request) => request.view === "dormant").length,
      superseded: open.filter((request) => request.view === "superseded").length,
    };
    return {
      requests: open.filter((request) => request.view === "active"),
      hidden,
      unavailable: false,
    };
  } catch (error) {
    console.error("결정 목록을 불러오지 못했습니다.", error);
    return {
      requests: [] as ListedDecisionRequest[],
      hidden: { dormant: 0, superseded: 0 } as HiddenCounts,
      unavailable: true,
    };
  }
}

/** Older copies of one card, shown as a single row. */
export type RepeatGroup = {
  /** The newest copy: the one that is (or was) in the main list. */
  newest: DecisionRequest;
  hiddenCount: number;
  firstCreatedAt: string;
};

// Everything the main list leaves out, nothing deleted: cards past the age
// rule or parked by hand, older copies of a repeated card, and cards the owner
// cleared with "이미 처리했어요".
export async function getArchive() {
  try {
    const all = withLifecycle(await listRequests(), Date.now());
    const bySlug = new Map(all.map((request) => [request.slug, request]));
    const newestFirst = (a: DecisionRequest, b: DecisionRequest) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

    const repeats = new Map<string, RepeatGroup>();
    for (const request of all) {
      if (request.view !== "superseded" || !request.supersededBy) continue;
      const newest = bySlug.get(request.supersededBy);
      if (!newest) continue;
      const group = repeats.get(newest.slug);
      if (!group) {
        repeats.set(newest.slug, {
          newest,
          hiddenCount: 1,
          firstCreatedAt: request.createdAt,
        });
      } else {
        group.hiddenCount += 1;
        if (request.createdAt < group.firstCreatedAt) {
          group.firstCreatedAt = request.createdAt;
        }
      }
    }

    return {
      dormant: all.filter((request) => request.view === "dormant").sort(newestFirst),
      repeats: [...repeats.values()].sort((a, b) => b.hiddenCount - a.hiddenCount),
      dismissed: all
        .filter((request) => request.status === "dismissed")
        .sort(newestFirst),
      unavailable: false,
    };
  } catch (error) {
    console.error("보관함을 불러오지 못했습니다.", error);
    return {
      dormant: [] as ListedDecisionRequest[],
      repeats: [] as RepeatGroup[],
      dismissed: [] as ListedDecisionRequest[],
      unavailable: true,
    };
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
